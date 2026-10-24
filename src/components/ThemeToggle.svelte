<script lang="ts">
  import { app } from '../lib/state/app.svelte';
  import type { Theme } from '../lib/state/theme';
  import Icon, { type IconName } from './Icon.svelte';

  const options: { value: Theme; label: string; icon: IconName }[] = [
    { value: 'system', label: 'System theme', icon: 'monitor' },
    { value: 'light', label: 'Light theme', icon: 'sun' },
    { value: 'dark', label: 'Dark theme', icon: 'moon' },
  ];
</script>

<fieldset class="toggle">
  <legend class="visually-hidden">Theme</legend>
  {#each options as o (o.value)}
    <label title={o.label}>
      <input
        class="visually-hidden"
        type="radio"
        name="theme"
        value={o.value}
        checked={app.theme === o.value}
        onchange={() => app.setTheme(o.value)}
      />
      <Icon name={o.icon} size={14} />
      <span class="visually-hidden">{o.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .toggle {
    display: inline-flex;
    gap: 2px;
    margin: 0;
    padding: 2px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--glass-tint-press);
  }

  label {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    color: var(--ink-muted);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  label:hover {
    color: var(--ink);
  }

  label:has(input:checked) {
    background: var(--control-fill-hover);
    color: var(--ink);
    box-shadow:
      var(--shadow-sm),
      0 0 0 0.5px var(--hairline);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
