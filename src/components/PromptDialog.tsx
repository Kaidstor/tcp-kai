// Single-field prompt (new collection, new request, rename). Opened via
// store.promptDialog(), which resolves with the trimmed value or null.
import { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { Button, Field, Input, Overlay } from "./ui";

export function PromptDialog() {
  const prompt = useApp((s) => s.prompt);
  const resolvePrompt = useApp((s) => s.resolvePrompt);
  const [value, setValue] = useState("");

  // reseed whenever a new prompt opens (rename arrives with a value)
  useEffect(() => {
    if (prompt) setValue(prompt.initialValue ?? "");
  }, [prompt]);

  if (!prompt) return null;

  const submit = () => {
    const trimmed = value.trim();
    resolvePrompt(trimmed ? trimmed : null);
  };

  return (
    <Overlay
      onClose={() => resolvePrompt(null)}
      closeOnEsc
      className="items-start bg-black/60 pt-[18vh]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-[24rem] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <h2 className="mb-3 text-[14px] font-semibold text-zinc-100">
          {prompt.title}
        </h2>
        <Field label={prompt.label}>
          <Input
            autoFocus
            value={value}
            placeholder={prompt.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={() => resolvePrompt(null)}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {prompt.confirmLabel ?? "Создать"}
          </Button>
        </div>
      </form>
    </Overlay>
  );
}
