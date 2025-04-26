<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { Copy, Check } from "lucide-svelte";

  interface CopyButtonProps {
    value: string;
    duration?: number;
    className?: string;
  }

  let { value, duration = 1500, className = "" }: CopyButtonProps = $props();

  let state: "idle" | "copied" = $state("idle");
  let timer: ReturnType<typeof setTimeout>;

  function handleClick() {
    writeText(value);
    state = "copied";
    clearTimeout(timer);
    timer = setTimeout(() => (state = "idle"), duration);
  }
</script>

<button onclick={handleClick} class={className} aria-live="polite">
  {#if state === "copied"}
    <Check class="w-4 h-4 inline-block animate-bounce" />
  {:else}
    <Copy class="w-4 h-4 inline-block" />
  {/if}
</button>
