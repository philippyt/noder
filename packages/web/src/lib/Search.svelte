<script lang="ts">
  import { searchCompanies, sanitizeSearchInput, type BrregCompany } from '@noder/core'

  interface Props {
    onselect: (company: BrregCompany) => void
  }

  let { onselect }: Props = $props()

  let query = $state('')
  let results = $state<BrregCompany[]>([])
  let loading = $state(false)
  let hasSearched = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let inputEl: HTMLInputElement

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value
    query = value

    if (debounceTimer) clearTimeout(debounceTimer)

    const trimmed = value.trim()
    if (trimmed.length < 2) {
      results = []
      hasSearched = false
      return
    }

    debounceTimer = setTimeout(async () => {
      loading = true
      try {
        const sanitized = sanitizeSearchInput(trimmed)
        const res = await searchCompanies(sanitized)
        results = res
        hasSearched = true
      } catch {
        results = []
        hasSearched = true
      } finally {
        loading = false
      }
    }, 300)
  }

  function clearSearch() {
    query = ''
    results = []
    hasSearched = false
    if (debounceTimer) clearTimeout(debounceTimer)
  }

  function select(company: BrregCompany) {
    onselect(company)
    query = ''
    results = []
    hasSearched = false
    if (debounceTimer) clearTimeout(debounceTimer)
    requestAnimationFrame(() => inputEl?.focus())
  }
</script>

<div class="search-wrap">
  <div class="input-wrap">
    <input
      bind:this={inputEl}
      type="text"
      placeholder="Søk etter selskap eller org.nr."
      value={query}
      oninput={handleInput}
    />
    {#if query.length > 0}
      <button class="clear-btn" onclick={clearSearch} type="button">&times;</button>
    {/if}
  </div>
  {#if loading}
    <div class="status">Søker</div>
  {/if}
  {#if hasSearched && !loading}
    <div class="results-panel">
      {#if results.length === 0}
        <div class="status">Ingen treff</div>
      {:else}
        <div class="results-count">{results.length} treff</div>
        <ul class="results-list">
          {#each results as result}
            <li>
              <button type="button" onclick={() => select(result)}>
                <span class="navn">{result.navn}</span>
                <span class="meta">
                  <span class="orgnr">{result.orgnr}</span>
                  <span class="type">{result.type}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search-wrap {
    display: flex;
    flex-direction: column;
    width: 280px;
    flex-shrink: 0;
  }

  .input-wrap {
    position: relative;
  }

  input {
    width: 100%;
    padding: 7px 30px 7px 12px;
    border: 1px solid #28282e;
    border-radius: 3px;
    font-size: 13px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a1e;
    color: #e0e0e5;
    outline: none;
    box-sizing: border-box;
    height: 44px;
  }

  input::placeholder {
    color: #e0e0e5;
  }

  input:focus {
    border-color: #48484e;
  }

  .clear-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #4e4e54;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }

  .clear-btn:hover {
    color: #c8c8cd;
  }

  .status {
    padding: 6px 10px;
    font-size: 11px;
    color: #4e4e54;
    background: #1a1a1e;
    border: 1px solid #28282e;
    border-top: none;
    border-radius: 0 0 3px 3px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .results-panel {
    background: #1a1a1e;
    border: 1px solid #28282e;
    border-top: none;
    border-radius: 0 0 3px 3px;
  }

  .results-count {
    padding: 4px 10px;
    font-size: 10px;
    color: #4e4e54;
    border-bottom: 1px solid #222226;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .results-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 60vh;
    overflow-y: auto;
  }

  .results-list::-webkit-scrollbar {
    width: 6px;
  }

  .results-list::-webkit-scrollbar-track {
    background: #1a1a1e;
  }

  .results-list::-webkit-scrollbar-thumb {
    background: #38383f;
    border-radius: 3px;
  }

  .results-list li button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #c8c8cd;
  }

  .results-list li button:hover {
    background: #222226;
  }

  .navn {
    font-weight: 500;
    color: #e0e0e5;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: #58585e;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .type {
    background: #222226;
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 10px;
    color: #78787e;
  }
</style>