<script lang="ts">
  import { app } from "@tauri-apps/api";
  import { onMount } from "svelte";
  import {
    updateStatus,
    checkForUpdates,
    installUpdate,
    clearUpdateError,
  } from "$lib/updater";
  import { ArrowDownCircle, RefreshCw } from "lucide-svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let appVersion = $state("");
  let pendingUpdate: any = $state(null);
  let showErrorDialog = $state(false);

  onMount(async () => {
    try {
      appVersion = await app.getVersion();
    } catch (err) {
      console.error("Failed to get app version:", err);
      appVersion = "unknown";
    }
  });

  async function handleCheckForUpdates() {
    pendingUpdate = await checkForUpdates();
  }

  // Try to get the update object if status is available but we don't have it stored
  $effect(() => {
    if ($updateStatus.available && !pendingUpdate) {
      checkForUpdates().then((update) => {
        pendingUpdate = update;
      });
    }
  });

  async function handleInstallUpdate() {
    console.log("handleInstallUpdate", $updateStatus.available, pendingUpdate);
    if (!$updateStatus.available) return;

    // If we have status.available but no pendingUpdate, try to get it
    if (!pendingUpdate) {
      pendingUpdate = await checkForUpdates();
    }

    if (pendingUpdate) {
      await installUpdate(pendingUpdate);
    } else {
      console.error("Не удалось получить информацию об обновлении");
      updateStatus.update((state) => ({
        ...state,
        error: "Не удалось получить информацию об обновлении",
      }));
    }
  }

  function closeErrorDialog() {
    showErrorDialog = false;
    clearUpdateError();
  }

  $effect(() => {
    if ($updateStatus.error && !showErrorDialog) {
      showErrorDialog = true;
    }
  });
</script>

<!-- This div is used to create a space for the updater button -->
<div class="min-h-8"></div>

<div
  class="mt-auto py-1 h-8 border-t border-stone-700 text-sm absolute bottom-0 left-0 right-0"
>
  <div class="flex items-center justify-between px-2">
    {#if $updateStatus.checking}
      <button class="text-stone-400 animate-spin" disabled>
        <RefreshCw size="0.75rem" />
      </button>
    {:else if $updateStatus.downloading}
      <div class="text-green-400 flex items-center gap-1">
        <ArrowDownCircle size="0.75rem" class="animate-pulse" />
        <span>Скачивание...</span>
      </div>
    {:else if $updateStatus.available}
      <button
        class="text-green-400 hover:text-green-300 flex items-center gap-1"
        onclick={handleInstallUpdate}
        title="Установить обновление v{$updateStatus.version}"
      >
        <ArrowDownCircle size="0.75rem" />
        <span>Обновить</span>
      </button>
    {:else}
      <button
        class="text-stone-400 hover:text-stone-300"
        onclick={handleCheckForUpdates}
        title="Проверить наличие обновлений"
      >
        <RefreshCw size="0.75rem" />
      </button>
    {/if}

    <span class="text-stone-400">v{appVersion}</span>

    {#if $updateStatus.downloading && $updateStatus.progress > 0}
      <div
        class="absolute inset-0 bg-green-900/50 pointer-events-none transition-all duration-300 ease-in-out"
        style="width: {$updateStatus.progress}%;"
      ></div>
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={showErrorDialog}
  title="Ошибка обновления"
  message={$updateStatus.error}
  confirmLabel="ОК"
  cancelLabel=""
  onConfirm={closeErrorDialog}
  onCancel={closeErrorDialog}
/>
