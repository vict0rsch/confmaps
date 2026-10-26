<script lang="ts">
  // Home location and travel settings (DESIGN §6.5, §5.2). Desktop: a pill summarising them that
  // opens an anchored panel. `compact` (mobile logo panel): the same panel inline, with the travel
  // preferences folded into a disclosure.
  import { tick } from 'svelte';
  import { cityLabel, cityShortLabel, searchCities, type IndexedCity } from '../lib/home/cities';
  import { home } from '../lib/home/store.svelte';
  import { kmToMi, miToKm } from '../lib/geo/distance';
  import { travel } from '../lib/state/travel.svelte';
  import Segmented from './filters/Segmented.svelte';
  import Icon from './Icon.svelte';
  import { PRIVACY_URL } from './Footer.svelte';

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
  let pill: HTMLButtonElement | undefined = $state();
  let section: HTMLElement | undefined = $state();
  /** Desktop: the panel under the pill is open. */
  let panelOpen = $state(false);

  const results: IndexedCity[] = $derived(home.cities ? searchCities(home.cities, query) : []);
  const typed = $derived(query.trim().length > 0);
  const showList = $derived(open && typed && results.length > 0);
  const searching = $derived(!home.city || changing);

  const mi = $derived(travel.units === 'mi');
  const threshold = $derived(mi ? Math.round(kmToMi(travel.threshold)) : travel.threshold);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const travelSummary = $derived(
    travel.mode === 'auto'
      ? `Train for trips under ${fmt(threshold)} ${travel.units}`
      : `Always fly · ${travel.units}`,
  );
  /** The logo panel's narrower summary. */
  const travelShort = $derived(
    travel.mode === 'auto'
      ? `Train under ${fmt(threshold)} ${travel.units}`
      : `Always fly · ${travel.units}`,
  );

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
    await afterChosen();
  }

  /** A city was picked: desktop closes the panel back to the pill; in the logo panel the focus
   *  moves to Change. */
  async function afterChosen() {
    if (!compact) return closePanel(true);
    await tick();
    changeButton?.focus();
  }

  async function openPanel() {
    panelOpen = true;
    await tick();
    (searching ? input : changeButton)?.focus();
  }

  async function closePanel(refocus: boolean) {
    panelOpen = false;
    if (changing && home.city) {
      changing = false;
      query = '';
    }
    if (!refocus) return;
    await tick();
    pill?.focus();
  }

  function onPanelKeydown(e: KeyboardEvent) {
    // The combobox handles Escape first (closing its list or cancelling a change).
    if (e.key !== 'Escape' || !panelOpen || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    closePanel(true);
  }

  /** Outside click closes the panel (focus stays where the click put it). */
  function onDocumentPointerdown(e: PointerEvent) {
    const target = e.target as Node;
    if (target instanceof Element && target.closest('dialog')) return; // modal opened from the panel
    if (panelOpen && !section?.contains(target)) closePanel(false);
  }

  /** Tabbing out of the panel closes it, so it never covers the next focused control. */
  function onFocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next instanceof Element && next.closest('dialog')) return; // modal opened from the panel
    if (panelOpen && next && !section?.contains(next)) closePanel(false);
  }

  async function clearHome() {
    home.clear();
    await tick();
    input?.focus();
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
      await afterChosen();
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

<svelte:document onpointerdown={compact ? undefined : onDocumentPointerdown} />

{#snippet notices()}
  {#if home.shared}
    <p class="shared" data-testid="shared-notice">
      Showing distances from <strong>{cityShortLabel(home.shared)}</strong> (from the shared link) ·
      <button class="text-button" type="button" onclick={() => home.useMine()}>Use mine</button>
    </p>
  {/if}

  {#if travel.fromLink}
    <p class="shared" data-testid="shared-travel-notice">
      Using the travel settings from the shared link ({travel.units} ·
      {travel.mode === 'auto' ? `train under ${fmt(threshold)} ${travel.units}` : 'always fly'}) ·
      <button class="text-button" type="button" onclick={() => travel.useMine()}>Use mine</button>
    </p>
  {/if}
{/snippet}

{#snippet travelFields()}
  <div class="row">
    <span class="field-label" aria-hidden="true">Units</span>
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
  <div class="field">
    <span class="field-label" aria-hidden="true">How do you travel?</span>
    <Segmented
      legend="How do you travel?"
      name="{uid}-mode"
      options={[
        { value: 'auto', label: 'Train when possible' },
        { value: 'fly', label: 'Always fly' },
      ]}
      value={travel.mode}
      onchange={(v) => travel.setMode(v)}
    />
  </div>
  {#if travel.mode === 'auto'}
    <label class="threshold-row">
      <span>Take the train under</span>
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
      <span>{travel.units}</span>
    </label>
  {/if}
{/snippet}

{#snippet panel()}
  <div class="panel">
    <h2 class="heading" id="{uid}-heading">Where are you travelling from?</h2>
    {#if compact}{@render notices()}{/if}

    {#if home.city && !searching}
      <div class="current">
        <Icon name="pin" size={16} />
        <span class="city" data-testid={compact ? 'home-city' : undefined}
          >{cityShortLabel(home.city)}</span
        >
        <button class="text-button" type="button" bind:this={changeButton} onclick={startChanging}>
          Change<span class="visually-hidden"> location</span>
        </button>
        <button class="text-button" type="button" onclick={clearHome}>
          Clear<span class="visually-hidden"> location</span>
        </button>
      </div>
    {:else}
      <div class="search">
        <label class="visually-hidden" for="{uid}-search">
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
            placeholder="Search for a city"
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
        <div class="search-actions">
          <button class="button" type="button" disabled={locating} onclick={useLocation}>
            <Icon name="target" size={14} />
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          {#if changing && home.city}
            <button
              class="text-button"
              type="button"
              onclick={() => {
                changing = false;
                query = '';
                tick().then(() => changeButton?.focus());
              }}>Cancel</button
            >
          {/if}
        </div>
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
        Stays on this device — only the nearest city is saved. <a href={PRIVACY_URL}>Privacy</a>
      </p>
    {/if}

    {#if compact}
      <details class="travel">
        <summary class="travel-summary">
          <span class="subheading">Travel preferences</span>
          <span class="travel-current tabular">{travelShort}</span>
          <Icon name="chevron" size={14} />
        </summary>
        <div class="travel-fields">{@render travelFields()}</div>
      </details>
    {:else}
      <div class="travel">
        <h3 class="subheading">Travel preferences</h3>
        {@render travelFields()}
      </div>
    {/if}
  </div>
{/snippet}

{#if compact}
  <div role="group" aria-labelledby="{uid}-heading">
    {@render panel()}
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class="settings"
    aria-label="Location and travel"
    data-slot="settings"
    bind:this={section}
    onkeydown={onPanelKeydown}
    onfocusout={onFocusout}
  >
    <div class="anchor">
      <button
        class="pill"
        type="button"
        aria-expanded={panelOpen}
        aria-controls="{uid}-panel"
        data-testid="home-pill"
        bind:this={pill}
        onclick={() => (panelOpen ? closePanel(false) : openPanel())}
      >
        <Icon name="pin" size={16} />
        <span class="pill-text">
          {#if home.city}
            <span class="pill-city" data-testid="home-city">{cityShortLabel(home.city)}</span>
          {:else}
            <span class="pill-city">Set your city</span>
          {/if}
          <span class="pill-prefs tabular">{travelSummary}</span>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      <div
        id="{uid}-panel"
        class="popover glass-thick"
        role="group"
        aria-labelledby="{uid}-heading"
        hidden={!panelOpen}
      >
        {@render panel()}
      </div>
    </div>
    {@render notices()}
  </section>
{/if}

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* ---- Pill (desktop) ---- */
  .anchor {
    position: relative;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    background: var(--control-fill);
    box-shadow: var(--shadow-sm);
    text-align: left;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-press) var(--ease-out);
  }

  .pill:hover {
    background: var(--control-fill-hover);
  }

  .pill:active {
    transform: scale(0.99);
  }

  .pill > :global(.icon:first-child) {
    color: var(--accent);
  }

  .pill > :global(.icon:last-child) {
    color: var(--ink-muted);
    transform: rotate(90deg);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .pill[aria-expanded='true'] > :global(.icon:last-child) {
    transform: rotate(-90deg);
  }

  .pill-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .pill-city,
  .pill-prefs {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill-city {
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .pill-prefs {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  /* Anchored under the pill, over the filters and list. */
  .popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    left: 0;
    z-index: 20;
    max-height: min(560px, 70vh);
    padding: var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-card);
    animation: pop-in var(--duration-base) var(--ease-out);
  }

  .popover[hidden] {
    display: none;
  }

  /* ---- Panel content (shared by the popover and the logo panel) ---- */
  .panel,
  .search,
  .travel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .heading {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .subheading,
  .field-label {
    color: var(--ink-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .current {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-radius: var(--radius-full);
    background: var(--glass-tint-press);
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
    padding: 4px 6px;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .text-button:hover {
    text-decoration: underline;
  }

  .shared {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-card);
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
    left: 13px;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .combo .input {
    width: 100%;
    height: 40px;
    padding-left: 36px;
    font-size: var(--text-md);
  }

  .listbox {
    max-height: 240px;
    margin: calc(-1 * var(--space-1)) 0 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-card);
    background: var(--glass-fill-thick);
    box-shadow: var(--shadow-md);
  }

  .listbox[hidden] {
    display: none;
  }

  [role='option'] {
    padding: 8px var(--space-3);
    border-radius: 12px; /* concentric: card radius − list padding */
    font-size: var(--text-sm);
    cursor: pointer;
  }

  [role='option']:hover,
  [role='option'].active {
    background: var(--accent-soft);
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

  .search-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .status:empty {
    display: none;
  }

  .privacy {
    margin-top: calc(-1 * var(--space-1));
    color: var(--ink-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  /* The link stays underlined, so it never relies on colour alone. */
  .privacy a {
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
  }

  /* ---- Travel preferences ---- */
  .travel {
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
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

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .threshold-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .threshold {
    width: 88px;
    height: 32px;
    text-align: right;
  }

  /* ---- Compact (logo panel): the travel preferences in a disclosure ---- */
  /* Block, not flex: Safari mislays a flex <details>. */
  details.travel {
    display: block;
  }

  /* The negative margin pulls the hairline (closed) and the fields (open) closer to the text.
     Positioned, so the fields' top padding never covers its 44 px tap target. */
  .travel-summary {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    margin-bottom: calc(-1 * var(--space-3));
    list-style: none;
    cursor: pointer;
  }

  .travel-summary::-webkit-details-marker {
    display: none;
  }

  .travel-current {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .travel-summary > :global(.icon) {
    color: var(--ink-muted);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  details[open] > .travel-summary > :global(.icon) {
    transform: rotate(90deg);
  }

  .travel-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-3);
  }

  @keyframes pop-in {
    from {
      transform: translateY(-4px);
      opacity: 0;
    }
  }
</style>
