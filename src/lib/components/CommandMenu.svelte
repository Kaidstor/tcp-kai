<script lang="ts">
  import { Command, Dialog } from "bits-ui";
  import {
    Search,
    Database,
    Settings,
    Plus,
    Trash2,
    ChevronLeft,
  } from "lucide-svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import type { Collection } from "$lib/types";
  import { onMount, onDestroy, tick } from "svelte";
  import { appStore } from "$lib/store/app-store.svelte";

  interface Props {
    onAddCollection: () => void;
    onOpenEnvConfig: () => void;
    onDeleteCollection?: (id: number) => void;
  }

  const { onAddCollection, onOpenEnvConfig, onDeleteCollection }: Props =
    $props();

  let dialogOpen = $state(false);
  let searchValue = $state("");
  let confirmDeleteOpen = $state(false);
  let collectionToDelete = $state<number | null>(null);
  let highlightedItem = $state("");
  let commandWrapperEl: HTMLElement | null = null;

  // Режимы работы Command меню
  type MenuMode = "collections" | "actions";
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

  // Проверяет текущий выделенный элемент через DOM
  function getSelectedCommandItem(): string | null {
    if (!commandWrapperEl) return null;

    // Ищем элемент с атрибутом data-selected
    const selectedItem = commandWrapperEl.querySelector("[data-selected]");
    if (!selectedItem) {
      console.log("No selected item found");
      return null;
    }

    // Пытаемся получить value из атрибутов
    let value = selectedItem.getAttribute("data-value");

    // Если нет data-value, пробуем получить value из другого элемента
    if (!value) {
      // Ищем вложенный элемент Command.Item, который должен содержать value
      const parent = selectedItem.closest(".command-item");
      if (parent) {
        value = parent.getAttribute("data-value");
      }

      // Если всё ещё нет, пробуем получить ID из текста
      if (!value) {
        // Ищем элемент коллекции по его тексту
        const collectionItems =
          commandWrapperEl.querySelectorAll(".command-item");

        // Находим именно выделенный элемент среди всех
        for (const item of collectionItems) {
          if (item.contains(selectedItem)) {
            // Получаем имя коллекции из текстового содержимого
            const collectionName = item.textContent?.trim();

            // Находим коллекцию по имени
            const collection = appStore.collections.find(
              (c) => c.name === collectionName
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

  // Обработка глобальной горячей клавиши для открытия меню
  function handleGlobalCmdK(e: KeyboardEvent) {
    if (e.key === "k" && (e.metaKey || e.ctrlKey) && !dialogOpen) {
      e.preventDefault();
      dialogOpen = true;
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalCmdK);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleGlobalCmdK);
  });

  // Обработчик для клавиш внутри Command
  async function handleCommandKeydown(e: KeyboardEvent) {
    console.log("Command keydown captured:", e.key, "meta:", e.metaKey);

    // Если мы в режиме коллекций
    if (currentMode === "collections") {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();

        // Даем время для обновления DOM перед проверкой выделенного элемента
        await tick();

        // Получаем выделенный элемент непосредственно из DOM
        const selectedValue = getSelectedCommandItem();
        console.log("Selected value from DOM:", selectedValue);

        if (selectedValue && selectedValue.startsWith("select-collection-")) {
          const collectionId = parseInt(
            selectedValue.replace("select-collection-", "")
          );
          const collection = appStore.collections.find(
            (c) => c.id === collectionId
          );

          if (collection) {
            showCollectionActions(collection);
          } else {
            console.log("Collection not found for ID:", collectionId);
          }
        } else {
          console.log("No valid selected item found in DOM");
        }
      }
    }
    // Если мы в режиме действий
    else if (currentMode === "actions" && currentTarget) {
      // Esc для возврата в основное меню
      if (e.key === "Escape") {
        e.preventDefault();
        resetSearch();
        return;
      }

      // Env shortcut: ⌘E
      if (e.key === "e" && e.metaKey && currentTarget.isSelected) {
        e.preventDefault();
        onOpenEnvConfig();
        resetSearch();
        dialogOpen = false;
        return;
      }

      // Delete shortcut: ⌘⌫
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        e.metaKey &&
        onDeleteCollection
      ) {
        e.preventDefault();
        openDeleteConfirm(currentTarget.id);
        return;
      }
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

    console.log("Collection actions:", actions);

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
    // Если мы в режиме коллекций
    if (currentMode === "collections") {
      // Проверяем, какое действие было выбрано
      if (value === "add-collection") {
        onAddCollection();
        dialogOpen = false;
      } else if (value.startsWith("select-collection-")) {
        // Сразу выбираем коллекцию (основное действие при Enter)
        const collectionId = parseInt(value.replace("select-collection-", ""));
        appStore.setCurrentCollection(collectionId);
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
    // Переключаемся в режим действий
    currentMode = "actions";
    searchValue = ""; // Сбрасываем поисковую строку
  }

  function getSelectedCollectionName() {
    const selected = appStore.collections.find(
      (c) => c.id === appStore.currentCollection?.id
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
    currentTarget = null;
  }

  // Обработчик изменения состояния Command
  function handleStateChange(state: any) {
    console.log("Command state changed:", state);
    if (state && state.selectedValue !== undefined) {
      highlightedItem = state.selectedValue;
      console.log("Highlighted item changed to:", highlightedItem);
    }
  }
</script>

<div>
  <button
    onclick={toggleDialog}
    class="flex items-center gap-2 px-3 py-2 bg-stone-700 hover:bg-stone-600 rounded-md text-white transition-colors"
  >
    <Database class="w-4 h-4" />
    <span class="truncate max-w-[150px]">{getSelectedCollectionName()}</span>
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
                placeholder={currentMode === "collections"
                  ? "Поиск коллекций..."
                  : "Поиск действий..."}
                class="h-10 py-2 w-full bg-stone-800 text-white focus:outline-none"
              />
            </div>

            <Command.List class="max-h-[300px] overflow-y-auto p-1">
              <Command.Empty class="py-6 text-center text-sm text-stone-400">
                {currentMode === "collections"
                  ? "Коллекции не найдены"
                  : "Нет доступных действий"}
              </Command.Empty>

              <!-- Группа коллекций (видна в режиме collections) -->
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
                      <span class="text-xs text-stone-500"
                        >{action.shortcut}</span
                      >
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

              <!-- Группа глобальных действий (видна в режиме collections) -->
              <Command.Group
                class={currentMode !== "collections" ? "hidden" : ""}
              >
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

              <!-- Группа действий с коллекцией (видна в режиме actions) -->
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

  /* Скрываем неактивные группы */
  .hidden {
    display: none;
  }
</style>
