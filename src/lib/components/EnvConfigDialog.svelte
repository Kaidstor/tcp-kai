<script lang="ts">
  import { Dialog } from "bits-ui";
  import {
    Plus,
    Trash2,
    Check,
    RotateCcw,
    Save,
    Database,
    Pen,
    Globe,
    Link,
  } from "lucide-svelte";
  import InputDialog from "./InputDialog.svelte";
  import { updateEnvPack, updateCollectionPack } from "$lib/db";

  import { envStore } from "$lib/store/env-store.svelte";
  import { appStore } from "$lib/store/app-store.svelte";

  interface Props {
    open: boolean;
    onCancel: () => void;
  }

  let { open, onCancel }: Props = $props();

  let isEditingPackName = $state(false);
  let editedPackName = $state("");

  // New variable input
  let newKey = $state("");
  let newValue = $state("");

  // Check if there are unsaved changes
  let hasChanges = $derived.by(() => {
    return (
      JSON.stringify(envStore.currentEnvPack?.vars) !==
      JSON.stringify(envStore.originalEnvPackVars)
    );
  });

  function startEditingPackName() {
    if (!envStore.currentEnvPack) return;
    editedPackName = envStore.currentEnvPack.name;
    isEditingPackName = true;
  }

  async function savePackName() {
    if (!envStore.currentEnvPack || !editedPackName.trim()) return;
    await envStore.updateEnvPackName(
      envStore.currentEnvPack.id,
      editedPackName.trim()
    );
    isEditingPackName = false;
  }

  async function handleAddVar() {
    if (!newKey || !envStore.currentEnvPack) return;
    envStore.currentEnvPack.vars?.push({ key: newKey, value: newValue });
    newKey = "";
    newValue = "";
  }

  async function handleDeleteVar(idx: number) {
    if (!envStore.currentEnvPack) return;
    envStore.currentEnvPack.vars = envStore.currentEnvPack.vars?.filter(
      (_, i) => i !== idx
    );
  }

  async function saveChanges() {
    if (!envStore.currentEnvPack) return;
    await updateEnvPack(
      envStore.currentEnvPack.id,
      envStore.currentEnvPack.vars ?? []
    );
  }

  async function activatePack() {
    if (!envStore.currentEnvPack || !appStore.currentCollection) return;

    try {
      // First, save any changes to variables
      if (hasChanges) {
        await saveChanges();
      }

      // Update the collection's pack reference
      await updateCollectionPack(
        appStore.currentCollection.id,
        envStore.currentEnvPack.id
      );

      await envStore.setCurrentEnvPack(envStore.currentEnvPack.id);
      onCancel();

      // Don't set dialog state directly, let parent component handle it
      // open = false; // <-- Удаляем эту строку
    } catch (error) {
      console.error("Error activating environment pack:", error);
    }
  }

  function cancel() {
    isEditingPackName = false;
    onCancel();
  }

  function changeSelectedPackId(id: number) {
    envStore.setCurrentEnvPack(id);
  }

  async function handleConfirmAddPack(name: string) {
    if (!name.trim()) return;
    await envStore.addEnvPack(name.trim());
  }
</script>

