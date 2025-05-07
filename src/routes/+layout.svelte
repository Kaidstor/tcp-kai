<script lang="ts">
  import "../app.css";

  import { onMount } from "svelte";
  import { initUpdater } from "$lib/updater";

  onMount(() => {
    const cleanup = initUpdater();

    return () => {
      cleanup();
    };
  });
</script>

<slot />
