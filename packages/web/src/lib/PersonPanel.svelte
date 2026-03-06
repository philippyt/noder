<script lang="ts">
  import { fly } from 'svelte/transition'
  import type { GraphNode } from './graph-store.svelte.js'
  import { graphStore } from './graph-store.svelte.js'

  interface Props {
    node: GraphNode
    onclose: () => void
    oncompanyclick: (orgnr: string) => void
  }

  let { node, onclose, oncompanyclick }: Props = $props()

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
</script>

<div class="panel" transition:fly={{ x: 400, duration: 250 }}>
  <div class="panel-header">
    <div class="panel-title">{node.navn}</div>
    <button class="panel-close" onclick={onclose}>x</button>
  </div>

  <div class="panel-section">
    <div class="panel-row">
      <span class="panel-label">Født</span>
      <span class="panel-value">{node.fodselsdato ? node.fodselsdato.slice(0, 4) : 'Ukjent'}</span>
    </div>
    {#if node.personCompanies}
      <div class="panel-row">
        <span class="panel-label">Selskaper</span>
        <span class="panel-value">{node.personCompanies.length}</span>
      </div>
    {/if}
  </div>

  {#if node.loading}
    <div class="skeleton-block"></div>
    <div class="skeleton-block short"></div>
    <div class="skeleton-block tall"></div>
  {:else if node.personCompanies && node.personCompanies.length > 0}
    <div class="panel-section">
      <div class="panel-section-title">Selskaper</div>
      {#each node.personCompanies as company}
        <button class="company-row" onclick={() => oncompanyclick(company.orgnr)}>
          <span class="company-name">{company.navn}</span>
          <span class="company-role">{company.rolle}</span>
        </button>
      {/each}
    </div>
  {:else}
    <div class="panel-section">
      <p class="empty">Ingen kjente selskaper.</p>
    </div>
  {/if}

  <div class="panel-section">
    <div class="panel-section-title">Notater</div>
    <textarea class="notes" placeholder="Skriv notater her..." value={notesValue} oninput={onNotesInput}></textarea>
  </div>
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
    color: #b08860;
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

  .company-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 8px 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-bottom: 1px solid #222226;
  }

  .company-row:last-child {
    border-bottom: none;
  }

  .company-row:hover .company-name {
    color: #7a8a9e;
  }

  .company-name {
    font-size: 12px;
    color: #c8c8cd;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .company-role {
    font-size: 11px;
    color: #78787e;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .empty {
    color: #58585e;
    font-size: 12px;
    font-style: italic;
    margin: 0;
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