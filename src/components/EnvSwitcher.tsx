// Titlebar pill: which env pack the open collection uses, and a quick switch
// between the packs available to it.
import { Check, Settings, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { activePack, useApp, usableEnvPacks } from "../lib/store";
import { isProdPack } from "../lib/utils";
import { Kbd, MenuButton, Popover, cn } from "./ui";

export function EnvSwitcher() {
  const packs = useApp(useShallow(usableEnvPacks));
  const active = useApp(activePack);
  const activateEnvPack = useApp((s) => s.activateEnvPack);
  const openEnvConfig = useApp((s) => s.openEnvConfig);
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      panelClassName="max-h-64 w-48 overflow-y-auto p-1"
      trigger={
        <MenuButton
          onClick={() => setOpen((v) => !v)}
          title={
            isProdPack(active?.name)
              ? "Боевой стенд — write-паттерны спросят подтверждение (⌘E — настроить)"
              : "Пак переменных окружения (⌘E — настроить)"
          }
          className={cn(
            isProdPack(active?.name) &&
              "bg-red-950/70 text-red-400 hover:bg-red-900/60 hover:text-red-300",
          )}
        >
          {isProdPack(active?.name) && (
            <TriangleAlert size={11} className="shrink-0 text-red-400" />
          )}
          <span className="max-w-[120px] truncate">{active?.name ?? "no ENV"}</span>
        </MenuButton>
      }
    >
      {packs.map((pack) => (
        <button
          key={pack.id}
          onClick={() => {
            void activateEnvPack(pack.id);
            setOpen(false);
          }}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5",
            "text-left text-[12px] text-zinc-200 hover:bg-zinc-800",
          )}
        >
          <span
            className={cn("truncate", isProdPack(pack.name) && "text-red-400")}
          >
            {pack.name}
          </span>
          {pack.id === active?.id && (
            <Check size={12} className="shrink-0 text-sky-400" />
          )}
        </button>
      ))}

      {packs.length > 0 && <div className="my-1 h-px bg-zinc-800" />}

      <button
        onClick={() => {
          openEnvConfig();
          setOpen(false);
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-zinc-400 hover:bg-zinc-800"
      >
        <Settings size={12} />
        <span>Настройки</span>
        <Kbd className="ml-auto">⌘E</Kbd>
      </button>
    </Popover>
  );
}
