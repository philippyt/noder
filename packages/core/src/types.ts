export interface BrregCompany {
  orgnr: string
  navn: string
  type: string
  aktiv: boolean
  konkurs: boolean
  tvangsoppløsning: boolean
  stiftet: string | null
  ansatte: number | null
  nace: {
    kode: string
    beskrivelse: string
  } | null
  adresse: {
    gate: string | null
    postnr: string | null
    poststed: string | null
    kommune: string | null
  }
  mva_registrert: boolean
  overordnetEnhet: string | null
}

export interface BrregRole {
  type: string
  type_beskrivelse: string
  person: {
    navn: string
    orgnr?: string
    fodselsdato?: string
  }
  fra_dato: string | null
}

export interface BrregFinancials {
  orgnr: string
  år: number
  omsetning: number | null
  driftsresultat: number | null
  årsresultat: number | null
  egenkapital: number | null
  sum_gjeld: number | null
  sum_eiendeler: number | null
}

export interface NetworkNode {
  id: string
  navn: string
  type: string
  x?: number
  y?: number
}

export interface NetworkEdge {
  source: string
  target: string
  type: 'eierskap' | 'styremedlem' | 'daglig_leder' | 'revisor'
  label: string
}

export interface NetworkGraph {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}
