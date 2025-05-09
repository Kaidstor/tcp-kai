<script lang="ts">
  import "../app.css";

  import { onMount } from "svelte";
  import { initUpdater } from "$lib/updater";

  let { children } = $props();

  onMount(() => {
    const cleanup = initUpdater();

    return () => {
      cleanup();
    };
  });
</script>

{@render children()}
