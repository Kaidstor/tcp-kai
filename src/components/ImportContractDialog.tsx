// Импорт cmd-паттернов из NestJS-контракта в открытую коллекцию: путь к
// файлу (или перетащенный файл, или вставленное содержимое) → Rust-парсер
// (parse_contract) → выбор паттернов → создание запросов.
import { FileInput } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errText } from "../lib/api";
import { currentCollection, useApp } from "../lib/store";
import type { ContractGroup } from "../lib/types";
import { Button, Field, Input, Overlay, Spinner, cn } from "./ui";

export function ImportContractDialog() {
  const open = useApp((s) => s.importOpen);
  const prefill = useApp((s) => s.importPath);
  const closeImport = useApp((s) => s.closeImport);
  const collection = useApp(currentCollection);
  const requests = useApp((s) => s.requests);
  const importCmds = useApp((s) => s.importCmds);
  const showToast = useApp((s) => s.showToast);

  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [groups, setGroups] = useState<ContractGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  // каждое открытие — с чистого листа (плюс путь из drag&drop, если был)
  useEffect(() => {
    if (open) {
      setPath(prefill);
      setText("");
      setGroups(null);
      setSelected(new Set());
      setShowAll(false);
    }
  }, [open, prefill]);

  const known = useMemo(
    () => new Set(requests.flatMap((r) => [r.cmd, r.name])),
    [requests],
  );

  const parse = async (nextPath = path, nextText = text) => {
    setBusy(true);
    try {
      const parsed = await api.parseContract({
        path: nextPath.trim() || undefined,
        text: nextText.trim() || undefined,
      });
      setGroups(parsed);
      // предвыбор: новые не-deprecated cmd из cmd-контейнеров
      const preset = new Set<string>();
      for (const g of parsed) {
        if (!g.is_cmd) continue;
        for (const c of g.cmds) {
          if (!c.deprecated && !known.has(c.value)) preset.add(c.value);
        }
      }
      setSelected(preset);
      if (parsed.length === 0) showToast("В файле не нашлось контейнеров с cmd");
    } catch (e) {
      showToast(errText(e));
      setGroups(null);
    } finally {
      setBusy(false);
    }
  };

  // сразу разобрать перетащенный файл — путь уже известен
  useEffect(() => {
    if (open && prefill) void parse(prefill, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  if (!open) return null;

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const { created, skipped } = await importCmds([...selected]);
      showToast(
        `Импортировано ${created}${skipped ? `, пропущено ${skipped}` : ""}`,
        "success",
      );
      closeImport();
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const visibleGroups = (groups ?? []).filter((g) => showAll || g.is_cmd);
  const hiddenCount = (groups ?? []).filter((g) => !g.is_cmd).length;

  return (
    <Overlay
      onClose={closeImport}
      closeOnEsc
      className="items-start bg-black/60 pt-[10vh]"
    >
      <div className="flex max-h-[78vh] w-[38rem] max-w-[94vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
          <FileInput size={15} className="text-zinc-500" />
          Импорт контракта → {collection?.name}
        </h2>
        <p className="mb-3 text-[11px] text-zinc-500">
          Понимает as-const объекты и enum с именем *Cmd*, а также
          @MessagePattern в контроллерах. Файл можно просто перетащить в окно.
        </p>

        {!groups && (
          <>
            <Field label="Путь к файлу (*.contract.ts, cmd.enum.ts, контроллер)">
              <Input
                autoFocus
                value={path}
                placeholder="~/Projects/rebrandy/whois/src/contracts/cmd.contract.ts"
                className="font-mono"
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void parse();
                }}
              />
            </Field>
            <Field label="…или содержимое файла" className="mt-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                rows={6}
                placeholder="export const WhoisCmd = { LOOKUP: 'lookup', … } as const;"
                className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none"
              />
            </Field>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={closeImport}>Отмена</Button>
              <Button
                variant="primary"
                disabled={busy || (!path.trim() && !text.trim())}
                onClick={() => void parse()}
              >
                {busy && <Spinner />}
                Разобрать
              </Button>
            </div>
          </>
        )}

        {groups && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800">
              {visibleGroups.map((g) => (
                <div key={g.container}>
                  <div className="sticky top-0 flex items-center gap-2 border-b border-zinc-800 bg-zinc-925 px-2 py-1 font-mono text-[10px] text-zinc-500">
                    {g.container}
                    {!g.is_cmd && (
                      <span className="rounded border border-amber-500/40 px-1 text-[9px] text-amber-400">
                        не похож на cmd-реестр
                      </span>
                    )}
                  </div>
                  {g.refs.length > 0 && (
                    <div className="border-b border-zinc-800/60 px-2 py-1 text-[10px] text-amber-400/90">
                      {g.refs.length} значений — ссылки на другие константы (
                      {[
                        ...new Set(g.refs.map((r) => r.target.split(".")[0])),
                      ].join(", ")}
                      ) — импортируйте их файлы отдельно
                    </div>
                  )}
                  {g.cmds.map((c) => {
                    const exists = known.has(c.value);
                    return (
                      <label
                        key={`${g.container}:${c.value}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-2 py-1 text-[12px] hover:bg-zinc-800/50",
                          exists && "cursor-default opacity-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={exists}
                          checked={!exists && selected.has(c.value)}
                          onChange={() => toggle(c.value)}
                          className="accent-sky-600"
                        />
                        <span className="font-mono text-zinc-200">{c.value}</span>
                        {c.key && c.key !== c.value && (
                          <span className="truncate font-mono text-[10px] text-zinc-600">
                            {c.key}
                          </span>
                        )}
                        <span className="ml-auto flex shrink-0 gap-1">
                          {c.deprecated && (
                            <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-400">
                              @deprecated
                            </span>
                          )}
                          {exists && (
                            <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-500">
                              уже есть
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
              {visibleGroups.length === 0 && (
                <p className="p-6 text-center text-[11px] text-zinc-600">
                  cmd-контейнеров не нашлось
                </p>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  {showAll
                    ? "Скрыть прочие контейнеры"
                    : `Показать прочие контейнеры (${hiddenCount})`}
                </button>
              )}
              <div className="flex-1" />
              <Button onClick={() => setGroups(null)}>Назад</Button>
              <Button
                variant="primary"
                disabled={busy || selected.size === 0}
                onClick={() => void doImport()}
              >
                {busy && <Spinner />}
                Импортировать {selected.size || ""}
              </Button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
