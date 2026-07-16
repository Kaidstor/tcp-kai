// Past exchanges of the open request; picking one reloads its payloads into
// the editors. Каждая строка: исход (точка), время, пак, длительность.
// Кнопка сравнения: первая отметка — «A», вторая — открывает диф A↔B.
import { GitCompareArrows, History, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../lib/store";
import { secs } from "../lib/utils";
import { DiffDialog } from "./DiffDialog";
import { IconButton, Popover, cn } from "./ui";

/** "14.07, 18:32:05" — history is same-day browsing most of the time. */
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

export function HistoryMenu() {
  const history = useApp((s) => s.history);
  const openHistoryItem = useApp((s) => s.openHistoryItem);
  const deleteHistoryItem = useApp((s) => s.deleteHistoryItem);
  const [open, setOpen] = useState(false);
  /** Запись, отмеченная как «A» для сравнения. */
  const [diffA, setDiffA] = useState<number | null>(null);
  /** Пара, открытая в диф-диалоге. */
  const [diffPair, setDiffPair] = useState<[number, number] | null>(null);

  if (history.length === 0) return null;

  const pickForDiff = (id: number) => {
    if (diffA === null) {
      setDiffA(id);
      return;
    }
    if (diffA === id) {
      setDiffA(null);
      return;
    }
    setDiffPair([diffA, id]);
    setDiffA(null);
    setOpen(false);
  };

  return (
    <>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          setDiffA(null);
        }}
        align="right"
        panelClassName="max-h-72 w-80 overflow-y-auto p-1"
        trigger={
          <IconButton
            title={`История (${history.length})`}
            onClick={() => setOpen((v) => !v)}
          >
            <History size={14} />
          </IconButton>
        }
      >
        {diffA !== null && (
          <div className="mx-1 mt-1 rounded bg-sky-950/60 px-2 py-1 text-[10px] text-sky-300">
            Выберите вторую запись для сравнения
          </div>
        )}
        {history.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "group flex items-center gap-1 rounded px-1 hover:bg-zinc-800",
              entry.id === diffA && "bg-sky-950/60",
            )}
          >
            <button
              onClick={() => {
                void openHistoryItem(entry.id);
                setOpen(false);
                setDiffA(null);
              }}
              className="flex flex-1 items-baseline gap-2 truncate py-1.5 pl-1 text-left text-[11px] text-zinc-300"
            >
              <span
                title={entry.ok === 0 ? "Ошибка обмена" : "Успешно"}
                className={cn(
                  "size-1.5 shrink-0 self-center rounded-full",
                  entry.ok === 0 ? "bg-red-500" : "bg-emerald-500",
                )}
              />
              <span className="truncate font-mono">{stamp(entry.timestamp)}</span>
              {entry.pack && (
                <span className="shrink-0 rounded border border-zinc-700/60 px-1 text-[9px] text-zinc-500">
                  {entry.pack}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                {entry.execution_time != null && secs(entry.execution_time)}
              </span>
            </button>
            <IconButton
              title={
                diffA === null
                  ? "Сравнить с другой записью…"
                  : entry.id === diffA
                    ? "Снять отметку"
                    : "Сравнить с отмеченной"
              }
              onClick={() => pickForDiff(entry.id)}
              className={cn(
                "opacity-0 transition-opacity group-hover:opacity-100",
                entry.id === diffA && "text-sky-400 opacity-100",
              )}
            >
              <GitCompareArrows size={11} />
            </IconButton>
            <IconButton
              title="Удалить запись"
              onClick={() => void deleteHistoryItem(entry.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
            >
              <Trash2 size={11} />
            </IconButton>
          </div>
        ))}
      </Popover>

      {diffPair && (
        <DiffDialog
          aId={diffPair[0]}
          bId={diffPair[1]}
          onClose={() => setDiffPair(null)}
        />
      )}
    </>
  );
}
