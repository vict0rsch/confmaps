<script lang="ts">
  // Home location and travel settings (DESIGN §6.5, §5.2). Desktop: a block in the sidebar.
  // `compact` (mobile top bar): a button that opens the same panel in a sheet.
  import { tick } from 'svelte';
  import { cityLabel, cityShortLabel, searchCities, type IndexedCity } from '../lib/home/cities';
  import { home } from '../lib/home/store.svelte';
  import { kmToMi, miToKm } from '../lib/geo/distance';
  import { travel } from '../lib/state/travel.svelte';
  import Segmented from './filters/Segmented.svelte';
  import Icon from './Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const uid = $props.id();
  const listboxId = `${uid}-cities`;
  const optionId = (i: number) => `${uid}-city-${i}`;

  let query = $state('');
  let open = $state(false);
  let active = $state(-1);
  let changing = $state(false);
  let locating = $state(false);
  let message = $state('');
  let input: HTMLInputElement | undefined = $state();
  let changeButton: HTMLButtonElement | undefined = $state();
  let dialog: HTMLDialogElement | undefined = $state();

  const results: IndexedCity[] = $derived(home.cities ? searchCities(home.cities, query) : []);
  const typed = $derived(query.trim().length > 0);
  const showList = $derived(open && typed && results.length > 0);
  const searching = $derived(!home.city || changing);

  const mi = $derived(travel.units === 'mi');
  const threshold = $derived(mi ? Math.round(kmToMi(travel.threshold)) : travel.threshold);
  const fmt = (n: number) => n.toLocaleString('en-US');

  let status = $derived.by(() => {
    if (locating) return 'Finding the nearest city…';
    if (message) return message;
    if (!typed) return '';
    if (home.loadFailed) return "Couldn't load the city list. Check your connection and try again.";
    if (!home.cities) return 'Loading cities…';
    return results.length
      ? `${results.length} ${results.length === 1 ? 'city' : 'cities'} found`
      : 'No city found';
  });

  /** The part of "City, Region, Country" after the city name. */
  const rest = (c: IndexedCity) => cityLabel(c).slice(c.name.length);

  async function choose(c: IndexedCity) {
    home.set(c);
    query = '';
    open = false;
    active = -1;
    message = '';
    changing = false;
    await tick();
    changeButton?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    const n = results.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!typed || !n) return;
      e.preventDefault();
      open = true;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n;
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && showList) {
      e.preventDefault();
      choose(results[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault();
        open = false;
        active = -1;
      } else if (changing && home.city) {
        e.preventDefault();
        changing = false;
        query = '';
        tick().then(() => changeButton?.focus());
      }
    }
  }

  async function useLocation() {
    message = '';
    locating = true;
    const error = await home.locate();
    locating = false;
    if (!error) {
      changing = false;
      query = '';
      await tick();
      changeButton?.focus();
      return;
    }
    message = {
      unsupported: 'Your browser cannot share its location. Search for your city instead.',
      denied: 'Location permission was denied. Search for your city instead.',
      unavailable: 'Could not get your location. Search for your city instead.',
      'no-cities': "Couldn't load the city list. Check your connection and try again.",
    }[error];
  }

  async function startChanging() {
    changing = true;
    await tick();
    input?.focus();
  }

  function setThreshold(e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.valueAsNumber;
    if (Number.isFinite(v)) travel.setThreshold(mi ? miToKm(v) : v);
    e.currentTarget.value = String(threshold); // snap back if the value was rejected
  }
</script>

