// CodeMirror-расширение подсветки `{{vars}}` в редакторе тела — та же
// семантика, что у EnvVarInput в адресной строке: известная переменная
// янтарная, неизвестная подчёркнута красным; hover показывает значение.
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  hoverTooltip,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type { EnvVar } from "./types";

const VAR_RE = /\{\{([^}]+)\}\}/g;

const knownMark = Decoration.mark({ class: "cm-envvar" });
const unknownMark = Decoration.mark({ class: "cm-envvar cm-envvar-unknown" });

const theme = EditorView.baseTheme({
  ".cm-envvar": { color: "var(--color-amber-400)" },
  ".cm-envvar-unknown": {
    borderBottom: "2px solid var(--color-red-500)",
  },
  ".cm-tooltip.cm-envvar-tooltip": {
    padding: "3px 7px",
    fontFamily: "ui-monospace, monospace",
    fontSize: "11px",
    backgroundColor: "var(--color-zinc-800)",
    color: "var(--color-zinc-100)",
    border: "1px solid var(--color-zinc-700)",
    borderRadius: "4px",
  },
});

/** Подсветка и hover для `{{name}}`. Пересоздаётся при смене пака —
 *  JsonEditor держит его в useMemo от списка переменных. */
export function envVarsExtension(vars: EnvVar[]): Extension {
  const values = new Map(vars.map((v) => [v.key, v.value]));

  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_RE.exec(text)) !== null) {
        const name = m[1].trim();
        builder.add(
          from + m.index,
          from + m.index + m[0].length,
          values.has(name) ? knownMark : unknownMark,
        );
      }
    }
    return builder.finish();
  };

  const highlight = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const tooltip = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_RE.exec(line.text)) !== null) {
      const start = line.from + m.index;
      const end = start + m[0].length;
      if (pos < start || pos > end) continue;
      const name = m[1].trim();
      const value = values.get(name);
      return {
        pos: start,
        end,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-envvar-tooltip";
          dom.textContent =
            value !== undefined ? `${name} = ${value}` : `${name} — не задана`;
          return { dom };
        },
      };
    }
    return null;
  });

  return [highlight, tooltip, theme];
}
