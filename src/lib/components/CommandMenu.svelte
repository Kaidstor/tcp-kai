<script lang="ts">
  import { Command, Dialog } from "bits-ui";
  import { Search, Database, Settings, Plus, Trash2, ChevronLeft, Pencil } from "lucide-svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import type { Collection } from "$lib/db/schema";
  import { onMount, onDestroy, tick } from "svelte";
  import { appStore } from "$lib/store/app-store.svelte";
  import { requestStore } from "$lib/store/request-store.svelte";
  import { createHotkey } from "@tanstack/svelte-hotkeys";

  interface Props {
    onAddCollection: () => void;
    onOpenEnvConfig: () => void;
    onDeleteCollection?: (id: number) => void;
    onRenameCollection?: (id: number, name: string) => void;
    onSelectRequest?: (requestId: number) => void;
    onCreateRequest?: (cmd: string) => void;
    onCreateCollection?: (name: string) => void;
  }

  const {
    onAddCollection,
    onOpenEnvConfig,
    onDeleteCollection,
    onRenameCollection,
    onSelectRequest,
    onCreateRequest,
    onCreateCollection,
  }: Props = $props();

  let dialogOpen = $state(false);
  let searchValue = $state("");
  let searchText = $state("");
  let confirmDeleteOpen = $state(false);
  let collectionToDelete = $state<number | null>(null);
  let highlightedItem = $state("");
  let commandWrapperEl: HTMLElement | null = null;

  // Режимы работы Command меню
  type MenuMode = "collections" | "actions" | "requests" | "rename";
  let currentMode = $state<MenuMode>("collections");

  // Raycast-like actions
  type Action = {
    id: string;
    name: string;
    shortcut: string;
    icon: any;
    action: () => void;
    danger?: boolean;
  };

  type ActionTarget = {
    id: number;
    name: string;
    isSelected: boolean;
  };

  let currentTarget = $state<ActionTarget | null>(null);
  let renameTarget = $state<ActionTarget | null>(null);

  function getSelectedCommandItem(): string | null {
    if (!commandWrapperEl) return null;

    const selectedItem = commandWrapperEl.querySelector("[data-selected]");
    if (!selectedItem) return null;

    let value = selectedItem.getAttribute("data-value");

    if (!value) {
      const parent = selectedItem.closest(".command-item");
      if (parent) {
        value = parent.getAttribute("data-value");
      }

      if (!value) {
        const collectionItems = commandWrapperEl.querySelectorAll(".command-item");
        for (const item of collectionItems) {
          if (item.contains(selectedItem)) {
            const collectionName = item.textContent?.trim();
            const collection = appStore.collections.find(
              (c) => c.name === collectionName,
            );
            if (collection) {
              value = `select-collection-${collection.id}`;
            }
            break;
          }
        }
      }
    }

    return value;
  }

  // Глобальные хоткеи через @tanstack/svelte-hotkeys
  createHotkey("Mod+P", () => {
    if (!dialogOpen) {
      currentMode = "collections";
      dialogOpen = true;
    }
  });

  createHotkey("Mod+K", async () => {
    if (!dialogOpen) {
      currentMode = "requests";
      dialogOpen = true;
    } else if (currentMode === "collections") {
      await tick();
      const selectedValue = getSelectedCommandItem();
      if (selectedValue?.startsWith("select-collection-")) {
        const collectionId = parseInt(selectedValue.replace("select-collection-", ""));
        const collection = appStore.collections.find((c) => c.id === collectionId);
        if (collection) showCollectionActions(collection);
      }
    }
  });

  createHotkey(
    "Mod+E",
    () => {
      onOpenEnvConfig();
      resetSearch();
      dialogOpen = false;
    },
    () => ({
      enabled: dialogOpen && currentMode === "actions" && !!currentTarget?.isSelected,
    }),
  );

  createHotkey(
    "Mod+Backspace",
    () => {
      if (currentTarget && onDeleteCollection) {
        openDeleteConfirm(currentTarget.id);
      }
    },
    () => ({
      enabled: dialogOpen && currentMode === "actions" && !!currentTarget,
    }),
  );

  // Обработчик кастомного события от Monaco (Monaco перехватывает клавиатурные события)
  function handleOpenCommandMenu() {
    if (!dialogOpen) {
      currentMode = "collections";
      dialogOpen = true;
    }
  }

  function handleOpenCommandMenuRequests() {
    if (!dialogOpen) {
      currentMode = "requests";
      dialogOpen = true;
    }
  }

  onMount(() => {
    window.addEventListener("openCommandMenu", handleOpenCommandMenu);
    window.addEventListener("openCommandMenuRequests", handleOpenCommandMenuRequests);
  });

  onDestroy(() => {
    window.removeEventListener("openCommandMenu", handleOpenCommandMenu);
    window.removeEventListener("openCommandMenuRequests", handleOpenCommandMenuRequests);
  });

  // Escape в режиме actions/rename — возврат (element-level, чтобы опередить Dialog)
  function handleCommandKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (currentMode === "rename") {
        e.preventDefault();
        e.stopPropagation();
        renameTarget = null;
        if (currentTarget) {
          currentMode = "actions";
          searchText = "";
        } else {
          resetSearch();
        }
      } else if (currentMode === "actions") {
        e.preventDefault();
        e.stopPropagation();
        resetSearch();
      }
    }
    if (currentMode === "rename" && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const newName = searchText.trim();
      if (newName && renameTarget && onRenameCollection) {
        if (!appStore.collections.some((c) => c.id !== renameTarget!.id && c.name.toLowerCase() === newName.toLowerCase())) {
          onRenameCollection(renameTarget.id, newName);
        }
      }
      renameTarget = null;
      resetSearch();
      dialogOpen = false;
    }
  }

  function getCollectionActions(collection: ActionTarget): Action[] {
    const actions: Action[] = [
      {
        id: "open",
        name: "Открыть коллекцию",
        shortcut: "↵",
        icon: Database,
        action: () => {
          appStore.setCurrentCollection(collection.id);
          resetSearch();
          dialogOpen = false;
        },
      },
    ];

    if (collection.isSelected) {
      actions.push({
        id: "env",
        name: "Настроить переменные окружения",
        shortcut: "⌘E",
        icon: Settings,
        action: () => {
          onOpenEnvConfig();
          resetSearch();
          dialogOpen = false;
        },
      });
    }

    if (onRenameCollection) {
      actions.push({
        id: "rename",
        name: "Переименовать",
        shortcut: "",
        icon: Pencil,
        action: () => {
          renameTarget = collection;
          currentMode = "rename";
          searchText = collection.name;
        },
      });
    }

    if (onDeleteCollection) {
      actions.push({
        id: "delete",
        name: "Удалить коллекцию",
        shortcut: "⌘⌫",
        icon: Trash2,
        action: () => {
          openDeleteConfirm(collection.id);
          resetSearch();
        },
        danger: true,
      });
    }

    return actions;
  }

  function toggleDialog() {
    dialogOpen = !dialogOpen;
    resetSearch();
  }

  function handleSelect(value: string) {
    if (currentMode === "collections") {
      if (value === "add-collection") {
        onAddCollection();
        dialogOpen = false;
      } else if (value === "create-collection") {
        const name = searchText.trim();
        if (name && onCreateCollection) {
          onCreateCollection(name);
          resetSearch();
          dialogOpen = false;
        }
      } else if (value.startsWith("select-collection-")) {
        const collectionId = parseInt(value.replace("select-collection-", ""));
        appStore.setCurrentCollection(collectionId);
        dialogOpen = false;
      }
    }
    // Если мы в режиме запросов
    else if (currentMode === "requests") {
      if (value === "create-request") {
        const cmd = searchText.trim();
        if (cmd && onCreateRequest) {
          onCreateRequest(cmd);
          resetSearch();
          dialogOpen = false;
        }
      } else if (value.startsWith("select-request-")) {
        const requestId = parseInt(value.replace("select-request-", ""));
        onSelectRequest?.(requestId);
        resetSearch();
        dialogOpen = false;
      }
    }
    // Если мы в режиме действий
    else if (currentMode === "actions") {
      if (value === "back") {
        // Возвращаемся к режиму коллекций
        resetSearch();
      } else if (currentTarget) {
        // Выполняем действие
        const actions = getCollectionActions(currentTarget);
        const action = actions.find((a) => a.id === value);
        if (action) {
          action.action();
        }
      }
    }
  }

  function showCollectionActions(collection: Collection) {
    currentTarget = {
      id: collection.id,
      name: collection.name,
      isSelected: collection.id === appStore.currentCollection?.id,
    };
    currentMode = "actions";
    searchValue = "";
    searchText = "";
  }

  function getSelectedCollectionName() {
    const selected = appStore.collections.find(
      (c) => c.id === appStore.currentCollection?.id,
    );
    return selected ? selected.name : "Выберите коллекцию";
  }

  function openDeleteConfirm(id: number) {
    collectionToDelete = id;
    confirmDeleteOpen = true;
  }

  function confirmDeleteCollection() {
    if (collectionToDelete !== null && onDeleteCollection) {
      onDeleteCollection(collectionToDelete);
      confirmDeleteOpen = false;
      collectionToDelete = null;
      currentMode = "collections";
    }
  }

  function cancelDeleteCollection() {
    confirmDeleteOpen = false;
    collectionToDelete = null;
  }

  function resetSearch() {
    currentMode = "collections";
    searchValue = "";
    searchText = "";
    currentTarget = null;
    renameTarget = null;
  }

  // Обработчик изменения состояния Command
  function handleStateChange(state: any) {
    if (state && state.selectedValue !== undefined) {
      highlightedItem = state.selectedValue;
    }
  }
