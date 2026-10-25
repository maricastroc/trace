import { describe, expect, it } from "vitest";
import {
  forgetToken,
  type KeyValueStorage,
  LEGACY_TOKEN_KEY,
  readScenario,
  readTokens,
  SCENARIO_KEY,
  TOKENS_KEY,
  writeScenario,
  writeToken,
} from "./scenario-storage";

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items };
}

const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("readTokens", () => {
  it("returns no tokens when nothing is stored", () => {
    expect(readTokens(memory().storage)).toEqual({});
  });

  it("adopts the single legacy token as the meals scenario", () => {
    const { storage } = memory({ [LEGACY_TOKEN_KEY]: "old-token" });
    expect(readTokens(storage)).toEqual({ refeicoes: "old-token" });
  });

  it("prefers the per-scenario token over the legacy one", () => {
    const { storage } = memory({ [LEGACY_TOKEN_KEY]: "old", [TOKENS_KEY]: JSON.stringify({ refeicoes: "new" }) });
    expect(readTokens(storage)).toEqual({ refeicoes: "new" });
  });

  it("ignores malformed and empty entries", () => {
    expect(readTokens(memory({ [TOKENS_KEY]: "{not json" }).storage)).toEqual({});
    expect(readTokens(memory({ [TOKENS_KEY]: JSON.stringify({ a: "", b: 3, c: "ok" }) }).storage)).toEqual({ c: "ok" });
  });

  it("survives storage that throws or is missing", () => {
    expect(readTokens(broken)).toEqual({});
    expect(readTokens(null)).toEqual({});
  });
});

describe("writeToken and forgetToken", () => {
  it("keeps one token per scenario and drops the legacy key", () => {
    const { storage, items } = memory({ [LEGACY_TOKEN_KEY]: "old" });
    writeToken(storage, "cadastro", "t-cadastro");
    expect(JSON.parse(items.get(TOKENS_KEY)!)).toEqual({ refeicoes: "old", cadastro: "t-cadastro" });
    expect(items.has(LEGACY_TOKEN_KEY)).toBe(false);
  });

  it("forgets only the requested scenario", () => {
    const { storage } = memory({ [TOKENS_KEY]: JSON.stringify({ refeicoes: "a", cadastro: "b" }) });
    expect(forgetToken(storage, "cadastro")).toEqual({ refeicoes: "a" });
    expect(readTokens(storage)).toEqual({ refeicoes: "a" });
  });

  it("forgetting the meals scenario also clears the legacy token", () => {
    const { storage, items } = memory({ [LEGACY_TOKEN_KEY]: "old" });
    expect(forgetToken(storage, "refeicoes")).toEqual({});
    expect(items.has(LEGACY_TOKEN_KEY)).toBe(false);
  });

  it("does not throw when storage is blocked", () => {
    expect(writeToken(broken, "cadastro", "x")).toEqual({ cadastro: "x" });
    expect(() => forgetToken(broken, "cadastro")).not.toThrow();
  });
});

describe("readScenario and writeScenario", () => {
  it("returns the stored scenario when it still exists", () => {
    const { storage } = memory();
    writeScenario(storage, "cadastro");
    expect(readScenario(storage, ["refeicoes", "cadastro"], "refeicoes")).toBe("cadastro");
  });

  it("falls back when the stored scenario is unknown or absent", () => {
    expect(readScenario(memory({ [SCENARIO_KEY]: "rede" }).storage, ["refeicoes", "cadastro"], "refeicoes")).toBe("refeicoes");
    expect(readScenario(memory().storage, ["refeicoes"], "refeicoes")).toBe("refeicoes");
    expect(readScenario(broken, ["refeicoes"], "refeicoes")).toBe("refeicoes");
  });
});
