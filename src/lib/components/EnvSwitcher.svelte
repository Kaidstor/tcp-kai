<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { ChevronDown, Check, Settings } from "lucide-svelte";
  import { envStore } from "$lib/store/env-store.svelte";
  import { appStore } from "$lib/store/app-store.svelte";
  import { db } from "$lib/db/repositories";
  import { createHotkey } from "@tanstack/svelte-hotkeys";

  interface Props {
    onOpenSettings: () => void;
  }

  const { onOpenSettings }: Props = $props();

  let open = $state(false);

  let availablePacks = $derived(
    envStore.envPacks.filter(
      (pack) =>
        pack.collection_id === null ||
        pack.collection_id === appStore.currentCollection?.id,
    ),
  );

  let hasMultiplePacks = $derived(availablePacks.length > 1);

  async function selectPack(packId: number) {
    if (!appStore.currentCollection) return;

    await db.collections.updatePack(appStore.currentCollection.id, packId);
    appStore.currentCollection.pack_id = packId;

    const colIndex = appStore.collections.findIndex(
      (c) => c.id === appStore.currentCollection?.id,
    );
    if (colIndex !== -1) {
      appStore.collections[colIndex].pack_id = packId;
    }

    await envStore.setCurrentEnvPack(packId);
    open = false;
  }

  createHotkey("Mod+.", () => {
    open = !open;
  });
</script>

{#if hasMultiplePacks}
  <DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger
      class="bg-stone-700 text-stone-200 hover:bg-stone-500 px-2 py-1 rounded-xl text-xs whitespace-nowrap flex items-center gap-1 transition-colors outline-none"
    >
      <span class="truncate max-w-[120px]">
        {envStore.currentEnvPack?.name ?? "no ENV"}
      </span>
      <ChevronDown class="size-2.5 shrink-0" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        class="bg-stone-800 text-white border border-stone-700 rounded-lg p-1 mt-2 min-w-[180px] max-h-64 overflow-y-auto shadow-xl z-50"
      >
        {#each availablePacks as pack}
          <DropdownMenu.Item
            class="flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-stone-700 cursor-pointer transition-colors"
            onSelect={() => selectPack(pack.id)}
          >
            <span class="truncate">{pack.name}</span>
            {#if appStore.currentCollection?.pack_id === pack.id}
              <Check class="w-4 h-4 text-blue-400 shrink-0 ml-2" />
            {/if}
          </DropdownMenu.Item>
        {/each}

        <DropdownMenu.Separator class="h-px bg-stone-700 my-1" />

        <DropdownMenu.Item
          class="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-stone-700 cursor-pointer transition-colors text-stone-400"
          onSelect={onOpenSettings}
        >
          <Settings class="w-3.5 h-3.5" />
          <span>Настройки</span>
          <kbd class="ml-auto text-[10px] font-mono text-stone-500">⌘E</kbd>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{:else}
  <button
    onclick={onOpenSettings}
    class="bg-stone-600 hover:bg-stone-500 px-4 rounded text-xs whitespace-nowrap transition-colors outline-none"
  >
    {envStore.currentEnvPack?.name ?? "no ENV"}
  </button>
{/if}