</script>

<div>
  <button
    onclick={toggleDialog}
    class="flex items-center gap-1.5 px-2 py-1 hover:bg-stone-600 rounded text-xs text-stone-300 transition-colors outline-none"
  >
    <span class="truncate">{getSelectedCollectionName()}</span>
  </button>

  <Dialog.Root bind:open={dialogOpen}>
    <Dialog.Portal>
      <Dialog.Overlay
        class="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <Dialog.Content
        class="fixed left-[50%] top-[12%] z-50 w-[90vw] max-w-[450px] translate-x-[-50%] rounded-lg shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]"
      >
        <div
          class="command-wrapper"
          role="menu"
          tabindex="-1"
          onkeydown={handleCommandKeydown}
          bind:this={commandWrapperEl}
        >
          <Command.Root
            class="rounded-lg border border-stone-700 bg-stone-800 shadow-lg overflow-hidden"
            bind:value={searchValue}
            onValueChange={(value) => (searchValue = value)}
            onStateChange={handleStateChange}
          >
            <div class="flex items-center px-3 border-b border-stone-700">
              <Search class="w-4 h-4 mr-2 text-stone-400" />
              <Command.Input
                bind:value={searchText}
                placeholder={currentMode === "collections"
                  ? "Поиск коллекций..."
                  : currentMode === "requests"
                    ? "Поиск запросов (cmd)..."
                    : currentMode === "rename"
                      ? "Новое имя коллекции..."
                      : "Поиск действий..."}
                class="h-10 py-2 w-full bg-stone-800 text-white focus:outline-none"
              />
            </div>

            <Command.List class="max-h-[300px] overflow-y-auto p-1">
              {#if currentMode === "rename"}
                <div class="px-3 py-4 text-sm text-stone-400">
                  Введите новое имя и нажмите <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-stone-700 rounded">↵</kbd>
                </div>
              {:else}

              {#if currentMode === "actions"}
                <Command.Empty class="py-6 text-center text-sm text-stone-400">
                  Нет доступных действий
                </Command.Empty>
              {/if}

              <!-- Группа коллекций (видна в режиме collections и actions) -->
              {#if currentMode !== "requests"}
                <Command.Group>
                  <Command.GroupHeading
                    class="px-2 py-1.5 text-xs font-semibold text-stone-400"
                  >
                    {currentMode === "collections" ? "Коллекции" : "Действия"}
                  </Command.GroupHeading>
                  {#if currentTarget}
                    {#each getCollectionActions(currentTarget) as action}
                      {@const Component = action.icon}

                      <Command.Item
                        value={action.id}
                        onSelect={() => handleSelect(action.id)}
                        class="flex w-full items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                        data-action-id={action.id}
                      >
                        <div class="flex items-center gap-2">
                          <Component
                            class={`w-4 h-4 ${action.danger ? "text-red-400" : "text-stone-400"}`}
                          />
                          <span class={action.danger ? "text-red-400" : ""}>
                            {action.name}
                          </span>
                        </div>
                        <span class="text-xs text-stone-500">{action.shortcut}</span>
                      </Command.Item>
                    {/each}
                    <Command.Item
                      value="back"
                      onSelect={() => resetSearch()}
                      class="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                    >
                      <ChevronLeft class="w-4 h-4 text-stone-400" />
                      Назад
                    </Command.Item>
                  {:else}
                    {#each appStore.collections as collection}
                      <Command.Item
                        value={`select-collection-${collection.id}`}
                        onSelect={() =>
                          handleSelect(`select-collection-${collection.id}`)}
                        class="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 group command-item"
                        keywords={[collection.name]}
                        data-collection-id={collection.id}
                      >
                        <Database class="w-4 h-4 text-stone-400" />
                        <span class="flex-1 truncate">{collection.name}</span>

                        {#if collection.id === appStore.currentCollection?.id}
                          <span
                            class="px-1.5 py-0.5 text-xs rounded bg-stone-700 text-stone-300"
                          >
                            Текущая
                          </span>
                        {/if}

                        <kbd
                          class="hidden group-data-selected:flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono text-stone-400 bg-stone-700 rounded"
                        >
                          ⌘K
                        </kbd>
                      </Command.Item>
                    {/each}
                  {/if}
                </Command.Group>

                <!-- Отдельная группа для создания коллекции (forceMount чтобы не скрывалась фильтром) -->
                {#if currentMode === "collections" && searchText.trim() && onCreateCollection && !appStore.collections.some((c) => c.name.toLowerCase() === searchText.trim().toLowerCase())}
                  <Command.Group forceMount>
                    <Command.Item
                      value="create-collection"
                      onSelect={() => handleSelect("create-collection")}
                      class="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                      forceMount
                    >
                      <Plus class="w-4 h-4 text-stone-400" />
                      <span>Создать коллекцию <strong>"{searchText.trim()}"</strong></span>
                    </Command.Item>
                  </Command.Group>
                {/if}
              {/if}

              <!-- Группа запросов (видна в режиме requests) -->
              {#if currentMode === "requests"}
                <Command.Group>
                  <Command.GroupHeading
                    class="px-2 py-1.5 text-xs font-semibold text-stone-400"
                  >
                    Запросы
                  </Command.GroupHeading>
                  {#each requestStore.requests as req}
                    <Command.Item
                      value={`select-request-${req.id}`}
                      onSelect={() => handleSelect(`select-request-${req.id}`)}
                      class="flex items-center justify-between px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                      keywords={[req.name]}
                    >
                      <div class="flex flex-col flex-1 min-w-0">
                        <span class="truncate">{req.name}</span>
                        {#if req.cmd && req.cmd !== req.name}
                          <span class="text-xs text-stone-500 truncate">{req.cmd}</span>
                        {/if}
                      </div>
                      {#if req.id === requestStore.currentRequest?.id}
                        <span
                          class="px-1.5 py-0.5 text-xs rounded bg-stone-700 text-stone-300 ml-2 shrink-0"
                        >
                          Текущий
                        </span>
                      {/if}
                    </Command.Item>
                  {/each}
                  {#if searchText.trim() && onCreateRequest}
                    <Command.Item
                      value="create-request"
                      onSelect={() => handleSelect("create-request")}
                      class="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                      forceMount
                    >
                      <Plus class="w-4 h-4 text-stone-400" />
                      <span>Создать команду <strong>"{searchText.trim()}"</strong></span>
                    </Command.Item>
                  {/if}
                </Command.Group>
              {/if}

              <!-- Группа глобальных действий (видна в режиме collections) -->
              {#if currentMode === "collections"}
                <Command.Group>
                  <Command.GroupHeading
                    class="px-2 py-1.5 text-xs font-semibold text-stone-400"
                  >
                    Действия
                  </Command.GroupHeading>
                  <Command.Item
                    value="add-collection"
                    onSelect={() => handleSelect("add-collection")}
                    class="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-stone-700 data-selected:bg-stone-700 command-item"
                    data-action="add-collection"
                  >
                    <Plus class="w-4 h-4 text-stone-400" />
                    <span>Добавить коллекцию</span>
                  </Command.Item>
                </Command.Group>
              {/if}

              <!-- Группа действий с коллекцией (видна в режиме actions) -->
              {/if}<!-- /rename else -->
            </Command.List>
          </Command.Root>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  <!-- Используем существующий ConfirmDialog -->
  <ConfirmDialog
    bind:open={confirmDeleteOpen}
    title="Удаление коллекции"
    message="Вы уверены, что хотите удалить эту коллекцию? Все запросы и история этой коллекции будут удалены без возможности восстановления."
    confirmLabel="Удалить"
    cancelLabel="Отмена"
    onConfirm={confirmDeleteCollection}
    onCancel={cancelDeleteCollection}
  />
</div>

<style>
  /* Фиксируем проблему с z-index для обработки клавиатурных событий */
  .command-wrapper {
    position: relative;
    z-index: 60;
  }
</style>
