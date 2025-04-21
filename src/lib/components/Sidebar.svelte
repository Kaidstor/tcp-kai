<script lang="ts">
  export let collections: string[];
  export let selectedCollection: string;
  export let onSelectCollection: (col: string) => void;
  export let requests: any[];
  export let selectedRequest: any;
  export let onSelectRequest: (req: any) => void;
</script>

<aside class="w-64 bg-gray-100 border-r p-4 overflow-y-auto">
  <h2 class="text-xl font-semibold mb-4">Collections</h2>
  {#each collections as col}
    <button
      class="cursor-pointer p-2 mb-2 rounded hover:bg-gray-200"
      class:bg-gray-200={col === selectedCollection}
      onclick={() => onSelectCollection(col)}
    >
      {col}
    </button>
  {/each}

  <h2 class="text-xl font-semibold mt-6 mb-4">Requests</h2>
  {#each requests as req}
    <button
      class="cursor-pointer p-2 mb-2 rounded hover:bg-gray-200"
      class:bg-gray-200={req === selectedRequest}
      onclick={() => onSelectRequest(req)}
    >
      {req.name}
    </button>
  {/each}
</aside>
