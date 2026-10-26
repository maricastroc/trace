import { describe, expect, it } from "vitest";
import type { QuestionSpec, RunDetail, RunStep } from "@/lib/types";
import { lossesBefore, stepViews } from "./steps";

function step(position: number, type: RunStep["type"], headline: string, counts: [number, number, number], stats: RunStep["stats"], extra: Partial<RunStep> = {}): RunStep {
  return {
    position,
    id: `s${position}`,
    type,
    title: type,
    summary: "",
    input_count: counts[0],
    output_count: counts[1],
    excluded_count: counts[2],
    duration_ms: 1,
    stats,
    join: null,
    plain: { headline, drops: {}, unit: "", input_unit: "" },
    ...extra,
  };
}

function run(steps: RunStep[], totals: RunDetail["totals"], groupKeys: { alias: string; column: string }[] = []): RunDetail {
  return {
    id: "r1",
    status: "succeeded",
    recipe_id: "q1",
    recipe_name: "Pergunta",
    recipe_revision: 1,
    result_count: totals?.groups ?? 1,
    tuple_count: 0,
    error: null,
    queued_at: "",
    started_at: null,
    finished_at: null,
    duration_ms: 1,
    totals,
    recipe: { id: "q1", name: "Pergunta", revision: 1 },
    current_recipe_revision: 1,
    recipe_deleted: false,
    recipe_changed_since: false,
    decisions: [],
    decisions_key: "",
    decision_changes: [],
    interpretation: { recorded: true, version: 1, recorded_at: null, criteria: [] },
    inputs: [
      {
        position: 0,
        alias: "beneficiaries",
        dataset_id: "d1",
        dataset_name: "beneficiaries",
        version_id: "v1",
        version_number: 1,
        columns: [],
        row_count: 464,
        latest_version_number: 1,
        newer_version_available: false,
      },
    ],
    steps,
    output_columns: groupKeys.map((key) => ({ key: key.column, label: key.column, role: "group_key" as const, type: "text" as const, source: { ...key, input: 1 } })),
  };
}

const count: QuestionSpec = { base_dataset_id: "d1", measure: { function: "count" }, period: null, dimension: null };

describe("step views", () => {
  it("follows the records from the file to the grouped result, with each loss beside its step", () => {
    const filter = step(1, "filter", "Mantém beneficiaries com data_de_nascimento de 01/01/2024 a 31/12/2024", [464, 6, 458], {
      excluded_by_reason: { condition_false: 455, null_value: 3, unconvertible: 0 },
    });
    filter.plain.drops = { condition_false: "data_de_nascimento fora de 01/01/2024 a 31/12/2024", null_value: "sem data_de_nascimento" };
    const join = step(2, "join", "Liga beneficiaries a kitchens por cozinha = cozinha; quem não encontra par continua, sem kitchens", [6, 6, 0], {
      matched_tuples: 6,
      unmatched_tuples: 0,
      null_key_tuples: 0,
      created_tuples: 6,
      excluded_by_reason: { no_match: 0, null_key: 0 },
    }, { join: { relationship_id: "rel", relationship_status: "confirmed", relationship_policy: null, direction: "forward", join_type: "left", probe: { alias: "beneficiaries", column: "cozinha", input: 0 }, lookup: { alias: "kitchens", column: "cozinha", input: 1 } } });
    const aggregate = step(3, "aggregate", "Conta os registros por cozinha e endereco", [6, 1, 0], { groups: 1, aggregated_tuples: 6 });
    const views = stepViews(run([filter, join, aggregate], { values: { resposta: 6 }, sum_of_groups: { resposta: 6 }, groups: 1 }, [
      { alias: "kitchens", column: "cozinha" },
      { alias: "kitchens", column: "endereco" },
    ]), count);

    expect(views.map((view) => view.kind)).toEqual(["source", "filter", "join", "aggregate"]);
    expect(views[0]).toMatchObject({ rows: 464, version: 1 });
    expect(views[1]).toMatchObject({
      input: 464,
      output: 6,
      losses: [
        { code: "filter.condition_false", text: "data_de_nascimento fora de 01/01/2024 a 31/12/2024", count: 455 },
        { code: "filter.null_value", text: "sem data_de_nascimento", count: 3 },
      ],
    });
    expect(views[2]).toMatchObject({ output: 6, left: true, matched: 6, withoutPartner: 0, copies: 0, losses: [], lookup: "kitchens" });
    expect(views[3]).toMatchObject({
      results: 1,
      grouped: true,
      facts: ["6 linhas organizadas em 1 grupo por kitchens.cozinha e kitchens.endereco", "Total contado: 6 linhas"],
    });
    expect(lossesBefore(views, 2)).toBe(458);
  });

  it("separates rows, distinct identities, repetitions, empties and copies made by a join", () => {
    const join = step(1, "join", "Liga atendimentos a beneficiarios", [100, 97, 5], {
      matched_tuples: 95,
      unmatched_tuples: 5,
      null_key_tuples: 0,
      created_tuples: 97,
      excluded_by_reason: { no_match: 5, null_key: 0 },
    });
    join.plain.drops = { no_match: "sem par em beneficiarios" };
    const aggregate = step(2, "aggregate", "Conta valores diferentes de beneficiario_id em todos os registros", [97, 1, 0], {
      groups: 1,
      ignored_values: { resposta: { null: 2, unconvertible: 0 } },
    });
    const distinct: QuestionSpec = { ...count, measure: { function: "count_distinct", column: "beneficiario_id" } };
    const views = stepViews(run([join, aggregate], { values: { resposta: 80, registros: 97 }, sum_of_groups: { resposta: 80, registros: 97 }, groups: 1 }), distinct);

    expect(views[1]).toMatchObject({ left: false, matched: 95, copies: 2, losses: [{ code: "join.no_match", text: "sem par em beneficiarios", count: 5 }] });
    const counted = stepViews(run([join, aggregate], { values: { resposta: 97 }, sum_of_groups: { resposta: 97 }, groups: 1 }), count);
    expect(counted[2]).toMatchObject({ facts: ["97 linhas entram no cálculo, sem agrupar: 1 resultado", "Total contado: 97 linhas", "Contando linhas, as cópias criadas pela ligação também entram no total"] });
    expect(views[2]).toMatchObject({
      grouped: false,
      facts: [
        "97 linhas entram no cálculo, sem agrupar: 1 resultado",
        "Total contado: 80 valores diferentes de beneficiario_id em 95 linhas preenchidas",
        "15 linhas repetem um beneficiario_id já contado e não somam",
        "2 linhas sem beneficiario_id não entram na contagem",
      ],
    });
  });

  it("never presents the number of groups as the total and says when the total is not the sum of groups", () => {
    const aggregate = step(1, "aggregate", "Conta valores diferentes de id por cozinha", [133, 12, 0], { groups: 12, ignored_values: { resposta: { null: 0, unconvertible: 0 } } });
    const views = stepViews(
      run([aggregate], { values: { resposta: 117, registros: 133 }, sum_of_groups: { resposta: 119, registros: 133 }, groups: 12 }, [{ alias: "cozinhas", column: "id" }]),
      { ...count, measure: { function: "count_distinct", column: "id" } },
    );
    expect(views[1]).toMatchObject({
      results: 12,
      facts: [
        "133 linhas organizadas em 12 grupos por cozinhas.id",
        "Total contado: 117 valores diferentes de id em 133 linhas preenchidas",
        "16 linhas repetem um id já contado e não somam",
        "Somando os grupos dá 119; o total é calculado sobre todas as linhas, não somado",
      ],
    });
  });
});
