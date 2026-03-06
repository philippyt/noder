<script lang="ts">
  import { onMount } from 'svelte'
  import * as d3 from 'd3'
  import Canvas from '$lib/Canvas.svelte'
  import Search from '$lib/Search.svelte'
  import Controls from '$lib/Controls.svelte'
  import CompanyPanel from '$lib/CompanyPanel.svelte'
  import PersonPanel from '$lib/PersonPanel.svelte'
  import WelcomeModal from '$lib/WelcomeModal.svelte'
  import { graphStore } from '$lib/graph-store.svelte.js'
  import {
    getCompany,
    getRoles,
    getFinancials,
    searchCompanies,
    setRegnskapBaseUrl,
    setBrregBaseUrl,
    getCompanyParent,
    getSubsidiaries,
    type BrregCompany,
  } from '@noder/core'

  let canvas: Canvas
  let fileInput: HTMLInputElement
  let linkMode = $state(false)
  let linkFirst = $state<string | null>(null)
  let showLabelInput = $state(false)
  let labelInputValue = $state('')
  let labelInputPos = $state({ x: 0, y: 0 })
  let pendingLinkTarget = $state<string | null>(null)
  let labelInputEl: HTMLInputElement | undefined = $state()
  let selectedEdgeType = $state('manuell')

  const MANUAL_EDGE_TYPES = [
    { value: 'eierskap', label: 'Eierskap', color: '#5a7a9e' },
    { value: 'leverandør', label: 'Leverandør', color: '#5a9e6e' },
    { value: 'kunde', label: 'Kunde', color: '#9e8a5a' },
    { value: 'samarbeid', label: 'Samarbeid', color: '#7a9a8a' },
    { value: 'manuell', label: 'Annet', color: '#4a4a52' },
  ]
  let selectedNodeId = $state<string | null>(null)
  let panelNode = $state<import('$lib/graph-store.svelte.js').GraphNode | null>(null)

  $effect(() => {
    const _v = graphStore.version
    if (selectedNodeId) {
      const n = graphStore.getNode(selectedNodeId)
      if (n) panelNode = n
    }
  })

  function handleNodeClick(nodeId: string) {
    selectedNodeId = nodeId
    panelNode = graphStore.getNode(nodeId) ?? null
  }

  function closePanel() {
    selectedNodeId = null
  }

  let showMcp = $state(false)
  let mcpTab = $state<'claude' | 'cursor' | 'claude-code'>('claude')

  function toggleLinkMode() {
    if (linkMode) {
      linkMode = false
      linkFirst = null
      showLabelInput = false
      return
    }
    linkMode = true
    linkFirst = null
  }

  function handleLinkClick(nodeId: string) {
    if (!linkFirst) {
      linkFirst = nodeId
      return
    }
    if (linkFirst === nodeId) {
      linkFirst = null
      return
    }

    labelInputPos = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }
    pendingLinkTarget = nodeId
    labelInputValue = ''
    showLabelInput = true

    setTimeout(() => labelInputEl?.focus(), 10)
  }

  function confirmLabel() {
    if (linkFirst && pendingLinkTarget) {
      graphStore.addEdge({
        source: linkFirst,
        target: pendingLinkTarget,
        label: labelInputValue.trim(),
        auto: false,
        type: selectedEdgeType,
      })
    }
    showLabelInput = false
    linkFirst = null
    pendingLinkTarget = null
    linkMode = false
    selectedEdgeType = 'manuell'
    scheduleAutoSave()
  }

  function cancelLabel() {
    showLabelInput = false
    linkFirst = null
    pendingLinkTarget = null
  }

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  let lastSavedVersion = -1

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => graphStore.autoSave(), 500)
  }

  let showCopied = $state(false)

  async function shareGraph() {
    const state = graphStore.toSerializable()
    const compact = [
      state.n.map(n => [n.i, n.n, n.t, n.x, n.y]),
      state.e.map(e => [e.s, e.t, e.l, e.a ? 1 : 0, ...(e.tp ? [e.tp] : [])]),
    ]
    const json = JSON.stringify(compact)
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
    let b64 = ''
    for (let i = 0; i < compressed.length; i++) b64 += String.fromCharCode(compressed[i]!)
    const encoded = btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const url = `${window.location.origin}${window.location.pathname}?g=${encoded}`
    if (url.length > 8000) {
      alert('Grafen er for stor for en URL. Bruk "Eksporter JSON som fil" i stedet.')
      return
    }
    await navigator.clipboard.writeText(url)
    showCopied = true
    setTimeout(() => { showCopied = false }, 2000)
  }

  // eksport / import
  let showJsonPopup = $state<'export' | 'import' | null>(null)
  let jsonPopupText = $state('')

  function exportRaw() {
    jsonPopupText = JSON.stringify(graphStore.toSerializable(), null, 2)
    showJsonPopup = 'export'
  }

  function exportFile() {
    const data = JSON.stringify(graphStore.toSerializable(), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'noder.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importRaw() {
    jsonPopupText = ''
    showJsonPopup = 'import'
  }

  function confirmImportRaw() {
    try {
      const state = JSON.parse(jsonPopupText)
      graphStore.loadSerializable(state)
      for (const n of graphStore.nodes) enrichNode(n.id)
      scheduleAutoSave()
    } catch { /* ignore bad json */ }
    showJsonPopup = null
  }

  function importFile() {
    fileInput?.click()
  }

  function handleFileLoad(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const state = JSON.parse(reader.result as string)
        graphStore.loadSerializable(state)
        for (const n of graphStore.nodes) enrichNode(n.id)
        scheduleAutoSave()
      } catch { /* ignore bad files */ }
    }
    reader.readAsText(file)
    ;(e.target as HTMLInputElement).value = ''
  }

  let showCapture = $state(false)
  let captureDataUrl = $state('')
  let captureCanvas: HTMLCanvasElement | null = null

  function prepareSvgClone(svgEl: SVGSVGElement): { clone: SVGSVGElement; w: number; h: number } {
    const clone = svgEl.cloneNode(true) as SVGSVGElement
    const w = svgEl.clientWidth
    const h = svgEl.clientHeight
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // systemfont som fallback, Inter laster ikke i frittstående SVG
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `* { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important; }`
    clone.insertBefore(style, clone.firstChild)
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', '#131316')
    clone.insertBefore(bgRect, clone.firstChild)
    clone.removeAttribute('style')
    return { clone, w, h }
  }

  function captureScreenshot() {
    const svgEl = canvas.getSvgElement()
    const { clone, w, h } = prepareSvgClone(svgEl)
    const data = new XMLSerializer().serializeToString(clone)
    const b64 = btoa(unescape(encodeURIComponent(data)))
    const dataUri = `data:image/svg+xml;base64,${b64}`
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w * 2
      c.height = h * 2
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      captureCanvas = c
      captureDataUrl = c.toDataURL('image/png')
      showCapture = true
    }
    img.src = dataUri
  }

  function saveCaptureAs(format: 'png' | 'svg' | 'jpg') {
    if (format === 'svg') {
      const svgEl = canvas.getSvgElement()
      const { clone } = prepareSvgClone(svgEl)
      const data = new XMLSerializer().serializeToString(clone)
      const blob = new Blob([data], { type: 'image/svg+xml' })
      downloadBlob(blob, 'noder.svg')
    } else if (captureCanvas) {
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
      captureCanvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `noder.${format}`)
      }, mime, format === 'jpg' ? 0.92 : undefined)
    }
    showCapture = false
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  let nodeCount = 0

  function nextPosition(): { x: number; y: number } {
    for (let i = nodeCount; i < nodeCount + 100; i++) {
      let x: number, y: number
      if (i === 0) { x = 0; y = 0 }
      else {
        const ring = Math.ceil((-1 + Math.sqrt(1 + 4 * i)) / 2)
        const spotsInRing = ring * 6
        const indexInRing = i - (3 * ring * (ring - 1) + 1)
        const angle = (2 * Math.PI * indexInRing) / spotsInRing - Math.PI / 2
        const radius = ring * 280
        x = Math.cos(angle) * radius
        y = Math.sin(angle) * radius
      }
      if (!overlapsAny(x, y)) {
        nodeCount = i + 1
        return { x, y }
      }
    }
    nodeCount++
    return { x: nodeCount * 260, y: 0 }
  }

  function overlapsAny(x: number, y: number): boolean {
    const margin = 20
    for (const n of graphStore.nodes) {
      if (Math.abs(x - n.x) < 220 + margin && Math.abs(y - n.y) < 84 + margin) return true
    }
    return false
  }

  function positionNear(anchorX: number, anchorY: number, index: number): { x: number; y: number } {
    const cols = 3, colW = 260, rowH = 110, startY = 140
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = Math.floor((index + attempt) / cols)
      const col = (index + attempt) % cols
      const x = anchorX + (col - 1) * colW
      const y = anchorY + startY + row * rowH
      if (!overlapsAny(x, y)) return { x, y }
    }
    const angle = index * 2.4
    const r = 200 + index * 60
    return { x: anchorX + Math.cos(angle) * r, y: anchorY + Math.sin(angle) * r }
  }

  function makePersonId(name: string, fodselsdato?: string): string {
    return fodselsdato ? `person:${name}:${fodselsdato}` : `person:${name}`
  }

  function findPersonNodeByName(name: string) {
    const lower = name.toLowerCase()
    return graphStore.nodes.find(n => n.isPerson && n.navn.toLowerCase() === lower)
  }

  const ROLE_LABELS: Record<string, string> = {
    DAGL: 'Daglig leder', STYR: 'Styremedlem', NEST: 'Nestleder',
    LEDE: 'Styreleder', MEDL: 'Styremedlem', VARA: 'Varamedlem', REVI: 'Revisor',
  }

  async function enrichNode(orgnr: string) {
    try {
      const [company, roles, financials] = await Promise.all([
        getCompany(orgnr), getRoles(orgnr), getFinancials(orgnr),
      ])
      graphStore.updateNode(orgnr, { loading: false, company, roles, financials })

      // felles-person-koblinger mellom selskaper (hopp over om person-node finnes)
      for (const role of roles) {
        const lowerName = role.person.navn.toLowerCase()
        if (findPersonNodeByName(role.person.navn)) continue
        for (const existing of graphStore.nodes) {
          if (existing.id === orgnr || existing.isPerson || !existing.roles) continue
          const shared = existing.roles.find(r => {
            if (r.person.navn.toLowerCase() !== lowerName) return false
            if (role.person.fodselsdato && r.person.fodselsdato) {
              return role.person.fodselsdato === r.person.fodselsdato
            }
            return true
          })
          if (shared) {
            graphStore.addEdge({
              source: orgnr, target: existing.id,
              label: `${role.person.navn} (${ROLE_LABELS[role.type] ?? role.type_beskrivelse})`,
              auto: true,
            })
          }
        }
      }

      // koble til eksisterende person-noder på grafen
      for (const role of roles) {
        const personNode = findPersonNodeByName(role.person.navn)
        if (!personNode) continue
        const pid = personNode.id
        const alreadyConnected = graphStore.edges.some(
          e => (e.source === pid && e.target === orgnr) || (e.source === orgnr && e.target === pid)
        )
        if (!alreadyConnected) {
          graphStore.addEdge({
            source: pid, target: orgnr,
            label: `${role.person.navn} (${ROLE_LABELS[role.type] ?? role.type_beskrivelse})`,
            auto: true,
          })
          const existing = personNode.personCompanies ?? []
          if (!existing.some(c => c.orgnr === orgnr)) {
            graphStore.updateNode(pid, {
              personCompanies: [...existing, {
                orgnr,
                navn: company.navn,
                rolle: ROLE_LABELS[role.type] ?? role.type_beskrivelse,
              }],
            })
          }
        }
      }

      // koble til selskaper i roller (f.eks. revisorfirma) allerede på grafen
      for (const role of roles) {
        if (!role.person.orgnr) continue
        const roleNode = graphStore.getNode(role.person.orgnr)
        if (!roleNode || roleNode.isPerson) continue
        const rid = role.person.orgnr
        const hasEdge = graphStore.edges.some(
          e => (e.source === rid && e.target === orgnr) || (e.source === orgnr && e.target === rid)
        )
        if (!hasEdge) {
          graphStore.addEdge({
            source: rid, target: orgnr,
            label: ROLE_LABELS[role.type] ?? role.type_beskrivelse,
            auto: true,
          })
        }
      }

      // sjekk om DENNE noden er selskapsrollehaver for andre noder
      for (const existing of graphStore.nodes) {
        if (existing.id === orgnr || existing.isPerson || !existing.roles) continue
        for (const r of existing.roles) {
          if (r.person.orgnr !== orgnr) continue
          const hasEdge = graphStore.edges.some(
            e => (e.source === orgnr && e.target === existing.id) || (e.source === existing.id && e.target === orgnr)
          )
          if (!hasEdge) {
            graphStore.addEdge({
              source: orgnr, target: existing.id,
              label: ROLE_LABELS[r.type] ?? r.type_beskrivelse,
              auto: true,
            })
          }
        }
      }

      if (company.overordnetEnhet) {
        const parent = graphStore.getNode(company.overordnetEnhet)
        if (parent) {
          graphStore.addEdge({
            source: company.overordnetEnhet, target: orgnr,
            label: 'Morselskap', auto: true,
          })
        }
      }
      for (const existing of graphStore.nodes) {
        if (existing.company?.overordnetEnhet === orgnr) {
          graphStore.addEdge({
            source: orgnr, target: existing.id,
            label: 'Morselskap', auto: true,
          })
        }
      }

      scheduleAutoSave()
    } catch {
      graphStore.updateNode(orgnr, { loading: false })
    }
  }

  async function addToCanvas(company: BrregCompany, pos?: { x: number; y: number }) {
    if (graphStore.getNode(company.orgnr)) return
    const p = pos ?? nextPosition()
    graphStore.addNode({
      id: company.orgnr, navn: company.navn, type: company.type,
      loading: true, x: p.x, y: p.y,
    })
    await enrichNode(company.orgnr)
  }

  async function handleOverlayNameClick(personName: string) {
    const lowerName = personName.toLowerCase()

    // sjekk om dette er ein selskapsrollehavar (revisor, rekneskapsførar osb.)
    for (const node of graphStore.nodes) {
      if (!node.roles) continue
      const match = node.roles.find(r => r.person.navn.toLowerCase() === lowerName && r.person.orgnr)
      if (match) {
        const orgnr = match.person.orgnr!
        if (graphStore.getNode(orgnr)) {
          handleNodeClick(orgnr)
        } else {
          try {
            const co = await getCompany(orgnr)
            await addToCanvas(co)
            handleNodeClick(orgnr)
          } catch { /* skip */ }
        }
        return
      }
    }

    // vanleg person
    await expandPerson(personName)
  }

  async function expandPerson(personName: string) {
    const lowerName = personName.toLowerCase()

    if (findPersonNodeByName(personName)) return

    // finn fødselsdato fra lastede roller
    let fodselsdato: string | undefined
    for (const node of graphStore.nodes) {
      if (!node.roles) continue
      const match = node.roles.find(r => r.person.navn.toLowerCase() === lowerName && r.person.fodselsdato)
      if (match) { fodselsdato = match.person.fodselsdato; break }
    }

    const pid = makePersonId(personName, fodselsdato)

    function matchesPerson(r: { person: { navn: string; fodselsdato?: string } }): boolean {
      if (r.person.navn.toLowerCase() !== lowerName) return false
      if (fodselsdato && r.person.fodselsdato) return r.person.fodselsdato === fodselsdato
      return true
    }

    const knownCompanies: Array<{ orgnr: string; navn: string; rolle: string }> = []
    const sourceOrgnrs: string[] = []
    for (const node of graphStore.nodes) {
      if (!node.roles) continue
      for (const r of node.roles) {
        if (matchesPerson(r)) {
          sourceOrgnrs.push(node.id)
          knownCompanies.push({
            orgnr: node.id,
            navn: node.navn,
            rolle: ROLE_LABELS[r.type] ?? r.type_beskrivelse,
          })
        }
      }
    }

    const pos = nextPosition()
    graphStore.addNode({
      id: pid,
      navn: personName,
      type: 'PERSON',
      loading: true,
      isPerson: true,
      personCompanies: knownCompanies,
      fodselsdato,
      x: pos.x,
      y: pos.y,
    })

    for (const c of knownCompanies) {
      graphStore.addEdge({
        source: pid,
        target: c.orgnr,
        label: `${personName} (${c.rolle})`,
        auto: true,
      })
    }

    let childIdx = knownCompanies.length
    function nextChildPos(): { x: number; y: number } {
      return positionNear(pos.x, pos.y, childIdx++)
    }

    // hent mor/datter-selskaper for hvert kilde-selskap
    const fetchPromises: Promise<void>[] = []

    for (const orgnr of sourceOrgnrs) {
      fetchPromises.push((async () => {
        try {
          const parent = await getCompanyParent(orgnr)
          if (parent && !graphStore.getNode(parent)) {
            try {
              const co = await getCompany(parent)
              await addToCanvas(co, nextChildPos())
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      })())

      fetchPromises.push((async () => {
        try {
          const subs = await getSubsidiaries(orgnr)
          await Promise.all(subs.map(async (sub) => {
            if (graphStore.getNode(sub.organisasjonsnummer)) return
            try {
              const co = await getCompany(sub.organisasjonsnummer)
              await addToCanvas(co, nextChildPos())
            } catch { /* skip */ }
          }))
        } catch {}
      })())
    }

    await Promise.all(fetchPromises)

    // sørg for at alle noder har roller lastet
    const enrichPromises: Promise<void>[] = []
    for (const node of graphStore.nodes) {
      if (node.isPerson || node.roles) continue
      enrichPromises.push(enrichNode(node.id))
    }
    await Promise.all(enrichPromises)

    // skann alle noder på nytt for å finne personen
    const updatedCompanies: Array<{ orgnr: string; navn: string; rolle: string }> = []
    for (const node of graphStore.nodes) {
      if (node.isPerson || !node.roles) continue
      for (const r of node.roles) {
        if (matchesPerson(r)) {
          if (!updatedCompanies.some(c => c.orgnr === node.id)) {
            updatedCompanies.push({
              orgnr: node.id,
              navn: node.navn,
              rolle: ROLE_LABELS[r.type] ?? r.type_beskrivelse,
            })
          }
          graphStore.addEdge({
            source: pid,
            target: node.id,
            label: `${personName} (${ROLE_LABELS[r.type] ?? r.type_beskrivelse})`,
            auto: true,
          })
        }
      }
    }

    graphStore.updateNode(pid, { loading: false, personCompanies: updatedCompanies })
    scheduleAutoSave()
  }

  async function extractCompanyFromPerson(orgnr: string) {
    if (graphStore.getNode(orgnr)) {
      handleNodeClick(orgnr)
      return
    }
    let anchor: { x: number; y: number } | undefined
    for (const n of graphStore.nodes) {
      if (n.isPerson && n.personCompanies?.some(c => c.orgnr === orgnr)) {
        const idx = graphStore.nodes.filter(nd => !nd.isPerson).length
        anchor = positionNear(n.x, n.y, idx)
        break
      }
    }
    try {
      const co = await getCompany(orgnr)
      await addToCanvas(co, anchor)
      handleNodeClick(orgnr)
    } catch { /* skip */ }
  }

  // finn personer som dukker opp i flere selskaper og vis koblinger
  async function detectOverlaps() {
    const personMap = new Map<string, { lowerName: string; orgnr?: string; fodselsdato?: string; roles: Array<{ orgnr: string; navn: string; rolle: string }> }>()

    for (const node of graphStore.nodes) {
      if (node.isPerson || !node.roles) continue
      for (const r of node.roles) {
        const lowerName = r.person.navn.toLowerCase()
        const groupKey = r.person.fodselsdato ? `${lowerName}:${r.person.fodselsdato}` : lowerName
        if (!personMap.has(groupKey)) personMap.set(groupKey, { lowerName, orgnr: r.person.orgnr, fodselsdato: r.person.fodselsdato, roles: [] })
        const entry = personMap.get(groupKey)!
        if (!entry.orgnr && r.person.orgnr) entry.orgnr = r.person.orgnr
        if (!entry.fodselsdato && r.person.fodselsdato) entry.fodselsdato = r.person.fodselsdato
        entry.roles.push({
          orgnr: node.id,
          navn: node.navn,
          rolle: ROLE_LABELS[r.type] ?? r.type_beskrivelse,
        })
      }
    }

    // gjenopprett manglende kanter for selskapsrollehavere (f.eks. revisorfirma)
    let created = 0
    for (const node of graphStore.nodes) {
      if (node.isPerson || !node.roles) continue
      for (const role of node.roles) {
        if (!role.person.orgnr) continue
        const roleNode = graphStore.getNode(role.person.orgnr)
        if (!roleNode || roleNode.isPerson) continue
        const rid = role.person.orgnr
        const hasEdge = graphStore.edges.some(
          e => (e.source === rid && e.target === node.id) || (e.source === node.id && e.target === rid)
        )
        if (!hasEdge) {
          graphStore.addEdge({
            source: rid, target: node.id,
            label: ROLE_LABELS[role.type] ?? role.type_beskrivelse,
            auto: true,
          })
          created++
        }
      }
    }

    // håndter felles personer
    for (const [, { lowerName, orgnr: roleOrgnr, fodselsdato, roles: personRoles }] of personMap) {
      const uniqueOrgnrs = new Set(personRoles.map(r => r.orgnr))
      const alreadyOnCanvas = roleOrgnr && graphStore.getNode(roleOrgnr)
      if (uniqueOrgnrs.size < 2 && !alreadyOnCanvas) continue

      // selskapsrollehaver ikke på grafen ennå? legg til
      if (roleOrgnr && !graphStore.getNode(roleOrgnr)) {
        const orgnrs = [...uniqueOrgnrs]
        const avgX = orgnrs.reduce((s, id) => s + (graphStore.getNode(id)?.x ?? 0), 0) / orgnrs.length
        const avgY = orgnrs.reduce((s, id) => s + (graphStore.getNode(id)?.y ?? 0), 0) / orgnrs.length
        let displayName = lowerName
        for (const node of graphStore.nodes) {
          const match = node.roles?.find(r => r.person.orgnr === roleOrgnr)
          if (match) { displayName = match.person.navn; break }
        }
        getCompany(roleOrgnr).then(co => {
          addToCanvas(co, { x: avgX, y: avgY - 150 })
        }).catch(() => {
          graphStore.addNode({
            id: roleOrgnr, navn: displayName, type: 'AS',
            loading: false, x: avgX, y: avgY - 150,
          })
        })
        created++
        continue
      }

      // allerede håndtert over
      if (roleOrgnr) continue

      let personName = lowerName
      for (const node of graphStore.nodes) {
        if (node.isPerson || !node.roles) continue
        const match = node.roles.find(r => r.person.navn.toLowerCase() === lowerName)
        if (match) { personName = match.person.navn; break }
      }

      const pid = makePersonId(personName, fodselsdato)
      const existingPerson = findPersonNodeByName(personName) ?? graphStore.getNode(pid)
      if (existingPerson) {
        const epid = existingPerson.id
        const existingOrgnrs = new Set((existingPerson.personCompanies ?? []).map(c => c.orgnr))
        // gjenopprett manglende kanter, en per rolle
        for (const r of personRoles) {
          const label = `${existingPerson.navn} (${r.rolle})`
          const hasEdge = graphStore.edges.some(
            e => ((e.source === epid && e.target === r.orgnr) || (e.source === r.orgnr && e.target === epid)) && e.label === label
          )
          if (!hasEdge) {
            graphStore.addEdge({ source: epid, target: r.orgnr, label, auto: true })
            created++
          }
        }
        const seen = new Set<string>()
        const uniqueNew = personRoles.filter(r => {
          if (existingOrgnrs.has(r.orgnr) || seen.has(r.orgnr)) return false
          seen.add(r.orgnr); return true
        })
        if (uniqueNew.length > 0) {
          graphStore.updateNode(epid, {
            personCompanies: [...(existingPerson.personCompanies ?? []), ...uniqueNew],
          })
        }
        continue
      }

      // ingen person-node, opprett selskap↔selskap-kanter
      const companyGroups = new Map<string, string[]>()
      for (const r of personRoles) {
        if (!companyGroups.has(r.orgnr)) companyGroups.set(r.orgnr, [])
        companyGroups.get(r.orgnr)!.push(r.rolle)
      }
      const orgnrs = [...companyGroups.keys()]
      let addedAny = false
      for (let i = 0; i < orgnrs.length; i++) {
        for (let j = i + 1; j < orgnrs.length; j++) {
          const a = orgnrs[i]!, b = orgnrs[j]!
          const hasEdge = graphStore.edges.some(
            e => (e.source === a && e.target === b) || (e.source === b && e.target === a)
          )
          if (!hasEdge) {
            for (const rolle of companyGroups.get(a)!) {
              graphStore.addEdge({
                source: a, target: b,
                label: `${personName} (${rolle})`,
                auto: true,
              })
            }
            addedAny = true
            created++
          }
        }
      }
      // ekspander til person-node kun om ingen selskap <-> selskap-kanter trengtes
      if (!addedAny) {
        await expandPerson(personName)
        created++
      }
    }
    if (created > 0) scheduleAutoSave()
    return created
  }
  // korteste vei mellom to selskaper
  let showPathDialog = $state(false)
  let pathSearchA = $state('')
  let pathSearchB = $state('')
  let pathResultsA = $state<BrregCompany[]>([])
  let pathResultsB = $state<BrregCompany[]>([])
  let pathPickA = $state<BrregCompany | null>(null)
  let pathPickB = $state<BrregCompany | null>(null)
  let pathStatus = $state('')
  let pathSearching = $state(false)
  let pathDebounceA: ReturnType<typeof setTimeout> | null = null
  let pathDebounceB: ReturnType<typeof setTimeout> | null = null

  function openPathDialog() {
    showPathDialog = true
    pathSearchA = ''; pathSearchB = ''
    pathResultsA = []; pathResultsB = []
    pathPickA = null; pathPickB = null
    pathStatus = ''; pathSearching = false
    canvas.clearPathHighlight()
  }

  function closePathDialog() {
    showPathDialog = false
    canvas.clearPathHighlight()
  }

  async function pathSearch(side: 'A' | 'B', query: string) {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      if (side === 'A') pathResultsA = []; else pathResultsB = []
      return
    }
    try {
      const res = await searchCompanies(trimmed)
      if (side === 'A') pathResultsA = res; else pathResultsB = res
    } catch {
      if (side === 'A') pathResultsA = []; else pathResultsB = []
    }
  }

  function pathInputA(e: Event) {
    pathSearchA = (e.target as HTMLInputElement).value
    pathPickA = null
    if (pathDebounceA) clearTimeout(pathDebounceA)
    pathDebounceA = setTimeout(() => pathSearch('A', pathSearchA), 300)
  }

  function pathInputB(e: Event) {
    pathSearchB = (e.target as HTMLInputElement).value
    pathPickB = null
    if (pathDebounceB) clearTimeout(pathDebounceB)
    pathDebounceB = setTimeout(() => pathSearch('B', pathSearchB), 300)
  }

  function pickPathCompany(side: 'A' | 'B', company: BrregCompany) {
    if (side === 'A') {
      pathPickA = company; pathSearchA = company.navn; pathResultsA = []
    } else {
      pathPickB = company; pathSearchB = company.navn; pathResultsB = []
    }
  }

  function localBFS(startId: string, endId: string): string[] | null {
    const adj = new Map<string, Set<string>>()
    for (const e of graphStore.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set())
      if (!adj.has(e.target)) adj.set(e.target, new Set())
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
    if (!adj.has(startId) || !adj.has(endId)) return null
    const visited = new Set<string>([startId])
    const parent = new Map<string, string>()
    const queue = [startId]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === endId) {
        const path: string[] = []
        let node: string | undefined = endId
        while (node !== undefined) { path.unshift(node); node = parent.get(node) }
        return path
      }
      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          parent.set(neighbor, current)
          queue.push(neighbor)
        }
      }
    }
    return null
  }

  async function walkOwnershipUp(orgnr: string, budget: { remaining: number }): Promise<BrregCompany[]> {
    const chain: BrregCompany[] = []
    let current: string | null = orgnr
    const visited = new Set<string>()
    while (current && !visited.has(current) && chain.length < 10 && budget.remaining > 0) {
      visited.add(current)
      budget.remaining--
      try {
        const co = await getCompany(current)
        chain.push(co)
        current = co.overordnetEnhet
      } catch { break }
    }
    return chain
  }

  function findBridge(
    personIndex: Map<string, { original: string; fodselsdato?: string; orgnrs: Set<string> }>,
    sideA: Set<string>,
    sideB: Set<string>,
  ): { personName: string; fodselsdato?: string; companyA: string; companyB: string } | null {
    for (const [, { original, fodselsdato, orgnrs }] of personIndex) {
      let companyA: string | null = null
      let companyB: string | null = null
      for (const o of orgnrs) {
        if (sideA.has(o)) companyA = o
        if (sideB.has(o)) companyB = o
        if (companyA && companyB) return { personName: original, fodselsdato, companyA, companyB }
      }
    }
    return null
  }

  function buildBridgePath(
    chainA: BrregCompany[], chainB: BrregCompany[],
    companyA: string, companyB: string, personName: string, fodselsdato?: string,
  ): string[] {
    const idxA = chainA.findIndex(c => c.orgnr === companyA)
    const idxB = chainB.findIndex(c => c.orgnr === companyB)
    const pathUp = chainA.slice(0, (idxA >= 0 ? idxA : 0) + 1).map(c => c.orgnr)
    const pathDown = chainB.slice(0, (idxB >= 0 ? idxB : 0) + 1).map(c => c.orgnr).reverse()
    return [...pathUp, makePersonId(personName, fodselsdato), ...pathDown]
  }

  function addToPersonIndex(
    personIndex: Map<string, { original: string; fodselsdato?: string; orgnrs: Set<string> }>,
    roles: Awaited<ReturnType<typeof getRoles>>,
    orgnr: string,
  ) {
    for (const r of roles) {
      const key = r.person.fodselsdato
        ? `${r.person.navn.toLowerCase()}:${r.person.fodselsdato}`
        : r.person.navn.toLowerCase()
      if (!personIndex.has(key)) personIndex.set(key, { original: r.person.navn, fodselsdato: r.person.fodselsdato, orgnrs: new Set() })
      personIndex.get(key)!.orgnrs.add(orgnr)
    }
  }

  async function runPathfinding() {
    if (!pathPickA || !pathPickB) return
    pathSearching = true
    canvas.clearPathHighlight()

    const orgnrA = pathPickA.orgnr
    const orgnrB = pathPickB.orgnr
    const budget = { remaining: 50 }

    try {
      // BFS i lokal graf
      const localPath = localBFS(orgnrA, orgnrB)
      if (localPath && localPath.length > 0) {
        pathStatus = `Fant vei i grafen (${localPath.length} steg)`
        canvas.setPathHighlight(localPath)
        pathSearching = false
        return
      }

      // følg eierkjeder oppover fra begge
      pathStatus = 'Følger eierkjeder'
      const [chainA, chainB] = await Promise.all([
        walkOwnershipUp(orgnrA, budget),
        walkOwnershipUp(orgnrB, budget),
      ])

      const allChain = [...chainA, ...chainB]
      const uniqueOrgnrs = new Set<string>()
      for (const co of allChain) {
        if (!uniqueOrgnrs.has(co.orgnr)) {
          uniqueOrgnrs.add(co.orgnr)
          if (!graphStore.getNode(co.orgnr)) {
            const idx = uniqueOrgnrs.size - 1
            const x = (idx - allChain.length / 2) * 280
            await addToCanvas(co, { x, y: 0 })
          }
        }
      }

      // sjekk felles morselskap
      const setA = new Map(chainA.map((c, i) => [c.orgnr, i]))
      for (let bi = 0; bi < chainB.length; bi++) {
        const ai = setA.get(chainB[bi]!.orgnr)
        if (ai !== undefined) {
          const pathUp = chainA.slice(0, ai + 1).map(c => c.orgnr)
          const pathDown = chainB.slice(0, bi).map(c => c.orgnr).reverse()
          const pathNodes = [...pathUp, ...pathDown]
          pathStatus = `Fant vei via eierkjede (${pathNodes.length} steg)`
          canvas.setPathHighlight(pathNodes)
          pathSearching = false
          scheduleAutoSave()
          return
        }
      }

      // last roller parallelt, bygg person-indeks
      pathStatus = 'Sjekker roller'
      const personIndex = new Map<string, { original: string; orgnrs: Set<string> }>()
      const rolesMap = new Map<string, Awaited<ReturnType<typeof getRoles>>>()
      const sideAOrgnrs = new Set(chainA.map(c => c.orgnr))
      const sideBOrgnrs = new Set(chainB.map(c => c.orgnr))

      const allCompanies = [...new Map(allChain.map(c => [c.orgnr, c])).values()]
      await Promise.all(allCompanies.map(async co => {
        if (budget.remaining <= 0) return
        budget.remaining--
        try {
          const roles = await getRoles(co.orgnr)
          rolesMap.set(co.orgnr, roles)
          addToPersonIndex(personIndex, roles, co.orgnr)
        } catch { /* skip */ }
      }))

      const bridge = findBridge(personIndex, sideAOrgnrs, sideBOrgnrs)
      if (bridge) {
        const fullPath = buildBridgePath(chainA, chainB, bridge.companyA, bridge.companyB, bridge.personName, bridge.fodselsdato)
        await expandPerson(bridge.personName)
        pathStatus = `Fant vei via ${bridge.personName} (${fullPath.length} steg)`
        canvas.setPathHighlight(fullPath)
        pathSearching = false
        scheduleAutoSave()
        return
      }

      // utvid til datterselskaper
      if (budget.remaining > 0) {
        pathStatus = 'Utvider søk til datterselskaper'
        const expandSide = async (chainOrgnrs: string[]) => {
          const subOrgnrs: string[] = []
          const subFetches = chainOrgnrs.slice(0, 4).map(async orgnr => {
            if (budget.remaining <= 0) return []
            budget.remaining--
            try {
              const res = await fetch(
                `https://data.brreg.no/enhetsregisteret/api/underenheter?overordnetEnhet=${orgnr}&size=5`,
                { headers: { Accept: 'application/json' } },
              )
              if (!res.ok) return []
              const data = await res.json() as { _embedded?: { underenheter?: Array<{ organisasjonsnummer: string }> } }
              return (data._embedded?.underenheter ?? [])
                .slice(0, 5)
                .map(s => s.organisasjonsnummer)
                .filter(o => !rolesMap.has(o))
            } catch { return [] }
          })
          const results = await Promise.all(subFetches)
          for (const batch of results) subOrgnrs.push(...batch)

          await Promise.all(subOrgnrs.map(async orgnr => {
            if (budget.remaining <= 1) return
            budget.remaining -= 2
            try {
              const [co, roles] = await Promise.all([getCompany(orgnr), getRoles(orgnr)])
              if (!graphStore.getNode(co.orgnr)) await addToCanvas(co)
              rolesMap.set(co.orgnr, roles)
              addToPersonIndex(personIndex, roles, co.orgnr)
            } catch { /* skip */ }
          }))
          return subOrgnrs
        }

        const [subsA, subsB] = await Promise.all([
          expandSide(chainA.map(c => c.orgnr)),
          expandSide(chainB.map(c => c.orgnr)),
        ])

        const expandedA = new Set([...sideAOrgnrs, ...subsA])
        const expandedB = new Set([...sideBOrgnrs, ...subsB])

        const bridge2 = findBridge(personIndex, expandedA, expandedB)
        if (bridge2) {
          await expandPerson(bridge2.personName)
          const bridgePid = makePersonId(bridge2.personName, bridge2.fodselsdato)
          const pathNodes = [
            orgnrA,
            ...(bridge2.companyA !== orgnrA ? [bridge2.companyA] : []),
            bridgePid,
            ...(bridge2.companyB !== orgnrB ? [bridge2.companyB] : []),
            orgnrB,
          ]
          pathStatus = `Fant vei via ${bridge2.personName} (utvidet søk)`
          canvas.setPathHighlight(pathNodes)
          pathSearching = false
          scheduleAutoSave()
          return
        }
      }

      pathStatus = 'Ingen vei funnet mellom disse selskapene'
      pathSearching = false
    } catch (err) {
      pathStatus = `Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}`
      pathSearching = false
    }
  }

  const RANDOM_TERMS = [
    'konsult', 'bygg', 'tech', 'eiendom', 'transport', 'restaurant',
    'design', 'helse', 'energi', 'handel', 'fisk', 'media', 'sport',
    'invest', 'shipping', 'finans', 'mat', 'motor', 'data', 'kraft',
  ]

  async function loadRandom() {
    const term = RANDOM_TERMS[Math.floor(Math.random() * RANDOM_TERMS.length)]!
    try {
      const results = await searchCompanies(term)
      if (results.length > 0) {
        const pick = results[Math.floor(Math.random() * results.length)]!
        await addToCanvas(pick)
      }
    } catch { /* ignore */ }
  }

  function runLayout() {
    const simNodes = graphStore.nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))
    if (simNodes.length < 2) return

    const idIndex = new Map(simNodes.map((n, i) => [n.id, i]))
    const simLinks = graphStore.getCollapsedEdges()
      .filter(e => idIndex.has(e.source) && idIndex.has(e.target))
      .map(e => ({ source: idIndex.get(e.source)!, target: idIndex.get(e.target)! }))

    const sim = d3.forceSimulation(simNodes)
      .force('charge', d3.forceManyBody().strength(-800))
      .force('link', d3.forceLink(simLinks).distance(300).strength(0.5))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide(130))
      .stop()

    for (let i = 0; i < 200; i++) sim.tick()

    // animer noder til nye posisjoner
    const duration = 500
    const startPositions = new Map(graphStore.nodes.map(n => [n.id, { x: n.x, y: n.y }]))
    const targetPositions = new Map(simNodes.map(n => [n.id, { x: n.x, y: n.y }]))
    const startTime = performance.now()

    function animate() {
      const t = Math.min(1, (performance.now() - startTime) / duration)
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2 // easeInOutQuad
      for (const node of graphStore.nodes) {
        const from = startPositions.get(node.id)
        const to = targetPositions.get(node.id)
        if (from && to) {
          graphStore.moveNode(node.id, from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease)
        }
      }
      if (t < 1) requestAnimationFrame(animate)
      else scheduleAutoSave()
    }
    requestAnimationFrame(animate)
  }

  function clearCanvas() {
    graphStore.clear()
    canvas.clearOverlays()
    canvas.resetView()
    nodeCount = 0
    graphStore.autoSave()
  }

  async function loadGrafParam(param: string): Promise<boolean> {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    try {
      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      writer.write(bytes)
      writer.close()
      const decompressed = await new Response(ds.readable).arrayBuffer()
      const json = new TextDecoder().decode(decompressed)
      const [nodes, edges] = JSON.parse(json) as [unknown[][], unknown[][]]
      const state = {
        n: nodes.map(n => ({ i: String(n[0]), n: String(n[1]), t: String(n[2]), x: Number(n[3]), y: Number(n[4]) })),
        e: edges.map(e => ({ s: String(e[0]), t: String(e[1]), l: String(e[2] ?? ''), a: !!(e[3] ?? true), ...(e[4] ? { tp: String(e[4]) } : {}) })),
      }
      graphStore.loadSerializable(state)
      return true
    } catch {
      try {
        const json = new TextDecoder().decode(bytes)
        const state = JSON.parse(json)
        if (state.n && state.e) {
          graphStore.loadSerializable(state)
          return true
        }
      } catch { /* ignore */ }
    }
    return false
  }

  let watchInterval: ReturnType<typeof setInterval>

  onMount(() => {
    // regnskapsregisteret mangler CORS, bruk lokal proxy
    setRegnskapBaseUrl('/api/regnskap')
    setBrregBaseUrl('/api/brreg')

    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(window.location.search)
    const grafParam = params.get('g')
    let restored = false
    async function restore() {
      if (grafParam) {
        restored = await loadGrafParam(grafParam)
      }
      if (!restored && hash) {
        restored = graphStore.load(hash)
      }
      if (!restored) {
        restored = graphStore.autoLoad()
      }
      if (restored) {
        nodeCount = graphStore.nodes.length
        for (const n of graphStore.nodes) {
          enrichNode(n.id)
        }
      }
    }
    restore()

    watchInterval = setInterval(() => {
      if (graphStore.version !== lastSavedVersion) {
        lastSavedVersion = graphStore.version
        scheduleAutoSave()
      }
    }, 1000)

    return () => clearInterval(watchInterval)
  })
