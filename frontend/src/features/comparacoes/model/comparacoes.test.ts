import { describe, expect, it } from "vitest";
import { dataset, relation, version } from "@/features/mapa/model/fixtures";
import { buildCatalog } from "@/features/perguntas/model/catalog";
import type { ComparisonExplanation, ComparisonSideCounts, ComparisonSummary, DatasetSummary } from "@/lib/types";
import { buildScene, C, P, rowsFor, unitFor, Y0 } from "./overprint";
import { answerSentence, causeGroups, causes, closes, explanationText, ledger, unitSentence, type Reading } from "./reconciliation";
import { labelsFor, labelsOf, readingOf, sameNumbers, titleOf } from "./result";
import {
  declarationFor,
  decodeSpec,
  defaultLabel,
  describeSelection,
  emptyDraft,
  encodeSpec,
  equivalenceOf,
  fromSpec,
  keyFromRelation,
  pairOf,
  sameSpec,
  suggestions,
  toSpec,
  withSide,
  type Draft,
} from "./spec";
import { focusOf, targetFromGroup, targetKey } from "./targets";

const named = (key: string, name: string, rows: number): DatasetSummary => ({ ...dataset(key, rows), name });

function cadastro(standing: "suggested" | "rejected" = "suggested") {
  return buildCatalog(
    [named("cozinhas", "Cozinhas", 12), named("beneficiarios", "Beneficiários", 1248), named("atendimentos", "Atendimentos", 9756)],
    {
      "v-cozinhas": version("cozinhas", [{ key: "id", profile: { unique: true, distinct: 12 } }]),
      "v-beneficiarios": version("beneficiarios", [
        { key: "id", profile: { unique: false, distinct: 1242 } },
        { key: "cozinha_id", profile: { unique: false, distinct: 12 } },
        { key: "data_cadastro", type: "date", profile: { unique: false, min: "2022-01-01", max: "2026-01-28" } },
        { key: "data_desligamento", type: "date", profile: { unique: false, min: "2022-09-11", max: "2026-01-27" } },
      ]),
      "v-atendimentos": version("atendimentos", [
        { key: "id", profile: { unique: true, distinct: 9756 } },
        { key: "data", type: "date", profile: { unique: false, min: "2025-01-01", max: "2025-12-31" } },
        { key: "beneficiario_id", profile: { unique: false, distinct: 1196 } },
        { key: "cozinha_id", profile: { unique: false, distinct: 12 } },
      ]),
    },
    [
      relation("r-ben", ["beneficiarios", "cozinha_id"], ["cozinhas", "id"]),
      relation("r-ref", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], standing, { toUnique: false }),
    ],
  );
}

const NONE: Record<ComparisonExplanation, number> = { excluded_in_other: 0, outside_other_period: 0, possible_match: 0, ambiguous_match: 0, variant_of_matched: 0, absent: 0 };

function counts(rows: number, distinct: number, empty = 0): ComparisonSideCounts {
  return { rows, rows_with_key: rows - empty, empty_rows: empty, distinct, repeated_identities: rows - empty > distinct ? 1 : 0, repeated_rows: rows - empty - distinct };
}

function summary(input: {
  a: ComparisonSideCounts;
  b: ComparisonSideCounts;
  shared: number;
  rule?: number;
  onlyA?: Partial<Record<ComparisonExplanation, number>>;
  onlyB?: Partial<Record<ComparisonExplanation, number>>;
  broken?: boolean;
}): ComparisonSummary {
  const onlyA = { ...NONE, ...input.onlyA };
  const onlyB = { ...NONE, ...input.onlyB };
  const sum = (record: Record<string, number>) => Object.values(record).reduce((total, value) => total + value, 0);
  const a = sum(onlyA);
  const b = sum(onlyB);
  return {
    unit: "identidades distintas",
    a: input.a,
    b: input.b,
    shared: input.shared,
    shared_by_rule: input.rule ?? 0,
    only_a: a,
    only_b: b,
    net_difference: input.a.distinct - input.b.distinct,
    unmatched: a + b,
    possible_matches: onlyA.possible_match,
    explanations: { only_a: onlyA, only_b: onlyB },
    fields: [],
    checks: [{ name: "net", formula: "", left: 0, right: 0, holds: !input.broken }],
  };
}

