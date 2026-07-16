// Transient message pill (bottom-right). The Svelte build used alert() for
// backend errors, which blocks the webview; this doesn't.
import { useApp } from "../lib/store";
import { cn } from "./ui";

export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;

  return (
    <div
      className={cn(
        "fixed right-3 bottom-9 z-50 max-w-[28rem] rounded-lg px-3 py-1.5",
        "text-[12px] font-medium shadow-lg ring-1 ring-inset",
        toast.kind === "error"
          ? "bg-red-950 text-red-200 shadow-red-950/40 ring-red-500/30"
          : toast.kind === "success"
            ? "bg-emerald-950 text-emerald-200 shadow-emerald-950/40 ring-emerald-500/30"
            : "bg-zinc-800 text-zinc-200 shadow-black/40 ring-white/10",
      )}
    >
      <span className="selectable line-clamp-3 break-words whitespace-pre-wrap">
        {toast.message}
      </span>
    </div>
  );
}