</script>

<svelte:head>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #131316;
      color: #e0e0e5;
    }
  </style>
</svelte:head>

<WelcomeModal />

<div class="app">
  <Canvas bind:this={canvas} {linkMode} onlinkclick={handleLinkClick} onpersonclick={handleOverlayNameClick} onnodeclick={handleNodeClick} />

  <div class="top-bar">
    <span class="logo">Noder</span>
    <button class="mcp-btn" onclick={() => { showMcp = true }} title="MCP-server oppsett">MCP</button>
    <Search onselect={addToCanvas} />
    <button class="kartlegg-btn" onclick={detectOverlaps} title="Analyserer noder og viser koblinger mellom selskaper">Kartlegg</button>
    <Controls
      onzoomin={() => canvas.zoomIn()}
      onzoomout={() => canvas.zoomOut()}
      onclear={clearCanvas}
      onrandom={loadRandom}
      onlink={toggleLinkMode}
      onshare={shareGraph}
      onexportraw={exportRaw}
      onexportfile={exportFile}
      onimportraw={importRaw}
      onimportfile={importFile}
      oncapture={captureScreenshot}
      onfindpath={openPathDialog}
      onlayout={runLayout}
      {linkMode}
      {showCopied}
    />
  </div>

  <input
    type="file"
    accept=".json"
    style="display: none;"
    bind:this={fileInput}
    onchange={handleFileLoad}
  />

  {#if linkMode && !showLabelInput}
    <div class="link-hint">
      {#if linkFirst}
        Klikk på den andre noden for å koble den til {graphStore.getNode(linkFirst)?.navn ?? ''}
      {:else}
        Klikk på første node. Trykk Velg node øverst for å avbryte.
      {/if}
    </div>
  {/if}

  {#if showLabelInput}
    <div class="label-overlay" role="presentation" onclick={cancelLabel}>
      <div
        class="label-input-box"
        role="presentation"
        style="left: {labelInputPos.x}px; top: {labelInputPos.y}px;"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="label-input-title">Relasjonstype</div>
        <div class="type-picker">
          {#each MANUAL_EDGE_TYPES as mt}
            <button
              class="type-btn"
              class:type-selected={selectedEdgeType === mt.value}
              style="--tc: {mt.color}"
              onclick={() => { selectedEdgeType = mt.value }}
            >{mt.label}</button>
          {/each}
        </div>
        <div class="label-input-title" style="margin-top: 10px">Beskrivelse</div>
        <input
          type="text"
          bind:this={labelInputEl}
          bind:value={labelInputValue}
          onkeydown={(e) => {
            if (e.key === 'Enter') confirmLabel()
            if (e.key === 'Escape') cancelLabel()
          }}
        />
        <div class="label-input-actions">
          <button class="label-btn-cancel" onclick={cancelLabel}>Avbryt</button>
          <button class="label-btn-ok" onclick={confirmLabel}>OK</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showCapture}
    <div class="label-overlay" role="presentation" onclick={() => { showCapture = false }}>
      <div class="capture-popup" role="presentation" onclick={(e) => e.stopPropagation()}>
        <div class="capture-preview">
          <img src={captureDataUrl} alt="Skjermbilde" />
        </div>
        <div class="capture-actions">
          <button class="capture-btn" onclick={() => saveCaptureAs('png')}>PNG</button>
          <button class="capture-btn" onclick={() => saveCaptureAs('jpg')}>JPG</button>
          <button class="capture-btn" onclick={() => saveCaptureAs('svg')}>SVG</button>
          <button class="capture-btn cancel" onclick={() => { showCapture = false }}>Lukk</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showJsonPopup}
    <div class="label-overlay" role="presentation" onclick={() => { showJsonPopup = null }}>
      <div class="json-popup" role="presentation" onclick={(e) => e.stopPropagation()}>
        <div class="json-popup-header">
          <span class="json-popup-title">{showJsonPopup === 'export' ? 'Eksporter JSON' : 'Importer JSON'}</span>
          <button class="popup-close" onclick={() => { showJsonPopup = null }}>x</button>
        </div>
        {#if showJsonPopup === 'export'}
          <textarea class="json-textarea" readonly value={jsonPopupText} onclick={(e) => (e.target as HTMLTextAreaElement).select()}></textarea>
          <div class="json-actions">
            <button class="json-btn" onclick={() => { navigator.clipboard.writeText(jsonPopupText); showJsonPopup = null }}>Kopier</button>
            <button class="json-btn cancel" onclick={() => { showJsonPopup = null }}>Lukk</button>
          </div>
        {:else}
          <textarea class="json-textarea" placeholder='Lim inn JSON her...' bind:value={jsonPopupText}></textarea>
          <div class="json-actions">
            <button class="json-btn" onclick={confirmImportRaw}>Importer</button>
            <button class="json-btn cancel" onclick={() => { showJsonPopup = null }}>Avbryt</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showPathDialog}
    <div class="label-overlay" role="presentation" onclick={closePathDialog}>
      <div class="path-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
        <div class="path-dialog-title">Finn korteste vei</div>

        <div class="path-field">
          <label class="path-label" for="path-from">Fra</label>
          {#if pathPickA}
            <div class="path-picked">
              <span>{pathPickA.navn}</span>
              <button class="path-clear" onclick={() => { pathPickA = null; pathSearchA = ''; pathResultsA = [] }}>&times;</button>
            </div>
          {:else}
            <input id="path-from" type="text" placeholder="Søk selskap" value={pathSearchA} oninput={pathInputA} />
            {#if pathResultsA.length > 0}
              <ul class="path-results">
                {#each pathResultsA.slice(0, 5) as r}
                  <li><button onclick={() => pickPathCompany('A', r)}>{r.navn} <span class="path-meta">{r.orgnr}</span></button></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        <div class="path-field">
          <label class="path-label" for="path-to">Til</label>
          {#if pathPickB}
            <div class="path-picked">
              <span>{pathPickB.navn}</span>
              <button class="path-clear" onclick={() => { pathPickB = null; pathSearchB = ''; pathResultsB = [] }}>&times;</button>
            </div>
          {:else}
            <input id="path-to" type="text" placeholder="Søk selskap" value={pathSearchB} oninput={pathInputB} />
            {#if pathResultsB.length > 0}
              <ul class="path-results">
                {#each pathResultsB.slice(0, 5) as r}
                  <li><button onclick={() => pickPathCompany('B', r)}>{r.navn} <span class="path-meta">{r.orgnr}</span></button></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        {#if pathStatus}
          <div class="path-status" class:path-error={pathStatus.startsWith('Ingen') || pathStatus.startsWith('Feil')}>
            {#if pathSearching}<span class="path-spinner"></span>{/if}
            {pathStatus}
          </div>
        {/if}

        <div class="label-input-actions">
          <button class="label-btn-cancel" onclick={closePathDialog}>Lukk</button>
          <button
            class="label-btn-ok"
            disabled={!pathPickA || !pathPickB || pathSearching}
            onclick={runPathfinding}
          >
            {pathSearching ? 'Søker' : 'Finn vei'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showMcp}
    <div class="mcp-overlay" role="presentation" onclick={() => { showMcp = false }}>
      <div class="mcp-popup" role="presentation" onclick={(e) => e.stopPropagation()}>
        <button class="mcp-close" onclick={() => { showMcp = false }}>x</button>
        <h2>MCP-server</h2>
        <p class="mcp-desc">Med Noders MCP-server kan AI-agenter utforske norske selskapsnettverk, hente regnskap og roller, og bygge visuelle grafer som kan deles via URL.</p>

        <div class="mcp-step">
          <span class="mcp-num">1</span>
          <div>
            <p class="mcp-step-title">Installer</p>
            <code class="mcp-code">npx noder-mcp</code>
          </div>
        </div>

        <div class="mcp-step">
          <span class="mcp-num">2</span>
          <div>
            <p class="mcp-step-title">Legg til i config</p>
            <div class="mcp-tabs">
              <button class:active={mcpTab === 'claude'} onclick={() => mcpTab = 'claude'}>Claude Desktop</button>
              <button class:active={mcpTab === 'cursor'} onclick={() => mcpTab = 'cursor'}>Cursor</button>
              <button class:active={mcpTab === 'claude-code'} onclick={() => mcpTab = 'claude-code'}>Claude Code</button>
            </div>
            {#if mcpTab === 'claude'}
              <p class="mcp-step-file">claude_desktop_config.json</p>
              <pre class="mcp-pre"><code>{`{
  "mcpServers": {
    "noder": {
      "command": "npx",
      "args": ["noder-mcp"]
    }
  }
}`}</code></pre>
            {:else if mcpTab === 'cursor'}
              <p class="mcp-step-file">.cursor/mcp.json</p>
              <pre class="mcp-pre"><code>{`{
  "mcpServers": {
    "noder": {
      "command": "npx",
      "args": ["noder-mcp"]
    }
  }
}`}</code></pre>
            {:else}
              <p class="mcp-step-file">Terminal</p>
              <pre class="mcp-pre"><code>{`claude mcp add noder -- npx noder-mcp`}</code></pre>
            {/if}
          </div>
        </div>

        <div class="mcp-step">
          <span class="mcp-num">3</span>
          <div>
            <p class="mcp-step-title">Start agenten på nytt</p>
            <p class="mcp-step-desc">Verktøyene dukker opp automatisk.</p>
          </div>
        </div>

        <div class="mcp-tools">
          <p class="mcp-tools-title">Verktøy</p>
          <div class="mcp-tool-list">
            <span>søk_selskap</span>
            <span>hent_selskap</span>
            <span>hent_roller</span>
            <span>hent_regnskap</span>
            <span>hent_nettverk</span>
            <span>sammenlign_selskaper</span>
            <span>bygg_graf</span>
          </div>
        </div>

        <p class="mcp-step-desc" style="margin-top: 12px; opacity: 0.7;">Alle verktøy returnerer JSON. Serveren inkluderer også en guide-ressurs (<code style="font-size: 11px;">noder://guide</code>) som hjelper agenten med å bruke verktøyene riktig.</p>
      </div>
    </div>
  {/if}

  {#if selectedNodeId}
    <div class="panel-backdrop" role="presentation" onclick={closePanel}></div>
  {/if}
  {#if selectedNodeId && panelNode}
    {#if panelNode.isPerson}
      <PersonPanel node={panelNode} onclose={closePanel} oncompanyclick={extractCompanyFromPerson} />
    {:else}
      <CompanyPanel node={panelNode} onclose={closePanel} />
    {/if}
  {/if}
</div>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape') {
    if (selectedNodeId) { closePanel(); return }
    if (showJsonPopup) { showJsonPopup = null; return }
    if (showCapture) { showCapture = false; return }
    if (showPathDialog) { closePathDialog(); return }
    if (showMcp) { showMcp = false; return }
    if (showLabelInput) { cancelLabel(); return }
  }
}} />

<style>
  .app {
    width: 100vw;
    height: 100vh;
    position: relative;
  }

  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 16px;
    pointer-events: none;
  }

  .top-bar > :global(*) {
    pointer-events: auto;
  }

  .logo {
    font-size: 20px;
    color: #e0e0e5;
    text-decoration: none;
    font-weight: 700;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.5px;
    transition: color 0.15s;
    line-height: 44px;
    flex-shrink: 0;
    margin-right: 2px;
  }

  .mcp-btn {
    height: 44px;
    padding: 0 14px;
    border: 1px solid #3a3f48;
    border-radius: 3px;
    background: #1a1a1e;
    color: #7a8a9e;
    font-size: 13px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s, color 0.15s;
  }

  .mcp-btn:hover {
    border-color: #7a8a9e;
    color: #9aa8b8;
  }

  .kartlegg-btn {
    height: 44px;
    padding: 0 20px;
    border: 1px solid #5a7a9e;
    border-radius: 3px;
    background: #1e2a38;
    color: #9ab0c8;
    font-size: 13px;
    font-weight: 600;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    letter-spacing: 0.3px;
  }

  .kartlegg-btn:hover {
    border-color: #7a9abe;
    background: #243448;
    color: #c0d0e0;
  }

  .link-hint {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    background: #1a1a1e;
    border: 1px solid #7a8a9e;
    border-radius: 3px;
    padding: 8px 16px;
    font-size: 12px;
    color: #7a8a9e;
    white-space: nowrap;
  }

  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
  }

  .label-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
  }

  .label-input-box {
    position: absolute;
    transform: translate(-50%, -50%);
    background: #1a1a1e;
    border: 1px solid #38383f;
    border-radius: 3px;
    padding: 16px 20px;
    width: 280px;
  }

  .label-input-title {
    font-size: 12px;
    color: #78787e;
    margin-bottom: 8px;
  }

  .type-picker {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .type-btn {
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 1px solid #38383f;
    background: none;
    color: #78787e;
    transition: border-color 0.15s, color 0.15s;
  }

  .type-btn:hover {
    border-color: var(--tc);
    color: var(--tc);
  }

  .type-selected {
    border-color: var(--tc);
    color: var(--tc);
    background: color-mix(in srgb, var(--tc) 10%, transparent);
  }

  .label-input-box input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #38383f;
    border-radius: 3px;
    background: #131316;
    color: #c8c8cd;
    font-size: 13px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    outline: none;
    box-sizing: border-box;
  }

  .label-input-box input:focus {
    border-color: #7a8a9e;
  }

  .label-input-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    justify-content: flex-end;
  }

  .label-btn-cancel,
  .label-btn-ok {
    padding: 5px 14px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 1px solid #38383f;
  }

  .label-btn-cancel {
    background: none;
    color: #78787e;
  }

  .label-btn-cancel:hover {
    color: #c8c8cd;
    border-color: #58585e;
  }

  .label-btn-ok {
    background: #7a8a9e;
    color: #131316;
    border-color: #7a8a9e;
    font-weight: 600;
  }

  .label-btn-ok:hover {
    background: #8b5cf6;
    border-color: #8b5cf6;
  }

  /* MCP-popup */
  .mcp-overlay {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
  }

  .mcp-popup {
    position: relative;
    background: #1a1a1e;
    border: 1px solid #2e2e35;
    border-radius: 3px;
    padding: 40px 48px;
    width: 620px;
    max-height: 85vh;
    overflow-y: auto;
  }

  .mcp-close {
    position: absolute;
    top: 12px;
    right: 16px;
    background: none;
    border: none;
    color: #58585e;
    font-size: 18px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 4px 8px;
  }

  .mcp-close:hover {
    color: #c8c8cd;
  }

  .mcp-popup h2 {
    margin: 0 0 8px 0;
    font-size: 18px;
    font-weight: 700;
    color: #e0e0e4;
  }

  .mcp-desc {
    color: #b0b0b5;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 24px 0;
  }

  .mcp-step {
    display: flex;
    gap: 14px;
    margin-bottom: 20px;
  }

  .mcp-num {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #28282e;
    color: #7a8a9e;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
  }

  .mcp-step-title {
    margin: 0 0 6px 0;
    font-size: 15px;
    font-weight: 600;
    color: #e0e0e5;
  }

  .mcp-step-desc {
    margin: 0;
    font-size: 13px;
    color: #a0a0a5;
  }

  .mcp-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 10px;
  }

  .mcp-tabs button {
    padding: 5px 12px;
    font-size: 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #131316;
    border: 1px solid #28282e;
    color: #78787e;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .mcp-tabs button:first-child {
    border-radius: 3px 0 0 3px;
  }

  .mcp-tabs button:last-child {
    border-radius: 0 3px 3px 0;
  }

  .mcp-tabs button:not(:first-child) {
    border-left: none;
  }

  .mcp-tabs button:hover {
    color: #c8c8cd;
  }

  .mcp-tabs button.active {
    background: #28282e;
    color: #e0e0e5;
    border-color: #3e3e45;
  }

  .mcp-step-file {
    margin: 0 0 6px 0;
    font-size: 11px;
    color: #8a8a90;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .mcp-code {
    display: inline-block;
    background: #131316;
    border: 1px solid #28282e;
    border-radius: 3px;
    padding: 6px 12px;
    font-size: 13px;
    color: #7a8a9e;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .mcp-pre {
    background: #131316;
    border: 1px solid #28282e;
    border-radius: 3px;
    padding: 10px 12px;
    margin: 0;
    overflow-x: auto;
  }

  .mcp-pre code {
    font-size: 12px;
    color: #8e8e94;
    line-height: 1.5;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .mcp-tools {
    border-top: 1px solid #28282e;
    padding-top: 16px;
    margin-top: 8px;
  }

  .mcp-tools-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    color: #a0a0a5;
    font-weight: 600;
  }

  .mcp-tool-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mcp-tool-list span {
    background: #131316;
    border: 1px solid #28282e;
    border-radius: 2px;
    padding: 3px 8px;
    font-size: 11px;
    color: #8e8e94;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* Skjermbilde-popup */
  .capture-popup {
    position: absolute;
    transform: translate(-50%, -50%);
    left: 50%;
    top: 50%;
    background: #1a1a1e;
    border: 1px solid #38383f;
    border-radius: 3px;
    padding: 16px;
    max-width: 80vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .capture-preview {
    overflow: hidden;
    border-radius: 3px;
    border: 1px solid #28282e;
    max-height: 60vh;
  }

  .capture-preview img {
    display: block;
    max-width: 100%;
    max-height: 60vh;
    object-fit: contain;
  }

  .capture-actions {
    display: flex;
    gap: 6px;
    justify-content: center;
  }

  .capture-btn {
    padding: 6px 16px;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 1px solid #38383f;
    background: #131316;
    color: #c8c8cd;
    transition: border-color 0.15s, color 0.15s;
  }

  .capture-btn:hover {
    border-color: #7a8a9e;
    color: #7a8a9e;
  }

  .capture-btn.cancel {
    color: #78787e;
  }

  .capture-btn.cancel:hover {
    border-color: #58585e;
    color: #c8c8cd;
  }

  /* JSON-popup */
  .json-popup {
    position: absolute;
    transform: translate(-50%, -50%);
    left: 50%;
    top: 50%;
    background: #1a1a1e;
    border: 1px solid #38383f;
    border-radius: 3px;
    padding: 20px 24px;
    width: 540px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .json-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .json-popup-title {
    font-size: 15px;
    font-weight: 600;
    color: #e0e0e5;
  }

  .json-popup .popup-close {
    background: none;
    border: none;
    color: #58585e;
    font-size: 18px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 0 4px;
  }

  .json-popup .popup-close:hover {
    color: #e0e0e5;
  }

  .json-textarea {
    width: 100%;
    height: 320px;
    padding: 12px;
    border: 1px solid #2e2e35;
    border-radius: 3px;
    background: #131316;
    color: #c8c8cd;
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    line-height: 1.5;
  }

  .json-textarea:focus {
    border-color: #48484e;
  }

  .json-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .json-btn {
    padding: 7px 18px;
    border-radius: 3px;
    font-size: 13px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 1px solid #38383f;
    background: #131316;
    color: #e0e0e5;
    transition: border-color 0.15s, color 0.15s;
  }

  .json-btn:hover {
    border-color: #7a8a9e;
    color: #7a8a9e;
  }

  .json-btn.cancel {
    color: #78787e;
  }

  .json-btn.cancel:hover {
    border-color: #58585e;
    color: #c8c8cd;
  }

  /* Finn vei-dialog */
  .path-dialog {
    position: absolute;
    transform: translate(-50%, -50%);
    left: 50%;
    top: 50%;
    background: #1a1a1e;
    border: 1px solid #38383f;
    border-radius: 3px;
    padding: 20px 24px;
    width: 340px;
  }

  .path-dialog-title {
    font-size: 16px;
    font-weight: 700;
    color: #e0e0e5;
    margin-bottom: 16px;
  }

  .path-field {
    margin-bottom: 12px;
    position: relative;
  }

  .path-label {
    font-size: 11px;
    color: #78787e;
    display: block;
    margin-bottom: 4px;
  }

  .path-field input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #38383f;
    border-radius: 3px;
    background: #131316;
    color: #c8c8cd;
    font-size: 13px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    outline: none;
    box-sizing: border-box;
  }

  .path-field input:focus {
    border-color: #7a9a8a;
  }

  .path-results {
    list-style: none;
    margin: 0;
    padding: 0;
    background: #131316;
    border: 1px solid #38383f;
    border-top: none;
    border-radius: 0 0 3px 3px;
    max-height: 150px;
    overflow-y: auto;
    position: absolute;
    left: 0;
    right: 0;
    z-index: 10;
  }

  .path-results li button {
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #c8c8cd;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .path-results li button:hover {
    background: #222226;
  }

  .path-meta {
    font-size: 10px;
    color: #58585e;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .path-picked {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #131316;
    border: 1px solid #7a9a8a;
    border-radius: 3px;
    font-size: 13px;
    color: #7a9a8a;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .path-clear {
    background: none;
    border: none;
    color: #58585e;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .path-clear:hover {
    color: #c8c8cd;
  }

  .path-status {
    font-size: 12px;
    color: #7a9a8a;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .path-error {
    color: #e06c75;
  }

  .path-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid #7a9a8a;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>