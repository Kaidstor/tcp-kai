<script lang="ts">
  import { ScrollArea } from "bits-ui";
  import { exportToXLSX } from "../lib/utils";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import CollectionDropdown from "../lib/components/CollectionDropdown.svelte";
  import { onMount } from "svelte";
  import {
    getCollections,
    addCollection as dbAddCollection,
    getHistory,
    deleteHistory,
    getRequests,
    addRequest as dbAddRequest,
    addHistory as dbAddHistory,
    getEnvPack,
  } from "$lib/db";
  import type {
    HistoryEntry,
    RequestItem,
    Collection,
    EnvVar,
  } from "$lib/types";
  import { DropdownMenu } from "bits-ui";
  import { History, Trash2, X } from "lucide-svelte";
  import AddCollectionDialog from "$lib/components/AddCollectionDialog.svelte";
  import AddRequestDialog from "$lib/components/AddRequestDialog.svelte";
  import CopyButton from "$lib/components/CopyButton.svelte";
  import EnvConfigDialog from "$lib/components/EnvConfigDialog.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import StoneMonacoEditor from "$lib/components/StoneMonacoEditor.svelte";

  let requestEditor: any | null = $state(null);
  let responseEditor: any | null = $state(null);

  // reactive application state
  let collections: Collection[] = $state([]);
  let selectedCollection: number | null = $state(null);

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

  let selectedRequest: RequestItem | null = $state(null);
  let history: HistoryEntry[] = $state([]);

  // add collection via Dialog component
  let showAddDialog = $state(false);
  function openAdd() {
    showAddDialog = true;
  }
  async function confirmAdd(name: string) {
    if (!name) return;
    await dbAddCollection(name);
    collections = await getCollections();
    selectedCollection = collections[collections.length - 1]?.id;
    showAddDialog = false;
  }

  let showEnvConfig = $state(false);
  let envPackId: number | null = $state(null);
  let envLabel: string = $state("no ENV");
  let envVars: EnvVar[] = $state([]);

  async function handleEnvSelect(packId: number | null) {
    envPackId = packId;
    let varsArr: EnvVar[] = [];
    if (packId !== null) {
      const pack = await getEnvPack(packId);
      varsArr = pack?.vars ?? [];
    }
    envLabel = varsArr.length ? varsArr.map((e) => e.key).join(", ") : "no ENV";
    showEnvConfig = false;
  }
  function openEnvConfig() {
    showEnvConfig = true;
  }

  async function selectCollection(colId: number) {
    selectedCollection = colId;
    requests = await getRequests(colId);
    // load the pack_id for this collection
    const coll = collections.find((c) => c.id === colId);
    const pid = coll?.pack_id ?? null;
    envPackId = pid;
    let varsArr: EnvVar[] = [];
    if (pid !== null) {
      const pack = await getEnvPack(pid);
      varsArr = pack?.vars ?? [];
    }
    envLabel = varsArr.length ? varsArr.map((e) => e.key).join(", ") : "no ENV";
  }

  function selectRequest(req: RequestItem) {
    selectedRequest = req;

    url = req.url || "";
    cmd = req.cmd || "";
    sendData = JSON.stringify(JSON.parse(req.body || "{}"), null, 2);
    receivedData = "";
    statusText = "Ready";
    // load history for this request
    getHistory(req.id).then((h) => (history = h));
  }

  let requestFlags: Record<string, boolean> = {};
  let lastRequestId: string | null = null;

  async function sendQuery() {
    const requestId = Date.now().toString();
    requestFlags[requestId] = true;
    lastRequestId = requestId;
    isSending = true;
    statusText = "Sending...";

    try {
      const result = (await invoke("send_tcp_request", {
        connection: url,
        pattern: cmd,
        json: sendData,
        requestId,
      })) as string;

      if (!requestFlags[requestId]) return;

      const response = JSON.parse(result);
      if (response.ok) {
        const msg = JSON.parse(response.message);
        receivedData = JSON.stringify(msg, null, 2);
        responseEditor?.updateEditorValue();

        statusText = "Done";
        // save to history
        if (selectedRequest) {
          await dbAddHistory(selectedRequest.id, sendData, receivedData);
          history = await getHistory(selectedRequest.id);
        }
      } else {
        receivedData = "";
        statusText = response.message || "Error";
        alert(response.message);
      }
    } catch (error) {
      console.error(error);
      statusText = "Stopped";
    } finally {
      delete requestFlags[requestId];
      isSending = Object.keys(requestFlags).length > 0;
    }
  }
  function stopQuery() {
    if (lastRequestId) {
      invoke("cancel_tcp_request", { requestId: lastRequestId });
    }
    isSending = false;
    statusText = "Stopped";
  }

  // copy/export functions
  function copyText(text: string) {
    writeText(text);
  }
  function exportData(data: string) {
    try {
      exportToXLSX(JSON.parse(data));
    } catch {
      exportToXLSX([]);
    }
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
    await dbAddRequest(
      selectedCollection,
      data.name,
      data.url,
      data.cmd,
      data.body
    );
    requests = await getRequests(selectedCollection);
    showAddReqDialog = false;
  }

  onMount(async () => {
    collections = await getCollections();
    const first = collections[0];
    const firstId = first?.id ?? null;
    if (firstId !== null) {
      await selectCollection(firstId);
    }
  });
