<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { editor as EditorType } from "monaco-editor";

  type Props = {
    value: string;
    height: string;
    isPulse?: boolean;
    class?: string;
    options?: EditorType.IStandaloneEditorConstructionOptions;
  };

  let {
    value = $bindable(""),
    height = "100%",
    class: className = "",
    isPulse = $bindable(false),
    options = $bindable({}),
  }: Props = $props();

  let editorContainer: HTMLElement;
  let monaco: typeof import("monaco-editor");
  let editor: EditorType.IStandaloneCodeEditor;

  onMount(async () => {
    // Dynamically import our monaco.ts setup file
    // This ensures it only runs in the browser
    monaco = (await import("../monaco")).default;

    // Create the editor instance
    editor = monaco.editor.create(editorContainer, {
      value,
      language: "editor",
      lineNumbers: "off",
      theme: "stone",
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: "on",
      renderLineHighlightOnlyWhenFocus: true,
      ...options,
    });

    // Set up two-way binding
    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      if (value !== newValue) {
        value = newValue;
      }
    });
  });

  // Update editor when value changes externally
  export function updateEditorValue() {
    if (editor && value !== editor.getValue()) {
      console.log("Updating editor value", value);
      editor.setValue(value);
    }
  }

  // Clean up to prevent memory leaks
  onDestroy(() => {
    if (editor) {
      editor.dispose();
    }
  });
</script>

<div
  bind:this={editorContainer}
  class="rounded-lg {className}"
  class:animate-pulse={isPulse}
  style="width: 100%; height: {height}; padding-top: 8px; background-color: #292524;"
></div>