const reference = summary({ a: counts(1248, 1242), b: counts(9756, 1196), shared: 1179, onlyA: { possible_match: 14, absent: 49 }, onlyB: { possible_match: 14, absent: 3 } });
const accepted = summary({ a: counts(1248, 1242), b: counts(9756, 1196), shared: 1179, rule: 14, onlyA: { absent: 49 }, onlyB: { absent: 3 } });
const labels = { a: "cadastro", b: "atendimentos" };

describe("choosing the sets", () => {
  it("needs a table and an explicit identifier on both sides before comparing", () => {
    const draft = emptyDraft();
    expect(toSpec(draft)).toBeNull();
    const half: Draft = { ...draft, a: { ...draft.a, datasetId: "ds-beneficiarios", key: "id" } as Draft["a"], b: { ...draft.b, datasetId: "ds-atendimentos" } as Draft["b"] };
    expect(toSpec(half)).toBeNull();
    const full: Draft = { ...half, b: { ...half.b, key: "beneficiario_id" } as Draft["b"] };
    expect(toSpec(full)).toMatchObject({ a: { kind: "population", dataset_id: "ds-beneficiarios", key: "id", version_id: null }, b: { key: "beneficiario_id" }, rules: [] });
  });

  it("suggests keys only from relations of the Mapa, never from a column name", () => {
    const catalog = cadastro();
    expect(keyFromRelation(catalog, "ds-atendimentos", { table: "ds-beneficiarios", key: "id" })?.key).toBe("beneficiario_id");
    expect(keyFromRelation(catalog, "ds-atendimentos", { table: "ds-beneficiarios", key: "cozinha_id" })).toBeNull();
    expect(keyFromRelation(cadastro("rejected"), "ds-atendimentos", { table: "ds-beneficiarios", key: "id" })).toBeNull();
  });

  it("offers visible suggestions from relations, the larger population first, with a period only when the date is unambiguous", () => {
    const list = suggestions(cadastro());
    expect(list.map((s) => s.title)).toEqual(["Beneficiários × Atendimentos com data em 2025", "Cozinhas × Beneficiários"]);
    expect(list[0].reason).toBe("A relação atendimentos.beneficiario_id → beneficiarios.id do Mapa sugere estas colunas; atendimentos filtrada por data.");
    expect(list[0].draft.b).toMatchObject({ datasetId: "ds-atendimentos", key: "beneficiario_id", period: { kind: "date", column: "data", from: "2025-01-01", to: "2025-12-31" } });
    expect(list[1].draft.b).toMatchObject({ datasetId: "ds-beneficiarios", period: null });
    expect(suggestions(cadastro("rejected")).map((s) => s.title)).toEqual(["Cozinhas × Beneficiários"]);
  });

  it("suggests comparing the last two versions by a key that does not repeat", () => {
    const list = suggestions(cadastro(), {
      "ds-atendimentos": [
        { id: "v1", number: 1 },
        { id: "v3", number: 3 },
        { id: "v2", number: 2 },
      ],
    });
    const versions = list.find((s) => s.id === "ver:ds-atendimentos");
    expect(versions?.title).toBe("Atendimentos: versão 2 × versão 3");
    expect(versions?.draft.a).toMatchObject({ versionId: "v2", key: "id" });
    expect(versions?.draft.b).toMatchObject({ versionId: "v3", key: "id" });
    expect(list.some((s) => s.id === "ver:ds-beneficiarios")).toBe(false);
  });

  it("names each side readably from its metadata unless the person names it", () => {
    const catalog = cadastro();
    const [reference] = suggestions(catalog);
    expect(defaultLabel(reference.draft.a, { catalog })).toBe("Beneficiários");
    expect(defaultLabel(reference.draft.b, { catalog })).toBe("Atendimentos com data em 2025");
    const spec = toSpec({ ...reference.draft, b: { ...reference.draft.b, label: "Atendidos em 2025" } }, { catalog })!;
    expect([spec.a.label, spec.b.label]).toEqual(["Beneficiários", "Atendidos em 2025"]);
    const validity = { ...reference.draft.a, period: { kind: "validity" as const, reading: "active_any" as const, from: "2025-01-01", to: "2025-12-31" } };
    expect(defaultLabel(validity, { catalog })).toBe("Beneficiários que estiveram ativos em algum momento de 2025");
    const versioned = { ...reference.draft.a, versionId: "v1" };
    expect(defaultLabel(versioned, { catalog, versions: { "ds-beneficiarios": [{ id: "v1", number: 1 }] } })).toBe("Beneficiários (versão 1)");
    const imported = buildCatalog([dataset("beneficiaries_25_10_2026", 463)], { "v-beneficiaries_25_10_2026": version("beneficiaries_25_10_2026", [{ key: "beneficiario" }]) }, []);
    expect(defaultLabel({ ...emptyDraft().a, datasetId: "ds-beneficiaries_25_10_2026", key: "beneficiario" }, { catalog: imported })).toBe("Beneficiaries 25 10 2026");
  });

  it("asks for an explicit declaration unless the same column or a confirmed relation links the fields", () => {
    const catalog = cadastro();
    const draft = suggestions(catalog)[0].draft;
    const pair = pairOf(draft)!;
    expect(equivalenceOf(catalog, pair, null)).toMatchObject({ status: "unconfirmed", relation: { id: "r-ref", standing: "suggested" } });
    expect(toSpec(draft, { catalog })?.equivalence).toBeUndefined();

    const declared = { ...draft, equivalence: declarationFor(pair) };
    expect(equivalenceOf(catalog, pair, declared.equivalence).status).toBe("declared");
    expect(toSpec(declared, { catalog })?.equivalence).toEqual({ a: { dataset_id: "ds-beneficiarios", key: "id" }, b: { dataset_id: "ds-atendimentos", key: "beneficiario_id" } });

    const changed = { ...declared, b: { ...declared.b, key: "cozinha_id" } };
    expect(equivalenceOf(catalog, pairOf(changed), changed.equivalence).status).toBe("unconfirmed");
    expect(toSpec(changed, { catalog })?.equivalence).toBeUndefined();

    const sameField = { ...draft, b: { ...draft.a, period: { kind: "date" as const, column: "data_cadastro", from: "2025-01-01", to: "2025-12-31" } } };
    expect(equivalenceOf(catalog, pairOf(sameField), null).status).toBe("same_field");

    const confirmed = buildCatalog(
      [named("cozinhas", "Cozinhas", 12), named("atendimentos", "Atendimentos", 9756)],
      {
        "v-cozinhas": version("cozinhas", [
          { key: "id", profile: { unique: true, distinct: 12 } },
          { key: "municipio", type: "text" },
        ]),
        "v-atendimentos": version("atendimentos", [
          { key: "id", profile: { unique: true, distinct: 9756 } },
          { key: "cozinha_id", profile: { unique: false, distinct: 12 } },
          { key: "beneficiario_id", profile: { unique: false, distinct: 1196 } },
        ]),
      },
      [
        relation("r-att", ["atendimentos", "cozinha_id"], ["cozinhas", "id"], "confirmed"),
        relation("r-one", ["atendimentos", "id"], ["cozinhas", "id"], "confirmed"),
        relation("r-many", ["atendimentos", "beneficiario_id"], ["cozinhas", "municipio"], "confirmed", { policy: "accept_multiplicity", toUnique: false }),
      ],
    );
    const kitchens = { a: { table: "ds-cozinhas", key: "id" }, b: { table: "ds-atendimentos", key: "cozinha_id" } };
    expect(equivalenceOf(confirmed, kitchens, null)).toMatchObject({ status: "relation", gap: null });
    expect(equivalenceOf(confirmed, { ...kitchens, b: { table: "ds-atendimentos", key: "id" } }, null)).toMatchObject({ status: "unconfirmed", gap: "one_to_one" });
    const many = { a: { table: "ds-atendimentos", key: "beneficiario_id" }, b: { table: "ds-cozinhas", key: "municipio" } };
    expect(equivalenceOf(confirmed, many, null)).toMatchObject({ status: "unconfirmed", gap: "multiplicity" });
    expect(equivalenceOf(confirmed, many, declarationFor(many)).status).toBe("declared");
    expect(equivalenceOf(confirmed, { ...kitchens, a: { table: "ds-cozinhas", key: "municipio" } }, null)).toEqual({ status: "unconfirmed", relation: null, gap: "none" });
    expect(equivalenceOf(catalog, null, null).status).toBe("incomplete");
  });

  it("drops a declaration as soon as either column changes, even if it changes back", () => {
    const catalog = cadastro();
    const draft = suggestions(catalog)[0].draft;
    const declared = { ...draft, equivalence: declarationFor(pairOf(draft)!) };
    expect(withSide(declared, "a", { ...declared.a, label: "Cadastro" }).equivalence).not.toBeNull();
    const changed = withSide(declared, "b", { ...declared.b, key: "cozinha_id" });
    expect(changed.equivalence).toBeNull();
    expect(withSide(changed, "b", { ...changed.b, key: "beneficiario_id" }).equivalence).toBeNull();
  });

  it("keeps suggested names as suggestions when a comparison is edited again", () => {
    const catalog = cadastro();
    const spec = toSpec({ ...suggestions(catalog)[0].draft, a: { ...suggestions(catalog)[0].draft.a, label: "Cadastro completo" } }, { catalog })!;
    const draft = fromSpec(spec, {}, { catalog });
    expect([draft.a.label, draft.b.label]).toEqual(["Cadastro completo", ""]);
  });

  it("round-trips the definition and treats rule order as irrelevant", () => {
    const spec = toSpec({ ...suggestions(cadastro())[0].draft, rules: ["leading_zeros", "case_and_spacing"] })!;
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
    expect(sameSpec(spec, { ...spec, rules: ["case_and_spacing", "leading_zeros"] })).toBe(true);
    expect(sameSpec(spec, { ...spec, rules: [] })).toBe(false);
    expect(decodeSpec("{not json")).toBeNull();
    expect(decodeSpec(JSON.stringify({ a: { kind: "x" }, b: {} }))).toBeNull();
  });

  it("describes each selection without inventing what it is", () => {
    expect(describeSelection({ kind: "population", period: null, dimension: null, steps: [] })).toBe("todas as linhas");
    expect(describeSelection({ kind: "population", period: { kind: "date", column: "data", from: "2025-01-01", to: "2025-12-31" }, dimension: null, steps: [] })).toBe(
      "data em 2025",
    );
    expect(
      describeSelection({
        kind: "population",
        period: { kind: "validity", reading: "active_any", from: "2025-01-01", to: "2025-12-31" },
        dimension: { relationships: [], column: "cozinha_id", label_column: null, value: "0105" },
        steps: [],
      }),
    ).toBe("estiveram ativos em algum momento de 2025 · cozinha_id = 0105");
  });
});

