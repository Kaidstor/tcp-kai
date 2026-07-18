import type { EnvVar } from "./types";

/** `{{name}}` placeholders resolved against the active env pack. Unknown
 *  names are left verbatim — a typo shows up in the request instead of
 *  silently becoming an empty string. */
export function processEnvVars(text: string, envVars: EnvVar[]): string {
  if (!text || envVars.length === 0) return text;
  const values = new Map(envVars.map((v) => [v.key, v.value]));
  return text.replace(/\{\{([^}]+)\}\}/g, (match, name: string) => {
    const value = values.get(name.trim());
    return value !== undefined ? value : match;
  });
}

/** Pretty-prints JSON; returns the input untouched when it isn't valid JSON. */
export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** ms → "1.23s", the unit every status line and history row uses. */
export const secs = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

/** Полураспад веса запроса: неделя без использования — вес тает вдвое. */
export const WEIGHT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Frecency-вес на момент `now`. Распад по времени, а не по числу отправок:
 *  активная сессия с одним запросом не стирает остальных. null last_used_at —
 *  строки, жившие до v9: вес берётся как есть, распад начнётся с первой отправки. */
export function decayedWeight(
  weight: number | null,
  lastUsedAt: number | null,
  now: number,
): number {
  if (!weight || weight <= 0) return 0;
  if (lastUsedAt === null) return weight;
  // max(0, …) — на случай перевода часов назад
  return weight * 0.5 ** (Math.max(0, now - lastUsedAt) / WEIGHT_HALF_LIFE_MS);
}

/** Непустое тело, которое не разберётся как JSON: NestJS-кадр молча отправит
 *  `data: null` — GUI спрашивает подтверждение до отправки. */
export function isInvalidJsonBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

/** Пак похож на боевой стенд — для красного бейджа и confirm на запись. */
export const isProdPack = (name: string | undefined | null): boolean =>
  !!name && /prod|live|боев/i.test(name);

// Токены cmd, которые обычно означают запись/изменение состояния сервиса —
// ровно те, о которых предупреждает skills/tcp-kai (create-*, update-*, …),
// плюс частые в rebrandy инфиксы вида domains-set-status.
const WRITE_TOKENS = new Set([
  "create",
  "update",
  "delete",
  "remove",
  "drop",
  "add",
  "insert",
  "set",
  "unset",
  "upsert",
  "send",
  "save",
  "write",
  "sync",
  "reset",
  "start",
  "stop",
  "exec",
  "import",
]);

export const isWriteCmd = (cmd: string): boolean =>
  cmd
    .toLowerCase()
    .split(/[-_.:\s]+/)
    .some((token) => WRITE_TOKENS.has(token));

/** Конверт NestJS-транспорта: `{err, response, isDisposed, id}`. */
export interface Envelope {
  /** null/undefined — сервис не вернул ошибку. */
  err: unknown;
  response: unknown;
}

/** Распознаёт конверт в сыром ответе. Не-конверт (нестандартный сервис,
 *  старая запись истории) возвращается как null — показывается как есть. */
export function parseEnvelope(received: string): Envelope | null {
  if (!received.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(received);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      ("response" in parsed || "err" in parsed) &&
      ("isDisposed" in parsed || "id" in parsed)
    ) {
      const p = parsed as Record<string, unknown>;
      return { err: p.err ?? null, response: p.response };
    }
  } catch {
    // не JSON — показываем сырым
  }
  return null;
}

/** Что показывать в панели ответа: развёрнутый `response` (или `err`),
 *  либо исходный текст, когда это не конверт. */
export function unwrapReceived(received: string): {
  text: string;
  /** Сервис вернул err в конверте. */
  isErr: boolean;
  /** Конверт распознан — тумблер raw имеет смысл. */
  isEnvelope: boolean;
} {
  const envelope = parseEnvelope(received);
  if (!envelope) return { text: received, isErr: false, isEnvelope: false };
  if (envelope.err !== null && envelope.err !== undefined) {
    return {
      text: JSON.stringify(envelope.err, null, 2),
      isErr: true,
      isEnvelope: true,
    };
  }
  return {
    text:
      envelope.response === undefined
        ? ""
        : JSON.stringify(envelope.response, null, 2),
    isErr: false,
    isEnvelope: true,
  };
}
