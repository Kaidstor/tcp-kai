// «Что нового» — показывается один раз после обновления приложения:
// заметки релизов между прошлой запущенной версией и текущей (см. lib/whatsNew).
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { collectWhatsNew, type ReleaseNote } from "../lib/whatsNew";
import { Button, IconButton, Overlay } from "./ui";

/** Строки changelog'а: "- пункт" → маркер, остальное — абзац. */
function NoteLines({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-[12px] leading-relaxed text-zinc-300">
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        const bullet = t.match(/^[-*]\s+(.*)$/);
        return bullet ? (
          <div key={i} className="flex gap-2">
            <span className="text-zinc-600">•</span>
            <span>{bullet[1]}</span>
          </div>
        ) : (
          <p key={i}>{t}</p>
        );
      })}
    </div>
  );
}

export function WhatsNewDialog() {
  const [notes, setNotes] = useState<ReleaseNote[]>([]);

  useEffect(() => {
    void collectWhatsNew().then((r) => {
      if (r.length > 0) setNotes(r);
    });
  }, []);

  if (notes.length === 0) return null;
  const close = () => setNotes([]);

  return (
    <Overlay onClose={close} closeOnEsc className="items-center bg-black/60">
      <div className="w-[30rem] max-w-[92vw] self-center rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
            <Sparkles size={14} className="text-sky-400" />
            Что нового
          </h2>
          <IconButton onClick={close}>
            <X size={15} />
          </IconButton>
        </div>

        <div className="selectable max-h-[50vh] space-y-3 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.version}>
              <div className="mb-1 text-[11px] font-semibold text-sky-400">
                v{n.version}
              </div>
              <NoteLines text={n.notes} />
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={close}>
            Ок
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
