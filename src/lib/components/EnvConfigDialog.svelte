<script lang="ts">
  import { Dialog } from "bits-ui";
  import {
    X,
    Plus,
    Trash2,
    ChevronDown,
    Check,
    RotateCcw,
    Save,
    Database,
    Edit2,
  } from "lucide-svelte";
  import InputDialog from "./InputDialog.svelte";
  import {
    getEnvPacks,
    addEnvPack,
    deleteEnvPack,
    getEnvPack,
    updateEnvPack,
    updateEnvPackName,
    updateCollectionPack,
  } from "$lib/db";
  import type { EnvPack, EnvVar } from "$lib/types";
  export let open: boolean;
  export let collectionId: number | null;
  export let onSelect: (packId: number | null) => void;
  export let onCancel: () => void;

  let packs: EnvPack[] = [];
  let selectedPack: number | null = null;
  let newPackName = "";
  let isEditingPackName = false;
  let editedPackName = "";

  // Track original and edited variables
  let originalVars: EnvVar[] = [];
  let vars: EnvVar[] = [];
  let hasChanges: boolean = false;

  // New variable input
  let newKey = "";
  let newValue = "";

  function handleAddPackConfirm(name: string) {
    if (name) {
      addEnvPack(name);
      loadPacks();
    }
  }

  async function loadPacks() {
    const dbPacks = await getEnvPacks();
    packs = [...dbPacks];
    if (packs.length > 0) {
      selectedPack = packs[0].id;
    } else {
      selectedPack = null;
    }
    await loadVars();
  }

  async function loadVars() {
    if (selectedPack === null) {
      originalVars = [];
      vars = [];
      return;
    }
    const pack = await getEnvPack(selectedPack);
    originalVars = pack?.vars ? [...pack.vars] : [];
    vars = pack?.vars ? [...pack.vars] : [];
    hasChanges = false;
  }

  function resetVars() {
    vars = [...originalVars];
    hasChanges = false;
  }

  // Check if there are unsaved changes
  $: hasChanges = JSON.stringify(vars) !== JSON.stringify(originalVars);

  async function handleDeletePack(id: number) {
    await deleteEnvPack(id);
    if (selectedPack === id) selectedPack = null;
    await loadPacks();
  }

  function startEditingPackName() {
    if (selectedPack === null) return;
    const currentPack = packs.find((p) => p.id === selectedPack);
    if (currentPack) {
      editedPackName = currentPack.name;
      isEditingPackName = true;
    }
  }

  async function savePackName() {
    if (selectedPack === null || !editedPackName.trim()) return;
    await updateEnvPackName(selectedPack, editedPackName.trim());
    isEditingPackName = false;
    await loadPacks();
  }

  async function handleAddVar() {
    if (!newKey) return;
    vars = [...vars, { key: newKey, value: newValue }];
    newKey = "";
    newValue = "";
  }

  function handleUpdateVar(
    index: number,
    field: "key" | "value",
    value: string
  ) {
    const updatedVars = [...vars];
    updatedVars[index][field] = value;
    vars = updatedVars;
  }

  async function handleDeleteVar(idx: number) {
    vars = vars.filter((_, i) => i !== idx);
  }

  async function saveChanges() {
    if (selectedPack !== null) {
      await updateEnvPack(selectedPack, vars);
      originalVars = [...vars];
      hasChanges = false;
    }
  }

  async function activatePack() {
    if (collectionId !== null && selectedPack !== null) {
      try {
        // First, save any changes to variables
        if (hasChanges) {
          await saveChanges();
        }

        // Update the collection's pack reference
        await updateCollectionPack(collectionId, selectedPack);

        // Notify parent about selection first
        onSelect(selectedPack);

        // Set dialog to closed state directly
        open = false;
      } catch (error) {
        console.error("Error activating environment pack:", error);
      }
    }
  }

  function cancel() {
    // First, reset any editing states
    isEditingPackName = false;

    // Call the cancel handler from parent
    onCancel();
  }

  $: if (open) loadPacks();
</script>