describe("reconciliation view", () => {
  it("separates the net difference from the identities without a pair", () => {
    const text = answerSentence(reference, labels);
    expect(text).toContain("A diferença nos totais é menor que o número de identidades sem par");
    expect(text).toContain("as que só existem em atendimentos compensam, na soma, parte das que só existem em cadastro");
    expect(text).toContain("14 de cada lado têm um possível par escrito de outro jeito, que ainda não conta");
    expect(titleOf(reference, labels)).toBe("Por que 1.242 identidades em cadastro e 1.196 em atendimentos?");
  });

  it("closes the account as a ledger whose parts add up", () => {
    const rows = ledger(reference, labels, causes(reference, labels));
    expect(rows.map((row) => [row.op, row.value, row.parts])).toEqual([
      ["", 1242, []],
      ["−", 63, [14, 49]],
      ["+", 17, [14, 3]],
      ["=", 1196, []],
    ]);
    expect(rows[0].value - rows[1].value + rows[2].value).toBe(rows[3].value);
    expect(closes(reference)).toBe(true);
    expect(closes({ ...reference, checks: [{ name: "net", formula: "", left: 1, right: 2, holds: false }] })).toBe(false);
  });

  it("keeps hypotheses apart from proven causes", () => {
    const groups = causeGroups(causes(reference, labels), labels);
    expect(groups.map((group) => [group.title, group.items.map((item) => `${item.side}:${item.explanation}:${item.count}`)])).toEqual([
      ["Comprovado · só em cadastro", ["a:absent:49"]],
      ["Possível · não conta como par", ["a:possible_match:14", "b:possible_match:14"]],
      ["Comprovado · só em atendimentos", ["b:absent:3"]],
    ]);
  });

  it("recalculates after the rule without changing the net difference", () => {
    expect(accepted.net_difference).toBe(reference.net_difference);
    expect(ledger(accepted, labels, causes(accepted, labels)).map((row) => row.value)).toEqual([1242, 49, 3, 1196]);
    expect(answerSentence(accepted, labels)).toContain("Com a regra aceita, 14 pares");
    expect(sameNumbers(reference, accepted)).toBe(false);
  });

  it("speaks plainly about identical sets, one-sided sets and equal totals", () => {
    const same = summary({ a: counts(10, 10), b: counts(10, 10), shared: 10 });
    expect(answerSentence(same, labels)).toBe("Os dois lados têm exatamente as mesmas identidades.");
    expect(titleOf(same, labels)).toBe("cadastro e atendimentos têm as mesmas 10 identidades");
    const oneSided = summary({ a: counts(12, 12), b: counts(10, 10), shared: 10, onlyA: { absent: 2 } });
    expect(answerSentence(oneSided, labels)).toBe("Todas as identidades de atendimentos estão em cadastro; a diferença são as que só cadastro tem.");
    const equal = summary({ a: counts(15, 15), b: counts(118, 15, 1), shared: 13, onlyA: { absent: 2 }, onlyB: { absent: 1, variant_of_matched: 1 } });
    expect(answerSentence(equal, labels)).toContain("Os totais são iguais, mas não são as mesmas identidades");
    expect(titleOf(equal, labels)).toBe("Por que cadastro e atendimentos têm 15 identidades cada, mas não as mesmas?");
    expect(unitSentence(equal, labels)).toBe(
      "Contado em identidades distintas. cadastro tem 15 linhas = 15 identidades; atendimentos tem 118 linhas = 15 identidades (102 linhas repetidas; 1 sem identificador).",
    );
  });

  it("handles empty sides", () => {
    const empty = summary({ a: counts(0, 0), b: counts(3, 3), shared: 0, onlyB: { absent: 3 } });
    expect(ledger(empty, labels, causes(empty, labels)).map((row) => row.value)).toEqual([0, 0, 3, 3]);
    expect(buildScene(empty).cells.filter((cell) => cell.side === "a")).toHaveLength(0);
  });

  it("labels two sides of the same table apart", () => {
    const side = {
      kind: "population" as const,
      label: "beneficiarios",
      dataset: { id: "d", key: "beneficiarios", name: "Beneficiários" },
      version: { id: "v", number: 1, rows: 1 },
      key: "id",
      key_type: null,
      run_id: null,
      period: null,
      dimension: null,
      steps: [],
    };
    expect(labelsOf({ a: side, b: side })).toEqual({ a: "Beneficiários (A)", b: "Beneficiários (B)" });
    expect(labelsOf({ a: { ...side, label: "Cadastro anterior" }, b: { ...side, label: "Cadastro atualizado" } })).toEqual({ a: "Cadastro anterior", b: "Cadastro atualizado" });
  });
});

