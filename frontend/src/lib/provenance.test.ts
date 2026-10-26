import { describe, expect, it } from "vitest";
import { type Basis, isAuditable, runProvenance, sameBasis, staleness } from "./provenance";
import type { RunDetail, RunInput, RunStep } from "./types";

function input(position: number, alias: string, versionId: string, extra: Partial<RunInput> = {}): RunInput {
  return {
    position,
    alias,
    dataset_id: `ds-${alias}`,
    dataset_name: alias,
    version_id: versionId,
    version_number: 1,
    columns: [],
    row_count: 10,
    latest_version_number: 1,
    newer_version_available: false,
    ...extra,
  };
}

function step(position: number, type: RunStep["type"], join: RunStep["join"] = null): RunStep {
  return {
    position,
    id: `s${position}`,
    type,
    title: type,
    summary: type,
    input_count: null,
    output_count: null,
    excluded_count: null,
    duration_ms: null,
    stats: null,
    join,
    plain: { headline: type, drops: {}, unit: "linhas", input_unit: "linhas" },
  };
}

function run(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "run-1",
    status: "succeeded",
    recipe_id: "rec-1",
    recipe_name: "Receita",
    recipe_revision: 2,
    result_count: 3,
    tuple_count: 30,
    error: null,
    queued_at: "2026-10-24T10:00:00Z",
    started_at: "2026-10-24T10:00:01Z",
    finished_at: "2026-10-24T10:00:02Z",
    duration_ms: 1000,
    recipe: { id: "rec-1", name: "Receita", revision: 2 },
    current_recipe_revision: 2,
    recipe_deleted: false,
    recipe_changed_since: false,
    decisions: [],
    decisions_key: "",
    decision_changes: [],
    interpretation: { recorded: true, version: 1, recorded_at: null, criteria: [] },
    inputs: [input(0, "refeicoes", "v-ref-1"), input(1, "cozinhas", "v-coz-1")],
    steps: [
      step(1, "filter"),
      step(2, "join", {
        relationship_id: "rel-1",
        relationship_status: "confirmed",
        relationship_policy: null,
        direction: "forward",
        join_type: "inner",
        probe: { alias: "refeicoes", column: "cozinha_id", input: 0 },
        lookup: { alias: "cozinhas", column: "id", input: 1 },
      }),
      step(3, "aggregate"),
    ],
    output_columns: null,
    ...overrides,
  };
}

describe("runProvenance", () => {
  it("records recipe revision, input versions and join decisions", () => {
    const provenance = runProvenance(run());
    expect(provenance.kind).toBe("run");
    expect(provenance.traceable).toBe(true);
    expect(provenance.basis.recipe).toEqual({ id: "rec-1", revision: 2 });
    expect(provenance.basis.inputs.map((i) => [i.alias, i.versionId])).toEqual([
      ["refeicoes", "v-ref-1"],
      ["cozinhas", "v-coz-1"],
    ]);
    expect(provenance.basis.decisions).toEqual([{ stepPosition: 2, relationshipId: "rel-1", joinType: "inner" }]);
  });
});

describe("sameBasis", () => {
  const base = runProvenance(run()).basis;

  it("is true for the same recipe revision, versions and decisions, in any order", () => {
    const reordered: Basis = { ...base, inputs: [...base.inputs].reverse() };
    expect(sameBasis(base, reordered)).toBe(true);
  });

  it("is false when any input uses another version", () => {
    const other = runProvenance(run({ inputs: [input(0, "refeicoes", "v-ref-2"), input(1, "cozinhas", "v-coz-1")] })).basis;
    expect(sameBasis(base, other)).toBe(false);
  });

  it("is false when the recipe revision differs", () => {
    expect(sameBasis(base, { ...base, recipe: { id: "rec-1", revision: 3 } })).toBe(false);
  });

  it("is false when a join decision changes", () => {
    expect(sameBasis(base, { ...base, decisions: [{ stepPosition: 2, relationshipId: "rel-1", joinType: "left" }] })).toBe(false);
  });
});

describe("isAuditable and staleness", () => {
  it("only a succeeded run can be audited; a preview never can", () => {
    expect(isAuditable(runProvenance(run()))).toBe(true);
    expect(isAuditable(runProvenance(run({ status: "running" })))).toBe(false);
    expect(isAuditable({ kind: "preview", traceable: false, basis: runProvenance(run()).basis, computedAt: "2026-10-24T10:00:00Z" })).toBe(false);
  });

  it("reports newer input versions and recipe changes from the backend flags", () => {
    const fresh = staleness(runProvenance(run()));
    expect(fresh).toEqual({ newerInputs: [], recipeChanged: false, current: true });

    const stale = staleness(
      runProvenance(run({ recipe_changed_since: true, inputs: [input(0, "refeicoes", "v1", { newer_version_available: true }), input(1, "cozinhas", "v2")] })),
    );
    expect(stale).toEqual({ newerInputs: ["refeicoes"], recipeChanged: true, current: false });
  });
});
