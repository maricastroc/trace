import { formatCount, formatMeasure } from "@/lib/format";
import type { OutputColumn, Preview, QuestionSpec, ResultRow, RunDetail, RunTotals, StepPlain, StepStats } from "@/lib/types";

export const ANSWER = "resposta";
export const ROWS = "registros";

export type OutcomeStep = {
  position: number;
  id: string | null;
  type: "filter" | "join" | "aggregate";
  title: string | null;
  plain: StepPlain | null;
  input_count: number | null;
  output_count: number | null;
  excluded_count: number | null;
  stats: StepStats | null;
};

export type Outcome = {
  source: "preview" | "run";
  totals: RunTotals | null;
  results: ResultRow[];
  columns: OutputColumn[];
  steps: OutcomeStep[];
};

export function previewOutcome(preview: Preview): Outcome {
  const ids = new Map(preview.recipe_steps.map((step) => [step.position, step.id]));
  return {
    source: "preview",
    totals: preview.totals,
    results: preview.results,
    columns: preview.columns ?? [],
    steps: preview.steps.map((step) => ({ ...step, id: ids.get(step.position) ?? null })),
  };
}

export function runOutcome(run: RunDetail, results: ResultRow[]): Outcome {
  return {
    source: "run",
    totals: run.totals ?? null,
    results,
    columns: run.output_columns ?? [],
    steps: run.steps.map((step) => ({
      position: step.position,
      id: step.id,
      type: step.type,
      title: step.title,
      plain: step.plain,
      input_count: step.input_count,
      output_count: step.output_count,
      excluded_count: step.excluded_count,
      stats: step.stats,
    })),
  };
}

export function answerValue(outcome: Outcome) {
  return outcome.totals?.values[ANSWER] ?? null;
}

export function numeric(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatAnswer(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? formatCount(value) : formatMeasure(value);
}

export type Note = { kind: "rep" | "gran" | "warn" | "lim"; text: string };

function aggregateStep(outcome: Outcome) {
  return outcome.steps.find((step) => step.type === "aggregate") ?? null;
}

function distinctWithCopies(question: QuestionSpec) {
  const column = question.measure.column;
  if (!question.dimension) return `As cópias repetem o mesmo ${column}, que conta uma vez.`;
  if (question.dimension.value === null) {
    return `Cada ${column} conta uma vez por grupo, mas as cópias podem levar a mesma linha a mais de um grupo. No total, ela conta uma vez.`;
  }
  return `Cada ${column} conta uma vez, mas entra no recorte se qualquer cópia tiver o valor escolhido: a mesma linha pode entrar no recorte de mais de um valor.`;
}

export function answerNotes(question: QuestionSpec, outcome: Outcome, noun: string | null): Note[] {
  const notes: Note[] = [];
  const totals = outcome.totals;
  if (!totals) return notes;
  const value = numeric(totals.values[ANSWER]);
  const rows = numeric(totals.values[ROWS]);
  const ignored = aggregateStep(outcome)?.stats?.ignored_values?.[ANSWER];
  const column = question.measure.column ?? null;

  if (question.measure.function === "count_distinct" && value !== null && rows !== null) {
    const nulls = ignored?.null ?? 0;
    const repeated = rows - nulls - value;
    if (repeated > 0) notes.push({ kind: "rep", text: `${formatCount(rows)} linhas: ${formatCount(repeated)} repetem um ${column} já contado e contam uma vez.` });
    if (nulls > 0) notes.push({ kind: "lim", text: `${formatCount(nulls)} ${nulls === 1 ? "linha sem" : "linhas sem"} ${column} ficaram fora da contagem.` });
  }

  if (question.measure.function === "sum" && ignored && ignored.null + ignored.unconvertible > 0) {
    const parts = [
      ignored.null > 0 ? `${formatCount(ignored.null)} com ${column} vazio` : null,
      ignored.unconvertible > 0 ? `${formatCount(ignored.unconvertible)} com ${column} que não é número` : null,
    ].filter(Boolean);
    notes.push({ kind: "lim", text: `Ficaram fora da soma ${parts.join(" e ")}. Cada caso aparece nos diagnósticos.` });
  }

  for (const step of outcome.steps) {
    if (step.type !== "join" || !step.stats) continue;
    const extra = (step.stats.created_tuples ?? 0) - (step.stats.matched_tuples ?? 0);
    if (extra > 0) {
      notes.push({
        kind: "warn",
        text:
          question.measure.function === "count"
            ? `A ligação criou ${formatCount(extra)} linhas a mais porque o destino tem ids repetidos. Contando linhas, essas cópias entram no número.`
            : `A ligação criou ${formatCount(extra)} linhas a mais porque o destino tem ids repetidos. ${question.measure.function === "count_distinct" ? distinctWithCopies(question) : "A soma inclui essas cópias."}`,
      });
    }
  }

  if (question.dimension?.value === null && totals.groups > 0) {
    const sum = numeric(totals.sum_of_groups[ANSWER]);
    if (sum !== null && value !== null && sum !== value) {
      notes.push({
        kind: "gran",
        text: `Somando os grupos dá ${formatAnswer(sum)}; o total é ${formatAnswer(value)}.${question.measure.function === "count_distinct" ? " Quem aparece em mais de um grupo conta uma vez no total." : ""} O total é calculado, não somado.`,
      });
    }
    const empty = groups(outcome).find((group) => group.key === null);
    if (empty && noun) {
      notes.push({ kind: "lim", text: `O grupo sem valor de ${noun} dá ${formatAnswer(empty.value)} e aparece separado.` });
    }
  }
  return notes;
}

export type Group = { resultNo: number; key: string | null; label: string; value: number | string | null; rows: number };

export function groups(outcome: Outcome): Group[] {
  const keys = outcome.columns.filter((column) => column.role === "group_key");
  if (keys.length === 0) return [];
  const [keyColumn, labelColumn] = keys;
  return outcome.results.map((row) => {
    const key = row.values[keyColumn.key];
    const label = labelColumn ? row.values[labelColumn.key] : null;
    return {
      resultNo: row.result_no,
      key: key === null || key === undefined ? null : String(key),
      label: label !== null && label !== undefined ? String(label) : key !== null && key !== undefined ? String(key) : "",
      value: row.values[ANSWER] ?? null,
      rows: row.contributor_count,
    };
  });
}
