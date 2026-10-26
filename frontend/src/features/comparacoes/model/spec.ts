import type { ComparisonRule, ComparisonSideBasis, ComparisonSpec, EquivalenceDeclaration, EquivalenceStatus, QuestionDimension, QuestionPeriod } from "@/lib/types";
import { column, dateColumns, type Catalog, type CatalogRelation, type CatalogTable } from "@/features/perguntas/model/catalog";
import { dateBounds, defaultYear, periodLabel, yearRange } from "@/features/perguntas/model/period";
import { READING_TITLE, readingPhrase } from "@/features/perguntas/model/question";

export type PopulationDraft = {
  kind: "population";
  datasetId: string | null;
  versionId: string | null;
  key: string | null;
  period: QuestionPeriod | null;
  dimension: QuestionDimension | null;
  label: string;
};

export type RunDraft = { kind: "run"; runId: string | null; datasetId: string | null; key: string | null; label: string };

export type SideDraft = PopulationDraft | RunDraft;

export type Draft = { a: SideDraft; b: SideDraft; rules: ComparisonRule[]; equivalence: EquivalenceDeclaration | null };

export type Naming = { catalog: Catalog; versions?: Record<string, { id: string; number: number }[]>; runs?: Record<string, string> };

export type Side = "a" | "b";

export const RULE_TEXT: Record<ComparisonRule, { name: string; effect: string }> = {
  leading_zeros: { name: "zeros à esquerda", effect: "ignorar zeros à esquerda (0187 e 187 viram a mesma identidade)" },
  case_and_spacing: { name: "maiúsculas e espaços", effect: "ignorar maiúsculas, espaços nas pontas e espaços repetidos" },
};

export function emptyPopulation(): PopulationDraft {
  return { kind: "population", datasetId: null, versionId: null, key: null, period: null, dimension: null, label: "" };
}

export function emptyRun(): RunDraft {
  return { kind: "run", runId: null, datasetId: null, key: null, label: "" };
}

export function emptyDraft(): Draft {
  return { a: emptyPopulation(), b: emptyPopulation(), rules: [], equivalence: null };
}

export function humanize(text: string) {
  const plain = text.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.charAt(0).toLocaleUpperCase("pt-BR") + plain.slice(1);
}

export function tableTitle(table: Pick<CatalogTable, "key" | "name">) {
  return table.name && table.name !== table.key ? table.name : humanize(table.key);
}

export function defaultLabel(side: SideDraft, naming: Naming) {
  const table = side.datasetId ? naming.catalog.byId.get(side.datasetId) : undefined;
  if (side.kind === "run") return (side.runId ? naming.runs?.[side.runId] : undefined) ?? (table ? tableTitle(table) : "");
  if (!table) return "";
  const parts: string[] = [];
  const period = side.period;
  if (period?.kind === "date") parts.push(`com ${period.column} em ${periodLabel(period.from, period.to)}`);
  if (period?.kind === "validity" && period.reading) parts.push(`que ${readingPhrase(period.reading, false)} ${periodLabel(period.from, period.to)}`);
  if (side.dimension?.value) parts.push(`com ${side.dimension.column} ${side.dimension.value}`);
  const version = side.versionId ? naming.versions?.[table.id]?.find((candidate) => candidate.id === side.versionId) : undefined;
  const base = version ? `${tableTitle(table)} (versão ${version.number})` : tableTitle(table);
  return [base, parts.join(" e ")].filter(Boolean).join(" ");
}

export function labelOf(side: SideDraft, naming: Naming) {
  return side.label.trim() || defaultLabel(side, naming);
}

export function sideSpec(side: SideDraft, naming?: Naming): ComparisonSpec["a"] | null {
  const label = (naming ? labelOf(side, naming) : side.label.trim()) || undefined;
  if (side.kind === "run") {
    return side.runId && side.key ? { kind: "run", run_id: side.runId, key: side.key, label } : null;
  }
  if (!side.datasetId || !side.key) return null;
  return { kind: "population", dataset_id: side.datasetId, version_id: side.versionId, key: side.key, period: side.period, dimension: side.dimension, label };
}