{#snippet panel()}
  <div class="panel">
    {#if home.shared}
      <p class="shared" data-testid="shared-notice">
        Showing distances from <strong>{cityShortLabel(home.shared)}</strong> (from the shared link)
        ·
        <button class="text-button" type="button" onclick={() => home.useMine()}>Use mine</button>
      </p>
    {/if}

    {#if home.city && !searching}
      <div class="current">
        <Icon name="pin" size={16} />
        <span class="city" data-testid="home-city">{cityShortLabel(home.city)}</span>
        <button class="text-button" type="button" bind:this={changeButton} onclick={startChanging}>
          Change<span class="visually-hidden"> location</span>
        </button>
        <button class="text-button" type="button" onclick={() => home.clear()}>
          Clear<span class="visually-hidden"> location</span>
        </button>
      </div>
    {:else}
      <div class="search">
        <label class="field-label" for="{uid}-search">
          {home.city ? 'Change your city' : 'Your city'}
        </label>
        <div class="combo">
          <Icon name="search" size={15} />
          <input
            id="{uid}-search"
            class="input"
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            placeholder="Search a city"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            bind:this={input}
            bind:value={query}
            onfocus={() => {
              void home.load();
              open = typed;
            }}
            oninput={() => {
              open = true;
              active = -1;
              message = '';
            }}
            onblur={() => {
              open = false;
              active = -1;
            }}
            onkeydown={onKeydown}
          />
        </div>
        <ul
          id={listboxId}
          class="listbox"
          role="listbox"
          aria-label="Matching cities"
          hidden={!showList}
        >
          {#each results as c, i (c.id)}
            <!-- Mouse selection on mousedown so the input's blur does not close the list first. -->
            <li
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              class:active={i === active}
              onmousedown={(e) => {
                e.preventDefault();
                choose(c);
              }}
            >
              <span class="name">{c.name}</span><span class="rest">{rest(c)}</span>
            </li>
          {/each}
        </ul>
        <button class="button locate" type="button" disabled={locating} onclick={useLocation}>
          <Icon name="target" size={14} />
          {locating ? 'Locating…' : 'Use my location'}
        </button>
        {#if changing && home.city}
          <button
            class="text-button cancel"
            type="button"
            onclick={() => {
              changing = false;
              query = '';
              tick().then(() => changeButton?.focus());
            }}>Cancel</button
          >
        {/if}
      </div>
    {/if}
    <p
      class="status"
      role="status"
      aria-live="polite"
      class:visually-hidden={!message && !locating && (!typed || showList)}
    >
      {status}
    </p>
    {#if searching}
      <p class="privacy">
        Your location stays on this device. Only the nearest city is saved, never coordinates.
      </p>
    {/if}

    <details class="travel" open={compact}>
      <summary>
        <Icon name="chevron" size={14} />
        <span>Travel</span>
        <span class="summary tabular">
          {travel.units} ·
          {travel.mode === 'auto' ? `train under ${fmt(threshold)} ${travel.units}` : 'always fly'}
        </span>
      </summary>
      <div class="travel-body">
        <div class="row">
          <span class="field-label">Units</span>
          <Segmented
            legend="Distance units"
            name="{uid}-units"
            options={[
              { value: 'km', label: 'km' },
              { value: 'mi', label: 'mi' },
            ]}
            value={travel.units}
            onchange={(v) => travel.setUnits(v)}
          />
        </div>
        <fieldset class="mode">
          <legend class="field-label">Travel mode</legend>
          <div class="mode-row">
            <input
              id="{uid}-mode-auto"
              type="radio"
              name="{uid}-mode"
              checked={travel.mode === 'auto'}
              onchange={() => travel.setMode('auto')}
            />
            <label for="{uid}-mode-auto">Auto</label>
            <span class="auto-rest">
              (train under
              <input
                class="input threshold tabular"
                type="number"
                min="0"
                step="50"
                inputmode="numeric"
                aria-label="Train threshold in {travel.units}"
                value={threshold}
                onchange={setThreshold}
              />
              {travel.units})
            </span>
          </div>
          <div class="mode-row">
            <input
              id="{uid}-mode-fly"
              type="radio"
              name="{uid}-mode"
              checked={travel.mode === 'fly'}
              onchange={() => travel.setMode('fly')}
            />
            <label for="{uid}-mode-fly">Always fly</label>
          </div>
        </fieldset>
      </div>
    </details>
  </div>
{/snippet}

{#if compact}
  <button
    class="button open-sheet"
    type="button"
    aria-haspopup="dialog"
    onclick={() => dialog?.showModal()}
  >
    <Icon name="pin" size={14} />
    <span class="label" data-testid="home-button-label">
      {home.city ? home.city.name : 'Set location'}{home.shared ? ' · link' : ''}
    </span>
  </button>
  <dialog class="sheet" bind:this={dialog} aria-labelledby="{uid}-title">
    <header>
      <h2 id="{uid}-title">Your location</h2>
      <button
        class="icon-button"
        type="button"
        aria-label="Close location settings"
        onclick={() => dialog?.close()}
      >
        <Icon name="close" size={18} />
      </button>
    </header>
    <div class="sheet-body">{@render panel()}</div>
    <footer>
      <button class="done" type="button" onclick={() => dialog?.close()}>Done</button>
    </footer>
  </dialog>
{:else}
  <section class="settings" aria-label="Location and travel" data-slot="settings">
    {@render panel()}
  </section>
{/if}

<style>
  .panel,
  .search {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .current {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  .current > :global(.icon) {
    color: var(--accent);
  }

  .city {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text-button {
    padding: 2px 4px;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--text-sm);
  }

  .text-button:hover {
    text-decoration: underline;
  }

  .shared {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    font-size: var(--text-sm);
  }

  .combo {
    position: relative;
    display: flex;
    align-items: center;
  }

  .combo > :global(.icon) {
    position: absolute;
    left: var(--space-2);
    color: var(--ink-faint);
    pointer-events: none;
  }

  .combo .input {
    width: 100%;
    height: 36px;
    padding-left: 30px;
  }

  .listbox {
    max-height: 240px;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-md);
  }

  .listbox[hidden] {
    display: none;
  }

  [role='option'] {
    padding: 7px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  [role='option']:hover,
  [role='option'].active {
    background: var(--surface-selected);
  }

  [role='option'].active {
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .name {
    font-weight: var(--weight-semibold);
  }

  .rest {
    color: var(--ink-muted);
  }

  .locate {
    align-self: flex-start;
  }

  .cancel {
    align-self: flex-start;
  }

  .status {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .status:empty {
    display: none;
  }

  .privacy {
    color: var(--ink-faint);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  /* ---- Travel settings ---- */
  .travel {
    margin-top: var(--space-1);
  }

  .travel summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    list-style: none;
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    user-select: none;
  }

  .travel summary::-webkit-details-marker {
    display: none;
  }

  .travel summary :global(.icon) {
    color: var(--ink-muted);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .travel[open] summary :global(.icon) {
    transform: rotate(90deg);
  }

  .summary {
    margin-left: auto;
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
  }

  .travel-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-1);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .row :global(.segmented) {
    width: 120px;
  }

  .mode {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .mode legend {
    padding: 0;
  }

  .mode-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
  }

  .mode-row input[type='radio'] {
    margin: 0;
    accent-color: var(--accent);
  }

  .auto-rest {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
  }

  .threshold {
    width: 76px;
    height: 28px;
    text-align: right;
  }

  /* ---- Compact (mobile) ---- */
  .open-sheet {
    max-width: 150px;
  }

  .open-sheet :global(.icon) {
    color: var(--accent);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: var(--space-4) var(--space-4) 0;
    border: 0;
    background: var(--surface);
    color: var(--ink);
  }

  .sheet[open] {
    display: flex;
    flex-direction: column;
    animation: sheet-in var(--duration-slow) var(--ease-out);
  }

  .sheet::backdrop {
    background: var(--scrim);
  }

  .sheet header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  .sheet h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sheet footer {
    padding: var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }

  .done {
    width: 100%;
    height: 44px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  @keyframes sheet-in {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }
</style>
