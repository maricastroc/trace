import { describe, expect, it } from "vitest";
import { cardinalityEnds, checksFor, coverageState, effectSentences, factsOf, overprintCounts, summaryOf } from "./evidence";
import { relation } from "./fixtures";

const meals = relation("r1", ["refeicoes", "cozinha_id"], ["cozinhas", "id"], "suggested", {
  ratio: 0.9744,
  matchedRows: 114,
  unmatchedRows: 3,
  unmatchedDistinct: 2,
  nullRows: 1,
  fromNonNull: 117,
  fromDistinct: 14,
  matchedDistinct: 12,
  toDistinct: 15,
  unreferencedRows: 2,
  near: [{ value: "187", candidate: "0187", kind: "leading_zeros" }],
});

const duplicated = relation("r2", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "suggested", { toUnique: false, duplicates: 6, nameMatched: false });

describe("summary and facts", () => {
  it("states coverage and a supported N:1 when the target is unique", () => {
    expect(summaryOf(meals)).toEqual({ text: "97,4% das linhas encontram par e o destino é único: a evidência sustenta N:1. 3 linhas ficam sem par.", warn: false });
    expect(factsOf(meals).map((f) => [f.value, f.label, f.bad])).toEqual([
      ["97,4%", "cobertura", false],
      ["único", "destino", false],
      ["N:1", "comprovada", false],
      ["0", "linhas a mais na junção", false],
    ]);
  });

  it("states the real effect of a join that multiplies rows", () => {
    const multiplied = relation("r9", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "suggested", {
      toUnique: false,
      duplicates: 6,
      ratio: 0.9875,
      matchedRows: 9634,
      fromNonNull: 9756,
      unmatchedRows: 122,
      effect: { source_rows: 9756, matched_rows: 9634, unmatched_rows: 122, inner_rows: 9700, left_rows: 9822, extra_rows: 66, multiplied_rows: 60, repeated_keys: 4 },
    });
    expect(summaryOf(multiplied).text).toContain("ligar as tabelas acrescenta 66 linhas de atendimentos");
    expect(factsOf(multiplied)[3]).toEqual({ key: "effect", value: "+66", label: "linhas na junção", bad: true });
    const sentences = effectSentences(multiplied)!;
    expect(sentences.inner).toBe("Na junção, 9.634 linhas com par viram 9.700: 66 linhas a mais, porque 60 linhas de atendimentos apontam para 4 ids repetidos.");
    expect(sentences.left).toBe("Na junção à esquerda, as 9.756 linhas de atendimentos viram 9.822, mantendo 122 linhas sem par ou vazias.");
    expect(checksFor(multiplied, [multiplied]).find((c) => c.key === "effect")!.state).toBe("fail");
  });

  it("never presents N:1 as proven when the target repeats ids", () => {
    expect(summaryOf(duplicated).warn).toBe(true);
    expect(summaryOf(duplicated).text).toContain("6 valores repetidos");
    const facts = factsOf(duplicated);
    expect(facts[1]).toMatchObject({ value: "6", label: "ids repetidos", bad: true });
    expect(facts[2]).toMatchObject({ value: "N:N", label: "observada", bad: true });
  });
});

describe("checksFor", () => {
  it("turns the backend evidence into checks, linking the ones that have rows", () => {
    const checks = checksFor(meals, [meals]);
    expect(checks.map((c) => [c.key, c.state, c.side ?? null])).toEqual([
      ["cov", "warn", null],
      ["uniq", "ok", null],
      ["card", "ok", null],
      ["effect", "ok", null],
      ["none", "warn", "from"],
      ["nulls", "warn", "from_null"],
      ["unref", "info", "to"],
      ["name", "ok", null],
      ["types", "ok", null],
      ["near", "hyp", null],
    ]);
    expect(checks.find((c) => c.key === "cov")!.text).toBe("97,4% das linhas de refeicoes com cozinha_id preenchido encontram o mesmo valor em cozinhas.id (114 de 117).");
    expect(checks.find((c) => c.key === "nulls")!.text).toBe("1 linha tem cozinha_id vazio e não pode se relacionar.");
    expect(checks.find((c) => c.key === "near")!.text).toContain("zeros à esquerda");
  });

  it("flags a repeated target, a weak name and active competitors", () => {
    const rival = relation("r3", ["atendimentos", "beneficiario_id"], ["cadastro", "id"]);
    const checks = checksFor(duplicated, [duplicated, rival, { ...rival, id: "r4", status: "rejected" }]);
    expect(checks.find((c) => c.key === "uniq")!.state).toBe("fail");
    expect(checks.find((c) => c.key === "card")!.text).toContain("N:1 não está comprovada");
    expect(checks.find((c) => c.key === "name")!.state).toBe("warn");
    expect(checks.filter((c) => c.key.startsWith("comp-")).map((c) => c.relationId)).toEqual(["r3"]);
  });

  it("grades coverage", () => {
    expect([coverageState(1), coverageState(0.95), coverageState(0.5)]).toEqual(["ok", "warn", "fail"]);
  });
});

describe("overprintCounts and cardinality ends", () => {
  it("splits distinct values into both sides without double counting", () => {
    const counts = overprintCounts(meals.evidence);
    expect(counts).toEqual({ fromDistinct: 14, toDistinct: 15, both: 12, fromOnly: 2, toOnly: 3 });
    expect(counts.both + counts.fromOnly).toBe(counts.fromDistinct);
    expect(counts.both + counts.toOnly).toBe(counts.toDistinct);
  });

  it("draws the observed cardinality at each end", () => {
    expect(cardinalityEnds("many_to_one")).toEqual({ from: "many", to: "one" });
    expect(cardinalityEnds("many_to_many")).toEqual({ from: "many", to: "many" });
    expect(cardinalityEnds("one_to_one")).toEqual({ from: "one", to: "one" });
  });
});
