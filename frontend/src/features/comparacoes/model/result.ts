import type {
  ComparisonAttribution,
  ComparisonEquivalence,
  ComparisonIssue,
  ComparisonPreview,
  ComparisonRunDetail,
  ComparisonSideBasis,
  ComparisonSpec,
  ComparisonSummary,
} from "@/lib/types";
import type { Labels, Reading } from "./reconciliation";
import { describeSelection, tableTitle } from "./spec";

export type ResultModel = {
  source: "preview" | "trace";
  spec: ComparisonSpec;
  specKey: string | null;
  sides: { a: ComparisonSideBasis; b: ComparisonSideBasis };
  attribution: ComparisonAttribution;
  equivalence: ComparisonEquivalence | null;
  issues: ComparisonIssue[];
  summary: ComparisonSummary;
  samples: ComparisonPreview["samples"];
  explained: ComparisonPreview["explained_samples"];
  runId: string | null;
  comparisonId: string | null;
  finishedAt: string | null;
};

export function fromPreview(preview: ComparisonPreview): ResultModel | null {
  if (!preview.computed || !preview.summary) return null;
  return {
    source: "preview",
    spec: preview.spec,
    specKey: preview.spec_key,
    sides: preview.sides,
    attribution: preview.attribution,
    equivalence: preview.equivalence,
    issues: preview.issues,
    summary: preview.summary,
    samples: preview.samples,
    explained: preview.explained_samples,
    runId: null,
    comparisonId: null,
    finishedAt: preview.computed_at,
  };
}

export function fromRun(run: ComparisonRunDetail): ResultModel | null {
  if (run.status !== "succeeded" || !run.summary) return null;
  return {
    source: "trace",
    spec: run.spec,
    specKey: null,
    sides: run.sides,
    attribution: run.attribution,
    equivalence: run.equivalence ?? null,
    issues: run.issues,
    summary: run.summary,
    samples: null,
    explained: null,
    runId: run.id,
    comparisonId: run.comparison_id,
    finishedAt: run.finished_at,
  };
}

export function sideName(side: Pick<ComparisonSideBasis, "label" | "dataset">) {
  return side.label && side.label !== side.dataset.key ? side.label : tableTitle(side.dataset);
}

export function labelsOf(sides: ResultModel["sides"]): Labels {
  const a = sideName(sides.a);
  const b = sideName(sides.b);
  return a === b ? { a: `${a} (A)`, b: `${b} (B)` } : { a, b };
}

export function titleOf(summary: ComparisonSummary, labels: Labels) {
  const a = summary.a.distinct.toLocaleString("pt-BR");
  const b = summary.b.distinct.toLocaleString("pt-BR");
  if (summary.unmatched === 0) return `${labels.a} e ${labels.b} têm as mesmas ${a} identidades`;
  if (summary.a.distinct === summary.b.distinct) return `Por que ${labels.a} e ${labels.b} têm ${a} identidades cada, mas não as mesmas?`;
  return `Por que ${a} identidades em ${labels.a} e ${b} em ${labels.b}?`;
}

type Core = Pick<ComparisonSummary, "shared" | "shared_by_rule" | "only_a" | "only_b"> & { a: { distinct: number; rows: number }; b: { distinct: number; rows: number } };

export function sameNumbers(x: Core | null | undefined, y: Core | null | undefined) {
  if (!x || !y) return false;
  return (
    x.shared === y.shared &&
    x.shared_by_rule === y.shared_by_rule &&
    x.only_a === y.only_a &&
    x.only_b === y.only_b &&
    x.a.distinct === y.a.distinct &&
    x.b.distinct === y.b.distinct &&
    x.a.rows === y.a.rows &&
    x.b.rows === y.b.rows
  );
}

export function versionsOf(sides: Record<"a" | "b", { version: { id: string; number: number } }>) {
  return `${sides.a.version.id}|${sides.b.version.id}`;
}

type TracedBrief = {
  sides: Record<"a" | "b", { label: string; dataset: { key: string }; version: { id: string; number: number }; decisions_key?: string | null }>;
  equivalence: { status: ComparisonEquivalence["status"]; reading?: string | null } | null;
  summary: Core | null;
};

export function traceDifferences(done: TracedBrief, preview: { sides: TracedBrief["sides"]; equivalence: ComparisonEquivalence; summary: Core | null }) {
  const reasons: string[] = [];
  if (versionsOf(done.sides) !== versionsOf(preview.sides)) {
    const used = (["a", "b"] as const).map((side) => `${done.sides[side].dataset.key} versão ${done.sides[side].version.number}`).join(" e ");
    const now = (["a", "b"] as const).map((side) => `${preview.sides[side].dataset.key} versão ${preview.sides[side].version.number}`).join(" e ");
    reasons.push(`A execução usou ${used}; a prévia usa ${now}.`);
  }
  if (!done.sides.a.decisions_key || !done.sides.b.decisions_key) {
    reasons.push("A execução foi gravada antes de o Trace registrar as relações e vigências usadas; não dá para confirmar que são as mesmas de agora.");
  } else {
    for (const side of ["a", "b"] as const) {
      if (done.sides[side].decisions_key !== preview.sides[side].decisions_key) {
        reasons.push(`As relações ou a vigência usadas em ${done.sides[side].label} mudaram desde a execução. Abra a execução para ver o que mudou.`);
      }
    }
  }
  const was = done.equivalence;
  if (was && (was.status !== preview.equivalence.status || (was.reading ?? null) !== (preview.equivalence.reading?.kind ?? null))) {
    reasons.push(`A equivalência das chaves estava "${EQUIVALENCE_TAG[was.status]}" e agora está "${EQUIVALENCE_TAG[preview.equivalence.status]}".`);
  }
  if (reasons.length === 0 && !sameNumbers(done.summary, preview.summary))
    reasons.push("Com as mesmas versões e decisões, os números calculados agora são diferentes dos gravados.");
  return reasons;
}

export const EQUIVALENCE_TAG: Record<ComparisonEquivalence["status"], string> = {
  same_field: "mesma coluna",
  map_declared: "declarada no Mapa",
  relation: "relação confirmada no Mapa",
  declared: "declarada por você",
  unconfirmed: "sem confirmação",
};

export function labelsFor(result: Pick<ResultModel, "sides" | "equivalence">): Labels {
  const labels = labelsOf(result.sides);
  const reading = result.equivalence?.reading;
  if (reading?.kind !== "registry_references" || !reading.registry) return labels;
  return { ...labels, roles: { registry: reading.registry, references: reading.registry === "a" ? "b" : "a" } };
}

export function readingOf(result: Pick<ResultModel, "sides" | "equivalence" | "attribution">): Reading | null {
  const reading = result.equivalence?.reading;
  if (!reading) return null;
  return {
    kind: reading.kind,
    registry: reading.registry,
    entity: reading.entity ? tableTitle({ key: reading.entity.dataset, name: reading.entity.name }) : null,
    selections: { a: describeSelection(result.sides.a), b: describeSelection(result.sides.b) },
    attribution: result.attribution?.kind ?? null,
  };
}
