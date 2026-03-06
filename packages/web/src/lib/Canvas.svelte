<script lang="ts">
  import { onMount } from 'svelte'
  import * as d3 from 'd3'
  import { graphStore, type GraphNode, type CollapsedEdge, type PersonCompany } from './graph-store.svelte.js'

  interface Props {
    linkMode: boolean
    onlinkclick: (nodeId: string) => void
    onpersonclick: (name: string) => void
    onnodeclick?: (nodeId: string) => void
  }

  let { linkMode, onlinkclick, onpersonclick, onnodeclick }: Props = $props()
  let currentScale = $state(1)
  let pathNodeIds = $state<Set<string>>(new Set())
  let svgEl: SVGSVGElement
  let container: d3.Selection<SVGGElement, unknown, null, undefined>
  let edgeLayer: d3.Selection<SVGGElement, unknown, null, undefined>
  let nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>
  let overlayLayer: d3.Selection<SVGGElement, unknown, null, undefined>
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>
  let lastVersion = -1
  let lastContentVersion = -1
  let lastScale = -1
  const gridSize = 50
  const HW = 110, HH = 42

  const TYPE_COLORS: Record<string, string> = {
    AS:   '#5a7a9e',
    ASA:  '#5a7a9e',
    ENK:  '#5a9e6e',
    ANS:  '#9e8a5a',
    DA:   '#9e8a5a',
    NUF:  '#7a8a9e',
    FLI:  '#8a7a6a',
    SA:   '#9e8a5a',
    STI:  '#6a8a7a',
    SPA:  '#6a8a7a',
  }

  function typeColor(type: string): string {
    return TYPE_COLORS[type] ?? '#78787e'
  }

  const C = {
    bg: '#131316',
    surface: '#1a1a1e',
    border: '#2e2e35',
    borderLight: '#42424a',
    text: '#e0e0e5',
    textDim: '#a0a0a6',
    textMuted: '#68686e',
    edge: '#4a4a52',
    accent: '#7a8a9e',
    grid: '#252530',
  }

  const EDGE_STYLES: Record<string, { color: string; width: number; dash: string; end: string; start: string }> = {
    eierskap:   { color: '#5a7a9e', width: 2.5, dash: '',    end: 'url(#arrow-own)',  start: 'url(#diamond)' },
    rolle:      { color: '#8a8a92', width: 1.5, dash: '6,3', end: 'url(#arrow-role)', start: '' },
    kartlegg:   { color: '#c8c8cd', width: 1,   dash: '3,3', end: '',                 start: '' },
    leverandør: { color: '#5a9e6e', width: 1.5, dash: '',    end: 'url(#arrow-lev)',  start: '' },
    kunde:      { color: '#9e8a5a', width: 1.5, dash: '',    end: 'url(#arrow-kun)',  start: '' },
    samarbeid:  { color: '#6a8a7a', width: 1.5, dash: '6,3', end: '',                 start: '' },
    manuell:    { color: C.edge,    width: 1.5, dash: '',    end: '',                 start: '' },
  }

  function edgeStyle(d: CollapsedEdge) {
    return EDGE_STYLES[d.type] ?? EDGE_STYLES.manuell
  }

  interface InfoNode {
    edgeKey: string
    x: number
    y: number
    edge: CollapsedEdge
  }
  let infoNodes: InfoNode[] = []
  let infoVersion = 0

  let _dragging: { pairKey: string; fixedId: string; movingId: string; mx: number; my: number } | null = null
  let dragPreviewLine: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null

  function formatNOK(v: number | null | undefined): string {
    if (v == null) return '-'
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`
    return v.toFixed(0)
  }

  function rectEdgePoint(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number) {
    const dx = tx - cx, dy = ty - cy
    if (dx === 0 && dy === 0) return { x: cx, y: cy }
    const s = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy)
    return { x: cx + dx * s, y: cy + dy * s }
  }

  function edgePoint(nx: number, ny: number, tx: number, ty: number, node?: GraphNode) {
    if (node) {
      const r = nodeRect(node)
      return rectEdgePoint(r.cx, r.cy, r.hw, r.hh, tx, ty)
    }
    return rectEdgePoint(nx, ny, HW, HH, tx, ty)
  }

  function nodeRect(n: GraphNode): { cx: number; cy: number; hw: number; hh: number } {
    return { cx: n.x, cy: n.y, hw: HW, hh: HH }
  }

  function findNodeAt(gx: number, gy: number): GraphNode | null {
    for (const n of graphStore.nodes) {
      const r = nodeRect(n)
      if (Math.abs(gx - r.cx) < r.hw && Math.abs(gy - r.cy) < r.hh) return n
    }
    return null
  }

  function extractPersonName(label: string): string | null {
    const m = label.match(/^(.+?)\s*\(/)
    return m ? m[1]!.trim() : null
  }

  function toggleInfoNode(d: CollapsedEdge, mx: number, my: number) {
    const idx = infoNodes.findIndex(n => n.edgeKey === d.key)
    if (idx >= 0) {
      infoNodes.splice(idx, 1)
    } else {
      infoNodes.push({ edgeKey: d.key, x: mx, y: my + 30, edge: d })
    }
    infoVersion++
    renderOverlay()
  }

  function removeInfoNode(key: string) {
    infoNodes = infoNodes.filter(n => n.edgeKey !== key)
    infoVersion++
    renderOverlay()
  }

  function renderOverlay() {
    if (!overlayLayer) return

    const edgeKeys = new Set(graphStore.getCollapsedEdges().map(e => e.key))
    infoNodes = infoNodes.filter(n => edgeKeys.has(n.edgeKey))

    const sel = overlayLayer.selectAll<SVGGElement, InfoNode>('g.info-node')
      .data(infoNodes, (d: InfoNode) => d.edgeKey)

    sel.exit().remove()

    const enter = sel.enter().append('g').attr('class', 'info-node').attr('cursor', 'grab')
      .call(d3.drag<SVGGElement, InfoNode>()
        .filter(function (ev) {
          return !(ev.target as SVGElement).classList?.contains('person-link')
        })
        .on('start', function (ev) { ev.sourceEvent?.stopPropagation(); d3.select(this).attr('cursor', 'grabbing') })
        .on('drag', (ev, d) => { d.x = ev.x; d.y = ev.y; infoVersion++; renderOverlay() })
        .on('end', function () { d3.select(this).attr('cursor', 'grab') })
      )

    enter.append('rect').attr('class', 'info-bg').attr('rx', 3)
    enter.append('text').attr('class', 'info-close').attr('cursor', 'pointer').attr('font-size', '12px')
      .attr('fill', C.textMuted).attr('text-anchor', 'end').text('x')
      .on('click', function (_ev: Event, d: unknown) {
        removeInfoNode((d as InfoNode).edgeKey)
      })
    enter.append('g').attr('class', 'info-labels')
    enter.append('text').attr('class', 'info-remove-edge').attr('cursor', 'pointer').attr('font-size', '10px')
      .attr('fill', '#9e5a5a').attr('opacity', 0.6).text('Fjern relasjon')
      .on('mouseenter', function () { d3.select(this).attr('opacity', 1) })
      .on('mouseleave', function () { d3.select(this).attr('opacity', 0.6) })
      .on('click', function (_ev: Event, d: unknown) {
        const info = d as InfoNode
        graphStore.removeEdgesBetween(info.edge.source, info.edge.target)
        removeInfoNode(info.edgeKey)
      })
    enter.append('line').attr('class', 'info-connector').attr('stroke', C.borderLight).attr('stroke-width', 1).attr('stroke-dasharray', '3,3')

    const all = enter.merge(sel)

    all.each(function (this: SVGGElement, d: InfoNode) {
      const g = d3.select(this)
      g.attr('transform', `translate(${d.x},${d.y})`)

      const labels = d.edge.labels.length > 0 ? d.edge.labels : ['(ingen tekst)']
      const srcName = graphStore.getNode(d.edge.source)?.navn ?? ''
      const tgtName = graphStore.getNode(d.edge.target)?.navn ?? ''

        const personNames = new Set<string>()
      for (const l of d.edge.labels) {
        const pn = extractPersonName(l)
        if (pn) personNames.add(pn)
      }
      const footerName = personNames.size === 1 ? [...personNames][0]! : null
      const headerText = `${srcName} - ${tgtName}`
      const lineH = 16, padY = 10, padX = 10
      const extraLines = 1 + (footerName ? 1 : 0)
      const lineCount = labels.length + 1 + extraLines
      const headerLen = headerText.length * 6
      const maxLabelLen = Math.max(...labels.map(l => l.length)) * 5.5
      const boxW = Math.max(180, Math.min(500, Math.max(headerLen, maxLabelLen) + 30))
      const boxH = lineCount * lineH + padY * 2

      g.select('.info-bg')
        .attr('x', -padX).attr('y', -padY - lineH)
        .attr('width', boxW + padX * 2).attr('height', boxH)
        .attr('fill', C.surface).attr('stroke', C.border)

      g.select('.info-close').attr('x', boxW + padX - 4).attr('y', -padY + 2)

      const lblG = g.select('.info-labels')
      lblG.selectAll('*').remove()

      lblG.append('text').attr('y', 0).attr('font-size', '10px').attr('font-weight', '600').attr('fill', C.text)
        .attr('font-family', 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif').text(headerText)

      labels.forEach((l, i) => {
        const personName = extractPersonName(l)
        const isClickable = !!personName

        const t = lblG.append('text')
          .attr('y', (i + 1) * lineH)
          .attr('font-size', '10px')
          .attr('fill', isClickable ? C.accent : C.textDim)
          .attr('font-family', 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif')
          .attr('cursor', isClickable ? 'pointer' : 'default')
          .classed('person-link', isClickable)
          .text(l)

        if (isClickable && personName) {
          t.on('click', (ev: MouseEvent) => {
            ev.stopPropagation()
            onpersonclick(personName)
          })
          t.on('mouseenter', function () { d3.select(this).attr('text-decoration', 'underline') })
          t.on('mouseleave', function () { d3.select(this).attr('text-decoration', 'none') })
        }
      })

      let nextY = (labels.length + 1) * lineH
      if (footerName) {
        lblG.append('text').attr('y', nextY).attr('font-size', '9px').attr('fill', C.textMuted)
          .attr('font-family', 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif').text(footerName)
        nextY += lineH
      }

      g.select('.info-remove-edge').attr('x', 0).attr('y', nextY + 2)

      const src = graphStore.getNode(d.edge.source)
      const tgt = graphStore.getNode(d.edge.target)
      if (src && tgt) {
        const p1 = edgePoint(src.x, src.y, tgt.x, tgt.y, src)
        const p2 = edgePoint(tgt.x, tgt.y, src.x, src.y, tgt)
        const circleCx = (p1.x + p2.x) / 2
        const circleCy = (p1.y + p2.y) / 2
        const boxCx = d.x + boxW / 2
        const boxCy = d.y + (boxH / 2) - padY - lineH
        const boxHW = (boxW + padX * 2) / 2
        const boxHH = boxH / 2
        const exitPt = rectEdgePoint(boxCx, boxCy, boxHW, boxHH, circleCx, circleCy)
        const cdx = exitPt.x - circleCx, cdy = exitPt.y - circleCy
        const cDist = Math.sqrt(cdx * cdx + cdy * cdy)
        const circleR = 10
        const circlePtX = cDist > circleR ? circleCx + (cdx / cDist) * circleR : circleCx
        const circlePtY = cDist > circleR ? circleCy + (cdy / cDist) * circleR : circleCy

        g.select('.info-connector')
          .attr('x1', exitPt.x - d.x).attr('y1', exitPt.y - d.y)
          .attr('x2', circlePtX - d.x).attr('y2', circlePtY - d.y)
      }
    })
  }

  const PERSON_COLOR = '#b08860'

  function renderCompanyNode(g: d3.Selection<SVGGElement, GraphNode, null, undefined>, d: GraphNode) {
    const t = d.company?.type ?? d.type
    const tc = typeColor(t)

    const card = g.select('.node-card').attr('x', -HW).attr('y', -HH).attr('width', HW * 2).attr('height', HH * 2)
      .attr('fill', C.surface)
      .attr('stroke', linkMode ? C.accent : C.border)
      .attr('stroke-width', linkMode ? 2 : 1)
    card.on('mouseenter', function () { d3.select(this).attr('stroke', C.borderLight).attr('stroke-width', 2) })
    card.on('mouseleave', function () { d3.select(this).attr('stroke', linkMode ? C.accent : C.border).attr('stroke-width', linkMode ? 2 : 1) })
    g.select('.node-type-bar').attr('x', -HW).attr('y', -HH).attr('width', 4).attr('height', HH * 2)
      .attr('fill', d.loading ? C.border : tc)
    g.select('.node-loading').attr('opacity', d.loading ? 1 : 0)
    g.select('.node-delete').attr('x', 96).attr('y', -24).attr('opacity', !d.loading ? 1 : 0)

    const content = g.select('.node-content')
    content.selectAll('*').remove()

    if (!d.loading) {
      content.append('text').attr('x', -88).attr('y', -18).attr('font-size', '13px').attr('font-weight', '600')
        .attr('fill', C.text).attr('cursor', 'pointer').text(d.navn.length > 22 ? d.navn.slice(0, 20) + '...' : d.navn)
      content.append('text').attr('x', -88).attr('y', -2).attr('font-size', '10px')
        .attr('fill', tc).text(`${t} - ${d.company?.orgnr ?? d.id}`)
      const f = d.financials?.[0]
      if (f) {
        content.append('text').attr('x', -88).attr('y', 16).attr('font-size', '11px')
          .attr('fill', C.textDim).text(`Omsetning ${formatNOK(f.omsetning)}`)
        content.append('text').attr('x', -88).attr('y', 32).attr('font-size', '11px')
          .attr('fill', C.textDim).text(`Resultat ${formatNOK(f.årsresultat)}`)
      }
      if (currentScale >= 0.5 && d.financials && d.financials.length >= 2) {
        const vals = [...d.financials].reverse().map(fi => fi.omsetning ?? 0)
        const sparkW = 50, sparkH = 20, sparkX = 50, sparkY = -20
        const max = Math.max(...vals), min = Math.min(...vals)
        const range = max - min || 1
        const points = vals.map((v, i) =>
          `${sparkX + (i / (vals.length - 1)) * sparkW},${sparkY + sparkH - ((v - min) / range) * sparkH}`
        ).join(' ')
        content.append('polyline').attr('points', points)
          .attr('fill', 'none').attr('stroke', '#7a8a9e').attr('stroke-width', 1.5).attr('opacity', 0.7)
      }
    }
  }

  function renderPersonNode(g: d3.Selection<SVGGElement, GraphNode, null, undefined>, d: GraphNode) {
    const companies = d.personCompanies ?? []

    const card = g.select('.node-card').attr('x', -HW).attr('y', -HH).attr('width', HW * 2).attr('height', HH * 2)
      .attr('fill', C.surface)
      .attr('stroke', linkMode ? C.accent : C.border)
      .attr('stroke-width', linkMode ? 2 : 1)
    card.on('mouseenter', function () { d3.select(this).attr('stroke', C.borderLight).attr('stroke-width', 2) })
    card.on('mouseleave', function () { d3.select(this).attr('stroke', linkMode ? C.accent : C.border).attr('stroke-width', linkMode ? 2 : 1) })
    g.select('.node-type-bar').attr('x', -HW).attr('y', -HH).attr('width', 4).attr('height', HH * 2)
      .attr('fill', d.loading ? C.border : PERSON_COLOR)
    g.select('.node-loading').attr('opacity', d.loading ? 1 : 0)
    g.select('.node-delete').attr('x', 96).attr('y', -24).attr('opacity', !d.loading ? 1 : 0)

    const content = g.select('.node-content')
    content.selectAll('*').remove()

    if (!d.loading) {
      content.append('text').attr('x', -88).attr('y', -18).attr('font-size', '13px').attr('font-weight', '600')
        .attr('fill', PERSON_COLOR).text(d.navn.length > 22 ? d.navn.slice(0, 20) + '...' : d.navn)
      content.append('text').attr('x', -88).attr('y', -2).attr('font-size', '10px')
        .attr('fill', C.textMuted).text(d.fodselsdato ? `f. ${d.fodselsdato.slice(0, 4)}` : 'Person')
      if (companies.length > 0) {
        content.append('text').attr('x', -88).attr('y', 16).attr('font-size', '11px')
          .attr('fill', C.textDim).text(`${companies.length} selskap${companies.length > 1 ? 'er' : ''}`)
      }
    }
  }

  function renderGraph() {
    if (!container) return
    const ver = graphStore.version
    if (ver === lastVersion && currentScale === lastScale) return
    const contentChanged = graphStore.contentVersion !== lastContentVersion || currentScale !== lastScale
    lastVersion = ver
    lastContentVersion = graphStore.contentVersion
    lastScale = currentScale
    const nodes = graphStore.nodes

    if (contentChanged) {
      const collapsed = graphStore.getCollapsedEdges()
      const linkSel = edgeLayer.selectAll<SVGGElement, CollapsedEdge>('g.edge-group')
        .data(collapsed, (d: CollapsedEdge) => d.key)

      linkSel.exit().remove()

      const linkEnter = linkSel.enter().append('g').attr('class', 'edge-group')
      linkEnter.append('line').attr('class', 'edge-line')
      linkEnter.append('circle').attr('class', 'edge-info-btn')
        .attr('r', 10).attr('fill', C.surface).attr('stroke', C.borderLight).attr('stroke-width', 1).attr('cursor', 'pointer')
      linkEnter.append('text').attr('class', 'edge-info-label')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '9px').attr('font-family', 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif').attr('fill', C.textDim).attr('pointer-events', 'none')
      linkEnter.append('circle').attr('class', 'edge-handle-src').attr('r', 6).attr('fill', 'transparent').attr('stroke', 'transparent').attr('cursor', 'crosshair')
      linkEnter.append('circle').attr('class', 'edge-handle-tgt').attr('r', 6).attr('fill', 'transparent').attr('stroke', 'transparent').attr('cursor', 'crosshair')

      linkEnter.select('.edge-info-btn').on('click', function (_ev: MouseEvent, d: unknown) {
        const ce = d as CollapsedEdge
        const src = graphStore.getNodeById(ce.source), tgt = graphStore.getNodeById(ce.target)
        if (!src || !tgt) return
        const p1 = edgePoint(src.x, src.y, tgt.x, tgt.y, src), p2 = edgePoint(tgt.x, tgt.y, src.x, src.y, tgt)
        toggleInfoNode(ce, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
      })

      linkEnter.select<SVGCircleElement>('.edge-handle-src')
        .on('mouseenter', function () { d3.select(this).attr('fill', C.accent).attr('stroke', C.accent) })
        .on('mouseleave', function () { d3.select(this).attr('fill', 'transparent').attr('stroke', 'transparent') })
        .call(d3.drag<SVGCircleElement, CollapsedEdge>()
          .on('start', function (ev, d) { ev.sourceEvent?.stopPropagation(); startEdgeDrag(d.key, d.target, d.source, ev.x, ev.y) })
          .on('drag', (ev) => updateEdgeDrag(ev.x, ev.y))
          .on('end', (ev) => finishEdgeDrag(ev.x, ev.y))
        )

      linkEnter.select<SVGCircleElement>('.edge-handle-tgt')
        .on('mouseenter', function () { d3.select(this).attr('fill', C.accent).attr('stroke', C.accent) })
        .on('mouseleave', function () { d3.select(this).attr('fill', 'transparent').attr('stroke', 'transparent') })
        .call(d3.drag<SVGCircleElement, CollapsedEdge>()
          .on('start', function (ev, d) { ev.sourceEvent?.stopPropagation(); startEdgeDrag(d.key, d.source, d.target, ev.x, ev.y) })
          .on('drag', (ev) => updateEdgeDrag(ev.x, ev.y))
          .on('end', (ev) => finishEdgeDrag(ev.x, ev.y))
        )
    }

    edgeLayer.selectAll<SVGGElement, CollapsedEdge>('g.edge-group').each(function (this: SVGGElement, d: CollapsedEdge) {
      const g = d3.select(this)
      const src = graphStore.getNodeById(d.source), tgt = graphStore.getNodeById(d.target)
      if (!src || !tgt) return
      const p1 = edgePoint(src.x, src.y, tgt.x, tgt.y, src)
      const p2 = edgePoint(tgt.x, tgt.y, src.x, src.y, tgt)
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
      const es = edgeStyle(d)
      const isPath = pathNodeIds.size > 0 && pathNodeIds.has(d.source) && pathNodeIds.has(d.target)
      const dimmed = pathNodeIds.size > 0 && !isPath
      g.select('.edge-line')
        .attr('x1', p1.x).attr('y1', p1.y).attr('x2', p2.x).attr('y2', p2.y)
        .attr('stroke', isPath ? '#7a9a8a' : es.color)
        .attr('stroke-width', isPath ? 3.5 : es.width)
        .attr('stroke-dasharray', isPath ? null : (es.dash || null))
        .attr('marker-end', es.end || null)
        .attr('marker-start', es.start || null)
        .attr('opacity', dimmed ? 0.15 : 1)
        .attr('filter', isPath ? 'url(#glow)' : null)
      g.select('.edge-info-btn').attr('cx', mx).attr('cy', my).attr('stroke', isPath ? '#7a9a8a' : es.color)
        .attr('opacity', dimmed ? 0.15 : 1)
      g.select('.edge-info-label').attr('x', mx).attr('y', my)
        .attr('fill', es.color)
        .text('i')
      g.select('.edge-handle-src').attr('cx', p1.x).attr('cy', p1.y)
      g.select('.edge-handle-tgt').attr('cx', p2.x).attr('cy', p2.y)
    })

    const nodeSel = nodeLayer.selectAll<SVGGElement, GraphNode>('g.node')
      .data(nodes, (d: GraphNode) => d.id)

    nodeSel.exit().remove()

    const nodeEnter = nodeSel.enter().append('g').attr('class', 'node').attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .clickDistance(5)
        .filter(function (ev) {
          return !(ev.target as SVGElement).classList?.contains('person-link')
        })
        .on('start', function (ev) { if (linkMode) return; d3.select(this).attr('cursor', 'grabbing'); ev.sourceEvent?.stopPropagation() })
        .on('drag', (ev, d) => { if (!linkMode) graphStore.moveNode(d.id, ev.x, ev.y) })
        .on('end', function () { if (!linkMode) d3.select(this).attr('cursor', 'pointer') })
      )
      .on('click', (_ev: MouseEvent, d: GraphNode) => {
        if (linkMode) { _ev.stopPropagation(); onlinkclick(d.id) }
        else if (onnodeclick) { _ev.stopPropagation(); onnodeclick(d.id) }
      })

    nodeEnter.each(function (this: SVGGElement) {
      const g = d3.select(this)
      g.append('rect').attr('class', 'node-card').attr('rx', 3)
      g.append('rect').attr('class', 'node-type-bar').attr('rx', 2)
      g.append('g').attr('class', 'node-content')
      g.append('text').attr('class', 'node-loading').attr('text-anchor', 'middle').attr('y', 5).attr('font-size', '12px').attr('fill', C.textMuted).text('laster...')
      g.append('text').attr('class', 'node-delete').attr('text-anchor', 'middle')
        .attr('font-size', '14px').attr('fill', C.textMuted).attr('cursor', 'pointer').text('x')
        .on('click', function (ev: Event, d: unknown) { ev.stopPropagation(); graphStore.removeNode((d as GraphNode).id) })
    })

    const allNodes = nodeEnter.merge(nodeSel)
    allNodes.each(function (this: SVGGElement, d: GraphNode) {
      const g = d3.select(this)
      g.attr('transform', `translate(${d.x},${d.y})`)
      const isPathNode = pathNodeIds.size > 0 && pathNodeIds.has(d.id)
      const nodeDimmed = pathNodeIds.size > 0 && !isPathNode
      g.attr('opacity', nodeDimmed ? 0.2 : 1)
      if (isPathNode) {
        g.select('.node-card').attr('stroke', '#7a9a8a').attr('stroke-width', 2.5).attr('filter', 'url(#glow)')
      } else {
        g.select('.node-card').attr('filter', null)
      }

      if (contentChanged) {
        const gTyped = g as unknown as d3.Selection<SVGGElement, GraphNode, null, undefined>
        if (d.isPerson) {
          renderPersonNode(gTyped, d)
        } else {
          renderCompanyNode(gTyped, d)
        }
      }
    })

    renderOverlay()
  }

  function startEdgeDrag(key: string, fixedId: string, movingId: string, x: number, y: number) {
    _dragging = { pairKey: key, fixedId, movingId, mx: x, my: y }
    if (!dragPreviewLine) {
      dragPreviewLine = overlayLayer.append('line').attr('class', 'drag-preview')
        .attr('stroke', C.accent).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,4').attr('opacity', 0.8)
    }
  }

  function updateEdgeDrag(x: number, y: number) {
    if (!_dragging || !dragPreviewLine) return
    _dragging.mx = x; _dragging.my = y
    const fn = graphStore.getNodeById(_dragging.fixedId)
    if (fn) {
      const fp = edgePoint(fn.x, fn.y, x, y, fn)
      dragPreviewLine.attr('x1', fp.x).attr('y1', fp.y).attr('x2', x).attr('y2', y)
    }
  }

  function finishEdgeDrag(x: number, y: number) {
    if (!_dragging) return
    const target = findNodeAt(x, y)
    if (target && target.id !== _dragging.fixedId) {
      graphStore.reassignEdgeEnd(_dragging.pairKey, _dragging.movingId, target.id)
    }
    _dragging = null
    dragPreviewLine?.remove()
    dragPreviewLine = null
  }

  export function clearOverlays() {
    infoNodes = []
    infoVersion++
    if (overlayLayer) overlayLayer.selectAll('g.info-node').remove()
  }

  onMount(() => {
    const w = window.innerWidth, h = window.innerHeight
    const svg = d3.select(svgEl)
    const defs = svg.append('defs')
    const pat = defs.append('pattern').attr('id', 'grid').attr('width', gridSize).attr('height', gridSize).attr('patternUnits', 'userSpaceOnUse')
    pat.append('circle').attr('cx', gridSize / 2).attr('cy', gridSize / 2).attr('r', 1.2).attr('fill', C.grid)

    const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const merge = glow.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    function addArrow(id: string, color: string) {
      defs.append('marker').attr('id', id)
        .attr('viewBox', '0 0 10 6').attr('refX', 9).attr('refY', 3)
        .attr('markerWidth', 10).attr('markerHeight', 6)
        .attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
        .append('path').attr('d', 'M0,0.5 L9,3 L0,5.5 Z').attr('fill', color)
    }
    addArrow('arrow', C.edge)
    addArrow('arrow-own', '#5a7a9e')
    addArrow('arrow-role', C.accent)
    addArrow('arrow-lev', '#5a9e6e')
    addArrow('arrow-kun', '#9e8a5a')

    defs.append('marker').attr('id', 'diamond')
      .attr('viewBox', '0 0 14 8').attr('refX', 1).attr('refY', 4)
      .attr('markerWidth', 14).attr('markerHeight', 8)
      .attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
      .append('path').attr('d', 'M0,4 L7,0 L14,4 L7,8 Z').attr('fill', '#5a7a9e')

    container = svg.append('g').attr('class', 'container')
    container.append('rect').attr('class', 'grid-bg').attr('width', 40000).attr('height', 40000).attr('x', -20000).attr('y', -20000).attr('fill', 'url(#grid)')
    edgeLayer = container.append('g').attr('class', 'edges')
    nodeLayer = container.append('g').attr('class', 'nodes')
    overlayLayer = container.append('g').attr('class', 'overlays')

    zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => {
        container.attr('transform', event.transform.toString())
        currentScale = event.transform.k
      })

    svg.call(zoomBehavior)
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(w / 2, h / 2))

    let running = true
    function loop() {
      if (!running) return
      renderGraph()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)

    return () => { running = false }
  })

  export function zoomIn() { zoomBehavior && d3.select(svgEl).transition().duration(300).call(zoomBehavior.scaleBy, 1.5) }
  export function zoomOut() { zoomBehavior && d3.select(svgEl).transition().duration(300).call(zoomBehavior.scaleBy, 0.67) }
  export function resetView() {
    if (!zoomBehavior) return
    d3.select(svgEl).transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity.translate(window.innerWidth / 2, window.innerHeight / 2))
  }
  export function getSvgElement(): SVGSVGElement { return svgEl }
  export function setPathHighlight(nodeIds: string[]) {
    pathNodeIds = new Set(nodeIds)
    lastContentVersion = -1
  }
  export function clearPathHighlight() {
    pathNodeIds = new Set()
    lastContentVersion = -1
  }
</script>

<svg bind:this={svgEl} width="100%" height="100%" style="position: absolute; inset: 0; background: {C.bg};"></svg>