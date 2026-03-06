import { deflateRawSync } from 'node:zlib'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  searchCompanies,
  getCompany,
  getFinancials,
  getRoles,
  getNetwork,
  validateOrgnr,
} from '@noder/core'

function formatNOK(value: number | null): string {
  if (value === null) return 'Ikke tilgjengelig'
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(value)
}

function formatMillKr(value: number | null): string {
  if (value === null) return '-'
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)} mill kr`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)} tusen kr`
  return `${value} kr`
}

function trendArrow(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length < 2) return ''
  const first = nums[nums.length - 1]!, last = nums[0]!
  if (last > first) return ' (trend: opp)'
  if (last < first) return ' (trend: ned)'
  return ' (trend: flat)'
}

const server = new McpServer({
  name: 'noder',
  version: '1.0.0',
})

server.tool(
  'søk_selskap',
  'Søk etter norske selskaper på navn',
  { navn: z.string().min(2).max(100) },
  async ({ navn }) => {
    const results = await searchCompanies(navn)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2),
      }],
    }
  }
)

server.tool(
  'hent_selskap',
  'Hent grunndata om et norsk selskap basert på organisasjonsnummer',
  { orgnr: z.string().min(9).max(11) },
  async ({ orgnr }) => {
    const clean = validateOrgnr(orgnr)
    const company = await getCompany(clean)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(company, null, 2),
      }],
    }
  }
)

server.tool(
  'hent_regnskap',
  'Hent regnskap for siste 3 år med norsk formatering',
  { orgnr: z.string().min(9).max(11) },
  async ({ orgnr }) => {
    const clean = validateOrgnr(orgnr)
    const financials = await getFinancials(clean)

    if (financials.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Ingen regnskapsdata tilgjengelig for dette selskapet.',
        }],
      }
    }

    const lines = financials.map(f => [
      `--- ${f.år} ---`,
      `Omsetning:       ${formatMillKr(f.omsetning)}`,
      `Driftsresultat:  ${formatMillKr(f.driftsresultat)}`,
      `Årsresultat:     ${formatMillKr(f.årsresultat)}`,
      `Egenkapital:     ${formatMillKr(f.egenkapital)}`,
      `Sum gjeld:       ${formatMillKr(f.sum_gjeld)}`,
      `Sum eiendeler:   ${formatMillKr(f.sum_eiendeler)}`,
    ].join('\n'))

    const omsetninger = financials.map(f => f.omsetning)
    const trend = trendArrow(omsetninger)

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n\n') + (trend ? `\n\nOmsetning${trend}` : '') +
          '\n\nMerk: Tallene er hentet fra Brreg Regnskapsregisteret og kan avvike fra selskapets egen rapportering.',
      }],
    }
  }
)

server.tool(
  'hent_roller',
  'Hent styremedlemmer og ledelse for et selskap. Returnerer navn og rolle.',
  { orgnr: z.string().min(9).max(11) },
  async ({ orgnr }) => {
    const clean = validateOrgnr(orgnr)
    const roles = await getRoles(clean)

    if (roles.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Ingen roller registrert for dette selskapet.',
        }],
      }
    }

    const lines = roles.map(r => `${r.type_beskrivelse}: ${r.person.navn}`)

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n'),
      }],
    }
  }
)

server.tool(
  'hent_nettverk',
  'Hent nettverksgraf for et selskap - viser relasjoner til andre selskaper',
  { orgnr: z.string().min(9).max(11) },
  async ({ orgnr }) => {
    const clean = validateOrgnr(orgnr)
    const network = await getNetwork(clean)
    const company = await getCompany(clean)

    const nodeCount = network.nodes.length
    const edgeCount = network.edges.length
    const summary = `${company.navn} er koblet til ${nodeCount - 1} andre selskaper gjennom ${edgeCount} relasjoner.`

    return {
      content: [{
        type: 'text' as const,
        text: [summary, '', JSON.stringify(network, null, 2)].join('\n'),
      }],
    }
  }
)

server.tool(
  'sammenlign_selskaper',
  'Sammenlign to eller flere selskaper side om side — kun objektive regnskapstall',
  { orgnr_liste: z.array(z.string()).min(2).max(5) },
  async ({ orgnr_liste }) => {
    const cleanList = orgnr_liste.map(validateOrgnr)
    const selskaper = await Promise.all(cleanList.map(async orgnr => {
      const [company, financials] = await Promise.all([
        getCompany(orgnr),
        getFinancials(orgnr),
      ])
      return { company, financials }
    }))

    const header = ['Selskap', 'Omsetning', 'Driftsresultat', 'Årsresultat', 'Egenkapital', 'Sum eiendeler', 'Ansatte']
    const rows = selskaper.map(s => {
      const siste = s.financials[0]
      return [
        s.company.navn,
        formatNOK(siste?.omsetning ?? null),
        formatNOK(siste?.driftsresultat ?? null),
        formatNOK(siste?.årsresultat ?? null),
        formatNOK(siste?.egenkapital ?? null),
        formatNOK(siste?.sum_eiendeler ?? null),
        s.company.ansatte?.toString() ?? 'Ukjent',
      ]
    })

    const allRows = [header, ...rows]
    const widths = header.map((_, i) =>
      Math.max(...allRows.map(r => (r[i] ?? '').length))
    )

    const formatRow = (row: string[]) =>
      row.map((cell, i) => cell.padEnd(widths[i]!)).join('  |  ')

    const separator = widths.map(w => '-'.repeat(w)).join('--+--')

    const table = [
      formatRow(header),
      separator,
      ...rows.map(formatRow),
    ].join('\n')

    return {
      content: [{
        type: 'text' as const,
        text: table,
      }],
    }
  }
)

