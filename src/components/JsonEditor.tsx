// CodeMirror JSON editor used for both panes (request body, response). The
// Svelte build used Monaco; CodeMirror is what the sql-kai reference uses and
// it carries a fraction of the bundle.
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { envVarsExtension } from "../lib/cmVars";
import { jsonTargetAt } from "../lib/jsonPath";
import type { JsonTarget } from "../lib/jsonPath";
import { useApp } from "../lib/store";
import { editorThemes, themeById } from "../lib/themes";
import type { EnvVar } from "../lib/types";
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
  /** Подсветка `{{vars}}` против этого списка (редактор тела). */
  vars,
  /** Подчёркивать невалидный JSON (редактор тела). */
  lint = false,
  /** Гаттер фолдинга — для больших ответов. */
  foldable = false,
  /** ПКМ: JSON-цель под курсором (или null вне значения) + координаты. */
  onJsonContextMenu,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onSend?: () => void;
  placeholder?: ReactNode;
  pulse?: boolean;
  vars?: EnvVar[];
  lint?: boolean;
  foldable?: boolean;
  onJsonContextMenu?: (
    target: JsonTarget | null,
    at: { x: number; y: number },
  ) => void;
}) {
  const themeId = useApp((s) => s.settings.theme);
  const light = themeById(themeId).light;
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(() => {
    const list: Extension[] = [
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
    ];
    if (vars) list.push(envVarsExtension(vars));
    if (lint) {
      // пустой док — не ошибка: тело "{}"-по-умолчанию можно стереть целиком
      list.push(
        linter((view) =>
          view.state.doc.toString().trim() ? jsonParseLinter()(view) : [],
        ),
      );
    }
    return list;
  }, [onSend, vars, lint]);

  return (
    <div
      className={cn("relative h-full", pulse && "animate-pulse")}
      onContextMenu={
        onJsonContextMenu &&
        ((e) => {
          const view = editorRef.current?.view;
          if (!view) return;
          e.preventDefault();
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const target = pos === null ? null : jsonTargetAt(view.state, pos);
          onJsonContextMenu(target, { x: e.clientX, y: e.clientY });
        })
      }
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        className="h-full"
        theme={light ? editorThemes.light : editorThemes.dark}
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: foldable,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          // ⌘F — поиск по ответу; у панели своя разметка, но живёт в теме
          searchKeymap: true,
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
