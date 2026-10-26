import type { KeyValueStorage } from "./scenario-storage";

const LIMIT = 100;

export function stateKey(encoded: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < encoded.length; i++) {
    const code = encoded.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function read(storage: KeyValueStorage, name: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(name) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function stashState(storage: KeyValueStorage | null, kind: string, encoded: string) {
  if (!storage) return encoded;
  const name = `trace.address.${kind}`;
  const key = stateKey(encoded);
  try {
    const entries = Object.entries(read(storage, name)).filter(([existing]) => existing !== key);
    entries.push([key, encoded]);
    storage.setItem(name, JSON.stringify(Object.fromEntries(entries.slice(-LIMIT))));
    return key;
  } catch {
    return encoded;
  }
}

export function readState(storage: KeyValueStorage | null, kind: string, param: string | null) {
  if (!param) return null;
  if (param.trimStart().startsWith("{")) return param;
  return storage ? (read(storage, `trace.address.${kind}`)[param] ?? null) : null;
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
