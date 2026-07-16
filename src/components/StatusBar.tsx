// Bottom strip: last exchange's outcome on the right, app version on the left.
import { app } from "@tauri-apps/api";
import { useEffect, useState } from "react";
import { isSending, useApp } from "../lib/store";
import { Spinner, cn } from "./ui";

export function StatusBar() {
  const statusText = useApp((s) => s.statusText);
  const sending = useApp(isSending);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void app.getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const failed = /^(Error|Failed)/.test(statusText);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900 px-3">
      <span className="font-mono text-[10px] text-zinc-600">
        {version && `v${version}`}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 truncate text-[11px]",
          failed ? "text-red-400" : "text-zinc-500",
        )}
        title={statusText}
      >
        {sending && <Spinner className="size-3" />}
        {statusText}
      </span>
    </footer>
  );
}
