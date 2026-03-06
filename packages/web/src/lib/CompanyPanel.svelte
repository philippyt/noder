<script lang="ts">
  import { fly } from 'svelte/transition'
  import type { GraphNode } from './graph-store.svelte.js'
  import { graphStore } from './graph-store.svelte.js'

  interface Props {
    node: GraphNode
    onclose: () => void
  }

  let { node, onclose }: Props = $props()

  let notesValue = $state(node.notes ?? '')
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => { notesValue = node.notes ?? '' })

  function onNotesInput(e: Event) {
    notesValue = (e.target as HTMLTextAreaElement).value
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      graphStore.updateNode(node.id, { notes: notesValue || undefined })
    }, 400)
  }

  function formatNOK(v: number | null | undefined): string {
    if (v == null) return '-'
    return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(v)
  }

  function statusBadges(node: GraphNode): Array<{ label: string; color: string }> {
    const badges: Array<{ label: string; color: string }> = []
    const c = node.company
    if (!c) return badges
    if (c.konkurs) badges.push({ label: 'Konkurs', color: '#9e5a5a' })
    if (c.tvangsoppløsning) badges.push({ label: 'Under avvikling', color: '#9e8a5a' })
    if (c.aktiv) badges.push({ label: 'Aktiv', color: '#5a9e6e' })
    else badges.push({ label: 'Inaktiv', color: '#78787e' })
    if (c.mva_registrert) badges.push({ label: 'MVA', color: '#5a7a9e' })
    return badges
  }

  function isNegative(v: number | null | undefined): boolean {
    return v != null && v < 0
  }
</script>

<div class="panel" transition:fly={{ x: 400, duration: 250 }}>
  <div class="panel-header">
    <div class="panel-title">{node.navn}</div>
    <button class="panel-close" onclick={onclose}>x</button>
  </div>

  {#if node.loading}
    <div class="skeleton-block"></div>
    <div class="skeleton-block short"></div>
    <div class="skeleton-block"></div>
    <div class="skeleton-block short"></div>
    <div class="skeleton-block tall"></div>
  {:else}
    {#if node.company}
      <div class="panel-section">
        <div class="panel-row">
          <span class="panel-label">Org.nr</span>
          <span class="panel-value">{node.company.orgnr}</span>
        </div>
        <div class="panel-row">
          <span class="panel-label">Type</span>
          <span class="panel-value">{node.company.type}</span>
        </div>
        {#if node.company.stiftet}
          <div class="panel-row">
            <span class="panel-label">Stiftet</span>
            <span class="panel-value">{node.company.stiftet}</span>
          </div>
        {/if}
        {#if node.company.ansatte != null}
          <div class="panel-row">
            <span class="panel-label">Ansatte</span>
            <span class="panel-value">{node.company.ansatte}</span>
          </div>
        {/if}
        {#if node.company.nace}
          <div class="panel-row">
            <span class="panel-label">Bransje</span>
            <span class="panel-value">{node.company.nace.beskrivelse}</span>
          </div>
        {/if}
        {#if node.company.adresse?.poststed}
          <div class="panel-row">
            <span class="panel-label">Sted</span>
            <span class="panel-value">{node.company.adresse.poststed}</span>
          </div>
        {/if}

        <div class="badges">
          {#each statusBadges(node) as badge}
            <span class="badge" style="background: {badge.color}20; color: {badge.color}; border-color: {badge.color}40">{badge.label}</span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="panel-section">
      <div class="panel-section-title">Regnskap</div>
      {#if node.financials && node.financials.length > 0}
        {@const latest = node.financials[0]}
        <div class="fin-latest-year">{latest.år}</div>
        {#each [
          { label: 'Omsetning', val: latest.omsetning },
          { label: 'Driftsresultat', val: latest.driftsresultat },
          { label: 'Årsresultat', val: latest.årsresultat },
          { label: 'Egenkapital', val: latest.egenkapital },
          { label: 'Sum gjeld', val: latest.sum_gjeld },
          { label: 'Sum eiendeler', val: latest.sum_eiendeler },
        ] as row}
          <div class="panel-row">
            <span class="panel-label">{row.label}</span>
            <span class="panel-value" class:negative={isNegative(row.val)}>{formatNOK(row.val)}</span>
          </div>
        {/each}
      {:else}
        <p class="fin-empty">Ingen offentlig regnskap tilgjengelig.</p>
      {/if}
    </div>

    {#if node.roles && node.roles.length > 0}
      <div class="panel-section">
        <div class="panel-section-title">Roller</div>
        {#each node.roles as role}
          <div class="role-row">
            <span class="role-name">{role.person.navn}</span>
            <span class="role-type">{role.type_beskrivelse || role.type || 'Innehaver'}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="panel-section">
      <div class="panel-section-title">Notater</div>
      <textarea class="notes" placeholder="Skriv notater her..." value={notesValue} oninput={onNotesInput}></textarea>
    </div>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 380px;
    max-width: 90vw;
    z-index: 200;
    background: #1a1a1e;
    border-left: 1px solid #2e2e35;
    overflow-y: auto;
    padding: 20px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
  }

  .panel-title {
    font-size: 16px;
    font-weight: 700;
    color: #e0e0e5;
    line-height: 1.3;
    padding-right: 12px;
  }

  .panel-close {
    background: none;
    border: none;
    color: #58585e;
    font-size: 18px;
    cursor: pointer;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .panel-close:hover {
    color: #e0e0e5;
  }

  .panel-section {
    margin-bottom: 20px;
  }

  .panel-section-title {
    font-size: 11px;
    font-weight: 600;
    color: #58585e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #2e2e35;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 12px;
  }

  .panel-label {
    color: #78787e;
  }

  .panel-value {
    color: #c8c8cd;
    text-align: right;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 2px;
    border: 1px solid;
  }

  .fin-latest-year {
    font-size: 11px;
    color: #68686e;
    margin-bottom: 6px;
  }

  .panel-value.negative {
    color: #9e5a5a;
  }

  .fin-empty {
    color: #58585e;
    font-size: 12px;
    font-style: italic;
    margin: 0;
  }

  .role-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 12px;
  }

  .role-name {
    color: #c8c8cd;
  }

  .role-type {
    color: #78787e;
    font-size: 11px;
  }

  .notes {
    width: 100%;
    min-height: 80px;
    padding: 8px 10px;
    border: 1px solid #2e2e35;
    border-radius: 3px;
    background: #131316;
    color: #c8c8cd;
    font-size: 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    line-height: 1.5;
  }

  .notes:focus {
    border-color: #48484e;
  }

  .notes::placeholder {
    color: #48484e;
  }

  /* Loading skeleton */
  .skeleton-block {
    height: 20px;
    background: linear-gradient(90deg, #28282e 25%, #32323a 50%, #28282e 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 2px;
    margin-bottom: 12px;
  }

  .skeleton-block.short {
    width: 60%;
  }

  .skeleton-block.tall {
    height: 120px;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
