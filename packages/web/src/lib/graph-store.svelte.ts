import type { BrregCompany, BrregFinancials, BrregRole } from '@noder/core'

export interface PersonCompany {
  orgnr: string
  navn: string
  rolle: string
}

export interface GraphNode {
  id: string
  navn: string
  type: string
  loading: boolean
  company?: BrregCompany
  financials?: BrregFinancials[]
  roles?: BrregRole[]
  isPerson?: boolean
  personCompanies?: PersonCompany[]
  fodselsdato?: string
  notes?: string
  x: number
  y: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
  auto: boolean
  type?: string
}

export interface CollapsedEdge {
  key: string
  source: string
  target: string
  labels: string[]
  count: number
  type: string
}

export interface SerializableState {
  n: Array<{ i: string; n: string; t: string; x: number; y: number; nt?: string }>
  e: Array<{ s: string; t: string; l: string; a: boolean; tp?: string }>
}

const MAX_NODES = 200
const MAX_EDGES = 1000
const MAX_STR = 300

function sanitizeStr(v: unknown): string {
  return String(v ?? '').slice(0, MAX_STR).replace(/[<>]/g, '')
}

export function validateSerializable(raw: unknown): SerializableState {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid state')
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.n) || !Array.isArray(obj.e)) throw new Error('Missing n/e arrays')
  if (obj.n.length > MAX_NODES) throw new Error(`Too many nodes (max ${MAX_NODES})`)
  if (obj.e.length > MAX_EDGES) throw new Error(`Too many edges (max ${MAX_EDGES})`)

  const n = obj.n.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid node')
    const nd = item as Record<string, unknown>
    return {
      i: sanitizeStr(nd.i),
      n: sanitizeStr(nd.n),
      t: sanitizeStr(nd.t),
      x: Number(nd.x) || 0,
      y: Number(nd.y) || 0,
      ...(nd.nt ? { nt: sanitizeStr(nd.nt) } : {}),
    }
  })

  const e = obj.e.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid edge')
    const ed = item as Record<string, unknown>
    return {
      s: sanitizeStr(ed.s),
      t: sanitizeStr(ed.t),
      l: sanitizeStr(ed.l),
      a: Boolean(ed.a),
      ...(ed.tp ? { tp: sanitizeStr(ed.tp) } : {}),
    }
  })

  return { n, e }
}

let nodes = $state<GraphNode[]>([])
let edges = $state<GraphEdge[]>([])
let nextVersion = $state(0)
let nextContentVersion = $state(0)
let edgeIdCounter = 0
let nodeMap = new Map<string, GraphNode>()
let collapsedCache: CollapsedEdge[] | null = null

