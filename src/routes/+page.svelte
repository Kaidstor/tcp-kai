<script lang="ts">
  import {
    getCollections,
    getRequests,
    addCollection as dbAddCollection,
    addRequest as dbAddRequest,
    updateRequest,
    getHistoryList,
    deleteHistory,
    getHistoryItem,
    updateSetting,
    getSetting,
    getEnvPack,
    deleteRequest,
    addHistory as dbAddHistory,
    deleteCollection as dbDeleteCollection,
  } from "$lib/db";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Trash2,
    History,
    FileJson,
    FileOutput,
    Settings,
  } from "lucide-svelte";
  import { DropdownMenu } from "bits-ui";
  import StoneMonacoEditor from "$lib/components/StoneMonacoEditor.svelte";
  import AddRequestDialog from "$lib/components/AddRequestDialog.svelte";
  import AddCollectionDialog from "$lib/components/AddCollectionDialog.svelte";
  import EnvConfigDialog from "$lib/components/EnvConfigDialog.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import CopyButton from "$lib/components/CopyButton.svelte";
  import EnvVarInput from "$lib/components/EnvVarInput.svelte";
  import CommandMenu from "$lib/components/CommandMenu.svelte";
  import type { Collection, RequestItem, EnvVar } from "$lib/types";
  import { processEnvVars } from "$lib/utils";

  let collections: Collection[] = $state([]);
  let selectedCollection: number | null = $state(null);

  let requestEditor: any | null = $state(null);
  let responseEditor: any | null = $state(null);

  let isRequestEditorFocused: boolean = $state(false);
  let isResponseEditorFocused: boolean = $state(false);
  let requestPanelHeight: string = $state("50%");
  let isDragging: boolean = $state(false);

  let requests: RequestItem[] = $state([]);
  let reqSearch = $state("");

  let filteredRequests = $derived(
    reqSearch
      ? requests.filter((r) =>
          r.name.toLowerCase().includes(reqSearch.toLowerCase())
        )
      : requests
  );

  // UI state for editing and sending
  let url: string = $state("");
  let cmd: string = $state("");
  let sendData: string = $state("");
  let receivedData: string = $state("");
  let isSending: boolean = $state(false);
  let statusText: string = $state("Ready");
  let requestTime: number | null = $state(null);

  let selectedRequest: RequestItem | null = $state(null);
  let history: { id: number; timestamp: string; execution_time?: number }[] =
    $state([]);

  // add collection via Dialog component
  let showAddDialog = $state(false);
  function openAdd() {
    showAddDialog = true;
  }
  async function confirmAdd(name: string) {
    if (!name) return;
    const colId = await dbAddCollection(name);

    selectedCollection = colId;
    envPackId = null;

    showAddDialog = false;
  }

  let showEnvConfig = $state(false);
  let envPackId: number | null = $state(null);
  let envLabel: string = $state("no ENV");
  let envVars: EnvVar[] = $state([]);

  async function handleEnvSelect(packId: number | null) {
    envPackId = packId;
    await refreshEnvVars(packId);
    showEnvConfig = false;
  }

  async function refreshEnvVars(packId: number | null) {
    if (packId !== null) {
      const pack = await getEnvPack(packId);

      envVars = pack?.vars ?? [];
      envLabel = pack?.name ?? "no ENV";
    } else {
      envLabel = "no ENV";
    }
  }

  function openEnvConfig() {
    showEnvConfig = true;
  }

  async function closeEnvConfig() {
    showEnvConfig = false;
    // Make sure to refresh environment variables when the dialog is closed
    await refreshEnvVars(envPackId);
  }

  async function selectCollection(colId: number) {
    selectedCollection = colId;
    // Сохраняем выбранную коллекцию в настройках
    await updateSetting("last_collection_id", colId);

    requests = await getRequests(colId);
    // load the pack_id for this collection
    const coll = collections.find((c) => c.id === colId);
    const pid = coll?.pack_id ?? null;
    envPackId = pid;
    await refreshEnvVars(pid);
  }

  // Удаление коллекции
  async function handleDeleteCollection(colId: number) {
    try {
      await dbDeleteCollection(colId);

      // Обновляем список коллекций
      collections = await getCollections();

      // Если удалили текущую коллекцию, выбираем первую доступную
      if (selectedCollection === colId) {
        selectedCollection = collections.length > 0 ? collections[0].id : null;

        if (selectedCollection) {
          await selectCollection(selectedCollection);
        } else {
          // Если коллекций больше нет, очищаем всё
          requests = [];
          selectedRequest = null;
          url = "";
          cmd = "";
          sendData = "";
          receivedData = "";
          history = [];
          statusText = "Ready";
        }
      }
    } catch (error) {
      console.error("Ошибка при удалении коллекции:", error);
      alert("Не удалось удалить коллекцию");
    }
  }

  function selectRequest(req: RequestItem) {
    selectedRequest = req;
    // Сохраняем выбранный запрос в настройках
    updateSetting("last_request_id", req.id);

    url = req.url || "";
    cmd = req.cmd || "";
    sendData = JSON.stringify(JSON.parse(req.body || "{}"), null, 2);
    receivedData = "";
    statusText = "Ready";

    // Загружаем только список истории без полных данных
    getHistoryList(req.id).then((h) => (history = h));
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
      const processedUrl = processEnvVars(url, envVars);
      const processedData = processEnvVars(sendData, envVars);

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

        if (selectedRequest) {
          // Добавляем запись в историю и получаем её ID
          const historyId = await dbAddHistory(
            selectedRequest.id,
            sendData,
            receivedData,
            requestTime
          );

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
    if (selectedRequest) {
      await updateRequest({
        requestId: selectedRequest.id,
        name: selectedRequest.name,
        url: url,
        cmd: cmd,
        body: sendData,
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
  async function confirmAddRequest(data: {
    name: string;
    url: string;
    cmd: string;
    body: string;
  }) {
    if (!selectedCollection) return;
    const newRequestId = await dbAddRequest(
      selectedCollection,
      data.name,
      data.url,
      data.cmd,
      data.body
    );
    requests = await getRequests(selectedCollection);
    showAddReqDialog = false;

    // Find the newly created request and select it
    const newRequest = requests.find((req) => req.id === newRequestId);
    if (newRequest) {
      selectRequest(newRequest);
    }
  }

  // Загрузка полных данных истории при клике на элемент
  async function loadHistoryItem(historyId: number) {
    statusText = "Загрузка...";
    try {
      const item = await getHistoryItem(historyId);
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
      await deleteRequest(requestToDelete);

      // Обновляем список запросов
      if (selectedCollection !== null) {
        requests = await getRequests(selectedCollection);
      }

      // Если удаляемый запрос был выбран, очищаем выбор
      if (selectedRequest && selectedRequest.id === requestToDelete) {
        selectedRequest = null;
        url = "";
        cmd = "";
        sendData = "";
        receivedData = "";
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
      collections = await getCollections();
      if (collections.length === 0) return;

      // Получаем сохраненный ID коллекции
      const lastCollectionId = await getSetting("last_collection_id");
      let colId: number | null = null;

      if (lastCollectionId) {
        colId = parseInt(lastCollectionId);
        // Проверяем, существует ли эта коллекция
        if (!collections.some((c) => c.id === colId)) {
          colId = collections[0]?.id ?? null;
        }
      } else {
        colId = collections[0]?.id ?? null;
      }

      if (colId === null) return;

      // Выбираем коллекцию
      selectedCollection = colId;
      const coll = collections.find((c) => c.id === colId);
      const pid = coll?.pack_id ?? null;
      envPackId = pid;
      await refreshEnvVars(pid);

      // Загружаем запросы этой коллекции
      requests = await getRequests(colId);
      if (requests.length === 0) return;

      // Получаем сохраненный ID запроса
      const lastRequestId = await getSetting("last_request_id");
      let reqId: number | null = null;

      if (lastRequestId) {
        reqId = parseInt(lastRequestId);
        // Проверяем, существует ли этот запрос в текущей коллекции
        if (!requests.some((r) => r.id === reqId)) {
          reqId = requests[0]?.id ?? null;
        }
      } else {
        reqId = requests[0]?.id ?? null;
      }

      if (reqId === null) return;

      // Выбираем запрос
      const req = requests.find((r) => r.id === reqId);
      if (req) {
        selectedRequest = req;
        url = req.url || "";
        cmd = req.cmd || "";
        sendData = JSON.stringify(JSON.parse(req.body || "{}"), null, 2);

        // Загружаем историю
        history = await getHistoryList(reqId);
      }
    } catch (error) {
      console.error("Ошибка восстановления состояния:", error);
    }
  }

  $effect(() => {
    restoreAppState();

    // Add keyboard shortcut listener
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+E (Mac) or Ctrl+E (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        openEnvConfig();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  $effect(() => {
    void selectedRequest;

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
      let percentage = Math.min(
        Math.max((relativeY / containerHeight) * 100, 20),
        80
      );
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

<main class="flex h-screen bg-stone-900 text-white">
  <!-- Sidebar -->
  <aside
    class="w-64 bg-stone-800 border-r border-stone-700 p-4 overflow-y-auto"
  >
    <CommandMenu
      {collections}
      {selectedCollection}
      onSelectCollection={selectCollection}
      onAddCollection={openAdd}
      onOpenEnvConfig={openEnvConfig}
      onDeleteCollection={handleDeleteCollection}
    />

    <h2
      class="text-xl font-semibold mt-6 mb-4 flex items-center justify-between"
    >
      <span>Requests</span>
      <button
        onclick={openAddRequest}
        class="bg-stone-600 hover:bg-stone-500 text-sm px-3 py-1 rounded"
        >+ New</button
      >
    </h2>
    {#if requests.length >= 5}
      <input
        placeholder="Search requests..."
        bind:value={reqSearch}
        class="w-full mb-2 py-1 px-2 bg-stone-700 rounded h-10"
      />
    {/if}
    {#each filteredRequests as req}
      <div
        class="group relative w-full flex items-center hover:bg-stone-600 rounded"
        class:bg-stone-700={req === selectedRequest}
      >
        <button
          class="w-full text-left cursor-pointer p-2 pr-8 flex-grow truncate"
          onclick={() => selectRequest(req)}
          title={req.name}
        >
          {req.name}
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
  </aside>

  {#if selectedRequest}
    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Request Builder -->
      <div
        class={`p-2 bg-stone-800 border-b border-stone-700 grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2`}
      >
        <div class="flex flex-col gap-1">
          <EnvVarInput
            bind:value={url}
            placeholder="Host:Port"
            {envVars}
            className="rounded w-full"
          />
        </div>
        <input
          bind:value={cmd}
          placeholder="CMD"
          class="bg-stone-700 px-2 py-1 rounded"
        />
        <button
          onclick={() => (isSending ? stopQuery() : sendQuery())}
          class="bg-stone-600 hover:bg-stone-500 px-2 py-1 rounded"
        >
          {isSending ? "Stop" : "Send"}
        </button>
        <!-- History Dropdown -->
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            disabled={history.length === 0}
            class="bg-stone-600 hover:bg-stone-500 px-2 py-1 rounded"
          >
            <History size="1.25rem" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              class="bg-stone-800 text-white border border-stone-700 rounded p-2 max-h-64 overflow-y-auto mt-2 min-w-full"
            >
              {#each history as entry}
                <div
                  class="flex justify-between items-center p-2 hover:bg-stone-700 rounded text-sm whitespace-nowrap"
                >
                  <div class="flex-1">
                    <button
                      class="text-sm truncate cursor-pointer hover:text-primary-300 bg-transparent border-none p-0"
                      onclick={() => loadHistoryItem(entry.id)}
                    >
                      {entry.timestamp}
                      {#if entry.execution_time}
                        <span class="mx-2 text-xs text-stone-200">
                          {(entry.execution_time / 1000).toFixed(2)}s
                        </span>
                      {/if}
                    </button>
                  </div>
                  <div class="flex items-center space-x-2">
                    <button
                      onclick={() => {
                        deleteHistory(entry.id).then(() => {
                          // Удаляем запись локально, без повторного запроса к БД
                          history = history.filter(
                            (item) => item.id !== entry.id
                          );
                        });
                      }}
                      class="p-1 hover:bg-stone-600 rounded"
                    >
                      <Trash2 size="1rem" />
                    </button>
                  </div>
                </div>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <!-- Env button -->
        <button
          onclick={openEnvConfig}
          class="bg-stone-600 hover:bg-stone-500 px-4 rounded text-xs whitespace-nowrap"
        >
          {envLabel}
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
            bind:value={sendData}
            height="100%"
            options={{
              language: "json",
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
          <div
            class="absolute inset-x-0 h-[1px] bg-stone-700 hover:bg-stone-600"
          ></div>
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
          />
          {#if !receivedData}
            <div
              class="absolute inset-0 flex flex-col items-center justify-center bg-stone-800 bg-opacity-80 pointer-events-none"
            >
              <FileOutput size="3rem" class="mb-2 text-stone-500" />
              <p class="text-stone-500">Response</p>
            </div>
          {/if}
          <CopyButton
            value={receivedData}
            className="absolute top-2 right-2 bg-stone-600 rounded-md w-8 h-8"
            duration={1000}
          />
        </div>
      </div>

      <!-- Status Bar -->
      <footer
        class="h-8 bg-stone-800 flex items-center px-4 border-t border-stone-700"
      >
        {statusText}
      </footer>
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
  <EnvConfigDialog
    open={showEnvConfig}
    collectionId={selectedCollection}
    bind:currentPackId={envPackId}
    onSelect={handleEnvSelect}
    onCancel={closeEnvConfig}
  />

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
