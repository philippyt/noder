<script lang="ts">
  let visible = $state(false)
  let isMobile = $state(false)

  const STORAGE_KEY = 'noder:hide-welcome'

  if (typeof window !== 'undefined') {
    isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768
    if (!localStorage.getItem(STORAGE_KEY)) visible = true
  }

  function dismiss() {
    visible = false
  }

  function dismissForever() {
    localStorage.setItem(STORAGE_KEY, '1')
    visible = false
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dismiss()
  }
</script>

<svelte:window {onkeydown} />

{#if visible}
  <div class="backdrop" role="presentation" onclick={dismiss}>
    <div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
      <div class="header">
        <h2>Noder</h2>
        <a class="github" href="https://github.com" target="_blank" rel="noopener noreferrer" title="Åpen kildekode på GitHub">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
      </div>

      <p class="intro">Gratis åpen kildekode-verktøy for å utforske norske selskapsnettverk visuelt. Søk opp selskaper, se koblinger mellom dem, og bygg din egen graf.</p>

      {#if isMobile}
        <p class="warning">Noder er laget for desktop. På mobil vil grafen være vanskelig å bruke.</p>
      {/if}

      <p class="disclaimer">Ingen data lagres på noen server. Alt ligger i nettleserens lokale lagring. Alle selskapsdata hentes fra offentlige API-er hos Brønnøysundregistrene.</p>

      <div class="guide">
        <div class="guide-title">Verktøylinje</div>
        <dl>
          <dt>Kartlegg</dt>
          <dd>Analyserer noder og viser koblinger mellom selskaper</dd>

          <dt>+ / &minus;</dt>
          <dd>Zoom inn og ut i grafen</dd>

          <dt>Koble</dt>
          <dd>Lager en manuell relasjon mellom to noder</dd>

          <dt>Tilfeldig</dt>
          <dd>Legg til et tilfeldig selskap på grafen</dd>

          <dt>Finn vei</dt>
          <dd>Finn korteste vei mellom to selskaper via felles personer eller eierskap</dd>

          <dt>Sorter</dt>
          <dd>Rydd opp i grafen automatisk. Sprer ut noder og holder koblede noder nær hverandre</dd>

          <dt>Del</dt>
          <dd>Del grafen som lenke, eksporter/importer som JSON</dd>

          <dt>Bilde</dt>
          <dd>Ta skjermbilde av grafen</dd>

          <dt>Nullstill</dt>
          <dd>Fjern alt fra grafen</dd>
        </dl>
        <p class="guide-hint">Trykk på en node for å se detaljer. Trykk på <strong>i</strong>-sirkelen på en relasjon for å se roller og fjerne koblinger.</p>
      </div>

      <div class="actions">
        <button class="primary" onclick={dismiss}>Kom i gang</button>
        <button class="muted" onclick={dismissForever}>Ikke vis igjen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal {
    background: #1a1a1e;
    border: 1px solid #2e2e35;
    border-radius: 6px;
    padding: 32px 36px;
    max-width: 520px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    color: #e0e0e5;
    letter-spacing: -0.5px;
  }

  .github {
    color: #48484e;
    transition: color 0.15s;
    display: flex;
  }

  .github:hover {
    color: #a0a0a6;
  }

  .intro {
    margin: 0 0 16px;
    font-size: 15px;
    line-height: 1.6;
    color: #a0a0a6;
  }

  .warning {
    margin: 0 0 16px;
    font-size: 14px;
    line-height: 1.5;
    color: #c7a04a;
    background: rgba(199, 160, 74, 0.08);
    border: 1px solid rgba(199, 160, 74, 0.2);
    border-radius: 3px;
    padding: 10px 14px;
  }

  .disclaimer {
    margin: 0 0 20px;
    font-size: 13px;
    line-height: 1.5;
    color: #58585e;
    font-style: italic;
  }

  .guide {
    margin-bottom: 24px;
    border: 1px solid #2e2e35;
    border-radius: 4px;
    padding: 16px 18px;
    background: #16161a;
  }

  .guide-title {
    font-size: 14px;
    font-weight: 600;
    color: #c8c8cd;
    margin-bottom: 12px;
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    align-items: baseline;
  }

  dt {
    font-size: 13px;
    font-weight: 600;
    color: #7a8a9e;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    font-size: 13px;
    color: #8a8a90;
    line-height: 1.4;
  }

  .guide-hint {
    margin: 14px 0 0;
    font-size: 13px;
    color: #68686e;
    line-height: 1.5;
  }

  .guide-hint strong {
    color: #8a8a90;
  }

  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  button {
    height: 40px;
    padding: 0 20px;
    border-radius: 3px;
    font-size: 14px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .primary {
    background: #2a2a30;
    border: 1px solid #48484e;
    color: #e0e0e5;
  }

  .primary:hover {
    border-color: #7a8a9e;
  }

  .muted {
    background: none;
    border: 1px solid transparent;
    color: #48484e;
    font-size: 13px;
  }

  .muted:hover {
    color: #68686e;
  }
</style>