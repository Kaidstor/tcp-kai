<script lang="ts">
  interface Props {
    value: string;
    placeholder: string;
    envVars: { key: string; value: string }[];
    className: string;
  }

  let { value = $bindable(), placeholder, envVars, className }: Props = $props();

  let inputElement: HTMLInputElement | null = $state(null);
  let showSuggestions = $state(false);

  let cursorPosition = $derived(() => inputElement?.selectionStart || 0);

  let filteredSuggestions: string[] = $state([]);
  let activeVarMatch: { start: number; end: number; key: string } | null = $state(null);
  let selectedSuggestionIndex: number = $state(0);

  let processedValue = $derived(highlightEnvVars(value, envVars));

  // Reset selected suggestion index when filtered suggestions change
  $effect(() => {
    if (filteredSuggestions.length > 0) {
      selectedSuggestionIndex = 0;
    }
  });

  // Function to highlight env vars in the input
  function highlightEnvVars(text: string, vars: { key: string; value: string }[]) {
    const keys = vars.map((v) => v.key);
    let result = [];
    let lastIndex = 0;

    // Regular expression to find {{var}} patterns
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push({
          type: "text",
          content: text.substring(lastIndex, match.index),
        });
      }

      // Add the matched variable
      const varName = match[1];
      result.push({
        type: "var",
        content: match[0],
        name: varName,
        exists: keys?.includes(varName),
      });

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining text
    if (lastIndex < text.length) {
      result.push({
        type: "text",
        content: text.substring(lastIndex),
      });
    }

    return result;
  }

  function handleInput(e: Event) {
    value = (e.target as HTMLInputElement).value;
    checkForSuggestions();
  }

  function handleFocus() {
    checkForSuggestions();
  }

  function handleBlur() {
    // Small delay to allow clicking on suggestions
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }

  function checkForSuggestions() {
    // Check if we're inside a variable declaration
    let openBracePos = -1;
    let closeBracePos = -1;
    let partialVar = "";

    const cursorPos = cursorPosition();

    const leftText = value.substring(0, cursorPos);
    const rightText = value.substring(cursorPos);

    // Find the last opening {{ before cursor
    const lastOpenBrace = leftText.lastIndexOf("{{");
    if (lastOpenBrace !== -1) {
      // Find the next closing }} after the opening {{
      const nextCloseBrace = leftText.indexOf("}}", lastOpenBrace);

      // If we have an opening {{ without a closing }} before the cursor
      if (nextCloseBrace === -1) {
        // Check if there's a closing }} after the cursor
        const closingAfterCursor = rightText.indexOf("}}");

        if (closingAfterCursor !== -1) {
          // We're inside a var declaration
          openBracePos = lastOpenBrace;
          closeBracePos = cursorPos + closingAfterCursor + 2;
          partialVar = value.substring(openBracePos + 2, closeBracePos - 2);
        } else {
          // We have an opening {{ but no closing }} anywhere
          openBracePos = lastOpenBrace;
          partialVar = value.substring(openBracePos + 2, cursorPos);
        }
      }
      // If we have a complete {{ }} but cursor is inside it
      else if (cursorPos > lastOpenBrace && cursorPos <= nextCloseBrace + 2) {
        openBracePos = lastOpenBrace;
        closeBracePos = nextCloseBrace + 2;
        partialVar = value.substring(openBracePos + 2, closeBracePos - 2);
      }
    }

    if (openBracePos !== -1) {
      // We're in a variable context, show suggestions
      const varKeys = envVars.map((v) => v.key);
      filteredSuggestions = varKeys.filter((key) =>
        key.toLowerCase().includes(partialVar.toLowerCase()),
      );

      activeVarMatch = {
        start: openBracePos,
        end: closeBracePos > 0 ? closeBracePos : cursorPos,
        key: partialVar,
      };

      showSuggestions = filteredSuggestions.length > 0;
    } else {
      activeVarMatch = null;
      showSuggestions = false;
    }
  }

  function insertSuggestion(suggestion: string) {
    if (!activeVarMatch) return;

    const beforeVar = value.substring(0, activeVarMatch.start);
    const afterVar =
      activeVarMatch.end >= value.length ? "" : value.substring(activeVarMatch.end);

    value = `${beforeVar}{{${suggestion}}}${afterVar}`;
    showSuggestions = false;

    // Set focus back to input and position cursor after inserted var
    inputElement?.focus();
    const newPosition = activeVarMatch.start + suggestion.length + 4; // +4 for {{ and }}
    setTimeout(() => {
      inputElement?.setSelectionRange(newPosition, newPosition);
    }, 0);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle suggestion navigation with arrow keys
    if (showSuggestions) {
      if (e.key === "ArrowDown") {
        selectedSuggestionIndex = Math.min(
          selectedSuggestionIndex + 1,
          filteredSuggestions.length - 1,
        );
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
        e.preventDefault();
      } else if (e.key === "Enter" && filteredSuggestions.length > 0) {
        insertSuggestion(filteredSuggestions[selectedSuggestionIndex]);
        e.preventDefault();
      } else if (e.key === "Escape") {
        showSuggestions = false;
        e.preventDefault();
      }
    }
  }
</script>

<div class="relative">
  <!-- Actual input (invisible but functional) -->
  <input
    bind:this={inputElement}
    {placeholder}
    {value}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    class="bg-stone-700 p-2 w-full {className} text-transparent caret-white selection:bg-stone-600"
  />

  <!-- Visual overlay for highlighting -->
  <div
    class="absolute top-0 left-0 right-0 bottom-0 pointer-events-none p-2 flex items-center whitespace-pre overflow-hidden"
  >
    {#each processedValue as part}
      {#if part.type === "text"}
        <span class="text-white">{part.content}</span>
      {:else}
        <span
          class={part.exists
            ? "text-yellow-400"
            : "text-yellow-400 border-b-2 border-red-500"}
        >
          {part.content}
        </span>
      {/if}
    {/each}
  </div>

  {#if showSuggestions && activeVarMatch}
    <div
      class="absolute left-0 mt-1 w-full max-h-40 overflow-y-auto bg-stone-700 shadow-lg z-10"
    >
      {#each filteredSuggestions as suggestion, i}
        <button
          class={`block w-full text-left px-3 py-2 hover:bg-stone-600 ${i === selectedSuggestionIndex ? "bg-stone-600" : ""}`}
          onmousedown={() => insertSuggestion(suggestion)}
          onmouseover={() => (selectedSuggestionIndex = i)}
        >
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}
</div>
