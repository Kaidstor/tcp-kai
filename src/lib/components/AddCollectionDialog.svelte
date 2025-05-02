<script lang="ts">
  import { Dialog, Separator } from "bits-ui";
  import { X } from "lucide-svelte";

  interface Props {
    open: boolean;
    onConfirm: (name: string) => void;
    onCancel: () => void;
  }

  let { open = $bindable(false), onConfirm, onCancel }: Props = $props();

  let name = $state("");

  function handleConfirm() {
    onConfirm(name);
    name = "";
  }

  function handleClose() {
    name = "";
    onCancel();
  }
</script>

<Dialog.Root bind:open onOpenChange={(val) => !val && handleClose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50 z-40" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-stone-800 text-white rounded p-6 w-4/5 max-w-lg z-50"
    >
      <Dialog.Title class="text-lg font-semibold mb-2"
        >Новая коллекция</Dialog.Title
      >
      <Separator.Root class="mb-4" />
      <input
        bind:value={name}
        placeholder="Название коллекции"
        class="w-full bg-stone-700 p-2 rounded mb-4"
      />
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
