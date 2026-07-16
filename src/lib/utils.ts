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
