<script lang="ts">
  // Home location / units / travel mode (DESIGN §6.5). `compact` = the mobile logo panel.
  import HomeSettings from '../HomeSettings.svelte';

  let { compact = false }: { compact?: boolean } = $props();
</script>

<HomeSettings {compact} />
