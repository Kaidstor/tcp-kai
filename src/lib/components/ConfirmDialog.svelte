<script lang="ts">
  import { Dialog } from "bits-ui";
  import { X, AlertTriangle } from "lucide-svelte";

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    open = $bindable(),
    title,
    message,
    confirmLabel = "Да",
    cancelLabel = "Отмена",
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

<Dialog.Root bind:open onOpenChange={(v) => !v && onCancel()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50 z-40" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-stone-800 text-white rounded p-6 w-full max-w-md z-50 shadow-xl"
    >
      <div class="flex flex-col">
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-shrink-0 text-amber-400">
            <AlertTriangle />
          </div>
          <Dialog.Title class="text-lg font-medium">
            {title}
          </Dialog.Title>
        </div>

        <Dialog.Description class="text-sm text-stone-300 mb-6">
          {message}
        </Dialog.Description>

        <div class="flex justify-end gap-3">
          <button
            onclick={onCancel}
            class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded transition-colors text-sm"
          >
            {cancelLabel}
          </button>
          <button
            onclick={() => {
              onConfirm();
              open = false;
            }}
            class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded transition-colors text-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
