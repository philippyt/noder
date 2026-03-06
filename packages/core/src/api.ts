import { cache, TTL } from './cache.js'
import { rateLimiter } from './rate-limiter.js'
import { validateOrgnr, sanitizeSearchInput } from './validate.js'
import type { BrregCompany, BrregRole, BrregFinancials } from './types.js'

let BRREG_BASE = 'https://data.brreg.no/enhetsregisteret/api'
let REGNSKAP_BASE = 'https://data.brreg.no/regnskapsregisteret/regnskap'

const ALLOWED_BRREG_BASES = [
  'https://data.brreg.no/enhetsregisteret/api',
  '/api/brreg',
]

export function setBrregBaseUrl(url: string) {
  if (!ALLOWED_BRREG_BASES.includes(url)) {
    throw new Error('Ugyldig Brreg-URL')
  }
  BRREG_BASE = url
}

// Regnskapsregisteret mangler CORS — i nettleseren må man bruke en proxy
const ALLOWED_REGNSKAP_BASES = [
  'https://data.brreg.no/regnskapsregisteret/regnskap',
  '/api/regnskap',
]

export function setRegnskapBaseUrl(url: string) {
  if (!ALLOWED_REGNSKAP_BASES.includes(url)) {
    throw new Error('Ugyldig regnskaps-URL')
  }
  REGNSKAP_BASE = url
}

