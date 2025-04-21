<script lang="ts">
  import "../app.css";
  import { appLocalDataDir } from "@tauri-apps/api/path";

  (async () => {
    const appLocalDataDirPath = await appLocalDataDir();

    console.log(appLocalDataDirPath);
  })();
</script>

<slot />
