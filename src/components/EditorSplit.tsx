// Request body over response, with a draggable divider between them.
import { FileJson, FileOutput } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { isSending, useApp } from "../lib/store";
import { JsonEditor } from "./JsonEditor";

export function EditorSplit() {
  const draft = useApp((s) => s.draft);
  const patchDraft = useApp((s) => s.patchDraft);
  const send = useApp((s) => s.send);
  const sending = useApp(isSending);
  const editorPct = useApp((s) => s.editorPct);
  const setEditorPct = useApp((s) => s.setEditorPct);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onSend = useCallback(() => {
    if (!useApp.getState().sendingId) void send();
  }, [send]);

  // Listeners live on the document so the drag survives the cursor leaving
  // the 12px handle.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      setEditorPct(((e.clientY - rect.top) / rect.height) * 100);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setEditorPct]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div style={{ height: `${editorPct}%` }} className="min-h-0 overflow-hidden">
        <JsonEditor
          value={draft.body}
          onChange={(body) => patchDraft({ body })}
          onSend={onSend}
          placeholder={
            <>
              <FileJson size={36} />
              <span className="text-[12px]">Request Body</span>
            </>
          }
        />
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={startDrag}
        className="group flex h-3 shrink-0 cursor-ns-resize items-center bg-zinc-900"
      >
        <div className="h-px w-full bg-zinc-800 transition-colors group-hover:bg-sky-600" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <JsonEditor
          value={draft.received}
          readOnly
          onSend={onSend}
          pulse={sending}
          placeholder={
            <>
              <FileOutput size={36} />
              <span className="text-[12px]">Response</span>
            </>
          }
        />
      </div>
    </div>
  );
}
