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
    // Адрес — короткий и почти константный (стенд задают переменные пака),
    // поэтому фиксированной ширины; главное поле — cmd, оно и растягивается.
    <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
      <EnvVarInput
        value={draft.url}
        onChange={(url) => patchDraft({ url })}
        envVars={vars}
        placeholder="host:port"
        className="w-56 shrink-0"
      />
      <Input
        value={draft.cmd}
        placeholder="CMD"
        className="flex-1 font-mono"
        onChange={(e) => patchDraft({ cmd: e.target.value })}
      />
      <button
        onClick={() => (sending ? stop() : void send())}
        title={sending ? "Остановить" : "Отправить (⌘↵)"}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1",
          "text-[12px] font-medium transition-colors",
          sending
            ? "bg-zinc-800 text-red-400 hover:bg-zinc-700"
            : "bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-600",
        )}
      >
        {sending ? <Square size={12} /> : <SendHorizontal size={12} />}
        {sending ? "Стоп" : "Отправить"}
      </button>
    </div>
  );
}
