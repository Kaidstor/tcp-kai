<script lang="ts">
  import { DropdownMenu } from "bits-ui";

  export interface Collection {
    id: number;
    name: string;
  }

  interface Props {
    collections: Collection[];
    selected: number | null;
    selectText: string;
    onSelect: (id: number) => void;
    onAdd: () => void;
  }

  const { collections, selected, selectText, onSelect, onAdd }: Props =
    $props();

  let selectedName = $derived(
    collections.find((c) => c.id === selected)?.name || selectText
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="w-full text-left p-2 mb-4 bg-stone-700 hover:bg-stone-600 rounded"
  >
    {selectedName}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-stone-800 border border-stone-700 rounded p-2"
    >
      <div class="rounded overflow-hidden">
        {#each collections as col}
          <DropdownMenu.Item
            onclick={() => onSelect(col.id)}
            class={`p-2 hover:bg-stone-700 text-white ${col.id === selected ? "bg-stone-700" : ""}`}
            >{col.name}</DropdownMenu.Item
          >
        {/each}
      </div>
      <DropdownMenu.Item
        onclick={onAdd}
        class="cursor-pointer p-2 mt-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >+ коллекция</DropdownMenu.Item
      >
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