export type Pair = { a: { table: string; key: string }; b: { table: string; key: string } };

export function pairOf(draft: Pick<Draft, "a" | "b">): Pair | null {
  const { a, b } = draft;
  return a.datasetId && a.key && b.datasetId && b.key ? { a: { table: a.datasetId, key: a.key }, b: { table: b.datasetId, key: b.key } } : null;
}

export function declarationFor(pair: Pair): EquivalenceDeclaration {
  return { a: { dataset_id: pair.a.table, key: pair.a.key }, b: { dataset_id: pair.b.table, key: pair.b.key } };
}

export function declares(declared: EquivalenceDeclaration | null | undefined, pair: Pair | null) {
  return !!declared && !!pair && declared.a.dataset_id === pair.a.table && declared.a.key === pair.a.key && declared.b.dataset_id === pair.b.table && declared.b.key === pair.b.key;
}

export type EquivalenceGap = "multiplicity" | "target_repeats" | "review" | "one_to_one" | "suggested" | "rejected" | "none";

export type EquivalenceState = { status: EquivalenceStatus | "incomplete"; relation: CatalogRelation | null; gap: EquivalenceGap | null };

function isUnique(catalog: Catalog, tableId: string, key: string) {
  const table = catalog.byId.get(tableId);
  return table ? column(table, key)?.profile.unique === true : false;
}

export function relationGap(catalog: Catalog, relation: CatalogRelation | null): EquivalenceGap | null {
  if (!relation) return "none";
  if (relation.standing === "suggested") return "suggested";
  if (relation.standing === "rejected") return "rejected";
  if (relation.standing === "caveat") return "multiplicity";
  if (!isUnique(catalog, relation.to.table, relation.to.column)) return "target_repeats";
  if (relation.standing !== "confirmed") return "review";
  if (isUnique(catalog, relation.from.table, relation.from.column)) return "one_to_one";
  return null;
}

export function equivalenceOf(catalog: Catalog, pair: Pair | null, declared: EquivalenceDeclaration | null | undefined): EquivalenceState {
  if (!pair) return { status: "incomplete", relation: null, gap: null };
  if (pair.a.table === pair.b.table && pair.a.key === pair.b.key) return { status: "same_field", relation: null, gap: null };
  const relation =
    catalog.relations.find(
      (candidate) =>
        (candidate.from.table === pair.a.table && candidate.from.column === pair.a.key && candidate.to.table === pair.b.table && candidate.to.column === pair.b.key) ||
        (candidate.from.table === pair.b.table && candidate.from.column === pair.b.key && candidate.to.table === pair.a.table && candidate.to.column === pair.a.key),
    ) ?? null;
  const gap = relationGap(catalog, relation);
  if (gap === null) return { status: "relation", relation, gap };
  return { status: declares(declared, pair) ? "declared" : "unconfirmed", relation, gap };
}

export function toSpec(draft: Draft, naming?: Naming): ComparisonSpec | null {
  const a = sideSpec(draft.a, naming);
  const b = sideSpec(draft.b, naming);
  if (!a || !b) return null;
  const spec: ComparisonSpec = { a, b, rules: [...draft.rules].sort(), fields: [] };
  const pair = pairOf(draft);
  if (pair && declares(draft.equivalence, pair) && !(naming && equivalenceOf(naming.catalog, pair, draft.equivalence).status !== "declared"))
    spec.equivalence = declarationFor(pair);
  return spec;
}

export function fromSpec(spec: ComparisonSpec, runDatasets: Record<string, string> = {}, naming?: Naming): Draft {
  const side = (s: ComparisonSpec["a"]): SideDraft => {
    const draft: SideDraft =
      s.kind === "run"
        ? { kind: "run", runId: s.run_id, datasetId: runDatasets[s.run_id] ?? null, key: s.key, label: s.label ?? "" }
        : { kind: "population", datasetId: s.dataset_id, versionId: s.version_id, key: s.key, period: s.period ?? null, dimension: s.dimension ?? null, label: s.label ?? "" };
    return naming && draft.label === defaultLabel({ ...draft, label: "" }, naming) ? { ...draft, label: "" } : draft;
  };
  return { a: side(spec.a), b: side(spec.b), rules: [...spec.rules], equivalence: spec.equivalence ?? null };
}

