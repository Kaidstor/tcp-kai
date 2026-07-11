<script lang="ts">
  import { db } from "$lib/db/repositories";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Trash2,
    History,
    FileJson,
    FileOutput,
    SendHorizontal,
    Square,
    Database,
  } from "lucide-svelte";
  import { DropdownMenu } from "bits-ui";
  import ScrollArea from "$lib/components/ScrollArea.svelte";
  import StoneMonacoEditor from "$lib/components/StoneMonacoEditor.svelte";
  import AddRequestDialog from "$lib/components/AddRequestDialog.svelte";
  import AddCollectionDialog from "$lib/components/AddCollectionDialog.svelte";
  import EnvConfigDialog from "$lib/components/EnvConfigDialog.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import EnvVarInput from "$lib/components/EnvVarInput.svelte";
  import CommandMenu from "$lib/components/CommandMenu.svelte";
  import EnvSwitcher from "$lib/components/EnvSwitcher.svelte";
  import type { RequestItem } from "$lib/db/schema";
  import { processEnvVars } from "$lib/utils";
  import { onMount } from "svelte";
  import { createHotkey } from "@tanstack/svelte-hotkeys";
  import UpdaterButton from "$lib/components/UpdaterButton.svelte";
  import { appStore } from "$lib/store/app-store.svelte";
  import { envStore } from "$lib/store/env-store.svelte";
  import { requestStore } from "$lib/store/request-store.svelte";

  let requestEditor: any | null = $state(null);
  let responseEditor: any | null = $state(null);

  let isRequestEditorFocused: boolean = $state(false);
  let isResponseEditorFocused: boolean = $state(false);
  let requestPanelHeight: string = $state("50%");
  let isDragging: boolean = $state(false);

  let reqSearch = $state("");

  let filteredRequests = $derived(
    reqSearch
      ? requestStore.requests.filter((r) =>
          r.name.toLowerCase().includes(reqSearch.toLowerCase()),
        )
      : requestStore.requests,
  );

  // UI state for editing and sending
  let url = $derived(requestStore.currentRequest?.url);
  let cmd = $derived(requestStore.currentRequest?.cmd);
  let sendData = $derived(requestStore.currentRequest?.body);
  let receivedData = $derived(requestStore.currentRequest?.received || "");

  let isSending: boolean = $state(false);
  let statusText: string = $state("Ready");
  let requestTime: number | null = $state(null);

  let history: {
    id: number;
    timestamp: string;
    execution_time?: number | null;
  }[] = $state([]);

  // add collection via Dialog component
  let showAddDialog = $state(false);
  function openAdd() {
    showAddDialog = true;
  }
  async function confirmAdd(name: string) {
    if (!name) return;
    if (appStore.collections.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      return;
    const colId = await db.collections.add(name);

    appStore.collections.push({
      id: colId,
      name: name,
      pack_id: null,
    });

    appStore.setCurrentCollection(colId);
    envStore.setCurrentEnvPack(null);

    showAddDialog = false;
  }

  let showEnvConfig = $state(false);

  function openEnvConfig() {
    showEnvConfig = true;
  }

  async function handleRenameCollection(colId: number, newName: string) {
    if (appStore.collections.some((c) => c.id !== colId && c.name.toLowerCase() === newName.toLowerCase()))
      return;
    await db.collections.rename(colId, newName);
    const col = appStore.collections.find((c) => c.id === colId);
    if (col) col.name = newName;
  }

  // Удаление коллекции
  async function handleDeleteCollection(colId: number) {
    try {
      await db.collections.delete(colId);

      // Обновляем список коллекций
      appStore.deleteCollection(colId);
      requestStore.deleteAllRequests();

      // Если удалили текущую коллекцию, выбираем первую доступную
      if (!appStore.currentCollection) {
        // Если коллекций больше нет, очищаем всё
        url = "";
        cmd = "";
        sendData = "";
        receivedData = "";
        history = [];
        statusText = "Ready";
      }
    } catch (error) {
      console.error("Ошибка при удалении коллекции:", error);
    }
  }

  async function selectRequest(req: RequestItem) {
    requestStore.setCurrentRequest(req.id);
    // Сохраняем выбранный запрос в настройках
    db.settings.updateSetting("last_request_id", req.id);

    url = req.url || "";
    cmd = req.cmd || "";
    statusText = "Ready";

    const latestHistory = await db.history.getLatestByRequest(req.id);
    if (latestHistory) {
      sendData = latestHistory.sent;
      receivedData = latestHistory.received;
      requestTime = latestHistory.execution_time;
    } else {
      sendData = JSON.stringify(JSON.parse(req.body || "{}"), null, 2);
      receivedData = "";
      requestTime = null;
    }

    // Загружаем только список истории без полных данных
    db.history.getListByRequest(req.id).then((h) => (history = h));
  }

  let requestFlags: Record<string, boolean> = {};
  let lastRequestId: string | null = null;

  async function sendQuery() {
    const requestId = Date.now().toString();
    requestFlags[requestId] = true;
    lastRequestId = requestId;
    isSending = true;
    statusText = "Sending...";
    const startTime = performance.now();
    requestTime = null;

    try {
      // Process environment variables in URL and JSON data
      const processedUrl = processEnvVars(url || "", envStore.currentEnvPack?.vars ?? []);
      const processedData = processEnvVars(
        sendData || "",
        envStore.currentEnvPack?.vars ?? [],
      );

      const result = (await invoke("send_tcp_request", {
        connection: processedUrl,
        pattern: cmd,
        json: processedData,
        requestId,
      })) as string;

      if (!requestFlags[requestId]) return;

      const endTime = performance.now();
      requestTime = endTime - startTime;

      const response = JSON.parse(result);
      if (response.ok) {
        const msg = JSON.parse(response.message);
        receivedData = JSON.stringify(msg, null, 2);
        responseEditor?.updateEditorValue();

        statusText = `Done in ${(requestTime / 1000).toFixed(2)}s`;

        if (requestStore.currentRequest) {
          // Добавляем запись в историю и получаем её ID
          const historyId = await db.history.add(
            requestStore.currentRequest.id,
            sendData || "",
            receivedData || "",
            requestTime,
          );

          // Применяем затухание веса ко всем запросам
          await db.requests.decayWeights();

          // Увеличиваем вес использованного запроса (вызывается только для текущего запроса)
          await db.requests.incrementWeight(requestStore.currentRequest.id);

          // Добавляем новую запись в начало списка истории
          history.push({
            id: historyId,
            timestamp: new Date().toLocaleString(),
            execution_time: requestTime,
          });
        }
      } else {
        receivedData = "";
        statusText = `Error in ${(requestTime / 1000).toFixed(2)}s: ${response.message || "Unknown error"}`;
        alert(response.message);
      }
    } catch (error) {
      const endTime = performance.now();
      requestTime = endTime - startTime;
      console.error(error);
      statusText = `Stopped in ${(requestTime / 1000).toFixed(2)}s`;
    } finally {
      delete requestFlags[requestId];
      isSending = Object.keys(requestFlags).length > 0;
    }

    // update the request item
    if (requestStore.currentRequest) {
      await db.requests.updateRequest(requestStore.currentRequest.id, {
        name: requestStore.currentRequest.name,
        url: url || "",
        cmd: cmd || "",
        body: sendData || "",
      });
    }
  }
  function stopQuery() {
    if (lastRequestId) {
      invoke("cancel_tcp_request", { requestId: lastRequestId });
    }

    if (isSending) {
      const endTime = performance.now();
      const startTimestamp = parseInt(lastRequestId || "0");
      if (startTimestamp > 0) {
        requestTime = endTime - startTimestamp;
        statusText = `Stopped in ${(requestTime / 1000).toFixed(2)}s`;
      } else {
        statusText = "Stopped";
      }
    }

    isSending = false;
  }

  // Dialog for new request
  let showAddReqDialog = $state(false);
  // new request state handled in AddRequestDialog component

  function openAddRequest() {
    showAddReqDialog = true;
  }
  async function confirmAddRequest(cmd: string) {
    if (!appStore.currentCollection) return;

    await requestStore.addRequest({
      collection_id: appStore.currentCollection.id,
      name: cmd,
      url: "{{host}}:{{port}}",
      cmd,
      body: "{}",
      received: "",
      weight: null,
    });

    showAddReqDialog = false;
  }

  // Загрузка полных данных истории при клике на элемент
  async function loadHistoryItem(historyId: number) {
    statusText = "Загрузка...";
    try {
      const item = await db.history.findById(historyId);
      if (item) {
        sendData = item.sent || "";
        receivedData = item.received || "";
        requestTime = item.execution_time || null;
        requestEditor?.updateEditorValue();
        responseEditor?.updateEditorValue();

        if (item.execution_time) {
          statusText = `Completed in ${(item.execution_time / 1000).toFixed(2)}s`;
        } else {
          statusText = "Done";
        }
      }
    } catch (error) {
      console.error("Ошибка при загрузке истории:", error);
      statusText = "Ошибка загрузки";
    }
  }

  // Состояние диалога подтверждения удаления
  let showDeleteConfirm = $state(false);
  let requestToDelete = $state<number | null>(null);

  // Функция удаления запроса
  function handleDeleteRequest(e: Event, requestId: number) {
    e.stopPropagation(); // Предотвращаем выбор запроса при клике на кнопку удаления
    requestToDelete = requestId;
    showDeleteConfirm = true;
  }

  // Функция подтверждения удаления
  async function confirmDeleteRequest() {
    if (requestToDelete === null) return;

    try {
      // Используем новый метод с каскадным удалением истории
      await requestStore.deleteRequest(requestToDelete);

      // Если удаляемый запрос был выбран, очищаем выбор
      if (requestStore.currentRequest?.id === requestToDelete) {
        history = [];
        statusText = "Ready";
      }

      // Сбрасываем requestToDelete
      requestToDelete = null;
    } catch (error) {
      console.error("Ошибка при удалении запроса:", error);
      alert("Не удалось удалить запрос");
    }
  }

  // Функция отмены удаления
  function cancelDeleteRequest() {
    showDeleteConfirm = false;
    requestToDelete = null;
  }

  // Восстанавливаем состояние приложения при загрузке
  async function restoreAppState() {
    try {
      // Сначала загружаем все коллекции
      await appStore.init();

      // Выбираем запрос
      const req = requestStore.currentRequest;
      if (req) {
        sendData = JSON.stringify(JSON.parse(req.body || "{}"), null, 2);
        history = await db.history.getListByRequest(req.id);
      }
    } catch (error) {
      console.error("Ошибка восстановления состояния:", error);
    }
  }

  createHotkey("Mod+E", () => openEnvConfig());
  createHotkey("Mod+Enter", () => {
    if (!isSending && requestStore.currentRequest) {
      sendQuery();
    }
  });

  onMount(() => {
    restoreAppState();
  });

  $effect(() => {
    void requestStore.currentRequest;

    requestEditor?.updateEditorValue();
    responseEditor?.updateEditorValue();
  });

  function startDrag(event: MouseEvent) {
    // Prevent default behavior to avoid text selection
    event.preventDefault();

    isDragging = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) return;

      // Prevent default to avoid text selection during drag
      event.preventDefault();

      const container = document.querySelector(".editors-container");
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const containerHeight = containerRect.height;
      const relativeY = event.clientY - containerRect.top;

      // Calculate percentage (keep within 20-80% range)
      let percentage = Math.min(Math.max((relativeY / containerHeight) * 100, 20), 80);
      requestPanelHeight = `${percentage}%`;

      // Update the editors to reflect the new layout
      requestEditor?.updateEditorValue();
      responseEditor?.updateEditorValue();
    };

    const handleMouseUp = () => {
      isDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }
