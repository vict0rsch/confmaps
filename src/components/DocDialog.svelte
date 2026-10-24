<script lang="ts">
  // A repo markdown document inside the app, reachable at `#<hash>` (METHODOLOGY.md at
  // `#methodology`, PRIVACY.md at `#privacy`). The markdown is bundled as text and rendered on
  // first open only.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    hash,
    title,
    load,
  }: { hash: string; title: string; load: () => Promise<{ default: string }> } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let html = $state('');
  let failed = $state(false);

  async function render() {
    if (html || failed) return;
    try {
      const [{ marked }, { default: source }] = await Promise.all([import('marked'), load()]);
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
      // Wide tables scroll sideways on phones: keyboard users reach the scroll box (axe
      // scrollable-region-focusable), and screen readers hear what it is (one name per table).
      let tables = 0;
      html = (await marked.parse(source))
        .replaceAll(
          '<table>',
          () =>
            `<div class="table-scroll" tabindex="0" role="region" aria-label="Table ${++tables}"><table>`,
        )
        .replaceAll('</table>', '</table></div>');
    } catch {
      failed = true;
    }
  }

  function sync() {
    if (!dialog) return;
    if (location.hash === `#${hash}`) {
      if (!dialog.open) dialog.showModal();
      void render();
    } else if (dialog.open) {
      dialog.close();
    }
  }

  function onClose() {
    if (location.hash === `#${hash}`) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }

  onMount(sync);
</script>

<svelte:window onhashchange={sync} />

<dialog class="glass-thick" bind:this={dialog} aria-labelledby="{hash}-title" onclose={onClose}>
  <header>
    <h2 id="{hash}-title" class="visually-hidden">{title}</h2>
    <button
      class="icon-button"
      type="button"
      aria-label="Close {title.toLowerCase()}"
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
      <p>Could not load the {title.toLowerCase()}.</p>
    {:else}
      <p>Loading…</p>
    {/if}
  </div>
</dialog>

<style>
  /* Fill, border and shadow from .glass-thick (base.css). */
  dialog {
    width: min(720px, calc(100% - 2 * var(--space-4)));
    max-height: calc(100% - 2 * var(--space-6));
    padding: 0;
    border-radius: var(--radius-panel);
    color: var(--ink);
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  header {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: flex-end;
    padding: var(--space-3) var(--space-3) 0;
    background: inherit; /* the dialog's opaque fill, in every transparency mode */
  }

  /* Comfortable reading measure (~68 characters a line). */
  .doc {
    max-width: 68ch;
    margin: 0 auto;
    padding: 0 var(--space-8) var(--space-8);
    font-size: var(--text-md);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .doc :global(h1) {
    margin: 0 0 var(--space-4);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .doc :global(h2) {
    margin: var(--space-8) 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .doc :global(h3) {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .doc :global(p),
  .doc :global(ul),
  .doc :global(ol),
  .doc :global(.table-scroll) {
    margin: 0 0 var(--space-3);
  }

  .doc :global(ul),
  .doc :global(ol) {
    padding-left: var(--space-5);
  }

  /* Numbers stay whole; a wide table scrolls instead. */
  .doc :global(.table-scroll) {
    overflow-x: auto;
    border-radius: var(--radius-sm);
  }

  /* A floor width: on a phone the columns scroll instead of breaking every other word. */
  .doc :global(table) {
    min-width: 32rem;
    border-collapse: collapse;
    font-size: var(--text-sm);
    overflow-wrap: normal;
  }

  .doc :global(th),
  .doc :global(td) {
    padding: 6px var(--space-2);
    border-bottom: 1px solid var(--hairline);
    text-align: left;
  }

  .doc :global(th) {
    color: var(--ink-muted);
    font-weight: var(--weight-semibold);
  }

  .doc :global(code) {
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: var(--glass-tint-press);
    font-size: 0.92em;
  }

  @media (max-width: 600px) {
    .doc {
      padding: 0 var(--space-5) var(--space-6);
    }
  }
</style>
