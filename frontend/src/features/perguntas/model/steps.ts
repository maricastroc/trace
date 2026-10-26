import { formatCount } from "@/lib/format";
import type { QuestionSpec, RunDetail } from "@/lib/types";
import { ANSWER, formatAnswer, numeric, ROWS } from "./answer";

export type Loss = { code: string; text: string; count: number };

export type SourceView = { kind: "source"; key: string; alias: string; name: string; version: number; rows: number };

export type FilterView = { kind: "filter"; key: string; position: number; title: string; input: number; output: number; losses: Loss[] };

export type JoinView = {
  kind: "join";
  key: string;
  position: number;
  title: string;
  input: number;
  output: number;
  losses: Loss[];
  lookup: string;
  left: boolean;
  matched: number;
  withoutPartner: number;
  copies: number;
};

export type AggregateView = {
  kind: "aggregate";
  key: string;
  position: number;
  title: string;
  input: number;
  results: number;
  grouped: boolean;
  facts: string[];
};

export type StepView = SourceView | FilterView | JoinView | AggregateView;

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function losses(type: string, reasons: Record<string, number> | undefined, drops: Record<string, string>): Loss[] {
  return Object.entries(reasons ?? {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({ code: `${type}.${reason}`, text: drops[reason] ?? reason, count }));
}

function aggregateFacts(run: RunDetail, question: QuestionSpec, input: number, results: number, grouped: boolean, groupNames: string[], copied: boolean) {
  const totals = run.totals;
  const total = totals?.values[ANSWER] ?? null;
  const rows = numeric(totals?.values[ROWS]);
  const ignored = run.steps.find((step) => step.type === "aggregate")?.stats?.ignored_values?.[ANSWER];
  const column = question.measure.column;
  const facts = [
    grouped
      ? `${plural(input, "registro organizado", "registros organizados")} em ${plural(results, "grupo", "grupos")} por ${groupNames.join(" e ")}`
      : results === 0
        ? "Nenhum registro chegou ao cálculo"
        : `${plural(input, "registro entra", "registros entram")} no cálculo, sem agrupar: 1 resultado`,
  ];

  if (question.measure.function === "count") {
    facts.push(`Total contado: ${plural(numeric(total) ?? 0, "registro", "registros")}`);
    if (copied) facts.push("Contando linhas, as cópias criadas pela ligação também entram no total");
  } else if (question.measure.function === "count_distinct") {
    const distinct = numeric(total) ?? 0;
    const nulls = ignored?.null ?? 0;
    const counted = rows === null ? null : rows - nulls;
    const repeated = counted === null ? 0 : counted - distinct;
    facts.push(
      `Total contado: ${plural(distinct, `valor diferente de ${column}`, `valores diferentes de ${column}`)}` +
        (counted !== null ? ` em ${plural(counted, "linha preenchida", "linhas preenchidas")}` : ""),
    );
    if (repeated > 0) facts.push(`${plural(repeated, "linha repete", "linhas repetem")} um ${column} já contado e não ${repeated === 1 ? "soma" : "somam"}`);
    if (nulls > 0) facts.push(`${plural(nulls, "linha sem", "linhas sem")} ${column} ${nulls === 1 ? "não entra" : "não entram"} na contagem`);
  } else {
    facts.push(`Total calculado: soma de ${column} = ${formatAnswer(total)}`);
    const skipped = (ignored?.null ?? 0) + (ignored?.unconvertible ?? 0);
    if (skipped > 0) facts.push(`${plural(skipped, "linha fica", "linhas ficam")} fora da soma por ${column} vazio ou que não é número`);
  }

  if (grouped && totals) {
    const sum = numeric(totals.sum_of_groups[ANSWER]);
    const value = numeric(total);
    if (sum !== null && value !== null && sum !== value) facts.push(`Somando os grupos dá ${formatAnswer(sum)}; o total é calculado sobre todos os registros, não somado`);
  }
  return facts;
}

export function stepViews(run: RunDetail, question: QuestionSpec): StepView[] {
  const input = run.inputs[0];
  const views: StepView[] = input
    ? [{ kind: "source", key: "source", alias: input.alias, name: input.dataset_name, version: input.version_number, rows: input.row_count }]
    : [];
  const groupNames = (run.output_columns ?? []).filter((column) => column.role === "group_key").map((column) => (column.source ? `${column.source.alias}.${column.source.column}` : column.key));

  for (const step of run.steps) {
    const stats = step.stats ?? {};
    const common = { key: `s${step.position}`, position: step.position, title: step.plain.headline, input: step.input_count ?? 0 };
    if (step.type === "filter") {
      views.push({ kind: "filter", ...common, output: step.output_count ?? 0, losses: losses("filter", stats.excluded_by_reason, step.plain.drops) });
    } else if (step.type === "join") {
      const left = step.join?.join_type === "left";
      const matched = stats.matched_tuples ?? 0;
      views.push({
        kind: "join",
        ...common,
        output: step.output_count ?? 0,
        losses: losses("join", stats.excluded_by_reason, step.plain.drops),
        lookup: step.join?.lookup.alias ?? "",
        left,
        matched,
        withoutPartner: left ? (stats.unmatched_tuples ?? 0) + (stats.null_key_tuples ?? 0) : 0,
        copies: Math.max(0, (stats.created_tuples ?? 0) - matched),
      });
    } else {
      const results = stats.groups ?? step.output_count ?? 0;
      const grouped = groupNames.length > 0;
      const copied = views.some((view) => view.kind === "join" && view.copies > 0);
      views.push({ kind: "aggregate", ...common, results, grouped, facts: aggregateFacts(run, question, common.input, results, grouped, groupNames, copied) });
    }
  }
  return views;
}

export function lossesBefore(views: StepView[], position: number) {
  return views.reduce((sum, view) => (view.kind !== "source" && view.kind !== "aggregate" && view.position < position ? sum + view.losses.reduce((n, loss) => n + loss.count, 0) : sum), 0);
}
