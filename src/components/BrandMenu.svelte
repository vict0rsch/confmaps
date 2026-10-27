<script lang="ts">
  // Mobile top bar (DESIGN §5.7): the ☰ logo pill opens a panel anchored under it with the tagline,
  // the home and travel settings, the legend, theme, Share and footer links. A modal dialog: the
  // browser handles Escape, the focus trap and stacking, and a tap outside lands on its transparent
  // backdrop, never on a pin.
  import { lightDismiss } from '../lib/dialog';
  import { home } from '../lib/home/store.svelte';
  import { travel } from '../lib/state/travel.svelte';
  import Brand from './Brand.svelte';
  import Footer from './Footer.svelte';
  import Icon from './Icon.svelte';
  import Legend from './Legend.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import SettingsSlot from './slots/SettingsSlot.svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  const uid = $props.id();
  let open = $state(false);
  let top = $state(0);
  let dialog: HTMLDialogElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  /** The city or the travel settings of a shared link apply for this visit. */
  const sharedSettings = $derived(!!home.shared || travel.fromLink);

  /** Anchors the panel under the pill; again on resize (rotation changes the safe area). */
  function place() {
    if (button) top = button.getBoundingClientRect().bottom + 8;
  }

  function show() {
    place();
    dialog?.showModal();
    open = true;
  }
</script>

<svelte:window onresize={() => open && place()} />

<h1 class="heading">
  <button
    bind:this={button}
    class="pill glass"
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="{uid}-menu"
    onclick={show}
  >
    <span class="burger">
      <Icon name="menu" size={16} />
      {#if sharedSettings}<span class="dot" data-testid="shared-dot"></span>{/if}
    </span>
    <Brand heading={false} />
    {#if sharedSettings}<span class="visually-hidden">, settings from a shared link</span>{/if}
  </button>
</h1>

<dialog
  id="{uid}-menu"
  class="anchored-panel glass-thick"
  aria-label="confmaps"
  bind:this={dialog}
  {@attach lightDismiss}
  style:--panel-top="{top}px"
  onclose={() => {
    open = false;
    button?.focus();
  }}
>
  <!-- A section, so the Share dialog's <header> inside is not a nested banner landmark. -->
  <section class="body">
    <div class="top">
      <p class="tagline">AI conferences and their satellites. Attend closer, fly less.</p>
      <button
        class="icon-button"
        type="button"
        aria-label="Close menu"
        onclick={() => dialog?.close()}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
    <div class="home"><SettingsSlot compact /></div>
    <Legend />
    <div class="row">
      <span>Theme</span>
      <ThemeToggle />
    </div>
    <div class="row">
      <span>Share this view</span>
      <ShareDialog />
    </div>
    <Footer />
  </section>
</dialog>

<style>
  /* The top bar lets presses through to the map; App's `.topbar > *` cannot reach this element. */
  .heading {
    display: flex;
    font: inherit;
    pointer-events: auto;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-4) 0 var(--space-3);
    border-radius: var(--radius-full);
    color: var(--ink);
    transition: transform var(--duration-press) var(--ease-out);
  }

  .pill:active {
    transform: scale(0.97);
  }

  /* A smaller wordmark than the sidebar's, so ☰ fits beside it. */
  .pill :global(.brand) {
    font-size: var(--text-md);
  }

  .pill :global(.mark) {
    width: 18px;
    height: 18px;
  }

  .burger {
    position: relative;
    display: grid;
    color: var(--ink-muted);
  }

  /* Decorative: the visually hidden text in the pill carries the meaning. */
  .dot {
    position: absolute;
    top: -3px;
    right: -4px;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--glass-fill-solid);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  /* The close button sits in the corner, beside the tagline, so it adds no height. */
  .top {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .home {
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }

  .top .icon-button {
    flex: none;
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0 0;
  }

  .tagline {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>
