// Past exchanges of the open request; picking one reloads its payloads into
// the editors.
import { History, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../lib/store";
import { secs } from "../lib/utils";
import { IconButton, Popover } from "./ui";

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

  if (history.length === 0) return null;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      panelClassName="max-h-64 w-64 overflow-y-auto p-1"
      trigger={
        <IconButton
          title={`История (${history.length})`}
          onClick={() => setOpen((v) => !v)}
        >
          <History size={14} />
        </IconButton>
      }
    >
      {history.map((entry) => (
        <div
          key={entry.id}
          className="group flex items-center gap-1 rounded px-1 hover:bg-zinc-800"
        >
          <button
            onClick={() => {
              void openHistoryItem(entry.id);
              setOpen(false);
            }}
            className="flex flex-1 items-baseline justify-between gap-2 truncate py-1.5 pl-1 text-left text-[11px] text-zinc-300"
          >
            <span className="truncate font-mono">{stamp(entry.timestamp)}</span>
            {entry.execution_time != null && (
              <span className="shrink-0 text-[10px] text-zinc-500">
                {secs(entry.execution_time)}
              </span>
            )}
          </button>
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
  );
}
