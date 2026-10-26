import { describe, expect, it } from "vitest";
import { readState, stashState, stateKey } from "./address-state";
import type { KeyValueStorage } from "./scenario-storage";

function memory() {
  const items = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items };
}

describe("address state", () => {
  const question = JSON.stringify({ base_dataset_id: "ds-1", dimension: { value: "12345678900" } });

  it("puts a short key in the address and keeps the values in the browser", () => {
    const { storage, items } = memory();
    const key = stashState(storage, "q", question);
    expect(key).toBe(stateKey(question));
    expect(key).not.toContain("12345678900");
    expect(readState(storage, "q", key)).toBe(question);
    expect(items.get("trace.address.q")).toContain("12345678900");
  });

  it("still opens old addresses that carried the whole definition", () => {
    expect(readState(memory().storage, "q", question)).toBe(question);
  });

  it("returns nothing for an unknown key instead of guessing", () => {
    expect(readState(memory().storage, "q", "abc123")).toBeNull();
  });

  it("keeps the latest hundred definitions", () => {
    const { storage, items } = memory();
    for (let i = 0; i < 120; i++) stashState(storage, "c", JSON.stringify({ i }));
    expect(Object.keys(JSON.parse(items.get("trace.address.c")!))).toHaveLength(100);
    expect(readState(storage, "c", stateKey(JSON.stringify({ i: 119 })))).toBe(JSON.stringify({ i: 119 }));
    expect(readState(storage, "c", stateKey(JSON.stringify({ i: 0 })))).toBeNull();
  });
});
