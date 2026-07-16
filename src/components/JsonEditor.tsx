// CodeMirror JSON editor used for both panes (request body, response). The
// Svelte build used Monaco; CodeMirror is what the sql-kai reference uses and
// it carries a fraction of the bundle.
import { json } from "@codemirror/lang-json";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useApp } from "../lib/store";
import { editorThemes, themeById } from "../lib/themes";
import { cn } from "./ui";

export function JsonEditor({
  value,
  onChange,
  readOnly = false,
  /** Fired on ⌘/Ctrl+Enter from inside the editor. */
  onSend,
  /** Watermark shown while the pane is empty. */
  placeholder,
  /** Response pane breathes while a request is in flight. */
  pulse = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onSend?: () => void;
  placeholder?: ReactNode;
  pulse?: boolean;
}) {
  const themeId = useApp((s) => s.settings.theme);
  const light = themeById(themeId).light;

  const extensions = useMemo(
    () => [
      json(),
      // Prec.highest so it beats CodeMirror's own Mod-Enter (insert blank line)
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onSend?.();
              return true; // handled — no newline gets inserted
            },
          },
        ]),
      ),
    ],
    [onSend],
  );

  return (
    <div className={cn("relative h-full", pulse && "animate-pulse")}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        className="h-full"
        theme={light ? editorThemes.light : editorThemes.dark}
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          searchKeymap: false,
        }}
      />
      {!value && placeholder && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600">
          {placeholder}
        </div>
      )}
    </div>
  );
}
