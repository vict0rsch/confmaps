<script lang="ts">
  import type { ControlProps } from '../../lib/filters/types';

  let { state, set }: ControlProps<boolean> = $props();
</script>

<label class="check">
  <input
    type="checkbox"
    checked={state}
    aria-describedby="filter-open-hint"
    onchange={(e) => set(e.currentTarget.checked)}
  />
  <span>Submission still open</span>
</label>
<p class="hint" id="filter-open-hint">An abstract or paper deadline is still ahead.</p>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
  }

  .hint {
    margin: var(--space-1) 0 0 24px;
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }
</style>