describe("what each side represents", () => {
  const kitchens = summary({ a: counts(15, 15), b: counts(118, 15, 1), shared: 13, onlyA: { absent: 2 }, onlyB: { absent: 1, variant_of_matched: 1 } });
  const named2 = { a: "Cozinhas", b: "Refeições com data em 2026" };
  const registry: Reading = { kind: "registry_references", registry: "a", entity: "Cozinhas", selections: { a: "todas as linhas", b: "data em 2026" }, attribution: "sources" };

  it("reads a registry against the identifiers that reference it, without calling absence an error", () => {
    expect(answerSentence(kitchens, named2, registry)).toBe(
      "As duas seleções têm 15 identificadores distintos, mas representam populações diferentes: 15 cadastrados em Cozinhas e 15 de Cozinhas referenciados em Refeições com data em 2026. 13 aparecem nas duas. 2 estão no cadastro, mas não aparecem como referência nesta seleção; 2 são referenciados sem correspondência no cadastro selecionado. Ficar de fora de uma seleção não indica, por si só, inatividade nem erro.",
    );
    const labels = { ...named2, roles: { registry: "a" as const, references: "b" as const } };
    expect(explanationText("absent", "a", labels).title).toBe("não aparecem como referência em Refeições com data em 2026");
    expect(explanationText("absent", "b", labels).title).toBe("sem correspondência no cadastro selecionado");
    expect(explanationText("absent", "b", labels).rule).toContain("não comprova, por si só, um erro de cadastro");
    expect(explanationText("absent", "b", named2).title).toBe("sem nenhuma correspondência em Cozinhas");
  });

  it("reads two selections of the same column as the same kind of identifier", () => {
    const periods = summary({ a: counts(1248, 1242), b: counts(320, 318), shared: 318, onlyA: { excluded_in_other: 924 } });
    const same: Reading = {
      kind: "same_field",
      registry: null,
      entity: "Beneficiários",
      selections: { a: "todas as linhas", b: "data_cadastro em 2024" },
      attribution: "criteria",
    };
    expect(answerSentence(periods, { a: "Beneficiários", b: "Beneficiários com data_cadastro em 2024" }, same)).toBe(
      "São duas seleções de Beneficiários pela mesma coluna, então os identificadores têm o mesmo significado nos dois lados. 318 aparecem nas duas; 924 só em Beneficiários e 0 só em Beneficiários com data_cadastro em 2024. As definições diferem só no critério de seleção.",
    );
  });

  it("stays neutral without structured evidence and never invents a meaning", () => {
    const uneven = summary({ a: counts(464, 463), b: counts(15, 5), shared: 0, onlyA: { absent: 463 }, onlyB: { absent: 5 } });
    const unknown: Reading = { kind: "unknown", registry: null, entity: null, selections: { a: "todas as linhas", b: "todas as linhas" }, attribution: "sources" };
    const text = answerSentence(uneven, { a: "Pessoas", b: "Cozinhas" }, unknown);
    expect(text).toBe("Nenhuma identidade aparece nos dois lados: por estas colunas, os conjuntos não têm nada em comum.");
    expect(text).not.toMatch(/cadastr|referenc|\bentidade/);
    expect(unitSentence(uneven, { a: "Pessoas", b: "Cozinhas" })).toContain("Pessoas tem 464 linhas = 463 identidades (1 linha repetida)");
  });

  it("takes the reading from what the comparison stored, not from the current Mapa", () => {
    const sides = {
      a: {
        kind: "population" as const,
        label: "Cozinhas",
        dataset: { id: "k", key: "cozinhas", name: "Cozinhas" },
        version: { id: "v", number: 1, rows: 15 },
        key: "id",
        key_type: null,
        run_id: null,
        period: null,
        dimension: null,
        steps: [],
      },
      b: {
        kind: "population" as const,
        label: "Refeições com data em 2026",
        dataset: { id: "r", key: "refeicoes", name: "Refeições" },
        version: { id: "w", number: 1, rows: 118 },
        key: "cozinha_id",
        key_type: null,
        run_id: null,
        period: { kind: "date" as const, column: "data", from: "2026-01-01", to: "2026-12-31" },
        dimension: null,
        steps: [],
      },
    };
    const equivalence = {
      status: "relation" as const,
      a: { dataset_id: "k", dataset: "cozinhas", key: "id", name: "cozinhas.id" },
      b: { dataset_id: "r", dataset: "refeicoes", key: "cozinha_id", name: "refeicoes.cozinha_id" },
      relationship_id: "rel",
      relationship_standing: "confirmed" as const,
      statement: "",
      reading: { kind: "registry_references" as const, registry: "a" as const, entity: { dataset: "cozinhas", name: "Cozinhas" }, key_unique: true },
    };
    expect(labelsFor({ sides, equivalence }).roles).toEqual({ registry: "a", references: "b" });
    expect(readingOf({ sides, equivalence, attribution: { kind: "sources", differences: [], statement: "" } })).toEqual({
      kind: "registry_references",
      registry: "a",
      entity: "Cozinhas",
      selections: { a: "todas as linhas", b: "data em 2026" },
      attribution: "sources",
    });
    expect(readingOf({ sides, equivalence: { ...equivalence, reading: undefined }, attribution: { kind: "sources", differences: [], statement: "" } })).toBeNull();
    expect(labelsFor({ sides, equivalence: null }).roles).toBeUndefined();
  });
});

