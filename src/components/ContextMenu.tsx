// Лёгкое контекстное меню (ПКМ) без зависимостей: fixed-позиция с прижимом
// к краям окна, закрытие по клику мимо/Esc. Референс — ContextMenu sql-kai,
// но без @base-ui: единственному потребителю (панель ответа) хватает списка.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "./ui";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Моноширинная подпись справа (значение/путь). */
  hint?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  danger?: boolean;
  action: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  header,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Строка над пунктами — например, путь до значения. */
  header?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // прижать к краям окна после первого рендера, когда известны размеры
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-52 max-w-96 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-[12px] shadow-xl shadow-black/50"
      onContextMenu={(e) => e.preventDefault()}
    >
      {header && (
        <div className="truncate border-b border-zinc-800 px-2 py-1.5 font-mono text-[10px] text-zinc-500">
          {header}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
              "hover:bg-zinc-800",
              item.danger ? "text-red-400" : "text-zinc-200",
            )}
          >
            {Icon && (
              <Icon
                size={13}
                className={item.danger ? "text-red-400" : "text-zinc-500"}
              />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="max-w-40 truncate font-mono text-[10px] text-zinc-500">
                {item.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
