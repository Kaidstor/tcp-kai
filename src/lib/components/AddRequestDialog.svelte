<script lang="ts">
  import { Dialog, Separator, Label } from "bits-ui";
  import { X, Tag, Server, Terminal } from "lucide-svelte";

  export let open: boolean;
  export let onConfirm: (data: {
    name: string;
    url: string;
    cmd: string;
    body: string;
  }) => void;
  export let onCancel: () => void;

  let name = "";
  let url = "";
  let cmd = "";
  let body = "";

  function handleConfirm() {
    onConfirm({ name, url, cmd, body });
    name = url = cmd = body = "";
  }

  function handleClose() {
    name = url = cmd = body = "";
    onCancel();
  }
</script>

<Dialog.Root bind:open onOpenChange={(v) => !v && handleClose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50 z-40" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-stone-800 text-white rounded p-6 w-4/5 max-w-xl z-50"
    >
      <Dialog.Title class="text-lg font-semibold mb-4"
        >Новый запрос</Dialog.Title
      >
      <Separator.Root class="mb-4" />
      <div class="flex flex-col space-y-4 mb-4">
        <div class="flex flex-col gap-2">
          <!-- <Label.Root for="reqName">Name</Label.Root> -->
          <div class="relative">
            <input
              id="reqName"
              bind:value={name}
              placeholder="Name"
              class="w-full bg-stone-700 p-2 rounded pr-8"
            />
            <Tag
              class="absolute right-2 top-1/2 transform -translate-y-1/2 text-stone-400"
            />
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <!-- <Label.Root for="reqUrl">Host:Port</Label.Root> -->
          <div class="relative">
            <input
              id="reqUrl"
              bind:value={url}
              placeholder="Host:Port"
              class="w-full bg-stone-700 p-2 rounded pr-8"
            />
            <Server
              class="absolute right-2 top-1/2 transform -translate-y-1/2 text-stone-400"
            />
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <!-- <Label.Root for="reqCmd">CMD</Label.Root> -->
          <div class="relative">
            <input
              id="reqCmd"
              bind:value={cmd}
              placeholder="CMD"
              class="w-full bg-stone-700 p-2 rounded pr-8"
            />
            <Terminal
              class="absolute right-2 top-1/2 transform -translate-y-1/2 text-stone-400"
            />
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <!-- <Label.Root for="reqBody">Body</Label.Root> -->
          <textarea
            id="reqBody"
            bind:value={body}
            placeholder="Body"
            class="w-full bg-stone-700 p-2 rounded h-24"
          ></textarea>
        </div>
      </div>
      <div class="flex justify-end space-x-2">
        <button
          onclick={handleConfirm}
          class="bg-stone-600 hover:bg-stone-500 px-4 py-2 rounded"
          >Создать</button
        >
        <button
          onclick={handleClose}
          class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded"
          >Отмена</button
        >
      </div>
      <Dialog.Close
        class="absolute top-2 right-2 p-1 hover:bg-stone-700 rounded z-50"
        onclick={handleClose}
      >
        <X class="w-5 h-5" />
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
