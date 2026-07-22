// Host:port field with live `{{var}}` highlighting and completion.
//
// The input itself renders transparent text over an overlay that paints the
// same string with the variables coloured — known ones amber, unknown ones
// underlined red. Both layers must share font, padding and metrics or the
// caret drifts away from the glyphs.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EnvVar } from "../lib/types";
import { cn } from "./ui";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "var"; text: string; name: string; value: string | undefined };

/** Splits `{{name}}` placeholders out of the surrounding text. */
function segments(text: string, vars: EnvVar[]): Segment[] {
  const values = new Map(vars.map((v) => [v.key, v.value]));
  const out: Segment[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const name = m[1].trim();
    out.push({ kind: "var", text: m[0], name, value: values.get(name) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The `{{…}}` the caret sits in, if any — that's what completion replaces. */
function activeVar(
  value: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  const open = value.lastIndexOf("{{", Math.max(caret - 1, 0));
  // каретка слева от самих скобок — внутрь placeholder'а она ещё не зашла
  if (open === -1 || caret < open + 2) return null;
  const closeBefore = value.indexOf("}}", open);
  // каретка на `}}` или правее — placeholder уже дописан, подсказка не нужна
  if (closeBefore !== -1 && caret >= closeBefore + 2) return null;
  const end = closeBefore === -1 ? caret : closeBefore + 2;
  const inner = value.slice(open + 2, closeBefore === -1 ? caret : closeBefore);
  return { start: open, end, query: inner };
}

export function EnvVarInput({
  value,
  onChange,
  envVars,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  envVars: EnvVar[];
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const paintRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [sel, setSel] = useState(0);

  // Значение длиннее поля прокручивает input — слой подсветки обязан ехать
  // ровно так же, иначе каретка встаёт посреди чужих глифов. scrollLeft
  // браузер пересчитывает уже после обработчика, поэтому читаем ещё и в
  // следующем кадре.
  const syncScroll = () => {
    const copy = () => {
      if (inputRef.current && paintRef.current)
        paintRef.current.scrollLeft = inputRef.current.scrollLeft;
    };
    copy();
    requestAnimationFrame(copy);
  };

  useLayoutEffect(syncScroll, [value]);

  const parts = useMemo(() => segments(value, envVars), [value, envVars]);

  // Completion is open only while the caret is inside a `{{…}}`
  const active = caret === null ? null : activeVar(value, caret);
  const matches = useMemo(() => {
    if (!active) return [];
    const q = active.query.trim().toLowerCase();
    return envVars.filter((v) => v.key.toLowerCase().includes(q)).slice(0, 8);
  }, [active, envVars]);
  const open = matches.length > 0;

  const sync = (el: HTMLInputElement) => setCaret(el.selectionStart);

  const insert = (key: string) => {
    if (!active) return;
    const next = `${value.slice(0, active.start)}{{${key}}}${value.slice(active.end)}`;
    onChange(next);
    setCaret(null);
    // put the caret just past the completed placeholder
    const pos = active.start + key.length + 4;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      // программный перенос каретки не поднимает onSelect — двигаем слой сами
      syncScroll();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      // plain Enter completes; ⌘Enter still belongs to "send"
      e.preventDefault();
      insert(matches[sel].key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCaret(null);
    }
  };

  // shared by both layers so the painted text lands exactly on the real one
  const textLayer = "px-2 py-1 text-[13px] font-mono whitespace-pre";

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
          syncScroll();
          setSel(0);
        }}
        onSelect={(e) => {
          sync(e.currentTarget);
          syncScroll();
        }}
        onScroll={syncScroll}
        onFocus={(e) => sync(e.currentTarget)}
        onBlur={() => setCaret(null)}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full rounded-md border border-zinc-700 bg-zinc-900",
          "text-transparent caret-zinc-100 selection:bg-sky-500/30",
          "placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none",
          textLayer,
        )}
      />

      {/* painted copy of the same string; the input above owns interaction */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center overflow-hidden",
          // прозрачная рамка повторяет рамку input'а: без неё текст съезжает
          // на её ширину и каретка не попадает в свои глифы
          "border border-transparent",
          textLayer,
        )}
      >
        {/* padding снаружи, прокручивается только текст — как внутри input'а */}
        <div ref={paintRef} className="min-w-0 flex-1 overflow-hidden">
          {parts.map((part, i) =>
            part.kind === "text" ? (
              <span key={i} className="text-zinc-100">
                {part.text}
              </span>
            ) : (
              <span
                key={i}
                title={
                  part.value !== undefined
                    ? `${part.name} = ${part.value}`
                    : `${part.name} — не задана`
                }
                className={cn(
                  "text-amber-400",
                  part.value === undefined && "border-b-2 border-red-500",
                )}
              >
                {part.text}
              </span>
            ),
          )}
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40">
          {matches.map((v, i) => (
            <button
              key={v.key}
              type="button"
              // mousedown, not click — blur would close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                insert(v.key);
              }}
              onMouseEnter={() => setSel(i)}
              className={cn(
                "flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[12px]",
                i === sel && "bg-zinc-800",
              )}
            >
              <span className="font-mono text-zinc-100">{v.key}</span>
              <span className="truncate font-mono text-[11px] text-zinc-500">
                {v.value}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
