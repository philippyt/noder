# Noder

Utforsk norske selskapsnettverk visuelt. Åpen kildekode.

**Web:** [noder.no](https://noder.no)

 **MCP:** `npx noder-mcp`

## Arkitektur

npm workspaces monorepo med tre pakker:

```
packages/
├── core/       @noder/core - API-klient, typer, risikoscoring
├── mcp/        noder-mcp - MCP-server (stdio-transport)
└── web/        SvelteKit-app med D3.js SVG-rendering
```

### `@noder/core`

Ren TypeScript-pakke uten rammeverk-avhengigheter. Wrapper rundt Brønnøysundregistrenes åpne API-er.

| Modul | Ansvar |
|---|---|
| `api.ts` | `getCompany`, `getRoles`, `getFinancials`, `searchCompanies` - alle kall mot `data.brreg.no/enhetsregisteret/api` og `data.brreg.no/regnskapsregisteret/regnskap` |
| `network.ts` | `getNetwork`- bygger `NetworkGraph` fra roller + eierkjeder + underenheter |
| `cache.ts` | In-memory TTL-cache (enheter 24t, roller 24t, regnskap 7d, tomme svar 1t, søk 1t) |
| `rate-limiter.ts` | Token bucket, maks 10 kall per 10s vindu |
| `validate.ts` | `validateOrgnr` (regex `^\d{9}$`), `sanitizeSearchInput` (stripping av `<>'"`, maks 100 tegn) |

Regnskapsregisteret mangler CORS-headere. I nettleseren proxyes kall via SvelteKit-endepunkt `/api/regnskap/[orgnr]` → `data.brreg.no/regnskapsregisteret/regnskap/{orgnr}`. `setRegnskapBaseUrl()` bytter base-URL, hviteliste-begrenset.

### `packages/web`

SvelteKit 2 + Svelte 5 (runes: `$state`, `$props`, `$derived`, `$effect`). Adapter: `adapter-auto`.

**Graf-rendering:** D3.js med SVG. Ingen canvas/WebGL. `Canvas.svelte` kjører en `requestAnimationFrame`-loop som diffchecker `graphStore.version` mot forrige frame og oppdaterer D3-seleksjoner (enter/update/exit). Noder er `<rect>` + `<text>`, kanter er `<line>` med SVG-markører (piler, diamant for eierskap). Zoom/pan via `d3.zoom`.

**Tilstandslagring:** `graph-store.svelte.ts` eksponerer et reaktivt `graphStore`-objekt med `$state`-arrays for noder og kanter. Mutasjoner invaliderer en cached collapsed-edge-struktur (pairKey-deduplisering). Persistens via `localStorage` (`noder:current` for auto-save, `noder:{id}` for navngitte lagringer).

**Deling:** Grafen serialiseres til kompakt JSON `[[orgnr,navn,type,x,y], ...]`, komprimeres med `CompressionStream('deflate-raw')`, base64url-enkodes og legges i `?g=`-parameter. Maks er rundt 8000 tegn.

**Nøkkelfunksjoner:**

- `enrichNode()` - henter selskapsdata, roller, regnskap parallelt. Oppretter kanter til felles personer, selskapsrollehavere (revisorfirma osv.), morselskap og eksisterende person-noder
- `expandPerson()` - oppretter person-node, henter mor/datter-selskaper for alle kilde-selskaper, berike nye noder, kobler alle roller
- `detectOverlaps()` - to-stegs kartlegg-deteksjon. (1) Gjenopprett kanter for selskapsrollehavere, (2) Finn felles personer og opprett enten selskap <-> selskap-kanter eller person-noder
- `runLayout()` - `d3.forceSimulation` med `forceManyBody(-800)`, `forceLink(300)`, `forceCollide(130)`, 200 ticks, animert overgang med easeInOutQuad over 500ms
- `runPathfinding()` - flerstegs BFS: lokal graf -> eierkjeder oppover -> rollebasert bro-søk -> datterselskaps-ekspansjon. Budsjett på 50 API-kall for å ikke være for plagsom.

**Server-side proxy:**
```
/api/regnskap/[orgnr]/+server.ts
```
Validerer 9-sifret orgnr, proxyer til Brreg Regnskapsregisteret, setter `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: private, max-age=3600`.

### `noder-mcp`

MCP-server over stdio. 7 verktøy + 1 ressurs (`noder://guide`):

| Verktøy | Beskrivelse |
|---|---|
| `søk_selskap` | Fritekst-søk -> JSON med orgnr, navn, type |
| `hent_selskap` | Grunndata for ett orgnr |
| `hent_regnskap` | Siste 3 års regnskap, norsk formatering, trendpil |
| `hent_roller` | Styremedlemmer, daglig leder, revisor, regnskapsfører |
| `hent_nettverk` | Nettverksgraf (noder + kanter) fra roller + eierskap |
| `sammenlign_selskaper` | 2–5 selskaper i ASCII-tabell |
| `bygg_graf` | Tar noder/kanter-JSON, komprimerer med `deflateRawSync`, returnerer `noder.no/?g=`-URL |

## Kjøring

```bash
git clone https://github.com/philippyt/noder.git
cd noder
npm install
npm run build -w packages/core
npm run build -w packages/mcp
npm run dev -w packages/web
```

MCP i Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "noder": {
      "command": "npx",
      "args": ["noder-mcp"]
    }
  }
}
```

Claude Code:
```bash
claude mcp add noder -- npx noder-mcp
```

## Datakilder

Alle API-er er åpne og krever ingen autentisering:

| Kilde | Endepunkt | Data |
|---|---|---|
| Enhetsregisteret | `data.brreg.no/enhetsregisteret/api/enheter` | Grunndata, adresse, NACE, organisasjonsform |
| Roller | `data.brreg.no/enhetsregisteret/api/enheter/{orgnr}/roller` | Styremedlemmer, daglig leder, revisor (med fødselsdato) |
| Underenheter | `data.brreg.no/enhetsregisteret/api/underenheter` | Datterselskaper via `?overordnetEnhet={orgnr}` |
| Regnskapsregisteret | `data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` | Omsetning, driftsresultat, årsresultat, egenkapital, gjeld, eiendeler |

Brreg har også `POST /autorisert-api/personer/rolleutskrift` for revers person -> selskap-oppslag, men det krever Maskinporten-autentisering + fødselsnummer. Ikke brukt her.

## Personvern

Noder viser kun offentlig registrerte opplysninger fra Brønnøysundregistrene. Ingen data lagres server-side, alt ligger i nettleserens `localStorage`. MCP-serveren gjør kun utgående kall til Brreg, ingen data sendes tilbake.

---

## TODO

### Rendering: D3/SVG → sigma.js/WebGL

Nåværende rendering er D3.js med SVG-elementer. Hvert node-element er en `<g>` med `<rect>` + `<text>` + sparkline `<polyline>`. `requestAnimationFrame`-loopen re-rendrer hele grafen hver frame ved dirty-check (`graphStore.version`). Dette skalerer greit til rundt 100-200 noder, men SVG DOM-manipulasjon blir flaskehalsen ved større grafer.

**Migreringsplan:**
- Bytt til [sigma.js](https://www.sigmajs.org/) v3 med graphology som graf-datastruktur
- sigma.js rendrer noder/kanter som WebGL-instanced quads, O(1) draw calls uavhengig av node-antall
- Behold D3 kun for `d3.forceSimulation` (layout), dropp D3 DOM-bindinger
- Custom node-program for selskapskortet (type-farge sidebar, navn, orgnr, sparkline som tekstur)
- sigma.js har innebygd zoom/pan, node-hover, click-events. Erstatter `d3.zoom` og manuell hit-testing
- graphology gir effektiv naboskaps-traversering for BFS/kartlegg uten custom adjacency maps

**Estimert kompleksitet:** Stor refaktor. `Canvas.svelte` (600+ linjer) må omskrives. `graph-store.svelte.ts` kan beholdes som kilde, men synkroniseres mot graphology-instansen. Info-overlay (draggbare kantpaneler) må implementeres som HTML-overlay over WebGL-canvasen.

### Brreg totalbestand for naturlig graf-ekspansjon

I dag henter Noder roller per selskap on-demand. For å la grafen ekspandere naturlig (klikk person -> vis alle selskaper de sitter i) trengs revers-oppslag: person -> selskaper.

**Alternativer:**
1. **Brreg autorisert API** (`POST /autorisert-api/personer/rolleutskrift`) - krever Maskinporten M2M-token + fødselsnummer. Ikke realistisk for en åpen webapp.
2. **Brreg totalbestand** - komplett dump av alle enheter/roller. Kan lastes ned og indekseres i en database for revers-oppslag.
   - **Arkitektur:** Cloudflare Worker + D1 (SQLite-edge). Nattlig cron-trigger som henter totalbestand-filen, parser CSV/JSON, skriver til D1. API-endepunkt: `GET /api/person-roles?name={navn}&dob={dato}` -> liste med orgnr + rolle.
   - **Datavolum:** Rundt 1M enheter, rundt 3M rolleinnehavere. D1 gratis-tier er 5GB lagring, 5M reads/dag.
   - **Indeksering:** `CREATE INDEX idx_person ON roles(lower_name, fodselsdato)` for O(log n) oppslag.
   - **Alternativ:** Bygg en precomputed person -> selskaper JSON-blob per unike (navn, fødselsdato)-par, server fra R2/KV.

### Diverse

- **Kartlegg-bug:** Kanter mistes i noen tilfeller ved fjerning og gjenlegging av noder. `detectOverlaps()` har edge-cases rundt label-matching (`e.label === label` er for strikt når navn kan ha ulik kapitalisering).
- **Undo/redo:** `graphStore` har ingen historikk. Implementér som stack av `SerializableState`-snapshots med maks 50 nivåer.
- **Søk i graf:** Cmd+F for å filtre/highlighte noder i eksisterende graf etter navn, orgnr, rolle.
- **Batch-import:** Importer liste med orgnr (CSV/linjeskift) og legg alle til på canvas parallelt med auto-layout.
- **Enhetstest-suite:** Ingen tester i dag. Vitest for `@noder/core` (cache-TTL, rate-limiter, risk-scoring, orgnr-validering). Playwright for e2e (søk -> legg til -> panel viser data).
- **Tilgjengelighet (a11y):** Mange `<div onclick>` uten ARIA-roller. Keyboard-navigasjon i grafen mangler.
- **Mobile responsive:** WelcomeModal advarer, men appen er i praksis ubrukelig på mobil. Vurder read-only touch-navigasjon med pinch-zoom.

## Lisens

MIT