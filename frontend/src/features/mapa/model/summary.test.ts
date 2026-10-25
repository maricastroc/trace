import { describe, expect, it } from "vitest";
import { relation } from "./fixtures";
import { pathStandings, relationsSummary, routeLabel } from "./summary";

describe("relationsSummary", () => {
  it("describes an empty map", () => {
    expect(relationsSummary([])).toBe("Nenhuma relação encontrada entre as tabelas ainda.");
  });

  it("puts pending decisions first, then confirmed, rejected and attention", () => {
    const relations = [
      relation("a", ["x", "a"], ["y", "id"], "suggested"),
      relation("b", ["x", "b"], ["z", "id"], "suggested", { toUnique: false, duplicates: 3 }),
      relation("c", ["y", "c"], ["z", "id"], "confirmed"),
      relation("d", ["z", "d"], ["y", "id"], "rejected"),
    ];
    expect(relationsSummary(relations)).toBe("2 relações aguardam sua decisão · 1 confirmada · 1 rejeitada · 1 pede atenção");
  });

  it("names relations kept with a caveat and relations that need review", () => {
    const relations = [
      relation("a", ["x", "a"], ["y", "id"], "confirmed", { toUnique: false, policy: "accept_multiplicity" }),
      relation("b", ["x", "b"], ["z", "id"], "confirmed", { toUnique: false }),
    ];
    expect(relationsSummary(relations)).toBe("1 relação para reavaliar · 1 com ressalva");
  });

  it("reads naturally when everything is decided", () => {
    expect(relationsSummary([relation("a", ["x", "a"], ["y", "id"], "confirmed")])).toBe("1 relação confirmada");
    expect(relationsSummary([relation("a", ["x", "a"], ["y", "id"], "rejected")])).toBe("1 relação rejeitada");
  });
});

describe("pathStandings", () => {
  const confirmed = relation("a", ["atendimentos", "cozinha_id"], ["cozinhas", "id"], "confirmed");
  const pending = relation("b", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "suggested", { toUnique: false, duplicates: 6 });

  it("authorizes a path only when every relation is usable", () => {
    expect(pathStandings([confirmed])).toEqual([{ key: "authorized", label: "autorizado para uso" }]);
  });

  it("keeps a path with pending decisions as structural and names its risks", () => {
    expect(pathStandings([pending, confirmed])).toEqual([
      { key: "structural", label: "só estrutural" },
      { key: "pending", label: "1 decisão pendente" },
      { key: "risk", label: "destino com ids repetidos" },
    ]);
  });

  it("separates an accepted multiplicity from a decision that needs review", () => {
    const caveat = relation("c", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "confirmed", { toUnique: false, policy: "accept_multiplicity" });
    const review = relation("d", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "confirmed", { toUnique: false });
    expect(pathStandings([caveat, confirmed])).toEqual([
      { key: "authorized", label: "autorizado com ressalva" },
      { key: "caveat", label: "multiplicidade aceita" },
    ]);
    expect(pathStandings([review])).toEqual([
      { key: "structural", label: "só estrutural" },
      { key: "review", label: "1 relação para reavaliar" },
    ]);
  });

  it("labels the route from the starting table", () => {
    expect(routeLabel("cozinhas", [confirmed])).toBe("cozinhas → atendimentos");
  });
});
