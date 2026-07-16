// Address + cmd + send/stop. The URL resolves `{{vars}}` against the
// collection's env pack; both fields are saved on send.
import { SendHorizontal, Square } from "lucide-react";
import { activeVars, isSending, useApp } from "../lib/store";
import { EnvVarInput } from "./EnvVarInput";
import { Input, cn } from "./ui";

export function RequestBar() {
  const draft = useApp((s) => s.draft);
  const patchDraft = useApp((s) => s.patchDraft);
  const vars = useApp(activeVars);
  const sending = useApp(isSending);
  const send = useApp((s) => s.send);
  const stop = useApp((s) => s.stop);

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-zinc-800 bg-zinc-900 p-2">
      <EnvVarInput
        value={draft.url}
        onChange={(url) => patchDraft({ url })}
        envVars={vars}
        placeholder="host:port"
      />
      <Input
        value={draft.cmd}
        placeholder="CMD"
        className="font-mono"
        onChange={(e) => patchDraft({ cmd: e.target.value })}
      />
      <button
        onClick={() => (sending ? stop() : void send())}
        title={sending ? "Остановить" : "Отправить (⌘↵)"}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-3 transition-colors",
          sending
            ? "bg-zinc-800 text-red-400 hover:bg-zinc-700"
            : "bg-sky-600 text-white hover:bg-sky-500",
        )}
      >
        {sending ? <Square size={14} /> : <SendHorizontal size={14} />}
      </button>
    </div>
  );
}
