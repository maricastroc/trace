import { describe, expect, it } from "vitest";
import { dataset, relation, version } from "@/features/mapa/model/fixtures";
import type { DatasetSummary, ValidityDeclaration } from "@/lib/types";
import { buildCatalog } from "./catalog";
import { answerNotes, groups, type Outcome } from "./answer";
import { defaultYear, monthRange, periodLabel } from "./period";
import {
  currentDimension,
  decodeQuestion,
  dimensionOptions,
  encodeQuestion,
  measureOptions,
  pathAlternatives,
  plainText,
  sentence,
  starterQuestion,
} from "./question";

const named = (key: string, name: string, rows: number, validity: ValidityDeclaration | null = null): DatasetSummary => ({ ...dataset(key, rows, validity), name });

const declared: ValidityDeclaration = { start_column: "data_cadastro", end_column: "data_desligamento", end_inclusive: true, declared_at: null };

function cadastro(validity: ValidityDeclaration | null = null, extra = [] as ReturnType<typeof relation>[]) {
  return buildCatalog(
    [named("cozinhas", "Cozinhas", 12), named("beneficiarios", "Beneficiários", 1248, validity), named("atendimentos", "Atendimentos", 9756)],
    {
      "v-cozinhas": version("cozinhas", [
        { key: "id", profile: { unique: true, distinct: 12 } },
        { key: "nome", type: "text", profile: { unique: true, distinct: 12 } },
        { key: "municipio", type: "text", profile: { unique: false, distinct: 4 } },
      ]),
      "v-beneficiarios": version("beneficiarios", [
        { key: "id", profile: { unique: false, distinct: 1242 } },
        { key: "nome", type: "text", profile: { unique: false, distinct: 1242 } },
        { key: "cozinha_id", profile: { unique: false, distinct: 12 } },
        { key: "data_cadastro", type: "date", profile: { unique: false, min: "2022-01-01", max: "2026-01-28" } },
        { key: "data_desligamento", type: "date", profile: { unique: false, min: "2022-09-11", max: "2026-01-27" } },
      ]),
      "v-atendimentos": version("atendimentos", [
        { key: "id", profile: { unique: true, distinct: 9756 } },
        { key: "data", type: "date", profile: { unique: false, min: "2025-01-01", max: "2025-12-31" } },
        { key: "beneficiario_id", profile: { unique: false, distinct: 1196 } },
        { key: "cozinha_id", profile: { unique: false, distinct: 12 } },
        { key: "refeicoes", type: "number", profile: { unique: false, distinct: 2 } },
      ]),
    },
    [
      relation("r-ben", ["beneficiarios", "cozinha_id"], ["cozinhas", "id"]),
      relation("r-att", ["atendimentos", "cozinha_id"], ["cozinhas", "id"], "confirmed"),
      relation("r-ref", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"], "suggested", { toUnique: false }),
      ...extra,
    ],
  );
}

describe("measure options", () => {
  it("distinguishes rows from different ids when the id repeats, and names ids reached through relations", () => {
    const catalog = cadastro();
    expect(measureOptions(catalog, catalog.byId.get("ds-beneficiarios")!).map((option) => option.label)).toEqual(["linhas", "beneficiários diferentes", "valores diferentes de cozinha_id"]);
    expect(measureOptions(catalog, catalog.byId.get("ds-atendimentos")!).map((option) => [option.label, option.measure])).toEqual([
      ["registros", { function: "count" }],
      ["valores diferentes de cozinha_id", { function: "count_distinct", column: "cozinha_id" }],
      ["valores diferentes de beneficiario_id", { function: "count_distinct", column: "beneficiario_id" }],
      ["soma de refeicoes", { function: "sum", column: "refeicoes" }],
    ]);
  });

  it("offers a sum for text columns only when every sample is a number", () => {
    const catalog = buildCatalog(
      [named("refeicoes", "Refeições", 118)],
      {
        "v-refeicoes": version("refeicoes", [
          { key: "id", profile: { unique: true } },
          { key: "quantidade", type: "text", profile: { unique: false, samples: ["140", "190"] } },
          { key: "obs", type: "text", profile: { unique: false, samples: ["140", "n/d"] } },
        ]),
      },
      [],
    );
    expect(measureOptions(catalog, catalog.tables[0]).map((option) => option.label)).toEqual(["registros", "soma de quantidade"]);
  });
});

describe("dimension options", () => {
  it("follows relations forward, labels keys by name and finds alternative paths to the same column", () => {
    const catalog = cadastro();
    const base = catalog.byId.get("ds-atendimentos")!;
    const options = dimensionOptions(catalog, base);
    expect(options.map((option) => [option.route, option.noun, option.labelColumn])).toEqual([
      ["atendimentos.beneficiario_id → beneficiarios", "beneficiario", null],
      ["atendimentos.cozinha_id → cozinhas", "cozinha", "nome"],
      ["atendimentos.cozinha_id → cozinhas.municipio", "municipio", null],
      ["atendimentos.beneficiario_id → beneficiarios.cozinha_id → cozinhas", "cozinha", "nome"],
      ["atendimentos.beneficiario_id → beneficiarios.cozinha_id → cozinhas.municipio", "municipio", null],
    ]);
    expect(pathAlternatives(catalog, base, options[1]).map((option) => option.via)).toEqual(["atendimentos.cozinha_id", "beneficiarios.cozinha_id"]);
  });

  it("ignores rejected relations", () => {
    const catalog = cadastro(null, [relation("r-bad", ["atendimentos", "id"], ["cozinhas", "id"], "rejected")]);
    expect(dimensionOptions(catalog, catalog.byId.get("ds-atendimentos")!).some((option) => option.relationships.includes("r-bad"))).toBe(false);
  });
});

describe("starter question and sentence", () => {
  it("starts from the table with declared validity and leaves the reading for the user", () => {
    const catalog = cadastro(declared);
    const question = starterQuestion(catalog)!;
    expect(question).toEqual({
      base_dataset_id: "ds-beneficiarios",
      measure: { function: "count_distinct", column: "id" },
      period: { kind: "validity", reading: null, from: "2025-01-01", to: "2025-12-31" },
      dimension: { relationships: ["r-ben"], column: "id", label_column: "nome", value: null },
    });
    expect(plainText(sentence(catalog, question))).toBe("Em beneficiários vigentes em 2025, quantos beneficiários diferentes por cozinha?");
    const pending = sentence(catalog, question).find((part) => typeof part !== "string" && part.kind === "periodKind");
    expect(pending).toMatchObject({ pending: true });
  });

  it("without validity starts from the largest dated table and phrases each reading", () => {
    const catalog = cadastro();
    const question = starterQuestion(catalog)!;
    expect(question.base_dataset_id).toBe("ds-atendimentos");
    expect(question.period).toEqual({ kind: "date", column: "data", from: "2025-01-01", to: "2025-12-31" });
    expect(plainText(sentence(catalog, question))).toBe("Em atendimentos com data em 2025, quantos registros por cozinha via atendimentos.cozinha_id?");

    const undeclared = starterQuestion(catalog, "ds-beneficiarios")!;
    expect(undeclared.period).toBeNull();
    expect(plainText(sentence(catalog, undeclared))).toBe("Em beneficiários, em qualquer data, quantos beneficiários diferentes por cozinha?");
    const people = { ...undeclared, measure: { function: "count" as const } };
    const kitchen = { ...people, dimension: { ...people.dimension!, value: "0101" }, period: { kind: "validity" as const, reading: "active_at_end" as const, from: "2025-01-01", to: "2025-12-31" } };
    expect(plainText(sentence(catalog, kitchen, "Cozinha Esperança"))).toBe("Em beneficiários que estavam vigentes no último dia de 2025, quantas linhas de Cozinha Esperança?");
    expect(currentDimension(catalog, catalog.byId.get("ds-beneficiarios")!, kitchen.dimension)?.noun).toBe("cozinha");
  });

  it("round-trips through the address bar and refuses malformed input", () => {
    const question = starterQuestion(cadastro())!;
    expect(decodeQuestion(encodeQuestion(question))).toEqual(question);
    expect(decodeQuestion("{nope")).toBeNull();
    expect(decodeQuestion(JSON.stringify({ base_dataset_id: 3 }))).toBeNull();
  });
});

describe("periods", () => {
  it("labels whole years and months and finds the last day of each month", () => {
    expect(periodLabel("2025-01-01", "2025-12-31")).toBe("2025");
    expect(periodLabel(...(Object.values(monthRange(2026, 9)) as [string, string]))).toBe("setembro de 2026");
    expect(monthRange(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodLabel("2025-03-01", "2025-05-31")).toBe("01/03/2025 a 31/05/2025");
  });

  it("prefers the last year only when it is at least half covered", () => {
    expect(defaultYear("2022-01-01", "2026-01-28")).toBe(2025);
    expect(defaultYear("2026-08-04", "2026-09-30")).toBe(2026);
    expect(defaultYear("2025-01-01", "2025-12-31")).toBe(2025);
  });
});

describe("answer notes", () => {
  const grouped: Outcome = {
    source: "preview",
    totals: { values: { resposta: 117, registros: 121 }, sum_of_groups: { resposta: 119, registros: 121 }, groups: 3 },
    columns: [
      { key: "id", label: "id", role: "group_key", type: "identifier", source: null },
      { key: "nome", label: "nome", role: "group_key", type: "text", source: null },
      { key: "resposta", label: "resposta", role: "measure", type: "number", function: "count_distinct", source: null },
    ],
    results: [
      { result_no: 1, values: { id: "0101", nome: "Cozinha Esperança", resposta: 60 }, contributor_count: 62 },
      { result_no: 2, values: { id: "0102", nome: "Cozinha Girassol", resposta: 57 }, contributor_count: 57 },
      { result_no: 3, values: { id: null, nome: null, resposta: 2 }, contributor_count: 2 },
    ],
    steps: [
      { position: 1, id: "ligacao_1", type: "join", title: "Junção", plain: null, input_count: 119, output_count: 121, excluded_count: 0, stats: { matched_tuples: 117, created_tuples: 119 } },
      { position: 2, id: "resposta", type: "aggregate", title: "Agregação", plain: null, input_count: 121, output_count: 3, excluded_count: 0, stats: { ignored_values: { resposta: { null: 0, unconvertible: 0 } } } },
    ],
  };
  const question = {
    base_dataset_id: "ds-beneficiarios",
    measure: { function: "count_distinct" as const, column: "id" },
    period: null,
    dimension: { relationships: ["r-ben"], column: "id", label_column: "nome", value: null },
  };

  it("explains repeated ids, copies from a join, the calculated total and the group without a match", () => {
    expect(answerNotes(question, grouped, "cozinha").map((note) => [note.kind, note.text])).toEqual([
      ["rep", "121 linhas: 4 repetem um id já contado e contam uma vez."],
      ["warn", "A ligação criou 2 linhas a mais porque o destino tem ids repetidos. Cada id conta uma vez por grupo, mas as cópias podem levar a mesma linha a mais de um grupo. No total, ela conta uma vez."],
      ["gran", "Somando os grupos dá 119; o total é 117. Quem aparece em mais de um grupo conta uma vez no total. O total é calculado, não somado."],
      ["lim", "O grupo sem valor de cozinha dá 2 e aparece separado."],
    ]);
  });

  it("does not promise that copies leave a distinct count unchanged when a cut follows the join", () => {
    const cut = { ...question, dimension: { ...question.dimension, value: "0101" } };
    const copies = answerNotes(cut, grouped, "cozinha").find((note) => note.kind === "warn")?.text;
    expect(copies).toBe(
      "A ligação criou 2 linhas a mais porque o destino tem ids repetidos. Cada id conta uma vez, mas entra no recorte se qualquer cópia tiver o valor escolhido: a mesma linha pode entrar no recorte de mais de um valor.",
    );
  });

  it("reads groups with their labels and keeps the empty key apart", () => {
    expect(groups(grouped).map((group) => [group.key, group.label, group.value])).toEqual([
      ["0101", "Cozinha Esperança", 60],
      ["0102", "Cozinha Girassol", 57],
      [null, "", 2],
    ]);
  });
});
