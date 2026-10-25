import { describe, expect, it } from "vitest";
import { dataset, relation, version } from "./fixtures";
import { buildMapModel, competitorsOf, findPaths, neighborsOf, pathTables } from "./graph";

const meals = relation("r1", ["refeicoes", "cozinha_id"], ["cozinhas", "id"], "suggested", {
  ratio: 0.9744,
  nullRows: 1,
  near: [{ value: "187", candidate: "0187", kind: "leading_zeros" }],
});

function mealsModel(relations = [meals]) {
  return buildMapModel(
    [dataset("cozinhas", 15), dataset("refeicoes", 118)],
    {
      "v-cozinhas": version("cozinhas", [{ key: "id" }, { key: "nome", type: "text" }, { key: "municipio", type: "text", profile: { unique: false, distinct: 5 } }]),
      "v-refeicoes": version("refeicoes", [
        { key: "id" },
        { key: "cozinha_id", profile: { unique: false, nulls: 1, distinct: 12 } },
        { key: "data", type: "date", profile: { unique: false } },
      ]),
    },
    relations,
  );
}

describe("buildMapModel", () => {
  it("derives key and link roles from the relations, and keeps other fields hidden", () => {
    const model = mealsModel();
    const cozinhas = model.byKey.get("cozinhas")!;
    const refeicoes = model.byKey.get("refeicoes")!;

    expect(cozinhas.columns.map((c) => [c.key, c.role, c.relevant])).toEqual([
      ["id", "key", true],
      ["nome", null, false],
      ["municipio", null, false],
    ]);
    expect(refeicoes.columns.find((c) => c.key === "cozinha_id")).toMatchObject({ role: "fk", relevant: true });
    expect(refeicoes.columns.find((c) => c.key === "data")).toMatchObject({ role: null, relevant: false });
    expect(refeicoes.rows).toBe(118);
  });

  it("reports issues computed by the backend profile and evidence, with correct plurals", () => {
    const issues = mealsModel().byKey.get("refeicoes")!.columns.find((c) => c.key === "cozinha_id")!.issues;
    expect(issues).toEqual([
      { kind: "null", text: "1 vazio" },
      { kind: "near", text: "1 quase-par" },
    ]);
  });

  it("counts repeated ids of a relation target from the evidence", () => {
    const target = relation("r2", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "suggested", { toUnique: false, duplicates: 6 });
    const model = buildMapModel(
      [dataset("atendimentos", 9756), dataset("beneficiarios", 1248)],
      {
        "v-atendimentos": version("atendimentos", [{ key: "beneficiario_id", profile: { unique: false } }]),
        "v-beneficiarios": version("beneficiarios", [{ key: "id", profile: { unique: false, non_null: 1248, distinct: 1242 } }]),
      },
      [target],
    );
    expect(model.byKey.get("beneficiarios")!.columns[0].issues).toEqual([{ kind: "dup", text: "6 ids repetidos" }]);
  });

  it("ignores rejected relations for roles and skips tables whose version is not loaded", () => {
    const model = buildMapModel([dataset("cozinhas", 15), dataset("refeicoes", 118)], { "v-cozinhas": version("cozinhas", [{ key: "id" }]) }, [
      { ...meals, status: "rejected" },
    ]);
    expect(model.tables.map((t) => t.key)).toEqual(["cozinhas"]);
    expect(model.relations).toEqual([]);
    expect(model.byKey.get("cozinhas")!.columns[0].role).toBe("key");
  });
});

describe("validity declaration", () => {
  it("marks the declared start and end columns and keeps them visible", () => {
    const model = buildMapModel(
      [dataset("beneficiarios", 3, { start_column: "inicio", end_column: "fim", end_inclusive: true, declared_at: null })],
      { "v-beneficiarios": version("beneficiarios", [{ key: "inicio", type: "date" }, { key: "fim", type: "date" }, { key: "nome", type: "text" }]) },
      [],
    );
    const columns = model.byKey.get("beneficiarios")!.columns;
    expect(columns.map((c) => [c.key, c.validity, c.relevant])).toEqual([
      ["inicio", "start", true],
      ["fim", "end", true],
      ["nome", null, false],
    ]);
  });
});

describe("relations around a table", () => {
  const a = relation("a", ["atendimentos", "cozinha_id"], ["cozinhas", "id"], "confirmed");
  const b = relation("b", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"]);
  const c = relation("c", ["beneficiarios", "cozinha_id"], ["cozinhas", "id"]);
  const rejected = relation("x", ["atendimentos", "cozinha_id"], ["beneficiarios", "id"], "rejected");
  const rival = relation("y", ["atendimentos", "cozinha_id"], ["unidades", "id"]);

  it("finds competitors only among active relations from the same column", () => {
    expect(competitorsOf(a, [a, b, c, rejected, rival]).map((r) => r.id)).toEqual(["y"]);
    expect(competitorsOf(b, [a, b, c, rejected, rival])).toEqual([]);
  });

  it("lists neighbours through active relations", () => {
    expect([...neighborsOf("cozinhas", [a, b, c, rejected])].sort()).toEqual(["atendimentos", "beneficiarios", "cozinhas"]);
  });

  it("finds direct and indirect paths, shortest first, without rejected relations or cycles", () => {
    const paths = findPaths("atendimentos", "cozinhas", [a, b, c, rejected]);
    expect(paths.map((p) => p.map((r) => r.id))).toEqual([["a"], ["b", "c"]]);
    expect(pathTables("atendimentos", paths[1])).toEqual(["atendimentos", "beneficiarios", "cozinhas"]);
    expect(findPaths("cozinhas", "cozinhas", [a])).toEqual([]);
    expect(findPaths("atendimentos", "unidades", [a, b, c])).toEqual([]);
  });
});
