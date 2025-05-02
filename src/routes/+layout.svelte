<script lang="ts">
  import "../app.css";

  import { onMount } from "svelte";
  import { initUpdater } from "$lib/updater";
  import { app } from "@tauri-apps/api";

  console.log("app.getVersion()", app.getVersion());

  onMount(() => {
    const cleanup = initUpdater();

    return () => {
      cleanup();
    };
  });
</script>

<slot />