describe("overprint", () => {
  it("raises the trays into the empty space when nothing is shared", () => {
    const uneven = summary({ a: counts(464, 463), b: counts(15, 5), shared: 0, onlyA: { absent: 463 }, onlyB: { absent: 5 } });
    const scene = buildScene(uneven);
    expect(scene.trayY).toBe(Y0 + 108);
    expect(scene.height).toBeLessThan(scene.gridBottom + 122 + 13 * P);
    const stage3 = scene.positions[3];
    expect(stage3.every((point) => point.y >= scene.trayY && point.y + C <= scene.height)).toBe(true);
    expect(new Set(stage3.map((point) => `${point.x},${point.y}`)).size).toBe(468);
    const shared = buildScene(reference);
    expect(shared.trayY).toBe(shared.gridBottom + 122);
  });

  it("draws one square per identity, or honest blocks when the sets are large", () => {
    expect(unitFor(reference)).toBe(1);
    const large = summary({ a: counts(24000, 24000), b: counts(21780, 21780), shared: 20408, onlyA: { absent: 3592 }, onlyB: { absent: 1372 } });
    expect(unitFor(large)).toBe(20);
    const scene = buildScene(large);
    const filled = (side: "a" | "b") => scene.cells.filter((cell) => cell.side === side).reduce((total, cell) => total + cell.fill, 0) * scene.unit;
    expect(Math.round(filled("a"))).toBe(24000);
    expect(Math.round(filled("b"))).toBe(21780);
  });

  it("frames very unequal sets without distorting the counts", () => {
    const uneven = summary({ a: counts(463, 463), b: counts(5, 5), shared: 0, onlyA: { absent: 463 }, onlyB: { absent: 5 } });
    const scene = buildScene(uneven, { a: 380, b: 360 });
    expect(scene.cells.filter((cell) => cell.side === "a")).toHaveLength(463);
    expect(scene.cells.filter((cell) => cell.side === "b")).toHaveLength(5);
    expect(scene.rows).toBe(rowsFor(463));
    expect(scene.matched.cols).toBe(0);
    expect(scene.width).toBeLessThan(1360);
    const xs = scene.positions[2].map((point) => point.x);
    expect(Math.abs(Math.min(...xs) - (scene.width - Math.max(...xs) - C))).toBeLessThanOrEqual(P);
    for (const stage of [1, 2] as const) expect(new Set(scene.positions[stage].map((point) => `${point.x},${point.y}`)).size).toBe(468);
    const a2 = scene.positions[2].filter((_, i) => scene.cells[i].side === "a").map((point) => point.x);
    const b2 = scene.positions[2].filter((_, i) => scene.cells[i].side === "b").map((point) => point.x);
    expect(Math.min(...b2) - (Math.max(...a2) + C)).toBeGreaterThanOrEqual(2 * P);
    expect(scene.positions[1].every((point) => point.x >= 0 && point.x + C <= scene.width)).toBe(true);
  });

  it("uses fewer rows for small sets and keeps the large reference layout", () => {
    expect(rowsFor(15)).toBe(6);
    expect(rowsFor(463)).toBe(16);
    expect(rowsFor(1242)).toBe(24);
    const small = buildScene(summary({ a: counts(15, 15), b: counts(118, 15, 1), shared: 13, onlyA: { absent: 2 }, onlyB: { absent: 1, variant_of_matched: 1 } }));
    expect(small.rows).toBe(6);
    expect(small.gridBottom).toBeLessThan(small.trayY);
    expect(small.height).toBeLessThan(400);
  });

  it("puts the shared identities of both sides in the same place, so the colors overprint", () => {
    const scene = buildScene(accepted);
    for (const stage of [2, 3, 4] as const) {
      const at = (side: "a" | "b") =>
        scene.cells.flatMap((cell, i) =>
          cell.side === side && (cell.group === "shared" || cell.group === "rule") ? [`${scene.positions[stage][i].x},${scene.positions[stage][i].y}`] : [],
        );
      expect(at("a")).toEqual(at("b"));
      expect(at("a")).toHaveLength(1193);
    }
  });

  it("files each cause in its own tray, hypotheses on the dotted shelf, without overlaps", () => {
    const scene = buildScene(reference);
    expect(scene.trays.map((tray) => `${tray.side}:${tray.group}:${tray.count}`)).toEqual(["a:absent:49", "a:possible_match:14", "b:possible_match:14", "b:absent:3"]);
    expect(scene.shelves.map((shelf) => shelf.key)).toEqual(["a", "possible", "b"]);
    for (let i = 1; i < scene.trays.length; i++) expect(scene.trays[i].x).toBeGreaterThanOrEqual(scene.trays[i - 1].x + scene.trays[i - 1].width);
    for (const stage of [1, 2, 3, 4] as const) {
      for (const point of scene.positions[stage]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x + C).toBeLessThanOrEqual(scene.width);
        expect(point.y + C).toBeLessThanOrEqual(scene.height);
      }
    }
  });

  it("opens the hypothesis from the possible matches and a cause from any other tray", () => {
    expect(targetFromGroup("b", "possible_match", reference)).toEqual({ kind: "hypothesis" });
    expect(targetFromGroup("a", "absent", reference)).toEqual({ kind: "cause", side: "a", explanation: "absent" });
    expect(targetFromGroup("a", "rule", accepted)).toEqual({ kind: "rule" });
    expect([...focusOf({ kind: "hypothesis" })]).toEqual(["a:possible_match", "b:possible_match"]);
    expect(targetKey({ kind: "cause", side: "b", explanation: "variant_of_matched" })).toBe("cause:b:variant_of_matched");
  });
});
