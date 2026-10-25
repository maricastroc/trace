import { describe, expect, it } from "vitest";
import { AREAS, isCurrentArea } from "./areas";

describe("AREAS", () => {
  it("has exactly the three product areas, in order", () => {
    expect(AREAS.map((area) => area.label)).toEqual(["Mapa", "Perguntas", "Comparações"]);
  });
});

describe("isCurrentArea", () => {
  it("matches the area and its nested routes", () => {
    expect(isCurrentArea("/perguntas", "/perguntas")).toBe(true);
    expect(isCurrentArea("/perguntas/abc", "/perguntas")).toBe(true);
  });

  it("does not match a different area that shares a prefix", () => {
    expect(isCurrentArea("/mapas", "/mapa")).toBe(false);
    expect(isCurrentArea("/", "/mapa")).toBe(false);
  });
});