</script>

<main class="flex h-screen bg-stone-900 text-white">
  <!-- Sidebar -->
  <aside
    class="w-64 bg-stone-800 border-r border-stone-700 p-4 overflow-y-auto"
  >
    <CollectionDropdown
      {collections}
      selected={selectedCollection}
      selectText="Выберите коллекцию"
      onSelect={selectCollection}
      onAdd={openAdd}
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
        class="w-full mb-2 p-1 bg-stone-700 rounded"
      />
    {/if}
    {#each filteredRequests as req}
      <button
        class="w-full text-left cursor-pointer p-2 mb-2 rounded hover:bg-stone-700"
        class:bg-stone-700={req === selectedRequest}
        onclick={() => selectRequest(req)}>{req.name}</button
      >
    {/each}
  </aside>

  {#if selectedRequest}
    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Request Builder -->
      <div
        class={`p-4 border-b border-stone-700 grid ${history.length > 0 ? "grid-cols-[1fr_1fr_auto_auto_auto]" : "grid-cols-[1fr_1fr_auto_auto]"} gap-4`}
      >
        <input
          bind:value={url}
          placeholder="Host:Port"
          class="bg-stone-800 p-2 rounded"
        />
        <input
          bind:value={cmd}
          placeholder="CMD"
          class="bg-stone-800 p-2 rounded"
        />
        <button
          onclick={() => (isSending ? stopQuery() : sendQuery())}
          class="bg-stone-600 hover:bg-stone-500 px-4 rounded"
        >
          {isSending ? "Stop" : "Send"}
        </button>
        {#if history.length > 0}
          <!-- History Dropdown -->
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="bg-stone-600 hover:bg-stone-500 p-2 rounded"
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
                        onclick={() => {
                          sendData = entry.sent || "";
                          receivedData = entry.received || "";
                          console.log("Updating editors");
                          console.log(requestEditor);
                          console.log(responseEditor);
                          requestEditor?.updateEditorValue();
                          responseEditor?.updateEditorValue();
                        }}
                      >
                        {entry.timestamp}
                      </button>
                    </div>
                    <div class="flex items-center space-x-2">
                      <button
                        onclick={() => {
                          deleteHistory(entry.id).then(() =>
                            getHistory(selectedRequest!.id).then(
                              (h) => (history = h)
                            )
                          );
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
        {/if}
        <!-- Env button -->
        <button
          onclick={openEnvConfig}
          class="bg-stone-600 hover:bg-stone-500 px-4 rounded text-xs whitespace-nowrap"
        >
          {envLabel}
        </button>
      </div>

      <div class="flex flex-col gap-4 flex-1 overflow-hidden p-4">
        <!-- Body Editor -->
        <div class="flex-1 overflow-hidden rounded-lg flex flex-col">
          <h3 class="font-semibold mb-2">Request Body</h3>
          <StoneMonacoEditor
            bind:this={requestEditor}
            bind:value={sendData}
            height="calc(100% - 24px)"
            options={{
              language: "json",
            }}
          />
        </div>

        <!-- Response Viewer -->
        <div
          class="flex-1 overflow-hidden rounded-lg flex flex-col @container/response min-h-0"
        >
          <h3 class="font-semibold mb-2">Response</h3>
          <StoneMonacoEditor
            bind:this={responseEditor}
            bind:value={receivedData}
            height="calc(100% - 24px)"
            isPulse={statusText === "Sending..."}
            options={{
              readOnly: true,
              language: "json",
            }}
          />
          <CopyButton
            value={receivedData}
            className="absolute top-10 right-2 bg-stone-600 rounded-md w-8 h-8"
            duration={1000}
          />
        </div>
      </div>

      <!-- Status Bar -->
      <footer class="h-8 bg-stone-800 flex items-center px-4">
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
    onSelect={handleEnvSelect}
    onCancel={() => (showEnvConfig = false)}
  />
</main>