server.tool(
  'bygg_graf',
  'Bygg en visuell nettverksgraf av selskaper og del den som en URL. ' +
  'Returnerer en lenke til Noder-webappen med grafen ferdig lastet.',
  {
    noder: z.array(z.object({
      orgnr: z.string().min(9).max(9).regex(/^\d{9}$/).describe('Organisasjonsnummer (9 siffer)'),
      navn: z.string().min(1).max(200).describe('Selskapsnavn'),
      type: z.string().min(1).max(20).default('AS').describe('Selskapsform, f.eks. AS, ENK, NUF'),
      x: z.number().finite().default(0).describe('X-posisjon i grafen'),
      y: z.number().finite().default(0).describe('Y-posisjon i grafen'),
    })).min(1).max(100).describe('Liste med selskaper som noder'),
    kanter: z.array(z.object({
      fra: z.string().min(9).max(9).regex(/^\d{9}$/).describe('Orgnr for kilde-node'),
      til: z.string().min(9).max(9).regex(/^\d{9}$/).describe('Orgnr for mål-node'),
      tekst: z.string().max(200).default('').describe('Beskrivelse av forbindelsen'),
    })).max(500).default([]).describe('Liste med forbindelser mellom noder'),
  },
  async ({ noder, kanter }) => {
    const allZero = noder.every(n => n.x === 0 && n.y === 0)
    if (allZero && noder.length > 1) {
      const radius = 150 + noder.length * 40
      noder.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / noder.length - Math.PI / 2
        n.x = Math.round(Math.cos(angle) * radius)
        n.y = Math.round(Math.sin(angle) * radius)
      })
    }

    const compact = [
      noder.map(n => [n.orgnr, n.navn, n.type, n.x, n.y]),
      kanter.map(k => [k.fra, k.til, k.tekst]),
    ]
    const compressed = deflateRawSync(JSON.stringify(compact))
    const base64 = compressed.toString('base64url')
    const url = `https://noder.no/?g=${base64}`

    const summary = [
      `Graf med ${noder.length} selskaper og ${kanter.length} forbindelser.`,
      '',
      `Åpne grafen: ${url}`,
    ]

    return {
      content: [{
        type: 'text' as const,
        text: summary.join('\n'),
      }],
    }
  }
)

server.resource(
  'guide',
  'noder://guide',
  { description: 'Instruksjoner for hvordan agenter bruker Noder-verktøyene til å bygge selskapsgrafer' },
  async () => ({
    contents: [{
      uri: 'noder://guide',
      mimeType: 'text/plain',
      text: [
        'Noder MCP - verktøyguide for agenter',
        '',
        'Mål: Bygg en visuell nettverksgraf av norske selskaper og del den som en URL.',
        'Alle verktøy returnerer JSON.',
        '',
        'Verktøy og rekkefølge:',
        '',
        '1. søk_selskap: Søk etter selskap på navn. Returnerer JSON med orgnr, navn og type.',
        '   Bruk dette først for å få orgnr til selskaper brukeren nevner.',
        '',
        '2. hent_selskap: Hent grunndata for et orgnr (JSON). Feltet "overordnetEnhet"',
        '   inneholder orgnr til morselskap hvis det finnes. Bruk dette til å',
        '   følge eierkjeder oppover.',
        '',
        '3. hent_roller: Hent styremedlemmer og ledelse for et selskap.',
        '   Sammenlign personnavn på tvers av selskaper for å finne felles',
        '   styremedlemmer og bygge personrelasjoner.',
        '',
        '4. hent_regnskap: Hent regnskap (omsetning, resultat, egenkapital).',
        '   Nyttig for å gi kontekst til noder i grafen.',
        '',
        '5. hent_nettverk: Hent ferdig nettverksgraf for ett selskap.',
        '   Returnerer JSON med noder og kanter basert på roller. Bruk dette som',
        '   utgangspunkt og utvid med egne funn.',
        '',
        '6. sammenlign_selskaper: Sammenlign 2-5 selskaper side om side.',
        '   Gir en tabell med regnskapstall.',
        '',
        '7. bygg_graf: Bygg en visuell graf og få en delbar URL.',
        '   Send inn JSON med noder (orgnr, navn, type, x, y) og kanter (fra, til, tekst).',
        '   Sett x/y til 0 for automatisk layout. URL-en åpner grafen i noder.no.',
        '',
        'Typisk arbeidsflyt:',
        '',
        '  søk_selskap -> hent_selskap (+ følg overordnetEnhet)',
        '  -> hent_roller (finn felles personer)',
        '  -> bygg_graf med alle funn',
        '',
        'Tips:',
        '- Kjør søk, selskap og roller parallelt for flere orgnr.',
        '- Bygg grafen underveis. Kall bygg_graf flere ganger etter hvert som du finner flere noder.',
        '- Kanttekst bør beskrive relasjonen, f.eks. "Styreleder", "Morselskap", "Felles styremedlem: Ola Nordmann".',
        '- Presenter alltid den endelige URL-en til brukeren.',
      ].join('\n'),
    }],
  })
)

const transport = new StdioServerTransport()
await server.connect(transport)