function rebuildNodeMap() {
  nodeMap = new Map(nodes.map(n => [n.id, n]))
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

function inferEdgeType(e: GraphEdge): string {
  if (e.type) return e.type
  if (e.label === 'Morselskap') return 'eierskap'
  if (/\(/.test(e.label)) {
    return (e.source.startsWith('person:') || e.target.startsWith('person:')) ? 'rolle' : 'overlapp'
  }
  return 'manuell'
}

function invalidate() {
  collapsedCache = null
  nextVersion++
  nextContentVersion++
}

export const graphStore = {
  get nodes() { return nodes },
  get edges() { return edges },
  get version() { return nextVersion },
  get contentVersion() { return nextContentVersion },

  getNodeById(id: string): GraphNode | undefined {
    return nodeMap.get(id)
  },

  getCollapsedEdges(): CollapsedEdge[] {
    if (collapsedCache) return collapsedCache
    const map = new Map<string, CollapsedEdge>()
    const typePri: Record<string, number> = {
      eierskap: 6, leverandør: 5, kunde: 5, samarbeid: 5, rolle: 4, overlapp: 2, manuell: 1,
    }
    for (const e of edges) {
      const key = pairKey(e.source, e.target)
      const et = e.type ?? inferEdgeType(e)
      const existing = map.get(key)
      if (existing) {
        if (e.label && !existing.labels.includes(e.label)) existing.labels.push(e.label)
        existing.count++
        if ((typePri[et] ?? 0) > (typePri[existing.type] ?? 0)) existing.type = et
      } else {
        map.set(key, { key, source: e.source, target: e.target, labels: e.label ? [e.label] : [], count: 1, type: et })
      }
    }
    collapsedCache = Array.from(map.values())
    return collapsedCache
  },

  addNode(node: GraphNode) {
    if (nodeMap.has(node.id)) return
    nodes = [...nodes, node]
    rebuildNodeMap()
    invalidate()
  },

  updateNode(id: string, data: Partial<GraphNode>) {
    nodes = nodes.map(n => n.id === id ? { ...n, ...data } : n)
    rebuildNodeMap()
    invalidate()
  },

  moveNode(id: string, x: number, y: number) {
    const n = nodeMap.get(id)
    if (n) { n.x = x; n.y = y }
    nextVersion++
  },

  removeNode(id: string) {
    nodes = nodes.filter(n => n.id !== id).map(n => {
      if (n.isPerson && n.personCompanies?.some(c => c.orgnr === id)) {
        return { ...n, personCompanies: n.personCompanies!.filter(c => c.orgnr !== id) }
      }
      return n
    })
    edges = edges.filter(e => e.source !== id && e.target !== id)
    rebuildNodeMap()
    invalidate()
  },

  addEdge(edge: Omit<GraphEdge, 'id'>) {
    edges = [...edges, { ...edge, id: `e${edgeIdCounter++}` }]
    invalidate()
  },

  removeEdgesBetween(a: string, b: string) {
    const key = pairKey(a, b)
    edges = edges.filter(e => pairKey(e.source, e.target) !== key)
    invalidate()
  },

  reassignEdgeEnd(edgePairKey: string, oldNodeId: string, newNodeId: string) {
    if (oldNodeId === newNodeId) return
    edges = edges.map(e => {
      if (pairKey(e.source, e.target) !== edgePairKey) return e
      if (e.source === oldNodeId) return { ...e, source: newNodeId }
      if (e.target === oldNodeId) return { ...e, target: newNodeId }
      return e
    }).filter(e => e.source !== e.target)
    invalidate()
  },

  clear() {
    nodes = []
    edges = []
    nodeMap.clear()
    invalidate()
  },

  getNode(id: string): GraphNode | undefined {
    return nodeMap.get(id)
  },

  toSerializable(): SerializableState {
    return {
      n: nodes.map(n => ({ i: n.id, n: n.navn, t: n.type, x: Math.round(n.x), y: Math.round(n.y), ...(n.notes ? { nt: n.notes } : {}) })),
      e: edges.map(e => ({ s: e.source, t: e.target, l: e.label, a: e.auto, ...(e.type ? { tp: e.type } : {}) })),
    }
  },

  loadSerializable(state: SerializableState) {
    edgeIdCounter = 0
    nodes = state.n.map(n => {
      const isPerson = n.t === 'PERSON'
      const dobMatch = isPerson ? n.i.match(/:(\d{4}-\d{2}-\d{2})$/) : null
      return { id: n.i, navn: n.n, type: n.t, loading: true, isPerson, x: n.x, y: n.y, ...(dobMatch ? { fodselsdato: dobMatch[1] } : {}), ...(n.nt ? { notes: n.nt } : {}) }
    })
    edges = state.e.map(e => ({ id: `e${edgeIdCounter++}`, source: e.s, target: e.t, label: e.l, auto: e.a, ...(e.tp ? { type: e.tp } : {}) }))
    rebuildNodeMap()
    invalidate()
  },

  save(): string {
    const json = JSON.stringify(this.toSerializable())
    const id = Math.random().toString(36).slice(2, 8)
    try { localStorage.setItem(`noder:${id}`, json) } catch { /* quota */ }
    return id
  },

  load(id: string): boolean {
    try {
      const json = localStorage.getItem(`noder:${id}`)
      if (!json) return false
      const state = validateSerializable(JSON.parse(json))
      this.loadSerializable(state)
      return true
    } catch { return false }
  },

  autoSave() {
    try {
      localStorage.setItem('noder:current', JSON.stringify(this.toSerializable()))
    } catch { /* quota */ }
  },

  autoLoad(): boolean {
    try {
      const json = localStorage.getItem('noder:current')
      if (!json) return false
      const state = validateSerializable(JSON.parse(json))
      if (state.n.length === 0) return false
      this.loadSerializable(state)
      return true
    } catch { return false }
  },
}