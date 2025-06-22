<script lang="ts">
  import { ScrollArea } from "bits-ui";

  let { children, class: className }: { children: any; class: string } = $props();
</script>

<ScrollArea.Root
  class="border-dark-10 bg-background-alt shadow-card relative overflow-hidden px-2 py-2 {className}"
>
  <ScrollArea.Viewport class="h-full w-full [&>div]:min-w-full!">
    {@render children()}
  </ScrollArea.Viewport>
  <ScrollArea.Scrollbar
    orientation="vertical"
    class="bg-muted hover:bg-dark-10 data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out-0 data-[state=visible]:fade-in-0 flex w-2.5 touch-none select-none rounded-full border-l border-l-transparent p-px transition-all duration-200 hover:w-3"
  >
    <ScrollArea.Thumb class="bg-muted-foreground flex-1 rounded-full" />
  </ScrollArea.Scrollbar>
  <ScrollArea.Scrollbar
    orientation="horizontal"
    class="bg-muted hover:bg-dark-10 flex h-2.5 touch-none select-none rounded-full border-t border-t-transparent p-px transition-all duration-200 hover:h-3 "
  >
    <ScrollArea.Thumb class="bg-muted-foreground rounded-full" />
  </ScrollArea.Scrollbar>
  <ScrollArea.Corner />
</ScrollArea.Root>
