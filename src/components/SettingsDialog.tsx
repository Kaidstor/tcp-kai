// ⌘, — настройки: тема, таймаут ответа, лимит истории, ориентация сплита.
// Всё живёт в settings-таблице (см. lib/db.ts).
import { Check, Columns2, Rows2 } from "lucide-react";
import { useApp } from "../lib/store";
import { THEMES } from "../lib/themes";
import { DEFAULT_HISTORY_LIMIT, DEFAULT_TIMEOUT_SECS } from "../lib/types";
import { Field, Input, Label, Overlay, cn } from "./ui";

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const settings = useApp((s) => s.settings);
  const setTheme = useApp((s) => s.setTheme);
  const updateSettings = useApp((s) => s.updateSettings);

  if (!open) return null;
  const current = settings.theme ?? THEMES[0].id;
  const layout = settings.layout ?? "horizontal";

  /** Числовая настройка: пустое поле — вернуться к дефолту. */
  const numberField = (
    key: "timeout_secs" | "history_limit",
    raw: string,
  ) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      void updateSettings({ [key]: undefined });
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0) void updateSettings({ [key]: Math.floor(n) });
  };

  return (
    <Overlay
      onClose={() => setOpen(false)}
      closeOnEsc
      className="items-start bg-black/60 pt-[16vh]"
    >
      <div className="w-[26rem] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h2 className="mb-4 text-[13px] font-semibold text-zinc-100">Настройки</h2>

        <Label>Тема</Label>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => void setTheme(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-md border p-2 text-left transition-colors",
                t.id === current
                  ? "border-sky-600 bg-zinc-800"
                  : "border-zinc-700 hover:bg-zinc-800/60",
              )}
            >
              {/* swatch: app bg, panel, accent */}
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded border border-zinc-700"
                style={{ background: t.preview.bg }}
              >
                <span
                  className="size-3.5 rounded-sm"
                  style={{ background: t.preview.panel }}
                >
                  <span
                    className="block size-1.5 rounded-full"
                    style={{ background: t.preview.accent }}
                  />
                </span>
              </span>
              <span className="flex-1 truncate text-[12px] text-zinc-200">
                {t.label}
              </span>
              {t.id === current && (
                <Check size={13} className="shrink-0 text-sky-400" />
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label={`Таймаут ответа, сек (0 — без лимита)`}>
            <Input
              type="number"
              min={0}
              placeholder={String(DEFAULT_TIMEOUT_SECS)}
              defaultValue={settings.timeout_secs ?? ""}
              onBlur={(e) => numberField("timeout_secs", e.target.value)}
            />
          </Field>
          <Field label={`История на запрос (0 — хранить всё)`}>
            <Input
              type="number"
              min={0}
              placeholder={String(DEFAULT_HISTORY_LIMIT)}
              defaultValue={settings.history_limit ?? ""}
              onBlur={(e) => numberField("history_limit", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Label>Расположение ответа</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "horizontal", label: "Снизу", icon: Rows2 },
                { id: "vertical", label: "Справа", icon: Columns2 },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => void updateSettings({ layout: opt.id })}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-2 text-[12px] text-zinc-200 transition-colors",
                  layout === opt.id
                    ? "border-sky-600 bg-zinc-800"
                    : "border-zinc-700 hover:bg-zinc-800/60",
                )}
              >
                <opt.icon size={14} className="text-zinc-500" />
                {opt.label}
                {layout === opt.id && (
                  <Check size={13} className="ml-auto shrink-0 text-sky-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