<Dialog.Root bind:open onOpenChange={(v) => !v && cancel()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50" />
    <Dialog.Content
      class="fixed p-0 bg-stone-800 text-white rounded-lg w-[800px] h-[600px] max-w-[95vw] max-h-[90vh] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 shadow-xl overflow-hidden flex flex-col"
    >
      <div class="bg-stone-700 px-4 py-2 border-b border-stone-600">
        <Dialog.Title
          class="text-lg font-semibold flex items-center justify-between h-8"
        >
          <span>Переменные окружения</span>
          <div class="space-x-2">
            {#if hasChanges}
              <button
                onclick={envStore.resetCurrentEnvPackVars}
                class="px-3 py-1.5 bg-stone-600 hover:bg-stone-500 rounded-md transition-colors text-sm inline-flex items-center space-x-1"
              >
                <RotateCcw size="0.9em" />
                <span>Reset</span>
              </button>
              <button
                onclick={saveChanges}
                class="px-3 py-1.5 bg-stone-600 hover:bg-stone-500 rounded-md transition-colors text-sm inline-flex items-center space-x-1"
              >
                <Save size="0.9em" />
                <span>Save</span>
              </button>
            {/if}
            {#if envStore.currentEnvPack?.id !== null}
              <button
                onclick={activatePack}
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md transition-colors text-sm inline-flex items-center space-x-1 {appStore
                  .currentCollection?.pack_id === envStore.currentEnvPack?.id
                  ? 'opacity-50 cursor-not-allowed'
                  : ''}"
                disabled={appStore.currentCollection?.pack_id ===
                  envStore.currentEnvPack?.id}
              >
                <Check size="0.9em" />
                <span
                  >{appStore.currentCollection?.pack_id ===
                  envStore.currentEnvPack?.id
                    ? "Применен"
                    : "Применить"}</span
                >
              </button>
            {/if}
          </div>
        </Dialog.Title>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left sidebar: Packs -->
        <div class="w-68 border-r border-stone-700 p-4 flex flex-col h-full">
          <div class="overflow-y-auto flex-1">
            <div class="space-y-1">
              {#each envStore.envPacks as pack (pack.id)}
                {#if pack.collection_id === null || pack.collection_id === appStore.currentCollection?.id}
                  <button
                    onclick={() => changeSelectedPackId(pack.id)}
                    class="w-full text-left p-2 rounded-md transition-colors flex justify-between items-center group {envStore
                      .currentEnvPack?.id === pack.id
                      ? 'bg-stone-600'
                      : 'hover:bg-stone-700'}"
                  >
                    <div class="flex items-center gap-2">
                      {#if pack.collection_id === null}
                        <Globe size="0.9em" class="text-sky-400" />
                      {:else}
                        <Link size="0.9em" class="text-amber-400" />
                      {/if}
                      <span class="truncate font-medium text-sm"
                        >{pack.name}</span
                      >
                    </div>
                    {#if appStore.currentCollection?.pack_id === pack.id}
                      <span
                        class="text-xs px-1.5 py-0.5 bg-blue-500 text-white rounded-sm"
                        >Active</span
                      >
                    {/if}
                  </button>
                {/if}
              {/each}
            </div>
          </div>

          <div class="mt-2">
            <InputDialog
              title="Добавить пак переменных"
              label="Название пака"
              placeholder="Введите название пака"
              buttonText="Добавить"
              onConfirm={handleConfirmAddPack}
            >
              <Dialog.Trigger
                class="flex w-full items-center justify-center space-x-1 p-2 bg-stone-700 hover:bg-stone-600 rounded-md transition-colors text-sm"
              >
                <Plus size="0.9em" />
                <span>Добавить пак</span>
              </Dialog.Trigger>
            </InputDialog>
          </div>
        </div>

        <!-- Right content: Variables Table -->
        <div class="flex-1 flex flex-col h-full">
          <div class="p-4 flex-1 overflow-hidden flex flex-col gap-4">
            <div class="flex justify-between items-center h-8">
              <h3 class="font-medium text-stone-300 flex gap-2 items-center">
                <Database size="1.1em" class="text-stone-400" />
                {#if envStore.envPacks.length > 0 && envStore.currentEnvPack}
                  {#if isEditingPackName}
                    <input
                      bind:value={editedPackName}
                      class="bg-stone-700 border border-stone-600 focus:border-stone-500 px-2 py-1 rounded outline-none text-sm"
                      placeholder="Pack name"
                      onkeydown={(e) => e.key === "Enter" && savePackName()}
                    />
                  {:else}
                    <span>{envStore.currentEnvPack?.name}</span>
                    <span class="text-xs text-stone-400 ml-1">
                      {#if envStore.currentEnvPack.collection_id === null}
                        (Global)
                      {:else}
                        (Linked to: {appStore.collections.find(
                          (c) => c.id === envStore.currentEnvPack?.collection_id
                        )?.name})
                      {/if}
                    </span>
                  {/if}
                {:else if envStore.envPacks.length === 0}
                  No environment packs
                {:else}
                  No Pack Selected
                {/if}
              </h3>

              {#if envStore.currentEnvPack}
                <div class="flex gap-2 items-center">
                  <button
                    title={envStore.currentEnvPack.collection_id === null
                      ? appStore.currentCollection
                        ? "Link to current collection"
                        : "Link to collection (select one first)"
                      : "Make Global"}
                    onclick={() =>
                      envStore.toggleEnvPackScope(envStore.currentEnvPack!.id)}
                    class="p-1 hover:bg-stone-600 rounded-md text-stone-400 hover:text-white {envStore
                      .currentEnvPack.collection_id === null &&
                    !appStore.currentCollection
                      ? 'opacity-50 cursor-not-allowed'
                      : ''}"
                    disabled={envStore.currentEnvPack.collection_id === null &&
                      !appStore.currentCollection}
                  >
                    {#if envStore.currentEnvPack.collection_id === null}
                      <Link size="0.9rem" />
                    {:else}
                      <Globe size="0.9rem" />
                    {/if}
                  </button>
                  {#if isEditingPackName}
                    <button
                      onclick={savePackName}
                      class="p-1 hover:bg-green-600 rounded-md text-green-400 hover:text-white"
                      title="Save name"
                    >
                      <Save size="1rem" />
                    </button>
                  {:else}
                    <button
                      onclick={startEditingPackName}
                      class="p-1 hover:bg-stone-600 rounded-md text-stone-400 hover:text-white"
                      title="Edit name"
                    >
                      <Pen size="1rem" />
                    </button>
                  {/if}
                  <button
                    onclick={(e) => {
                      e.stopPropagation();
                      envStore.deleteEnvPack(envStore.currentEnvPack!.id);
                    }}
                    class="p-1 hover:bg-red-600 rounded-md text-red-400 hover:text-white"
                    title="Delete pack"
                  >
                    <Trash2 size="1rem" />
                  </button>
                </div>
              {/if}
            </div>

            <!-- Table Header -->
            {#if envStore.currentEnvPack?.vars?.length || 0 > 0}
              <div
                class="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 text-xs font-medium text-stone-400 px-1"
              >
                <div>KEY</div>
                <div>VALUE</div>
                <div></div>
              </div>
            {/if}

            <!-- Variables Table -->
            <div class="overflow-y-auto flex-1 pr-1">
              {#if envStore.envPacks.length === 0}
                <div
                  class="flex flex-col items-center justify-center h-full text-center p-4"
                >
                  <p class="text-gray-500">
                    No environment collections have been created.
                  </p>
                </div>
              {:else if envStore.currentEnvPack && envStore.currentEnvPack.vars?.length === 0}
                <div
                  class="flex flex-col items-center justify-center h-full text-center p-4"
                >
                  <p class="text-gray-500">No variables defined</p>
                </div>
              {:else if envStore.currentEnvPack?.vars && envStore.currentEnvPack.vars.length > 0}
                <div class="space-y-1">
                  {#each envStore.currentEnvPack.vars as v, i}
                    <div
                      class="grid grid-cols-[1fr_1fr_auto] gap-2 bg-stone-700 rounded-md p-2 group"
                    >
                      <input
                        bind:value={v.key}
                        class="bg-stone-700 border border-stone-600 focus:border-stone-500 p-1.5 rounded outline-none"
                        placeholder="Key"
                      />
                      <input
                        bind:value={v.value}
                        class="bg-stone-700 border border-stone-600 focus:border-stone-500 p-1.5 rounded outline-none"
                        placeholder="Value"
                      />
                      <button
                        onclick={() => handleDeleteVar(i)}
                        class="p-1.5 hover:bg-stone-600 rounded-md flex items-center justify-center text-stone-400 hover:text-white"
                      >
                        <Trash2 size="0.9em" />
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Add New Variable -->
            {#if envStore.currentEnvPack !== null}
              <div class="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  bind:value={newKey}
                  placeholder="New key"
                  class="bg-stone-700 border border-stone-600 focus:border-stone-500 p-2 rounded outline-none text-sm"
                />
                <input
                  bind:value={newValue}
                  placeholder="New value"
                  class="bg-stone-700 border border-stone-600 focus:border-stone-500 p-2 rounded outline-none text-sm"
                />
                <button
                  onclick={handleAddVar}
                  class="bg-stone-600 hover:bg-stone-500 p-2 rounded-md transition-colors flex items-center justify-center"
                >
                  <Plus size="1.1em" />
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
