<script lang="ts">
  interface Props {
    onzoomin: () => void
    onzoomout: () => void
    onclear: () => void
    onrandom: () => void
    onlink: () => void
    onshare: () => void
    onexportraw: () => void
    onexportfile: () => void
    onimportraw: () => void
    onimportfile: () => void
    oncapture: () => void

    onfindpath: () => void
    onlayout: () => void
    linkMode: boolean
    showCopied: boolean
  }

  let {
    onzoomin, onzoomout, onclear, onrandom, onlink,
    onshare, onexportraw, onexportfile, onimportraw, onimportfile, oncapture, onfindpath, onlayout,
    linkMode, showCopied,
  }: Props = $props()

  let openMenu = $state<string | null>(null)

  function toggle(name: string) {
    openMenu = openMenu === name ? null : name
  }

  function act(fn: () => void) {
    openMenu = null
    fn()
  }
</script>

<svelte:window onclick={() => { openMenu = null }} />

<div class="controls">
  <button onclick={onzoomin} title="Zoom inn">+</button>
  <button onclick={onzoomout} title="Zoom ut">&minus;</button>

  <div class="sep"></div>

  <button onclick={onlink} title="Koble to noder" class:active={linkMode}>
    {linkMode ? 'Velg node' : 'Koble'}
  </button>
  <button onclick={onrandom} title="Tilfeldig selskap">Tilfeldig</button>
  <button onclick={onfindpath} title="Finn korteste vei mellom to selskaper">Finn korteste vei</button>
  <button onclick={onlayout} title="Sprer ut nodene slik at de ikke overlapper og koblete noder havner nær hverandre">Sorter</button>

  <div class="sep"></div>
  
  <div class="dropdown">
    <button class:open={openMenu === 'share'} onclick={(e) => { e.stopPropagation(); toggle('share') }}>
      {showCopied ? 'Kopiert!' : 'Del'} <span class="caret">&#9662;</span>
    </button>
    {#if openMenu === 'share'}
      <div class="menu" role="presentation" onclick={(e) => e.stopPropagation()}>
        <button onclick={() => act(onshare)}>Kopier lenke</button>
        <div class="menu-sep"></div>
        <button onclick={() => act(onexportraw)}>Eksporter JSON som tekst</button>
        <button onclick={() => act(onexportfile)}>Eksporter JSON som fil</button>
        <div class="menu-sep"></div>
        <button onclick={() => act(onimportraw)}>Importer JSON fra tekst</button>
        <button onclick={() => act(onimportfile)}>Importer JSON fra fil</button>
      </div>
    {/if}
  </div>

  <button onclick={oncapture} title="Ta skjermbilde">Bilde</button>

  <div class="sep"></div>

  <button onclick={onclear} title="Nullstill alt" class="danger">Nullstill</button>
</div>

<style>
  .controls {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }

  .sep {
    width: 1px;
    height: 32px;
    background: #28282e;
    margin: 0 4px;
  }

  button {
    height: 44px;
    border: 1px solid #28282e;
    border-radius: 3px;
    background: #1a1a1e;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #e0e0e5;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: border-color 0.15s, color 0.15s;
    padding: 0 14px;
    white-space: nowrap;
    gap: 5px;
  }

  button:hover {
    border-color: #48484e;
    color: #e0e0e5;
  }

  .caret {
    font-size: 9px;
    opacity: 0.5;
  }

  .active {
    border-color: #7a8a9e;
    color: #7a8a9e;
  }

  .open {
    border-color: #48484e;
    color: #e0e0e5;
  }

  .danger:hover {
    border-color: #c75050;
    color: #c75050;
  }

  .dropdown {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: #1a1a1e;
    border: 1px solid #2e2e35;
    border-radius: 3px;
    padding: 4px;
    z-index: 200;
    min-width: 220px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .menu button {
    width: 100%;
    height: 34px;
    border: none;
    border-radius: 3px;
    background: none;
    color: #e0e0e5;
    font-size: 12px;
    justify-content: flex-start;
    padding: 0 10px;
  }

  .menu button:hover {
    background: #28282e;
    color: #e0e0e5;
    border: none;
  }

  .menu-sep {
    height: 1px;
    background: #2e2e35;
    margin: 3px 6px;
  }
</style>
