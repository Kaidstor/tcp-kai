// ⌘, — theme picker. Themes are CSS-variable overrides on <html>, so the
// swatches below are the whole story (see lib/themes.ts).
import { Check } from "lucide-react";
import { useApp } from "../lib/store";
import { THEMES } from "../lib/themes";
import { Label, Overlay, cn } from "./ui";

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const theme = useApp((s) => s.settings.theme);
  const setTheme = useApp((s) => s.setTheme);

  if (!open) return null;
  const current = theme ?? THEMES[0].id;

  return (
    <Overlay
      onClose={() => setOpen(false)}
      closeOnEsc
      className="items-start bg-black/60 pt-[16vh]"
    >
      <div className="w-[26rem] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h2 className="mb-4 text-[14px] font-semibold text-zinc-100">Настройки</h2>

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
      </div>
    </Overlay>
  );
}
