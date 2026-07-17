// Request body and response panes with a draggable divider; stacked by
// default, side-by-side when settings.layout === "vertical". The response
// pane unwraps the NestJS envelope and owns the right-click context menu.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Braces,
  Copy,
  FileJson,
  FileOutput,
  Route,
  Variable,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { JsonTarget } from "../lib/jsonPath";
import { activeVars, isSending, useApp } from "../lib/store";
import { unwrapReceived } from "../lib/utils";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { JsonEditor } from "./JsonEditor";
import { IconButton, Spinner, cn } from "./ui";

/** Default editor share of the split when reset (double-click). */
const DEFAULT_EDITOR_PCT = 50;
/** Minimum pane size while dragging; below half of it the editor snaps shut. */
const MIN_PANE_PX = 100;

/** UTF-8 размер ответа: "182 B" / "4.1 KB" / "2.3 MB". */
function byteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EditorSplit() {
  const draft = useApp((s) => s.draft);
  const patchDraft = useApp((s) => s.patchDraft);
  const send = useApp((s) => s.send);
  const sending = useApp(isSending);
  const editorPct = useApp((s) => s.editorPct);
  const setEditorPct = useApp((s) => s.setEditorPct);
  const layout = useApp((s) => s.settings.layout) ?? "horizontal";
  const lastOk = useApp((s) => s.lastOk);
  const statusText = useApp((s) => s.statusText);
  const showRaw = useApp((s) => s.showRaw);
  const setShowRaw = useApp((s) => s.setShowRaw);
  const vars = useApp(activeVars);
  const promptDialog = useApp((s) => s.promptDialog);
  const upsertActiveVar = useApp((s) => s.upsertActiveVar);
  const showToast = useApp((s) => s.showToast);
  const containerRef = useRef<HTMLDivElement>(null);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: JsonTarget | null;
  } | null>(null);

  const sideBySide = layout === "vertical";

  const onSend = useCallback(() => {
    if (!useApp.getState().sendingId) void send();
  }, [send]);

  // Snap the editor shut near the start, otherwise keep both panes at least
  // MIN_PANE_PX so neither collapses to an unusable sliver.
  const resizeTo = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offset = sideBySide ? clientX - rect.left : clientY - rect.top;
    const total = sideBySide ? rect.width : rect.height;
    const px =
      offset < MIN_PANE_PX / 2
        ? 0 // snap shut — response takes the whole area
        : Math.max(MIN_PANE_PX, Math.min(offset, total - MIN_PANE_PX));
    setEditorPct((px / total) * 100);
  };

  const unwrapped = useMemo(() => unwrapReceived(draft.received), [draft.received]);
  const displayed = showRaw ? draft.received : unwrapped.text;
  const size = useMemo(
    () => (displayed ? byteSize(displayed) : null),
    [displayed],
  );

  const copy = async (text: string, what: string) => {
    try {
      await writeText(text);
      showToast(`${what} — в буфере`, "success");
    } catch (e) {
      showToast(String(e));
    }
  };

  const menuItems: ContextMenuItem[] = useMemo(() => {
    if (!menu) return [];
    const items: ContextMenuItem[] = [];
    const target = menu.target;
    if (target) {
      items.push({
        id: "copy-value",
        label: "Копировать значение",
        hint: target.value.length > 40 ? undefined : target.value,
        icon: Copy,
        action: () => void copy(target.value, "Значение"),
      });
      if (target.path) {
        items.push({
          id: "copy-path",
          label: "Копировать путь",
          hint: target.path,
          icon: Route,
          action: () => void copy(target.path, "Путь"),
        });
      }
      items.push({
        id: "to-var",
        label: "Сохранить в переменную пака…",
        icon: Variable,
        action: () => {
          void (async () => {
            const name = await promptDialog({
              title: "Переменная пака",
              label: "Имя ({{имя}} в запросах)",
              initialValue: target.key ?? "",
              confirmLabel: "Сохранить",
            });
            if (name) await upsertActiveVar(name, target.value);
          })();
        },
      });
    }
    if (displayed) {
      items.push({
        id: "copy-all",
        label: "Копировать весь ответ",
        icon: Braces,
        action: () => void copy(displayed, "Ответ"),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, displayed]);

  const badge =
    lastOk === null ? null : !lastOk ? (
      <span className="rounded bg-red-950 px-1.5 py-px text-[10px] font-medium text-red-400">
        ошибка
      </span>
    ) : unwrapped.isErr ? (
      <span className="rounded bg-red-950 px-1.5 py-px text-[10px] font-medium text-red-400">
        err
      </span>
    ) : (
      <span className="rounded bg-emerald-950 px-1.5 py-px text-[10px] font-medium text-emerald-400">
        ok
      </span>
    );

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0 flex-1", !sideBySide && "flex-col")}
    >
      <div
        style={{ [sideBySide ? "width" : "height"]: `${editorPct}%` }}
        className={
          editorPct === 0
            ? "hidden"
            : cn(
                "shrink-0 overflow-hidden",
                sideBySide ? "min-w-[100px]" : "min-h-[100px]",
              )
        }
      >
        <JsonEditor
          value={draft.body}
          onChange={(body) => patchDraft({ body })}
          onSend={onSend}
          vars={vars}
          lint
          placeholder={
            <>
              <FileJson size={36} />
              <span className="text-[12px]">Request Body</span>
            </>
          }
        />
      </div>

      {/* Handle-less divider: a hairline in a wide hit-zone, revealed on hover. */}
      <div
        role="separator"
        aria-orientation={sideBySide ? "vertical" : "horizontal"}
        title="Потяните, чтобы изменить · двойной клик — сброс"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          resizeTo(e.clientX, e.clientY);
        }}
        onDoubleClick={() => setEditorPct(DEFAULT_EDITOR_PCT)}
        className={cn(
          "group relative shrink-0 touch-none select-none",
          sideBySide ? "w-1.5 cursor-ew-resize" : "h-1.5 cursor-ns-resize",
        )}
      >
        <div
          className={cn(
            "absolute bg-zinc-800 transition-colors group-hover:bg-sky-600 group-active:bg-sky-500",
            sideBySide
              ? "inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:w-0.5 group-active:w-0.5"
              : "inset-x-0 top-1/2 h-px -translate-y-1/2 group-hover:h-0.5 group-active:h-0.5",
          )}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Тулбар ответа: исход, размер, статус (бывший статус-бар), raw, копирование. */}
        {(sending || draft.received || lastOk !== null) && (
          <div className="flex h-6 shrink-0 items-center gap-2 border-b border-zinc-800/60 px-2">
            {badge}
            {size && <span className="text-[10px] text-zinc-600">{size}</span>}
            <span
              title={statusText}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-end gap-1.5 truncate text-[10px]",
                /^(Error|Failed)/.test(statusText)
                  ? "text-red-400"
                  : "text-zinc-600",
              )}
            >
              {sending && <Spinner className="size-2.5" />}
              {statusText !== "Ready" && statusText}
            </span>
            {unwrapped.isEnvelope && (
              <button
                onClick={() => setShowRaw(!showRaw)}
                title="Показать сырой конверт NestJS ({err, response, …})"
                className={cn(
                  "rounded px-1.5 py-px text-[10px] transition-colors",
                  showRaw
                    ? "bg-zinc-700 text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                raw
              </button>
            )}
            {displayed && (
              <IconButton
                title="Копировать ответ"
                onClick={() => void copy(displayed, "Ответ")}
                className="p-0.5"
              >
                <Copy size={11} />
              </IconButton>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <JsonEditor
            value={displayed}
            readOnly
            foldable
            onSend={onSend}
            pulse={sending}
            onJsonContextMenu={(target, at) =>
              setMenu({ x: at.x, y: at.y, target })
            }
            placeholder={
              draft.emit ? (
                <>
                  <Zap size={36} />
                  <span className="text-[12px]">
                    Event-паттерн — ответ не ожидается
                  </span>
                </>
              ) : (
                <>
                  <FileOutput size={36} />
                  <span className="text-[12px]">Response</span>
                </>
              )
            }
          />
        </div>
      </div>

      {menu && menuItems.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={menu.target?.path || undefined}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
