// The app's window.confirm() — that one doesn't block in the Tauri webview.
// Opened via store.confirmDialog(), which resolves with the outcome.
import { useEffect, useRef } from "react";
import { useApp } from "../lib/store";
import { Button, Overlay } from "./ui";

export function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  const resolveConfirm = useApp((s) => s.resolveConfirm);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Enter confirms straight away — the button owns focus while open
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  if (!confirm) return null;

  return (
    <Overlay
      onClose={() => resolveConfirm(false)}
      closeOnEsc
      className="items-center bg-black/60"
    >
      <div className="w-[26rem] max-w-[92vw] self-center rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h2 className="text-[14px] font-semibold text-zinc-100">{confirm.title}</h2>
        {confirm.message && (
          <p className="mt-2 text-[12px] whitespace-pre-wrap text-zinc-400">
            {confirm.message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => resolveConfirm(false)}>Отмена</Button>
          <Button
            ref={confirmRef}
            variant={confirm.danger ? "danger" : "primary"}
            onClick={() => resolveConfirm(true)}
          >
            {confirm.confirmLabel ?? "Удалить"}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
