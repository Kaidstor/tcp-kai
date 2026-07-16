// JSON-путь и значение под курсором — для контекстного меню панели ответа.
// Работает по синтаксическому дереву @codemirror/lang-json, а не по регуляркам,
// поэтому корректно считает индексы массивов и экранированные ключи.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** Узлы-значения JSON-грамматики lezer. */
const VALUE_NODES = new Set([
  "String",
  "Number",
  "True",
  "False",
  "Null",
  "Object",
  "Array",
]);

export interface JsonTarget {
  /** `.response.items[0].id`; пустая строка — корень документа. */
  path: string;
  /** Значение без кавычек/экранирования (для строк) или исходный текст. */
  value: string;
  /** Ключ ближайшего свойства — заготовка имени переменной. */
  key: string | null;
}

/** Ключ из узла PropertyName: `"user id"` → `user id`. */
function propertyKey(state: EditorState, property: SyntaxNode): string | null {
  const nameNode = property.getChild("PropertyName");
  if (!nameNode) return null;
  const raw = state.sliceDoc(nameNode.from, nameNode.to);
  try {
    return String(JSON.parse(raw));
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}

/** Индекс значения среди значений-детей массива. */
function arrayIndex(parent: SyntaxNode, child: SyntaxNode): number {
  let index = 0;
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.from === child.from && n.to === child.to) return index;
    if (VALUE_NODES.has(n.name)) index++;
  }
  return index;
}

/** Цель под позицией курсора; null — позиция вне JSON-значения. */
export function jsonTargetAt(state: EditorState, pos: number): JsonTarget | null {
  const node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
  if (!node) return null;

  // поднимаемся до ближайшего значения (клик мог попасть в скобку/запятую);
  // с имени свойства переходим на значение этого свойства
  let target: SyntaxNode | null = null;
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "PropertyName" && cur.parent) {
      // значение свойства — последний ребёнок-значение Property
      let valueNode: SyntaxNode | null = null;
      for (let ch = cur.parent.firstChild; ch; ch = ch.nextSibling) {
        if (VALUE_NODES.has(ch.name)) valueNode = ch;
      }
      target = valueNode ?? cur.parent;
      break;
    }
    if (VALUE_NODES.has(cur.name)) {
      target = cur;
      break;
    }
  }
  if (!target) return null;

  // путь: от цели вверх до корня
  const parts: string[] = [];
  let key: string | null = null;
  let cur: SyntaxNode = target;
  while (cur.parent) {
    const parent: SyntaxNode = cur.parent;
    if (parent.name === "Property") {
      const k = propertyKey(state, parent);
      if (k !== null) {
        if (key === null) key = k;
        parts.unshift(/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k}"]`);
      }
    } else if (parent.name === "Array") {
      parts.unshift(`[${arrayIndex(parent, cur)}]`);
    }
    cur = parent;
  }

  const raw = state.sliceDoc(target.from, target.to);
  let value = raw;
  if (target.name === "String") {
    try {
      value = String(JSON.parse(raw));
    } catch {
      value = raw.replace(/^"|"$/g, "");
    }
  }

  return { path: parts.join(""), value, key };
}
