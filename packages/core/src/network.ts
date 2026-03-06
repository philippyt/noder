import { getCompany, getRoles } from './api.js'
import type { NetworkGraph, NetworkNode, NetworkEdge } from './types.js'

const ROLE_TYPE_MAP: Record<string, NetworkEdge['type']> = {
  DAGL: 'daglig_leder',
  STYR: 'styremedlem',
  NEST: 'styremedlem',
  LEDE: 'styremedlem',
  MEDL: 'styremedlem',
  VARA: 'styremedlem',
  REVI: 'revisor',
}

function edgeTypeForRole(roleCode: string): NetworkEdge['type'] {
  return ROLE_TYPE_MAP[roleCode] ?? 'styremedlem'
}

export async function getNetwork(orgnr: string): Promise<NetworkGraph> {
  const nodes = new Map<string, NetworkNode>()
  const edges: NetworkEdge[] = []
  const seenEdges = new Set<string>()

  const company = await getCompany(orgnr)
  const roles = await getRoles(orgnr)

  nodes.set(orgnr, {
    id: orgnr,
    navn: company.navn,
    type: company.type,
  })

  const relatedOrgnrs = new Set<string>()

  for (const role of roles) {
    const edgeKey = `${orgnr}-${role.person.navn}-${role.type}`
    if (seenEdges.has(edgeKey)) continue
    seenEdges.add(edgeKey)

    edges.push({
      source: orgnr,
      target: orgnr,
      type: edgeTypeForRole(role.type),
      label: `${role.person.navn} (${role.type_beskrivelse})`,
    })
  }

  // Hent morselskap
  if (company.overordnetEnhet) {
    relatedOrgnrs.add(company.overordnetEnhet)
  }

  // Hent underenheter
  try {
    const res = await fetch(
      `https://data.brreg.no/enhetsregisteret/api/underenheter?overordnetEnhet=${orgnr}&size=20`,
      { headers: { Accept: 'application/json' } }
    )
    if (res.ok) {
      const data = await res.json() as { _embedded?: { underenheter?: Array<{ organisasjonsnummer: string }> } }
      for (const sub of data._embedded?.underenheter ?? []) {
        relatedOrgnrs.add(sub.organisasjonsnummer)
      }
    }
  } catch { /* ignorer feil */ }

  // Hent relaterte selskaper
  const fetchPromises = Array.from(relatedOrgnrs)
    .slice(0, 49)
    .map(async (relOrgnr) => {
      try {
        const relCompany = await getCompany(relOrgnr)
        nodes.set(relOrgnr, {
          id: relOrgnr,
          navn: relCompany.navn,
          type: relCompany.type,
        })

        const edgeKey = `${orgnr}-${relOrgnr}-eierskap`
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey)
          edges.push({
            source: orgnr,
            target: relOrgnr,
            type: 'eierskap',
            label: 'Eierskap',
          })
        }

        // Finn felles personer via roller
        const relRoles = await getRoles(relOrgnr)
        for (const relRole of relRoles) {
          const matchingRole = roles.find(
            r => r.person.navn.toLowerCase() === relRole.person.navn.toLowerCase()
          )
          if (matchingRole) {
            const sharedEdgeKey = `${orgnr}-${relOrgnr}-${relRole.person.navn}`
            if (!seenEdges.has(sharedEdgeKey)) {
              seenEdges.add(sharedEdgeKey)
              edges.push({
                source: orgnr,
                target: relOrgnr,
                type: edgeTypeForRole(relRole.type),
                label: `${relRole.person.navn} (${relRole.type_beskrivelse})`,
              })
            }
          }
        }
      } catch { /* ignorer feil */ }
    })

  await Promise.all(fetchPromises)

  const filteredEdges = edges.filter(e => e.source !== e.target)
  const nodeArray = Array.from(nodes.values()).slice(0, 50)

  return {
    nodes: nodeArray,
    edges: filteredEdges,
  }
}
