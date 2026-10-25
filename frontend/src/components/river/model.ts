import type { DatasetSummary, Flows, OutputColumn, Recipe, Relationship, RelationshipStatus, ResultRow, RunDetail, StepPlain } from "@/lib/types";

export const PALETTE = [
  { fill: "#2b4be0", text: "#2b4be0", soft: "#dfe4fb" },
  { fill: "#e5532d", text: "#c6401b", soft: "#f9dfd6" },
  { fill: "#0e8f78", text: "#0b7f6a", soft: "#d5ede7" },
  { fill: "#e2a31c", text: "#9a6a00", soft: "#f6e8c6" },
  { fill: "#8a3fa8", text: "#7c3aa0", soft: "#ead9f1" },
  { fill: "#1f7fc4", text: "#1a6fb0", soft: "#d7e7f4" },
  { fill: "#c23b6e", text: "#b8336a", soft: "#f3d9e3" },
  { fill: "#6b8a1e", text: "#5a7417", soft: "#e3ebcf" },
];

export const OTHERS_COLOR = { fill: "#9a9282", text: "#5d564b", soft: "#e6e1d6" };

export type RiverState = "planned" | "queued" | "running" | "failed" | "succeeded";

export type RiverStep = {
  position: number;
  type: "filter" | "join" | "aggregate";
  title: string;
  headline: string;
  detail: string;
  unit: string;
  inputUnit: string;
  input: number | null;
  output: number | null;
  excluded: number;
  drops: { code: string; label: string; count: number }[];
  lookup?: {
    alias: string;
    name: string;
    rows: number | null;
    unreferenced: number;
    nullKey: number;
    status: RelationshipStatus | undefined;
    relationshipId?: string;
    multiplied: number;
    created: number;
    matched: number;
  };
};

export type RiverResult = {
  key: string;
  resultNo: number | null;
  resultNos: number[];
  label: string;
  sum: string | number | null;
  records: number;
  color: (typeof PALETTE)[number];
  base: number;
  trace: Record<number, number>;
  related: Record<number, number>;
};

export type RiverModel = {
  state: RiverState;
  source: { alias: string; name: string; rows: number | null; version: number | null; input: number };
  steps: RiverStep[];
  lastStage: number;
  joinStage: number | null;
  groupFromStage: number;
  results: RiverResult[];
  totalResults: number;
  baseContributors: number | null;
  multiplied: boolean;
  measure: { key: string; caption: string } | null;
  failure: { step: number | null; message: string } | null;
  inputs: { position: number; alias: string; name: string; rows: number | null; versionId: string; versionNumber: number }[];
};

const FALLBACK_DROP: Record<string, string> = {
  condition_false: "não atendem à condição",
  null_value: "valor vazio",
  unconvertible: "valor fora do formato",
  no_match: "sem par",
  null_key: "chave vazia",
};

export function dropLabel(model: { steps: RiverStep[] }, step: number, code: string, fallback: string) {
  const short = code.includes(".") ? code.slice(code.indexOf(".") + 1) : code;
  return model.steps.find((s) => s.position === step)?.drops.find((d) => d.code === short)?.label ?? fallback;
}

export function groupLabel(columns: OutputColumn[], values: Record<string, string | number | null>, resultNo: number) {
  const keys = columns.filter((c) => c.role === "group_key");
  if (keys.length === 0) return `linha ${resultNo}`;
  return keys.map((c) => (values[c.key] === null || values[c.key] === undefined ? "sem valor" : String(values[c.key]))).join(" · ");
}