async function fetchJSON<T>(url: string): Promise<T> {
  await rateLimiter.throttle()
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Fant ingen data for forespørselen (404)`)
    }
    throw new Error(`API-feil: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

interface BrregEnhetResponse {
  organisasjonsnummer: string
  navn: string
  organisasjonsform?: { kode: string }
  registrertIMvaregisteret?: boolean
  konkurs?: boolean
  underTvangsavviklingEllerTvangsopplosning?: boolean
  registreringsdatoEnhetsregisteret?: string
  stiftelsesdato?: string
  antallAnsatte?: number
  overordnetEnhet?: string
  naeringskode1?: { kode: string; beskrivelse: string }
  forretningsadresse?: {
    adresse?: string[]
    postnummer?: string
    poststed?: string
    kommune?: string
  }
  postadresse?: {
    adresse?: string[]
    postnummer?: string
    poststed?: string
    kommune?: string
  }
}

function parseCompany(data: BrregEnhetResponse): BrregCompany {
  const adresse = data.forretningsadresse ?? data.postadresse
  return {
    orgnr: data.organisasjonsnummer,
    navn: data.navn,
    type: data.organisasjonsform?.kode ?? 'Ukjent',
    aktiv: !data.konkurs && !data.underTvangsavviklingEllerTvangsopplosning,
    konkurs: data.konkurs ?? false,
    tvangsoppløsning: data.underTvangsavviklingEllerTvangsopplosning ?? false,
    stiftet: data.stiftelsesdato ?? data.registreringsdatoEnhetsregisteret ?? null,
    ansatte: data.antallAnsatte ?? null,
    nace: data.naeringskode1
      ? { kode: data.naeringskode1.kode, beskrivelse: data.naeringskode1.beskrivelse }
      : null,
    adresse: {
      gate: adresse?.adresse?.join(', ') ?? null,
      postnr: adresse?.postnummer ?? null,
      poststed: adresse?.poststed ?? null,
      kommune: adresse?.kommune ?? null,
    },
    mva_registrert: data.registrertIMvaregisteret ?? false,
    overordnetEnhet: data.overordnetEnhet ?? null,
  }
}

export async function getCompany(orgnr: string): Promise<BrregCompany> {
  const clean = validateOrgnr(orgnr)
  const cacheKey = `enhet:${clean}`
  const cached = cache.get<BrregCompany>(cacheKey)
  if (cached) return cached

  const data = await fetchJSON<BrregEnhetResponse>(`${BRREG_BASE}/enheter/${clean}`)
  const company = parseCompany(data)
  cache.set(cacheKey, company, TTL.ENHET)
  return company
}

interface BrregRollerResponse {
  rollegrupper?: Array<{
    type: { kode: string; beskrivelse: string }
    roller: Array<{
      type: { kode: string; beskrivelse: string }
      person?: { fodselsdato?: string; navn: { fornavn?: string; mellomnavn?: string; etternavn?: string } }
      enhet?: { organisasjonsnummer: string; organisasjonsform?: { kode: string }; navn?: string[] }
      fratraadt?: boolean
    }>
  }>
}

export async function getRoles(orgnr: string): Promise<BrregRole[]> {
  const clean = validateOrgnr(orgnr)
  const cacheKey = `roller:${clean}`
  const cached = cache.get<BrregRole[]>(cacheKey)
  if (cached) return cached

  const data = await fetchJSON<BrregRollerResponse>(`${BRREG_BASE}/enheter/${clean}/roller`)
  const roles: BrregRole[] = []

  for (const gruppe of data.rollegrupper ?? []) {
    for (const rolle of gruppe.roller ?? []) {
      if (rolle.fratraadt) continue

      let navn = 'Ukjent'

      let enhetOrgnr: string | undefined
      let fodselsdato: string | undefined

      if (rolle.person) {
        const parts = [
          rolle.person.navn.fornavn,
          rolle.person.navn.mellomnavn,
          rolle.person.navn.etternavn,
        ].filter(Boolean)
        navn = parts.join(' ')
        fodselsdato = rolle.person.fodselsdato
      } else if (rolle.enhet) {
        navn = rolle.enhet.navn?.[0] ?? rolle.enhet.organisasjonsnummer
        enhetOrgnr = rolle.enhet.organisasjonsnummer
      }

      roles.push({
        type: rolle.type.kode,
        type_beskrivelse: rolle.type.beskrivelse,
        person: { navn, ...(enhetOrgnr ? { orgnr: enhetOrgnr } : {}), ...(fodselsdato ? { fodselsdato } : {}) },
        fra_dato: null,
      })
    }
  }

  cache.set(cacheKey, roles, TTL.ROLLER)
  return roles
}

// Regnskapsregisteret kan returnere array eller enkelt-objekt
interface RegnskapResponse {
  id: number
  journalnr: string
  regnskapsperiode: { fraDato: string; tilDato: string }
  valuta: string
  avviklingsregnskap: boolean
  oppstillingsplan: string
  resultatregnskapResultat?: {
    driftsresultat?: {
      driftsresultat?: number
      driftsinntekter?: { salgsinntekter?: number; sumDriftsinntekter?: number }
      driftskostnad?: { sumDriftskostnad?: number }
    }
    finansresultat?: { nettoFinans?: number; finansinntekt?: { sumFinansinntekter?: number }; finanskostnad?: { sumFinanskostnad?: number } }
    totalresultat?: number
    ordinaertResultatFoerSkattekostnad?: number
    ordinaertResultatSkattekostnad?: number
    aarsresultat?: number
    sumInntekter?: number
  }
  eiendeler?: {
    sumEiendeler?: number
  }
  egenkapitalGjeld?: {
    sumEgenkapitalGjeld?: number
    egenkapital?: { sumEgenkapital?: number; innskuttEgenkapital?: { sumInnskuttEgenkapital?: number } }
    gjeldOversikt?: { sumGjeld?: number }
  }
}

function parseRegnskap(r: RegnskapResponse, orgnr: string): BrregFinancials {
  const res = r.resultatregnskapResultat
  const ek = r.egenkapitalGjeld
  return {
    orgnr,
    år: new Date(r.regnskapsperiode.tilDato).getFullYear(),
    omsetning: res?.driftsresultat?.driftsinntekter?.sumDriftsinntekter ?? res?.sumInntekter ?? null,
    driftsresultat: res?.driftsresultat?.driftsresultat ?? null,
    årsresultat: res?.aarsresultat ?? res?.totalresultat ?? null,
    egenkapital: ek?.egenkapital?.sumEgenkapital ?? null,
    sum_gjeld: ek?.gjeldOversikt?.sumGjeld ?? null,
    sum_eiendeler: r.eiendeler?.sumEiendeler ?? null,
  }
}

export async function getFinancials(orgnr: string): Promise<BrregFinancials[]> {
  const clean = validateOrgnr(orgnr)
  const cacheKey = `regnskap:${clean}`
  const cached = cache.get<BrregFinancials[]>(cacheKey)
  if (cached) return cached

  let raw: unknown
  try {
    raw = await fetchJSON<unknown>(`${REGNSKAP_BASE}/${clean}`)
  } catch {
    cache.set(cacheKey, [], TTL.REGNSKAP_EMPTY)
    return []
  }

  // Brreg returnerer array for flere år, men kan returnere enkelt-objekt for kun ett år
  let items: RegnskapResponse[]
  if (Array.isArray(raw)) {
    items = raw
  } else if (raw && typeof raw === 'object' && 'regnskapsperiode' in raw) {
    items = [raw as RegnskapResponse]
  } else {
    cache.set(cacheKey, [], TTL.REGNSKAP)
    return []
  }

  const financials = items
    .slice(0, 3)
    .map(r => parseRegnskap(r, clean))
    .sort((a, b) => b.år - a.år)

  cache.set(cacheKey, financials, TTL.REGNSKAP)
  return financials
}

interface BrregSearchResponse {
  _embedded?: {
    enheter: BrregEnhetResponse[]
  }
}

export async function searchCompanies(navn: string): Promise<BrregCompany[]> {
  const clean = sanitizeSearchInput(navn)
  if (clean.length < 2) {
    throw new Error('Søketeksten må være minst 2 tegn')
  }

  const cacheKey = `søk:${clean.toLowerCase()}`
  const cached = cache.get<BrregCompany[]>(cacheKey)
  if (cached) return cached

  const url = `${BRREG_BASE}/enheter?navn=${encodeURIComponent(clean)}&size=10`
  const data = await fetchJSON<BrregSearchResponse>(url)
  const enheter = data._embedded?.enheter ?? []

  const companies = enheter.map(e => parseCompany(e))
  cache.set(cacheKey, companies, TTL.SØK)
  return companies
}

export async function getCompanyParent(orgnr: string): Promise<string | null> {
  const clean = validateOrgnr(orgnr)
  const data = await fetchJSON<BrregEnhetResponse>(`${BRREG_BASE}/enheter/${clean}`)
  return data.overordnetEnhet ?? null
}

interface BrregUnderenheterResponse {
  _embedded?: {
    underenheter?: Array<{ organisasjonsnummer: string }>
  }
}

export async function getSubsidiaries(orgnr: string): Promise<Array<{ organisasjonsnummer: string }>> {
  const clean = validateOrgnr(orgnr)
  const data = await fetchJSON<BrregUnderenheterResponse>(
    `${BRREG_BASE}/underenheter?overordnetEnhet=${clean}&size=10`
  )
  return data._embedded?.underenheter ?? []
}
