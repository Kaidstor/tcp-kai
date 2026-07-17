// Env pack editor (⌘E): pack list on the left, its variables on the right.
//
// Edits live in a draft buffer until Save — selecting a pack here only opens
// it for editing; "Применить" is what points the collection at it.
import {
  Check,
  Globe,
  Link,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/shallow";
import {
  currentCollection,
  editingPack,
  envDirty,
  useApp,
  usableEnvPacks,
} from "../lib/store";
import type { EnvVar } from "../lib/types";
import { Button, IconButton, Input, Overlay, cn } from "./ui";

export function EnvConfigDialog() {
  const open = useApp((s) => s.envConfigOpen);
  const setOpen = useApp((s) => s.setEnvConfigOpen);
  const packs = useApp(useShallow(usableEnvPacks));
  const pack = useApp(editingPack);
  const dirty = useApp(envDirty);
  const collection = useApp(currentCollection);
  const draftVars = useApp((s) => s.draftVars);
  const setDraftVars = useApp((s) => s.setDraftVars);
  const resetDraftVars = useApp((s) => s.resetDraftVars);
  const saveDraftVars = useApp((s) => s.saveDraftVars);
  const selectEditingPack = useApp((s) => s.selectEditingPack);
  const createEnvPack = useApp((s) => s.createEnvPack);
  const renameEnvPack = useApp((s) => s.renameEnvPack);
  const deleteEnvPack = useApp((s) => s.deleteEnvPack);
  const toggleEnvPackScope = useApp((s) => s.toggleEnvPackScope);
  const activateEnvPack = useApp((s) => s.activateEnvPack);
  const promptDialog = useApp((s) => s.promptDialog);
  const confirmDialog = useApp((s) => s.confirmDialog);

  const [newVar, setNewVar] = useState<EnvVar>({ key: "", value: "" });

  if (!open) return null;

  const applied = pack != null && collection?.pack_id === pack.id;
  const isGlobal = pack?.collection_id === null;

  const patchVar = (i: number, patch: Partial<EnvVar>) =>
    setDraftVars(draftVars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const addVar = () => {
    if (!newVar.key.trim()) return;
    setDraftVars([...draftVars, { ...newVar, key: newVar.key.trim() }]);
    setNewVar({ key: "", value: "" });
  };

  const addPack = async () => {
    const name = await promptDialog({
      title: "Новый пак переменных",
      label: "Название пака",
      placeholder: "dev / stage / prod",
      confirmLabel: "Добавить",
    });
    if (name) await createEnvPack(name);
  };

  const rename = async () => {
    if (!pack) return;
    const name = await promptDialog({
      title: "Переименовать пак",
      label: "Название пака",
      initialValue: pack.name,
      confirmLabel: "Сохранить",
    });
    if (name) await renameEnvPack(pack.id, name);
  };

  const remove = async () => {
    if (!pack) return;
    const ok = await confirmDialog({
      title: "Удаление пака",
      message: `Пак "${pack.name}" и все его переменные будут удалены. Коллекции, использующие его, останутся без переменных.`,
      danger: true,
    });
    if (ok) await deleteEnvPack(pack.id);
  };

  return (
    <Overlay
      onClose={() => setOpen(false)}
      closeOnEsc
      className="items-center bg-black/60"
    >
      <div className="flex h-[36rem] max-h-[90vh] w-[50rem] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-100">
            Переменные окружения
          </h2>
          <IconButton onClick={() => setOpen(false)}>
            <X size={15} />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* packs */}
          <div className="flex w-56 shrink-0 flex-col border-r border-zinc-800 p-2">
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {packs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectEditingPack(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]",
                    p.id === pack?.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/60",
                  )}
                >
                  {p.collection_id === null ? (
                    <Globe size={12} className="shrink-0 text-sky-400" />
                  ) : (
                    <Link size={12} className="shrink-0 text-amber-400" />
                  )}
                  <span className="flex-1 truncate">{p.name}</span>
                  {collection?.pack_id === p.id && (
                    <span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[9px] font-semibold tracking-wide text-sky-400">
                      ACTIVE
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button onClick={addPack} className="mt-2 justify-center">
              <Plus size={12} /> Добавить пак
            </Button>
          </div>

          {/* variables */}
          <div className="flex min-w-0 flex-1 flex-col p-4">
            {!pack ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-zinc-600">
                {packs.length === 0
                  ? "Ещё нет ни одного пака переменных"
                  : "Пак не выбран"}
              </div>
            ) : (
              <>
                <div className="mb-3 flex h-7 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium text-zinc-100">
                      {pack.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500">
                      {isGlobal
                        ? "(глобальный)"
                        : `(привязан к ${collection?.name ?? "коллекции"})`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {/* пара как PendingChangesBar в sql-kai: появляется только
                        пока есть несохранённые правки */}
                    {dirty && (
                      <>
                        <Button
                          onClick={resetDraftVars}
                          title="Вернуть сохранённые значения"
                        >
                          <RotateCcw size={12} /> Сбросить
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => void saveDraftVars()}
                        >
                          <Save size={12} /> Сохранить
                        </Button>
                      </>
                    )}
                    {!dirty && !applied && collection && (
                      <Button
                        variant="primary"
                        title={`Применить "${pack.name}" к коллекции "${collection.name}"`}
                        onClick={() => void activateEnvPack(pack.id)}
                      >
                        <Check size={12} /> Применить
                      </Button>
                    )}
                    {(dirty || (!applied && collection)) && (
                      <div className="mx-1 h-4 w-px bg-zinc-800" />
                    )}
                    <IconButton
                      title={
                        isGlobal
                          ? "Привязать к текущей коллекции"
                          : "Сделать глобальным"
                      }
                      disabled={isGlobal && !collection}
                      onClick={() => void toggleEnvPackScope(pack.id)}
                    >
                      {isGlobal ? <Link size={13} /> : <Globe size={13} />}
                    </IconButton>
                    <IconButton title="Переименовать" onClick={rename}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton
                      title="Удалить пак"
                      onClick={remove}
                      className="hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>

                {draftVars.length > 0 && (
                  <div className="mb-1 grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-[10px] font-medium text-zinc-500">
                    <div>KEY</div>
                    <div>VALUE</div>
                    <div className="w-6" />
                  </div>
                )}

                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                  {draftVars.map((v, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        value={v.key}
                        placeholder="key"
                        className="font-mono"
                        onChange={(e) => patchVar(i, { key: e.target.value })}
                      />
                      <Input
                        value={v.value}
                        placeholder="value"
                        className="font-mono"
                        onChange={(e) => patchVar(i, { value: e.target.value })}
                      />
                      <IconButton
                        title="Удалить переменную"
                        onClick={() =>
                          setDraftVars(draftVars.filter((_, j) => j !== i))
                        }
                        className="hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  ))}
                  {draftVars.length === 0 && (
                    <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                      Переменных пока нет
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addVar();
                  }}
                  className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-zinc-800 pt-3"
                >
                  <Input
                    value={newVar.key}
                    placeholder="key"
                    className="font-mono"
                    onChange={(e) => setNewVar({ ...newVar, key: e.target.value })}
                  />
                  <Input
                    value={newVar.value}
                    placeholder="value"
                    className="font-mono"
                    onChange={(e) => setNewVar({ ...newVar, value: e.target.value })}
                  />
                  <IconButton type="submit" title="Добавить переменную">
                    <Plus size={14} />
                  </IconButton>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
