// Диф двух записей истории: развёрнутые ответы бок о бок в unified-виде
// @codemirror/merge (красное — было, зелёное — стало). Хронологически более
// ранняя запись считается «оригиналом».
import { json } from "@codemirror/lang-json";
import { unifiedMergeView } from "@codemirror/merge";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/db";
import { useApp } from "../lib/store";
import { editorThemes, themeById } from "../lib/themes";
import type { HistoryEntry } from "../lib/types";
import { secs, unwrapReceived } from "../lib/utils";
import { Overlay, Spinner } from "./ui";

const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export function DiffDialog({
  aId,
  bId,
  onClose,
}: {
  aId: number;
  bId: number;
  onClose: () => void;
}) {
  const themeId = useApp((s) => s.settings.theme);
  const light = themeById(themeId).light;
  const showToast = useApp((s) => s.showToast);
  const [pair, setPair] = useState<[HistoryEntry, HistoryEntry] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          db.history.byId(aId),
          db.history.byId(bId),
        ]);
        if (!a || !b) throw new Error("запись не найдена");
        // старшая запись — «оригинал», диф читается как «что изменилось»
        const [orig, next] =
          a.timestamp <= b.timestamp ? [a, b] : [b, a];
        setPair([orig, next]);
      } catch (e) {
        showToast(`Диф не открылся: ${String(e)}`);
        onClose();
      }
    })();
  }, [aId, bId, onClose, showToast]);

  const extensions = useMemo(() => {
    if (!pair) return [];
    return [
      json(),
      unifiedMergeView({
        original: unwrapReceived(pair[0].received).text || pair[0].received,
        mergeControls: false,
      }),
    ];
  }, [pair]);

  const meta = (e: HistoryEntry) =>
    [
      stamp(e.timestamp),
      e.pack ?? undefined,
      e.execution_time != null ? secs(e.execution_time) : undefined,
      e.ok === 0 ? "ошибка" : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Overlay onClose={onClose} closeOnEsc className="items-center bg-black/60">
      <div className="flex max-h-[84vh] w-[56rem] max-w-[94vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-zinc-100">
            Сравнение ответов
          </h2>
          {pair && (
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="text-red-400">− {meta(pair[0])}</span>
              <span className="text-emerald-400">+ {meta(pair[1])}</span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!pair ? (
            <div className="flex items-center justify-center gap-2 p-10 text-[12px] text-zinc-500">
              <Spinner /> Загрузка…
            </div>
          ) : (
            <CodeMirror
              value={unwrapReceived(pair[1].received).text || pair[1].received}
              readOnly
              theme={light ? editorThemes.light : editorThemes.dark}
              extensions={extensions}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                searchKeymap: true,
              }}
            />
          )}
        </div>
      </div>
    </Overlay>
  );
}
