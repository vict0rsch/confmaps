<script lang="ts" module>
  export const HF_DEADLINES_URL = 'https://huggingface.co/spaces/huggingface/ai-deadlines';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { trackName, type JoinedLocation } from '../lib/data/load';
  import { isVirtual, type Conference } from '../lib/data/types';
  import { formatDateRange, formatInstant } from '../lib/format/dates';
  import { kindLabel, placeLabel, roleLabel, websiteLabel } from '../lib/format/labels';
  import { app } from '../lib/state/app.svelte';
  import { deadlineSummary } from '../lib/state/derive';
  import AccessBadge from './AccessBadge.svelte';
  import Icon from './Icon.svelte';
  import SiteMarker from './SiteMarker.svelte';
  import VirtualBadge from './VirtualBadge.svelte';

  let {
    conference,
    onclose,
    siteFootprint,
    onViewHistory,
  }: {
    conference: Conference;
    onclose: () => void;
    /** Per-site distance / estimated CO₂ (rendered only when `app.home` is set). */
    siteFootprint?: Snippet<[JoinedLocation]>;
    /** History mode entry point; the button is hidden until this is provided. */
    onViewHistory?: () => void;
  } = $props();

  let heading: HTMLHeadingElement;

  const sites = $derived(app.data.locationsByConference.get(conference.id) ?? []);
  const deadlines = $derived(deadlineSummary(conference, app.now));
  /** A past edition without deadlines on record (imported history): nothing to say about them. */
  const showDeadlines = $derived(conference.deadlines.length > 0 || conference.end >= app.today);
  /** The event's tracks (EMNLP + Industry + System Demonstrations), when it has several. */
  const tracks = $derived(app.data.trackGroups.get(conference.id) ?? []);
  const website = $derived(websiteLabel(conference.link));

  // Move focus into the panel when it opens or switches conference (screen readers).
  $effect(() => {
    void conference.id;
    heading?.closest('[data-scroll]')?.scrollTo({ top: 0 });
    heading?.focus({ preventScroll: true });
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // Esc inside a dialog (e.g. the mobile filters sheet) closes that dialog only.
    if (e.target instanceof Element && e.target.closest('dialog')) return;
    onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<article class="detail" aria-labelledby="detail-title" data-testid="detail">
  <header>
    <div class="heading">
      <h2 id="detail-title" bind:this={heading} tabindex="-1">
        {conference.title}
        {conference.year}
      </h2>
      {#if conference.fullName}<p class="full-name">{conference.fullName}</p>{/if}
    </div>
    <button class="icon-button close" type="button" aria-label="Close details" onclick={onclose}>
      <Icon name="close" size={18} />
    </button>
  </header>

  <dl class="facts">
    <div class="fact">
      <dt><Icon name="calendar" size={15} label="Dates" /></dt>
      <dd class="tabular">{formatDateRange(conference.start, conference.end)}</dd>
    </div>
    <div class="fact">
      <dt><Icon name="external" size={15} label="Website" /></dt>
      <dd>
        <a href={conference.link} target="_blank" rel="noopener noreferrer">
          {website.text}
          {#if website.archivedHost}<span class="archived-host">· {website.archivedHost}</span>{/if}
        </a>
      </dd>
    </div>
    {#if showDeadlines}
      <div class="fact quiet">
        <dt><Icon name="paper" size={15} label="Deadlines" /></dt>
        <dd>
          <span class="tabular">
            {#if deadlines.paper}
              Paper deadline:
              {#if deadlines.paper.passed}passed{:else}{formatInstant(
                  deadlines.paper.deadline.date,
                )}{/if}
            {:else}
              No paper deadline listed
            {/if}
          </span>
          {#if deadlines.next && deadlines.next !== deadlines.paper?.deadline}
            <span class="next tabular">
              Next: {deadlines.next.label}, {formatInstant(deadlines.next.date)}
            </span>
          {/if}
          <a class="hf" href={HF_DEADLINES_URL} target="_blank" rel="noopener noreferrer">
            Countdowns on the HF site
          </a>
        </dd>
      </div>
    {/if}
  </dl>

  {#if tracks.length}
    <section class="tracks" aria-labelledby="tracks-heading">
      <h3 id="tracks-heading">Tracks ({tracks.length})</h3>
      <ul role="list">
        {#each tracks as t (t.id)}
          {@const paper = deadlineSummary(t, app.now).paper}
          {@const current = t.id === conference.id}
          <li>
            <button
              type="button"
              class="track"
              aria-current={current ? 'true' : undefined}
              disabled={current}
              onclick={() => app.select(t.id)}
            >
              <span class="track-name">{trackName(t) ?? 'Main conference'}</span>
              <span class="track-meta tabular">
                {#if paper}
                  Paper deadline: {paper.passed ? 'passed' : formatInstant(paper.deadline.date)}
                {:else}
                  No paper deadline listed
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if !app.home}
    <p class="prompt">
      <Icon name="pin" size={15} />
      Set your location to see distance and estimated footprint
    </p>
  {/if}

  <section class="sites" aria-labelledby="sites-heading">
    <h3 id="sites-heading">
      {sites.length === 1 ? 'Location' : `Locations (${sites.length})`}
    </h3>
    <ul role="list">
      {#each sites as s (s.id)}
        <li class="site">
          <div class="site-top">
            <span class="role">
              {#if !isVirtual(s)}
                <SiteMarker
                  official={s.official}
                  main={s.role === 'main'}
                  locked={s.access === 'authors_only'}
                />
              {/if}
              {roleLabel(s)} · {kindLabel(s)}
            </span>
            <span class="site-dates tabular">{formatDateRange(s.start, s.end)}</span>
          </div>
          <p class="place">
            {placeLabel(s)}
            {#if isVirtual(s)}<VirtualBadge />{:else if s.format === 'hybrid'}<VirtualBadge
                format="hybrid"
              />{/if}
          </p>
          {#if s.role === 'satellite' && s.name}<p class="muted">{s.name}</p>{/if}
          {#if !isVirtual(s) && s.venue}<p class="muted">{s.venue}</p>{/if}
          <div class="site-tags">
            <AccessBadge access={s.access} />
            <span class="papers">
              {s.presentsPapers ? 'Accepted papers presented' : 'No paper presentations'}
            </span>
          </div>
          {#if s.notes}<p class="notes">{s.notes}</p>{/if}
          {#if s.link !== conference.link}
            <a class="site-link" href={s.link} target="_blank" rel="noopener noreferrer">
              Event page <Icon name="external" size={12} />
            </a>
          {/if}
          {#if app.home && siteFootprint}{@render siteFootprint(s)}{/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if onViewHistory}
    <button class="button history" type="button" onclick={onViewHistory}>
      <Icon name="history" size={14} /> View history
    </button>
  {/if}
</article>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    letter-spacing: -0.01em;
  }

  h2:focus {
    outline: none;
  }

  .full-name {
    margin-top: var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .close {
    margin: -4px -6px 0 0;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .fact {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .fact dt {
    padding-top: 2px;
    color: var(--ink-muted);
  }

  .fact dd {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .archived-host {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .quiet dd {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .next {
    font-size: var(--text-sm);
  }

  .hf {
    font-size: var(--text-sm);
  }

  .prompt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  h3 {
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .tracks ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .track {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink);
    text-align: left;
  }

  .track:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .track[aria-current='true'] {
    background: var(--surface-selected);
    cursor: default;
  }

  .track-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .track-meta {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .sites ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .site {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .site-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .role {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .place {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-semibold);
  }

  .muted {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .site-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .papers {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .notes {
    margin-top: var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    font-style: italic;
  }

  .site-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: var(--space-1);
    font-size: var(--text-sm);
  }

  .history {
    align-self: flex-start;
  }
</style>