export function withSide(draft: Draft, side: Side, next: SideDraft): Draft {
  const changed = { ...draft, [side]: next };
  return declares(changed.equivalence, pairOf(changed)) ? changed : { ...changed, equivalence: null };
}

export function encodeSpec(spec: ComparisonSpec) {
  return JSON.stringify(spec);
}

export function decodeSpec(text: string | null): ComparisonSpec | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ComparisonSpec>;
    const ok = (side: unknown) => !!side && typeof side === "object" && ((side as { kind?: string }).kind === "population" || (side as { kind?: string }).kind === "run");
    if (!ok(parsed.a) || !ok(parsed.b)) return null;
    const spec: ComparisonSpec = { a: parsed.a!, b: parsed.b!, rules: Array.isArray(parsed.rules) ? parsed.rules : [], fields: Array.isArray(parsed.fields) ? parsed.fields : [] };
    if (parsed.equivalence && typeof parsed.equivalence === "object") spec.equivalence = parsed.equivalence;
    return spec;
  } catch {
    return null;
  }
}

export function sameSpec(a: ComparisonSpec | null, b: ComparisonSpec | null) {
  return a !== null && b !== null && encodeSpec(normalizeSpec(a)) === encodeSpec(normalizeSpec(b));
}

function normalizeSpec(spec: ComparisonSpec): ComparisonSpec {
  const side = (s: ComparisonSpec["a"]) =>
    s.kind === "run"
      ? { kind: s.kind, run_id: s.run_id, key: s.key, label: s.label ?? null }
      : { kind: s.kind, dataset_id: s.dataset_id, version_id: s.version_id ?? null, key: s.key, period: s.period ?? null, dimension: s.dimension ?? null, label: s.label ?? null };
  return {
    a: side(spec.a) as ComparisonSpec["a"],
    b: side(spec.b) as ComparisonSpec["b"],
    rules: [...spec.rules].sort(),
    fields: spec.fields,
    ...(spec.equivalence ? { equivalence: spec.equivalence } : {}),
  };
}

export function datePeriod(table: CatalogTable): QuestionPeriod | null {
  const first = dateColumns(table)[0];
  if (!first) return null;
  const bounds = dateBounds(table, { kind: "date", column: first.key });
  return { kind: "date", column: first.key, ...yearRange(bounds ? defaultYear(bounds.min, bounds.max) : new Date().getFullYear()) };
}

export type Suggestion = { id: string; title: string; reason: string; draft: Draft };

function relationRoute(catalog: Catalog, relation: CatalogRelation) {
  return `${catalog.byId.get(relation.from.table)?.key}.${relation.from.column} → ${catalog.byId.get(relation.to.table)?.key}.${relation.to.column}`;
}

