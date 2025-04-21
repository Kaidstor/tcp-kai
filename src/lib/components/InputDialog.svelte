<script lang="ts">
  import { Dialog } from "bits-ui";
  import { X } from "lucide-svelte";

  export let title = "Введите значение";
  export let label = "Значение";
  export let placeholder = "";
  export let buttonText = "Сохранить";
  export let value = "";
  export let onConfirm = (value: string) => {};

  // Local copy of value to avoid modifying parent's value before confirmation
  let tempValue = "";

  // Update tempValue when dialog opens
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) {
      tempValue = value;
    }
  }

  function handleConfirm() {
    onConfirm(tempValue);
    tempValue = "";
  }
</script>

<Dialog.Root onOpenChange={handleOpenChange}>
  <slot />
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-black/50" />
    <Dialog.Content
      class="fixed p-0 bg-stone-800 text-white rounded-lg w-[400px] max-w-[95vw] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] shadow-xl overflow-hidden flex flex-col"
    >
      <div class="bg-stone-700 p-4 border-b border-stone-600">
        <Dialog.Title class="text-lg font-semibold">
          {title}
        </Dialog.Title>
      </div>

      <div class="p-6 space-y-4">
        <div>
          <label class="block mb-2 text-sm font-medium text-stone-300"
            >{label}</label
          >
          <input
            bind:value={tempValue}
            {placeholder}
            class="w-full p-2.5 bg-stone-700 rounded-md border border-stone-600 text-sm focus:ring-1 focus:ring-stone-500 outline-none"
            on:keydown={(e) => e.key === "Enter" && handleConfirm()}
          />
        </div>

        <div class="flex justify-end space-x-3 pt-4">
          <Dialog.Close
            class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-md transition-colors text-sm"
          >
            Отмена
          </Dialog.Close>
          <Dialog.Close
            class="px-4 py-2 bg-stone-600 hover:bg-stone-500 rounded-md transition-colors text-sm font-medium"
            onclick={handleConfirm}
          >
            {buttonText}
          </Dialog.Close>
        </div>
      </div>

      <Dialog.Close
        class="absolute top-3 right-3 p-1.5 hover:bg-stone-600 rounded-md transition-colors text-stone-400 hover:text-white"
      >
        <X size="1.15em" />
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
