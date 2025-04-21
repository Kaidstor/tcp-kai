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

  let search = $state("");

  let filtered = $derived(
    collections.length >= 5 && search
      ? collections.filter((c) =>
          c.name.toLowerCase().includes(search.toLowerCase())
        )
      : collections
  );

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
      <DropdownMenu.Item
        onclick={onAdd}
        class="cursor-pointer p-2 mb-2 bg-stone-600 hover:bg-stone-500 text-white rounded font-medium"
        >+ Добавить коллекцию</DropdownMenu.Item
      >
      {#if collections.length >= 5}
        <input
          placeholder="Поиск..."
          bind:value={search}
          class="w-full mb-2 p-1 bg-stone-700 rounded"
        />
      {/if}
      {#each filtered as col}
        <DropdownMenu.Item
          onclick={() => onSelect(col.id)}
          class={`p-2 rounded hover:bg-stone-700 text-white ${col.id === selected ? "bg-stone-700" : ""}`}
          >{col.name}</DropdownMenu.Item
        >
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
