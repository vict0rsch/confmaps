<script lang="ts">
  // Mobile top bar (DESIGN §6.7): the logo pill opens a panel anchored under it with the tagline,
  // legend, theme, Share and footer links. A modal dialog: the browser handles Escape, the focus
  // trap and stacking, and a tap outside lands on its transparent backdrop, never on a pin.
  import { lightDismiss } from '../lib/dialog';
  import Brand from './Brand.svelte';
  import Footer from './Footer.svelte';
  import Icon from './Icon.svelte';
  import Legend from './Legend.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  const uid = $props.id();
  let open = $state(false);
  let top = $state(0);
  let dialog: HTMLDialogElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

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
    <Brand heading={false} />
  </button>
</h1>

<dialog
  id="{uid}-menu"
  class="menu glass-thick"
  aria-label="confmaps"
  bind:this={dialog}
  {@attach lightDismiss}
  style:--menu-top="{top}px"
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
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    color: var(--ink);
    transition: transform var(--duration-press) var(--ease-out);
  }

  .pill:active {
    transform: scale(0.97);
  }

  /* Under the pill, left-aligned with it; scrolls if the credits outgrow the window. */
  .menu {
    position: fixed;
    inset: var(--menu-top) auto auto max(env(safe-area-inset-left), var(--space-3));
    margin: 0;
    padding: 0;
    width: min(340px, calc(100vw - 2 * var(--space-3)));
    max-width: none;
    max-height: calc(100dvh - var(--menu-top) - max(env(safe-area-inset-bottom), var(--space-3)));
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-card);
    color: var(--ink);
    pointer-events: auto;
  }

  .menu[open] {
    animation: pop-in var(--duration-base) var(--ease-out);
  }

  .menu::backdrop {
    background: transparent;
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

  @keyframes pop-in {
    from {
      transform: translateY(-4px);
      opacity: 0;
    }
  }
</style>