<Dialog.Root bind:open onOpenChange={(v) => !v && cancel()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50" />
    <Dialog.Content
      class="fixed p-0 bg-stone-800 text-white rounded-lg w-[800px] h-[600px] max-w-[95vw] max-h-[90vh] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 shadow-xl overflow-hidden flex flex-col"
    >
      <div class="bg-stone-700 p-4 border-b border-stone-600">
        <Dialog.Title
          class="text-lg font-semibold flex items-center justify-between h-8"
        >
          <span>Переменные окружения</span>
          <div class="space-x-2">
            {#if hasChanges}
              <button
                onclick={resetVars}
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
            {#if selectedPack !== null}
              <button
                onclick={activatePack}
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md transition-colors text-sm inline-flex items-center space-x-1"
              >
                <Check size="0.9em" />
                <span>Применить</span>
              </button>
            {/if}
          </div>
        </Dialog.Title>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left sidebar: Packs -->
        <div class="w-68 border-r border-stone-700 p-4 flex flex-col h-full">
          <h3 class="text-sm font-medium text-stone-300 mb-2">
            Environment Packs
          </h3>

          <InputDialog
            title="Добавить пак переменных"
            label="Название пака"
            placeholder="Введите название пака"
            buttonText="Добавить"
            onConfirm={handleAddPackConfirm}
          >
            <Dialog.Trigger
              class="flex w-full items-center justify-center space-x-1 p-2 bg-stone-700 hover:bg-stone-600 rounded-md mb-3 transition-colors text-sm"
            >
              <Plus size="0.9em" />
              <span>Добавить пак</span>
            </Dialog.Trigger>
          </InputDialog>

          <div class="overflow-y-auto flex-1">
            <div class="space-y-1">
              {#each packs as pack}
                <button
                  onclick={() => (selectedPack = pack.id)}
                  class="w-full text-left p-2 rounded-md transition-colors flex justify-between items-center group {selectedPack ===
                  pack.id
                    ? 'bg-stone-600'
                    : 'hover:bg-stone-700'}"
                >
                  <span class="truncate font-medium text-sm">{pack.name}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <!-- Right content: Variables Table -->
        <div class="flex-1 flex flex-col h-full">
          <div class="p-4 flex-1 overflow-hidden flex flex-col gap-4">
            <div class="flex justify-between items-center h-8">
              <h3
                class="font-medium text-stone-300 mb-2 flex gap-2 items-center"
              >
                <Database size="1.1em" class="text-stone-400" />
                {#if packs.length > 0}
                  {#if isEditingPackName && selectedPack !== null}
                    <input
                      bind:value={editedPackName}
                      class="bg-stone-700 border border-stone-600 focus:border-stone-500 px-2 py-1 rounded outline-none text-sm"
                      placeholder="Pack name"
                      onkeydown={(e) => e.key === "Enter" && savePackName()}
                    />
                  {:else}
                    {packs.find((p) => p.id === selectedPack)?.name ||
                      "No Pack Selected"}
                  {/if}
                {:else}
                  No environment packs
                {/if}
              </h3>

              {#if selectedPack !== null}
                <div class="flex gap-2">
                  {#if isEditingPackName}
                    <button
                      onclick={savePackName}
                      class="p-1 hover:bg-green-600 rounded-md text-green-400 hover:text-white"
                    >
                      <Save size="1rem" />
                    </button>
                  {:else}
                    <button
                      onclick={startEditingPackName}
                      class="p-1 hover:bg-stone-600 rounded-md text-stone-400 hover:text-white"
                    >
                      <Edit2 size="1rem" />
                    </button>
                  {/if}
                  <button
                    onclick={(e) => {
                      e.stopPropagation();
                      handleDeletePack(selectedPack!);
                    }}
                    class="p-1 hover:bg-red-600 rounded-md text-red-400 hover:text-white"
                  >
                    <Trash2 size="1rem" />
                  </button>
                </div>
              {/if}
            </div>

            <!-- Table Header -->
            {#if packs.length > 0}
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
              {#if packs.length === 0}
                <div
                  class="flex flex-col items-center justify-center h-full text-center p-4"
                >
                  <p class="text-gray-500">
                    No environment collections have been created.
                  </p>
                </div>
              {:else if selectedPack !== null && vars.length === 0}
                <div
                  class="flex flex-col items-center justify-center h-full text-center p-4"
                >
                  <p class="text-gray-500">No variables defined</p>
                </div>
              {:else if selectedPack !== null && vars.length > 0}
                <div class="space-y-1">
                  {#each vars as v, i}
                    <div
                      class="grid grid-cols-[1fr_1fr_auto] gap-2 bg-stone-700 rounded-md p-2 group"
                    >
                      <input
                        value={v.key}
                        oninput={(e) =>
                          handleUpdateVar(
                            i,
                            "key",
                            (e.target as HTMLInputElement).value
                          )}
                        class="bg-stone-700 border border-stone-600 focus:border-stone-500 p-1.5 rounded outline-none"
                        placeholder="Key"
                      />
                      <input
                        value={v.value}
                        oninput={(e) =>
                          handleUpdateVar(
                            i,
                            "value",
                            (e.target as HTMLInputElement).value
                          )}
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
            {#if selectedPack !== null}
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