</script>

<main class="flex flex-col h-screen bg-stone-900 text-white">
  <!-- Custom Titlebar -->
  <div
    data-tauri-drag-region
    class="bg-stone-800 border-b border-stone-700 flex items-stretch justify-between shrink-0"
  >
    <div class="flex items-center pl-20 gap-2 h-8">
      <CommandMenu
        onAddCollection={openAdd}
        onOpenEnvConfig={openEnvConfig}
        onDeleteCollection={handleDeleteCollection}
        onRenameCollection={handleRenameCollection}
        onSelectRequest={(requestId) => {
          const req = requestStore.getRequest(requestId);
          if (req) selectRequest(req);
        }}
        onCreateRequest={confirmAddRequest}
        onCreateCollection={confirmAdd}
      />
    </div>
    <div class="flex items-center gap-3 pr-2">
      <!-- Env vars (host/port only) -->
      {#if envStore.currentEnvPack?.vars?.length}
        {@const shown = envStore.currentEnvPack.vars.filter((v) => ['host', 'port'].includes(v.key.toLowerCase()))}
        {#if shown.length}
          <div class="flex gap-1 items-center text-[11px] text-stone-500">
            {#each shown as v}
              <span class="p-0.5 rounded truncate max-w-[120px]" title="{v.key}={v.value}">
                {v.key}=<span class="text-stone-400">{v.value}</span>
              </span>
            {/each}
          </div>
        {/if}
      {/if}
      <!-- History -->
      {#if history.length > 0}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="text-stone-400 hover:text-stone-200 transition-colors"
          >
            <History size="1rem" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              class="bg-stone-800 text-white border border-stone-700 rounded p-2 max-h-64 overflow-y-auto mt-2 min-w-[200px] z-50"
            >
              {#each history as entry}
                <div
                  class="flex justify-between items-center p-2 hover:bg-stone-700 rounded text-sm whitespace-nowrap"
                >
                  <button
                    class="text-sm truncate cursor-pointer hover:text-primary-300 bg-transparent border-none p-0 flex-1 text-left"
                    onclick={() => loadHistoryItem(entry.id)}
                  >
                    {entry.timestamp}
                    {#if entry.execution_time}
                      <span class="mx-2 text-xs text-stone-200">
                        {(entry.execution_time / 1000).toFixed(2)}s
                      </span>
                    {/if}
                  </button>
                  <button
                    onclick={() => {
                      db.history.delete(entry.id).then(() => {
                        history = history.filter((item) => item.id !== entry.id);
                      });
                    }}
                    class="p-1 hover:bg-stone-600 rounded ml-2"
                  >
                    <Trash2 size="0.8rem" />
                  </button>
                </div>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
      <!-- Env switcher -->
      <EnvSwitcher onOpenSettings={openEnvConfig} />
    </div>
  </div>

  {#if !appStore.currentCollection}
    <div class="flex-1 flex flex-col items-center justify-center gap-4 text-stone-400">
      <Database size="3rem" class="text-stone-600" />
      <p class="text-lg">Выберите или создайте коллекцию</p>
      <p class="text-sm text-stone-500">
        <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-stone-700 text-stone-300 rounded">⌘P</kbd>
        — выбрать коллекцию
      </p>
    </div>
  {:else}
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar -->
    <aside
      class="w-64 bg-stone-800 border-r border-stone-700 flex flex-col h-full relative"
    >
      <div class="p-2">
        <h2 class="text-xl font-semibold mb-4 flex items-center justify-between">
          <span>Requests</span>
          <button
            onclick={openAddRequest}
            class="bg-stone-600 hover:bg-stone-500 text-sm px-3 py-1 rounded">+</button
          >
        </h2>
      </div>

      <div class="px-2">
        <input
          placeholder="Search requests..."
          bind:value={reqSearch}
          class="w-full py-1 px-2 bg-stone-700 rounded h-10"
        />
      </div>
      <ScrollArea class="flex-1 overflow-y-auto pb-2">
        {#each filteredRequests as req}
          <div
            class="group relative w-full flex items-center hover:bg-stone-600 rounded"
            class:bg-stone-700={req.id === requestStore.currentRequest?.id}
          >
            <button
              class="w-full text-left cursor-pointer p-2 pr-8 flex-grow truncate"
              onclick={() => selectRequest(req)}
              title={req.name}
            >
              {req.name}
              {#if req.weight && req.weight > 0}
                <span class="text-xs text-stone-400 ml-2">({req.weight})</span>
              {/if}
            </button>
            <button
              class="p-1 hover:text-red-500 absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity"
              onclick={(e) => handleDeleteRequest(e, req.id)}
              title="Удалить запрос"
            >
              <Trash2 size="0.9rem" />
            </button>
          </div>
        {/each}
      </ScrollArea>

      <!-- Add UpdaterButton at the bottom of the sidebar -->
      <UpdaterButton />
    </aside>

    {#if requestStore.currentRequest}
      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Request Builder -->
        <div
          class={`p-2 bg-stone-800 border-b border-stone-700 grid grid-cols-[1fr_1fr_auto] gap-2`}
        >
          <div class="flex flex-col gap-1">
            <EnvVarInput
              bind:value={url!}
              placeholder="Host:Port"
              envVars={envStore.currentEnvPack?.vars ?? []}
              className="w-full"
            />
          </div>
          <input bind:value={cmd} placeholder="CMD" class="bg-stone-700 px-2 py-1" />
          <button
            onclick={() => (isSending ? stopQuery() : sendQuery())}
            class="bg-stone-700 hover:bg-stone-500 px-2 py-1"
          >
            {#if isSending}
              <Square size="1rem" color="var(--color-red-500)" />
            {:else}
              <SendHorizontal size="1rem" />
            {/if}
          </button>
        </div>

        <div class="flex flex-col flex-1 overflow-hidden editors-container">
          <!-- Body Editor -->
          <div
            class="overflow-hidden flex flex-col relative"
            style="height: {requestPanelHeight};"
          >
            <StoneMonacoEditor
              bind:this={requestEditor}
              bind:isFocused={isRequestEditorFocused}
              bind:value={sendData!}
              height="100%"
              options={{
                language: "json",
              }}
              onSendRequest={() => {
                if (!isSending && requestStore.currentRequest) {
                  sendQuery();
                }
              }}
            />
            {#if !sendData && !isRequestEditorFocused}
              <div
                class="absolute inset-0 flex flex-col items-center justify-center bg-stone-800 bg-opacity-80 pointer-events-none"
              >
                <FileJson size="3rem" class="mb-2 text-stone-500" />
                <p class="text-stone-500">Request Body</p>
              </div>
            {/if}
          </div>

          <!-- Resizable handle -->
          <div
            role="button"
            tabindex="0"
            class="h-3 relative cursor-ns-resize flex items-center bg-stone-800"
            onmousedown={startDrag}
          >
            <div class="absolute inset-x-0 h-[1px] bg-stone-700 hover:bg-stone-600"></div>
          </div>

          <!-- Response Viewer -->
          <div
            class="flex-1 overflow-hidden flex flex-col relative @container/response"
            style="height: calc(100% - {requestPanelHeight} - 4px);"
          >
            <StoneMonacoEditor
              bind:this={responseEditor}
              bind:value={receivedData}
              bind:isFocused={isResponseEditorFocused}
              height="100%"
              isPulse={statusText === "Sending..."}
              options={{
                readOnly: true,
                language: "json",
              }}
              onSendRequest={() => {
                if (!isSending && requestStore.currentRequest) {
                  sendQuery();
                }
              }}
            />
            {#if !receivedData}
              <div
                class="absolute inset-0 flex flex-col items-center justify-center bg-stone-800 bg-opacity-80 pointer-events-none"
              >
                <FileOutput size="3rem" class="mb-2 text-stone-500" />
                <p class="text-stone-500">Response</p>
              </div>
            {/if}
          </div>
        </div>

        <!-- Status Bar -->
        <footer
          class="h-8 text-stone-400 text-sm bg-stone-800 flex items-center justify-end px-4 border-t border-stone-700"
        >
          {statusText}
        </footer>
      </div>
    {/if}
  </div>
  {/if}

  <!-- Add Collection Dialog Component -->
  <AddCollectionDialog
    open={showAddDialog}
    onConfirm={confirmAdd}
    onCancel={() => (showAddDialog = false)}
  />

  <!-- Add Request Dialog Component -->
  <AddRequestDialog
    open={showAddReqDialog}
    onConfirm={confirmAddRequest}
    onCancel={() => (showAddReqDialog = false)}
  />

  <!-- Env Config Dialog -->
  <EnvConfigDialog bind:open={showEnvConfig} />

  <!-- Confirm Dialog -->
  <ConfirmDialog
    bind:open={showDeleteConfirm}
    title="Удаление запроса"
    message="Вы уверены, что хотите удалить этот запрос? Вся история запроса будет удалена без возможности восстановления."
    confirmLabel="Удалить"
    cancelLabel="Отмена"
    onConfirm={confirmDeleteRequest}
    onCancel={cancelDeleteRequest}
  />
</main>
