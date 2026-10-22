<script lang="ts">
  // METHODOLOGY.md inside the app, reachable at `#methodology` (the footer and the detail panel
  // link there). The markdown is bundled as text and rendered on first open only.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let html = $state('');
  let failed = $state(false);

  async function render() {
    if (html || failed) return;
    try {
      const [{ marked }, { default: source }] = await Promise.all([
        import('marked'),
        import('../../METHODOLOGY.md?raw'),
      ]);
      // Links to files of the repo cannot work on the site: show their text, keep external links.
      marked.use({
        renderer: {
          link({ href, title, tokens }) {
            const text = this.parser.parseInline(tokens);
            if (!/^https?:/i.test(href)) return text;
            const t = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
            return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
          },
        },
      });
      html = await marked.parse(source);
    } catch {
      failed = true;
    }
  }

  function sync() {
    if (!dialog) return;
    if (location.hash === '#methodology') {
      if (!dialog.open) dialog.showModal();
      void render();
    } else if (dialog.open) {
      dialog.close();
    }
  }

  function onClose() {
    if (location.hash === '#methodology') {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }

  onMount(sync);
</script>

<svelte:window onhashchange={sync} />

<dialog bind:this={dialog} aria-labelledby="methodology-title" onclose={onClose}>
  <header>
    <h2 id="methodology-title" class="visually-hidden">Methodology</h2>
    <button
      class="icon-button"
      type="button"
      aria-label="Close methodology"
      onclick={() => dialog?.close()}
    >
      <Icon name="close" size={18} />
    </button>
  </header>
  <div class="doc">
    {#if html}
      <!-- Our own METHODOLOGY.md, bundled at build time: not user input. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html html}
    {:else if failed}
      <p>Could not load the methodology.</p>
    {:else}
      <p>Loading…</p>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(720px, calc(100% - 2 * var(--space-4)));
    max-height: calc(100% - 2 * var(--space-6));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--surface-raised);
    color: var(--ink);
    box-shadow: var(--shadow-lg);
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  header {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-2) 0;
    background: var(--surface-raised);
  }

  .doc {
    padding: 0 var(--space-6) var(--space-6);
    font-size: var(--text-md);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .doc :global(h1) {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xl);
  }

  .doc :global(h2) {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--text-lg);
  }

  .doc :global(h3) {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-md);
  }

  .doc :global(p),
  .doc :global(ul),
  .doc :global(ol),
  .doc :global(table) {
    margin: 0 0 var(--space-3);
  }

  .doc :global(ul),
  .doc :global(ol) {
    padding-left: var(--space-5);
  }

  .doc :global(table) {
    display: block;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .doc :global(th),
  .doc :global(td) {
    padding: 4px var(--space-2);
    border: 1px solid var(--border);
    text-align: left;
  }

  .doc :global(code) {
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    font-size: 0.92em;
  }
</style>
