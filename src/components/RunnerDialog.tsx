// Раннер: прогнать выбранные запросы коллекции подряд и показать таблицу
// исходов. По умолчанию отмечены только read-запросы (см. isWriteCmd) —
// smoke после деплоя не должен случайно что-то записать. Историю прогон
// не трогает.
import { ListChecks, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { activePack, useApp } from "../lib/store";
import { isProdPack, isWriteCmd, secs } from "../lib/utils";
import { Button, Overlay, Spinner, cn } from "./ui";

export function RunnerDialog() {
  const open = useApp((s) => s.runnerOpen);
  const setOpen = useApp((s) => s.setRunnerOpen);
  const requests = useApp((s) => s.requests);
  const results = useApp((s) => s.runnerResults);
  const busy = useApp((s) => s.runnerBusy);
  const runRequests = useApp((s) => s.runRequests);
  const stopRunner = useApp((s) => s.stopRunner);
  const resetRunner = useApp((s) => s.resetRunner);
  const pack = useApp(activePack);
  const confirmDialog = useApp((s) => s.confirmDialog);

  const [checked, setChecked] = useState<Set<number>>(new Set());

  // каждое открытие: отмечены read-запросы, прошлые результаты сброшены
  useEffect(() => {
    if (open) {
      resetRunner();
      setChecked(new Set(requests.filter((r) => !isWriteCmd(r.cmd)).map((r) => r.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const summary = useMemo(() => {
    const values = Object.values(results);
    const ok = values.filter((r) => r.status === "ok").length;
    const err = values.filter((r) => r.status === "err").length;
    return { ok, err, done: ok + err };
  }, [results]);

  if (!open) return null;

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async () => {
    const ids = requests.filter((r) => checked.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    // на боевом паке write-запросы в прогоне — только осознанно
    const writes = requests.filter((r) => checked.has(r.id) && isWriteCmd(r.cmd));
    if (isProdPack(pack?.name) && writes.length > 0) {
      const ok = await confirmDialog({
        title: `Запись на «${pack?.name}»`,
        message: `В прогон включены write-паттерны (${writes
          .map((r) => r.cmd)
          .join(", ")}), а пак похож на боевой.`,
        confirmLabel: "Прогнать",
        danger: true,
      });
      if (!ok) return;
    }
    await runRequests(ids);
  };

  const close = () => {
    if (busy) stopRunner();
    setOpen(false);
  };

  return (
    <Overlay onClose={close} closeOnEsc className="items-start bg-black/60 pt-[10vh]">
      <div className="flex max-h-[78vh] w-[34rem] max-w-[94vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h2 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
          <ListChecks size={15} className="text-zinc-500" />
          Прогон запросов
          {pack && (
            <span
              className={cn(
                "rounded px-1.5 py-px text-[10px] font-medium",
                isProdPack(pack.name)
                  ? "bg-red-950 text-red-400"
                  : "bg-zinc-800 text-zinc-400",
              )}
            >
              {pack.name}
            </span>
          )}
        </h2>
        <p className="mb-3 text-[11px] text-zinc-500">
          Последовательно, текущим паком; результаты не пишутся в историю.
          Write-паттерны по умолчанию сняты.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800">
          {requests.map((r) => {
            const result = results[r.id];
            const write = isWriteCmd(r.cmd);
            return (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 border-b border-zinc-800/50 px-2 py-1.5 text-[12px] last:border-0 hover:bg-zinc-800/50"
              >
                <input
                  type="checkbox"
                  checked={checked.has(r.id)}
                  disabled={busy}
                  onChange={() => toggle(r.id)}
                  className="accent-sky-600"
                />
                <span className="truncate font-mono text-zinc-200">{r.cmd}</span>
                {write && (
                  <span
                    title="Похож на изменение данных"
                    className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-400"
                  >
                    write
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {result?.status === "running" && <Spinner className="size-3" />}
                  {result?.status === "ok" && (
                    <>
                      <span className="text-[10px] text-zinc-500">
                        {result.ms != null && secs(result.ms)}
                      </span>
                      <span className="text-emerald-400">✓</span>
                    </>
                  )}
                  {result?.status === "err" && (
                    <>
                      <span
                        title={result.message}
                        className="max-w-40 truncate text-[10px] text-red-400"
                      >
                        {result.message}
                      </span>
                      <span className="text-red-400">✗</span>
                    </>
                  )}
                </span>
              </label>
            );
          })}
          {requests.length === 0 && (
            <p className="p-6 text-center text-[11px] text-zinc-600">
              В коллекции нет запросов
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          {summary.done > 0 && (
            <span className="text-[11px] text-zinc-500">
              <span className="text-emerald-400">{summary.ok} ✓</span>
              {summary.err > 0 && (
                <>
                  {" · "}
                  <span className="text-red-400">{summary.err} ✗</span>
                </>
              )}
            </span>
          )}
          <div className="flex-1" />
          <Button onClick={close}>Закрыть</Button>
          {busy ? (
            <Button variant="danger" onClick={stopRunner}>
              <Square size={12} /> Остановить
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={checked.size === 0}
              onClick={() => void run()}
            >
              <Play size={12} /> Прогнать {checked.size || ""}
            </Button>
          )}
        </div>
      </div>
    </Overlay>
  );
}
