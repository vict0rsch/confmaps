<script lang="ts">
  // Share this view (DESIGN §6.5, §6.6): copies the current URL. Filters and selection are already
  // in it; the user's city is added only when they tick the box, and then only as a GeoNames id.
  import { track } from '../lib/analytics';
  import { lightDismiss } from '../lib/dialog';
  import { home } from '../lib/home/store.svelte';
  import { withHomeParam } from '../lib/state/url';

  let { label = 'Share' }: { label?: string } = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let field: HTMLInputElement | undefined = $state();
  let base = $state('');
  let includeHome = $state(false);
  let copied = $state<'yes' | 'failed' | ''>('');

  const cityId = $derived(home.city?.id ?? null);
  const url = $derived(withHomeParam(base || 'https://confmaps.org/', includeHome ? cityId : null));

  function show() {
    base = location.href;
    includeHome = false;
    copied = '';
    track('share_opened');
    dialog?.showModal();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      copied = 'yes';
    } catch {
      // No clipboard access (insecure context, permissions): select the text for a manual copy.
      field?.select();
      copied = 'failed';
    }
  }
</script>

<button
  class="icon-button share"
  type="button"
  aria-haspopup="dialog"
  aria-label={label}
  title={label}
  onclick={show}
>
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
  </svg>
</button>

<dialog
  class="glass-thick"
  bind:this={dialog}
  {@attach lightDismiss}
  aria-labelledby="{uid}-title"
  data-testid="share-dialog"
>
  <header>
    <h2 id="{uid}-title">Share this view</h2>
    <button class="icon-button" type="button" aria-label="Close" onclick={() => dialog?.close()}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </header>

  <p class="lead">The link includes your current filters and selection.</p>

  <div class="link">
    <input
      class="input"
      type="text"
      readonly
      aria-label="Link to share"
      value={url}
      bind:this={field}
      onfocus={(e) => e.currentTarget.select()}
    />
    <button class="copy" type="button" onclick={copy}>Copy link</button>
  </div>
  <p class="copied" role="status">
    {#if copied === 'yes'}Link copied.{:else if copied === 'failed'}Press Ctrl/Cmd+C to copy.{/if}
  </p>

  <label class="include" class:disabled={cityId === null}>
    <input type="checkbox" bind:checked={includeHome} disabled={cityId === null} />
    <span>
      <span class="include-label">Include my city in the link</span>
      <span class="hint">
        {#if home.city}
          Adds {home.city.name} (the city only, no coordinates) so others see distances from it. Off by
          default.
        {:else}
          Set your city first. Off by default.
        {/if}
      </span>
    </span>
  </label>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100% - 2 * var(--space-4)));
    padding: var(--space-5);
    border-radius: var(--radius-panel);
    color: var(--ink);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    animation: pop-in var(--duration-base) var(--ease-out);
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .lead,
  .hint,
  .copied {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .hint {
    display: block;
    font-size: var(--text-xs);
  }

  .link {
    display: flex;
    gap: var(--space-2);
  }

  .link .input {
    flex: 1;
    height: 36px;
  }

  .copy {
    flex: none;
    height: 36px;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: var(--weight-semibold);
  }

  .copy:hover {
    filter: brightness(1.08);
  }

  .copied {
    min-height: 1.4em;
    margin-top: calc(-1 * var(--space-2));
  }

  .include {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-card);
    background: var(--glass-tint-press);
    cursor: pointer;
  }

  .include.disabled {
    cursor: default;
    opacity: 0.7;
  }

  .include input {
    margin: 3px 0 0;
    accent-color: var(--accent);
  }

  .include-label {
    display: block;
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
  }

  @keyframes pop-in {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