export function buildRiverModel(
  recipe: Recipe,
  run: RunDetail | null,
  flows: Flows | undefined,
  results: ResultRow[] | undefined,
  relationships: Relationship[],
  datasets: DatasetSummary[],
): RiverModel {
  const state: RiverState = !run ? "planned" : run.status;
  const rowsByDataset = new Map(datasets.map((d) => [d.id, d.latest_version?.row_count ?? null]));
  const statusById = new Map(relationships.map((r) => [r.id, r.status]));

  const inputs = run
    ? run.inputs.map((i) => ({ position: i.position, alias: i.alias, name: i.dataset_name, rows: i.row_count, versionId: i.version_id, versionNumber: i.version_number }))
    : recipe.compiled.inputs.map((i) => ({
        position: i.position,
        alias: i.alias,
        name: i.dataset_name,
        rows: rowsByDataset.get(i.dataset_id) ?? null,
        versionId: i.version_id,
        versionNumber: i.version_number,
      }));

  const executed = state === "succeeded";
  const sourceSteps = run
    ? run.steps.map((s) => ({
        position: s.position,
        type: s.type,
        title: s.title,
        summary: s.summary,
        plain: s.plain,
        input: executed ? s.input_count : null,
        output: executed ? s.output_count : null,
        excluded: executed ? (s.excluded_count ?? 0) : 0,
        stats: executed ? s.stats : null,
        join: s.join ? { relationshipId: s.join.relationship_id, lookup: s.join.lookup } : null,
      }))
    : recipe.compiled.steps.map((s) => ({
        position: s.position,
        type: s.type,
        title: s.title,
        summary: s.summary,
        plain: s.plain as StepPlain | undefined,
        input: null,
        output: null,
        excluded: 0,
        stats: null,
        join: s.type === "join" && s.lookup ? { relationshipId: s.relationship_id ?? "", lookup: s.lookup } : null,
      }));

  const steps: RiverStep[] = sourceSteps.map((s) => {
    const plain = s.plain;
    const drops = Object.entries(s.stats?.excluded_by_reason ?? {})
      .filter(([, count]) => count > 0)
      .map(([code, count]) => ({ code, count, label: plain?.drops?.[code] ?? FALLBACK_DROP[code] ?? code }));
    const lookupInput = s.join ? inputs[s.join.lookup.input] : undefined;
    return {
      position: s.position,
      type: s.type,
      title: s.title,
      headline: plain?.headline ?? s.summary,
      detail: s.summary,
      unit: plain?.unit ?? "registros",
      inputUnit: plain?.input_unit ?? "registros",
      input: s.input,
      output: s.output,
      excluded: s.excluded,
      drops,
      lookup: s.join
        ? {
            alias: lookupInput?.alias ?? s.join.lookup.alias,
            name: lookupInput?.name ?? s.join.lookup.alias,
            rows: lookupInput?.rows ?? null,
            unreferenced: s.stats?.unreferenced_lookup_rows ?? 0,
            nullKey: s.stats?.lookup_null_key_rows ?? 0,
            status: run ? (executed ? "confirmed" : statusById.get(s.join.relationshipId)) : statusById.get(s.join.relationshipId),
            relationshipId: s.join.relationshipId,
            multiplied: s.stats?.multiplied_tuples ?? 0,
            created: s.stats?.created_tuples ?? 0,
            matched: s.stats?.matched_tuples ?? 0,
          }
        : undefined,
    };
  });

  const aggregateIndex = steps.findIndex((s) => s.type === "aggregate");
  const lastStage = aggregateIndex === -1 ? steps.length : aggregateIndex;
  const joinStep = steps.find((s) => s.type === "join");

  const columns = run?.output_columns ?? [];
  const sumColumn = columns.find((c) => c.role === "measure" && c.function === "sum") ?? null;
  const measureLabel = sumColumn?.source
    ? (run?.inputs[sumColumn.source.input]?.columns.find((c) => c.key === sumColumn.source!.column)?.label ?? sumColumn.source.column)
    : null;
  const valuesByResult = new Map((results ?? []).map((r) => [r.result_no, r.values]));

  const riverResults: RiverResult[] =
    executed && flows
      ? flows.results.map((item, index) => {
          const values = valuesByResult.get(item.result_no) ?? item.values;
          return {
            key: `r-${item.result_no}`,
            resultNo: item.result_no,
            resultNos: [item.result_no],
            label: groupLabel(columns, values, item.result_no),
            sum: sumColumn ? (values[sumColumn.key] ?? null) : null,
            records: item.contributor_count,
            color: PALETTE[index % PALETTE.length],
            base: item.base_tuples,
            trace: Object.fromEntries(item.trace.map((t) => [t.position, t.output_count])),
            related: item.related_exclusions.reduce<Record<number, number>>((acc, e) => ({ ...acc, [e.step_position]: (acc[e.step_position] ?? 0) + e.count }), {}),
          };
        })
      : [];

  if (executed && flows?.others) {
    const others = flows.others;
    riverResults.push({
      key: "others",
      resultNo: null,
      resultNos: others.result_nos,
      label: `outros ${others.result_nos.length} resultados`,
      sum: null,
      records: others.contributor_count,
      color: OTHERS_COLOR,
      base: others.base_tuples,
      trace: Object.fromEntries(others.trace.map((t) => [t.position, t.output_count])),
      related: others.related_exclusions.reduce<Record<number, number>>((acc, e) => ({ ...acc, [e.step_position]: (acc[e.step_position] ?? 0) + e.count }), {}),
    });
  }

  const baseSum = riverResults.reduce((acc, r) => acc + r.base, 0);
  const failed = state === "failed" && run?.error ? { step: run.error.step_position, message: run.error.message } : null;

  return {
    state,
    source: { alias: inputs[0]?.alias ?? "", name: inputs[0]?.name ?? "", rows: inputs[0]?.rows ?? null, version: inputs[0]?.versionNumber ?? null, input: 0 },
    steps,
    lastStage,
    joinStage: joinStep?.position ?? null,
    groupFromStage: (() => {
      const groupInput = columns.find((c) => c.role === "group_key")?.source?.input ?? 0;
      if (groupInput === 0) return 0;
      const joining = run?.steps.find((st) => st.join?.lookup.input === groupInput);
      return joining?.position ?? 0;
    })(),
    results: riverResults,
    totalResults: flows?.total_results ?? riverResults.length,
    baseContributors: flows?.base_contributors ?? null,
    multiplied: executed && flows !== undefined && baseSum > (flows.base_contributors ?? baseSum),
    measure: sumColumn && measureLabel ? { key: sumColumn.key, caption: `soma de ${measureLabel}` } : null,
    failure: failed,
    inputs,
  };
}