export function suggestions(catalog: Catalog, versions: Record<string, { id: string; number: number }[]> = {}): Suggestion[] {
  const naming: Naming = { catalog, versions };
  const found: Suggestion[] = [];
  for (const relation of catalog.relations) {
    if (relation.standing === "rejected") continue;
    const target = catalog.byId.get(relation.to.table);
    const source = catalog.byId.get(relation.from.table);
    if (!target || !source || target.id === source.id) continue;
    const period = dateColumns(source).length === 1 && !source.validity ? datePeriod(source) : null;
    const draft: Draft = {
      a: { ...emptyPopulation(), datasetId: target.id, key: relation.to.column },
      b: { ...emptyPopulation(), datasetId: source.id, key: relation.from.column, period },
      rules: [],
      equivalence: null,
    };
    found.push({
      id: `rel:${relation.id}`,
      title: `${defaultLabel(draft.a, naming)} × ${defaultLabel(draft.b, naming)}`,
      reason: `A relação ${relationRoute(catalog, relation)} do Mapa sugere estas colunas${period?.kind === "date" ? `; ${source.key} filtrada por ${period.column}` : ""}.`,
      draft,
    });
  }
  found.sort((x, y) => (catalog.byId.get(y.draft.a.datasetId ?? "")?.rows ?? 0) - (catalog.byId.get(x.draft.a.datasetId ?? "")?.rows ?? 0));
  for (const table of catalog.tables) {
    const list = versions[table.id] ?? [];
    const key = table.columns.find((candidate) => candidate.profile.unique && candidate.type === "identifier")?.key ?? null;
    if (list.length < 2 || !key) continue;
    const sorted = [...list].sort((x, y) => x.number - y.number);
    const previous = sorted[sorted.length - 2];
    const latest = sorted[sorted.length - 1];
    found.push({
      id: `ver:${table.id}`,
      title: `${tableTitle(table)}: versão ${previous.number} × versão ${latest.number}`,
      reason: `${table.key} tem ${list.length} versões. A comparação é pela coluna ${key}, que não se repete; nunca pela posição da linha.`,
      draft: {
        a: { ...emptyPopulation(), datasetId: table.id, versionId: previous.id, key },
        b: { ...emptyPopulation(), datasetId: table.id, versionId: latest.id, key },
        rules: [],
        equivalence: null,
      },
    });
  }
  return found;
}

export type KeyOption = { key: string; hint: string };

export function keyOptions(table: CatalogTable): KeyOption[] {
  return table.columns.map((candidate) => {
    const p = candidate.profile;
    const parts = [p.unique ? "cada valor aparece uma vez" : `${p.distinct.toLocaleString("pt-BR")} valores diferentes`];
    if (p.nulls) parts.push(`${p.nulls.toLocaleString("pt-BR")} vazios`);
    return { key: candidate.key, hint: parts.join(", ") };
  });
}

export function linkingRelation(catalog: Catalog, a: { table: string; key: string }, b: { table: string; key: string }) {
  return (
    catalog.relations.find(
      (relation) =>
        relation.standing !== "rejected" &&
        ((relation.from.table === a.table && relation.from.column === a.key && relation.to.table === b.table && relation.to.column === b.key) ||
          (relation.from.table === b.table && relation.from.column === b.key && relation.to.table === a.table && relation.to.column === a.key)),
    ) ?? null
  );
}

export function keyFromRelation(catalog: Catalog, tableId: string, other: { table: string; key: string } | null) {
  if (!other) return null;
  for (const relation of catalog.relations) {
    if (relation.standing === "rejected") continue;
    if (relation.from.table === tableId && relation.to.table === other.table && relation.to.column === other.key) return { key: relation.from.column, relation };
    if (relation.to.table === tableId && relation.from.table === other.table && relation.from.column === other.key) return { key: relation.to.column, relation };
  }
  return null;
}

export function sideTable(side: SideDraft) {
  return side.datasetId;
}

export function keyType(catalog: Catalog, tableId: string | null, key: string | null) {
  const table = tableId ? catalog.byId.get(tableId) : undefined;
  return table && key ? (column(table, key)?.type ?? null) : null;
}

export function describeSelection(basis: Pick<ComparisonSideBasis, "kind" | "period" | "dimension" | "steps">) {
  if (basis.kind === "run") {
    const steps = basis.steps.filter((step) => step.type !== "aggregate").map((step) => step.summary);
    return steps.length ? steps.join(" · ") : "todas as linhas que chegaram ao resultado";
  }
  const parts: string[] = [];
  const period = basis.period;
  if (period?.kind === "date") parts.push(`${period.column} em ${periodLabel(period.from, period.to)}`);
  if (period?.kind === "validity" && period.reading) parts.push(`${READING_TITLE[period.reading].toLocaleLowerCase("pt-BR")} ${periodLabel(period.from, period.to)}`);
  if (basis.dimension?.value) parts.push(`${basis.dimension.column} = ${basis.dimension.value}`);
  return parts.length ? parts.join(" · ") : "todas as linhas";
}
