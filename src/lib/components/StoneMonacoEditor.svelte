<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { editor as EditorType } from "monaco-editor";

  type Props = {
    value: string;
    height: string;
    isPulse?: boolean;
    isFocused?: boolean;
    class?: string;
    options?: EditorType.IStandaloneEditorConstructionOptions;
    onSendRequest?: () => void;
  };

  let {
    value = $bindable(""),
    isFocused = $bindable(false),
    height = "100%",
    class: className = "",
    isPulse = $bindable(false),
    options = $bindable({}),
    onSendRequest = $bindable(() => {}),
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

    // Add keyboard shortcut handler
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onSendRequest();
    });

    // Add cmd+p handler to open command menu (bypass Monaco's event capture)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      window.dispatchEvent(new CustomEvent("openCommandMenu"));
    });

    // Set up two-way binding
    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      if (value !== newValue) {
        value = newValue;
      }
    });

    // Focus and blur events
    editor.onDidFocusEditorText(() => {
      isFocused = true;
    });

    editor.onDidBlurEditorText(() => {
      isFocused = false;
    });
  });

  // Update editor when value changes externally
  export function updateEditorValue() {
    if (editor && value !== editor.getValue()) {
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
  class={className}
  class:animate-pulse={isPulse}
  style="width: 100%; height: {height}; padding-top: 8px; background-color: #292524;"
></div>
