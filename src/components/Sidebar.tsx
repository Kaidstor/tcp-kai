// Requests of the open collection, most-used first (see requests.weight).
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { IconButton, Input, cn } from "./ui";

export function Sidebar() {
  const requests = useApp((s) => s.requests);
  const currentRequestId = useApp((s) => s.currentRequestId);
  const selectRequest = useApp((s) => s.selectRequest);
  const createRequest = useApp((s) => s.createRequest);
  const deleteRequest = useApp((s) => s.deleteRequest);
  const promptDialog = useApp((s) => s.promptDialog);
  const confirmDialog = useApp((s) => s.confirmDialog);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? requests.filter((r) => r.name.toLowerCase().includes(q))
      : requests;
  }, [requests, search]);

  const addRequest = async () => {
    const cmd = await promptDialog({
      title: "Новый запрос",
      label: "CMD",
      placeholder: "user.get",
    });
    if (cmd) await createRequest(cmd);
  };

  const removeRequest = async (id: number, name: string) => {
    const ok = await confirmDialog({
      title: "Удаление запроса",
      message: `Запрос "${name}" и вся его история будут удалены без возможности восстановления.`,
      danger: true,
    });
    if (ok) await deleteRequest(id);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold text-zinc-200">Запросы</h2>
        <IconButton title="Новый запрос (⌘K)" onClick={addRequest}>
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="px-2 pb-2">
        <Input
          value={search}
          placeholder="Поиск запросов…"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.map((req) => (
          <div
            key={req.id}
            className={cn(
              "group relative flex items-center rounded",
              req.id === currentRequestId ? "bg-zinc-800" : "hover:bg-zinc-800/60",
            )}
          >
            <button
              title={req.name}
              onClick={() => void selectRequest(req.id)}
              className="flex-1 truncate py-1.5 pr-7 pl-2 text-left text-[12px] text-zinc-200"
            >
              {req.name}
              {req.weight ? (
                <span className="ml-1.5 text-[10px] text-zinc-600">
                  {req.weight}
                </span>
              ) : null}
            </button>
            <IconButton
              title="Удалить запрос"
              onClick={() => void removeRequest(req.id, req.name)}
              className="absolute right-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
            >
              <Trash2 size={12} />
            </IconButton>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-zinc-600">
            {requests.length === 0 ? "Пока нет запросов" : "Ничего не найдено"}
          </p>
        )}
      </div>
    </aside>
  );
}
