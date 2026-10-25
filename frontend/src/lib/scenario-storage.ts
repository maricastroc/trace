export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const LEGACY_TOKEN_KEY = "trace.workspace-token";
export const TOKENS_KEY = "trace.workspace-tokens";
export const SCENARIO_KEY = "trace.scenario";
export const LEGACY_SCENARIO = "refeicoes";

export type ScenarioTokens = Record<string, string>;

function safeGet(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStorage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {}
}

function safeRemove(storage: KeyValueStorage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {}
}

export function readTokens(storage: KeyValueStorage | null): ScenarioTokens {
  const tokens: ScenarioTokens = {};
  const raw = safeGet(storage, TOKENS_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [scenario, token] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof token === "string" && token !== "") tokens[scenario] = token;
        }
      }
    } catch {}
  }

  const legacy = safeGet(storage, LEGACY_TOKEN_KEY);
  if (legacy && !tokens[LEGACY_SCENARIO]) tokens[LEGACY_SCENARIO] = legacy;

  return tokens;
}

export function writeToken(storage: KeyValueStorage | null, scenario: string, token: string): ScenarioTokens {
  const tokens = { ...readTokens(storage), [scenario]: token };
  safeSet(storage, TOKENS_KEY, JSON.stringify(tokens));
  safeRemove(storage, LEGACY_TOKEN_KEY);
  return tokens;
}

export function forgetToken(storage: KeyValueStorage | null, scenario: string): ScenarioTokens {
  const tokens = readTokens(storage);
  delete tokens[scenario];
  safeSet(storage, TOKENS_KEY, JSON.stringify(tokens));
  if (scenario === LEGACY_SCENARIO) safeRemove(storage, LEGACY_TOKEN_KEY);
  return tokens;
}

export function readScenario(storage: KeyValueStorage | null, available: string[], fallback: string): string {
  const stored = safeGet(storage, SCENARIO_KEY);
  return stored && available.includes(stored) ? stored : fallback;
}

export function writeScenario(storage: KeyValueStorage | null, scenario: string) {
  safeSet(storage, SCENARIO_KEY, scenario);
}
