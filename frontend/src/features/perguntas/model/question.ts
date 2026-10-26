import type { QuestionDimension, QuestionMeasure, QuestionPeriod, QuestionSpec, ValidityReading } from "@/lib/types";
import {
  column,
  dateColumns,
  forwardPaths,
  isCategory,
  isSummable,
  labelColumn,
  outgoing,
  type Catalog,
  type CatalogRelation,
  type CatalogTable,
} from "./catalog";
import { dateBounds, defaultYear, periodLabel, yearRange } from "./period";

export const READINGS: ValidityReading[] = ["started", "active_any", "active_at_end"];

export const READING_TITLE: Record<ValidityReading, string> = {
  started: "Começaram em",
  active_any: "Estiveram vigentes em algum momento de",
  active_at_end: "Estavam vigentes no último dia de",
};

export const READING_HINT: Record<ValidityReading, string> = {
  started: "a vigência começou dentro do período",
  active_any: "estavam vigentes em qualquer dia do período",
  active_at_end: "continuavam vigentes no último dia do período",
};

export type MeasureOption = { measure: QuestionMeasure; label: string; hint: string };

export type DimensionOption = {
  key: string;
  relationships: string[];
  table: CatalogTable;
  column: string;
  labelColumn: string | null;
  noun: string;
  route: string;
  via: string;
};

export type TokenKind = "source" | "measure" | "dimension" | "path" | "periodKind" | "periodValue";

export type Token = { kind: TokenKind; text: string; what: string; pending?: boolean };

export type SentencePart = string | Token;

const FEMININE = /(a|as|ões|ção|dade|dades|gem|gens)$/;

export function isFeminine(noun: string) {
  const head = noun.trim().split(/\s+/)[0]?.toLocaleLowerCase("pt-BR") ?? "";
  return FEMININE.test(head);
}

function nounFromColumn(key: string) {
  return key.replace(/_id$/i, "").replace(/^id_/i, "").replace(/_/g, " ").trim();
}

function hasUniqueId(table: CatalogTable) {
  return column(table, "id")?.profile.unique === true;
}

export function measureOptions(catalog: Catalog, base: CatalogTable): MeasureOption[] {
  const options: MeasureOption[] = [
    hasUniqueId(base)
      ? { measure: { function: "count" }, label: "registros", hint: `conta as linhas de ${base.key} que chegam ao cálculo; cópias criadas por uma ligação também contam` }
      : { measure: { function: "count" }, label: "linhas", hint: "cada linha conta, mesmo com id repetido; cópias criadas por uma ligação também contam" },
  ];
  const id = column(base, "id");
  if (id && !id.profile.unique) {
    options.push({ measure: { function: "count_distinct", column: "id" }, label: `${base.noun} diferentes`, hint: "cada id conta uma vez" });
  }
  const foreign = new Set<string>();
  for (const relation of outgoing(catalog, base.id)) {
    const target = catalog.byId.get(relation.to.table);
    if (!target || foreign.has(relation.from.column)) continue;
    foreign.add(relation.from.column);
    options.push({
      measure: { function: "count_distinct", column: relation.from.column },
      label: `valores diferentes de ${relation.from.column}`,
      hint: `cada ${relation.from.column} conta uma vez, mesmo sem par em ${target.key}`,
    });
  }
  for (const candidate of base.columns) {
    if (candidate.key === "id" || foreign.has(candidate.key)) continue;
    if (candidate.type === "identifier" && !candidate.profile.unique) {
      options.push({ measure: { function: "count_distinct", column: candidate.key }, label: `valores diferentes de ${candidate.key}`, hint: `cada ${candidate.key} conta uma vez` });
    }
  }
  for (const candidate of base.columns) {
    if (isSummable(candidate) && candidate.key !== "id") {
      options.push({ measure: { function: "sum", column: candidate.key }, label: `soma de ${candidate.key}`, hint: "vazios e textos ficam fora da soma, com registro" });
    }
  }
  return options;
}

export function sameMeasure(a: QuestionMeasure, b: QuestionMeasure) {
  return a.function === b.function && (a.column ?? null) === (b.column ?? null);
}

export function measureLabel(catalog: Catalog, base: CatalogTable, measure: QuestionMeasure) {
  const option = measureOptions(catalog, base).find((candidate) => sameMeasure(candidate.measure, measure));
  if (option) return option.label;
  if (measure.function === "count") return "linhas";
  return measure.function === "sum" ? `soma de ${measure.column}` : `valores diferentes de ${measure.column}`;
}

function routeOf(catalog: Catalog, base: CatalogTable, relations: CatalogRelation[], finalColumn: string) {
  if (relations.length === 0) return `${base.key}.${finalColumn}`;
  const parts = relations.map((relation) => `${catalog.byId.get(relation.from.table)?.key}.${relation.from.column}`);
  return `${parts.join(" → ")} → ${catalog.byId.get(relations[relations.length - 1].to.table)?.key}`;
}

export function dimensionOptions(catalog: Catalog, base: CatalogTable): DimensionOption[] {
  const options: DimensionOption[] = [];
  const foreign = new Set(outgoing(catalog, base.id).map((relation) => relation.from.column));

  for (const path of forwardPaths(catalog, base.id)) {
    const last = path.relations[path.relations.length - 1];
    const ids = path.relations.map((relation) => relation.id);
    const via = `${catalog.byId.get(last.from.table)?.key}.${last.from.column}`;
    const keyLabel = labelColumn(path.table, last.to.column);
    options.push({
      key: `${ids.join(">")}:${last.to.column}`,
      relationships: ids,
      table: path.table,
      column: last.to.column,
      labelColumn: keyLabel,
      noun: nounFromColumn(last.from.column) || path.table.noun,
      route: routeOf(catalog, base, path.relations, last.to.column),
      via,
    });
    const linked = new Set(outgoing(catalog, path.table.id).map((relation) => relation.from.column));
    for (const candidate of path.table.columns) {
      if (candidate.key === last.to.column || candidate.key === keyLabel || linked.has(candidate.key) || !isCategory(candidate)) continue;
      options.push({
        key: `${ids.join(">")}:${candidate.key}`,
        relationships: ids,
        table: path.table,
        column: candidate.key,
        labelColumn: null,
        noun: nounFromColumn(candidate.key),
        route: `${routeOf(catalog, base, path.relations, candidate.key)}.${candidate.key}`,
        via,
      });
    }
  }

  for (const candidate of base.columns) {
    if (foreign.has(candidate.key) || !isCategory(candidate)) continue;
    options.push({
      key: `:${candidate.key}`,
      relationships: [],
      table: base,
      column: candidate.key,
      labelColumn: null,
      noun: nounFromColumn(candidate.key),
      route: `${base.key}.${candidate.key}`,
      via: `${base.key}.${candidate.key}`,
    });
  }
  return options;
}

export function dimensionKey(dimension: Pick<QuestionDimension, "relationships" | "column">) {
  return `${dimension.relationships.join(">")}:${dimension.column}`;
}

export function currentDimension(catalog: Catalog, base: CatalogTable, dimension: QuestionDimension | null) {
  if (!dimension) return null;
  return dimensionOptions(catalog, base).find((option) => option.key === dimensionKey(dimension)) ?? null;
}

export function pathAlternatives(catalog: Catalog, base: CatalogTable, option: DimensionOption) {
  return dimensionOptions(catalog, base).filter((candidate) => candidate.table.id === option.table.id && candidate.column === option.column);
}

export function dimensionFrom(option: DimensionOption, value: string | null = null): QuestionDimension {
  return { relationships: option.relationships, column: option.column, label_column: option.labelColumn, value };
}

export type PeriodKindOption = { key: string; label: string; hint: string; period: (from: string, to: string) => QuestionPeriod | null };

export function periodKindOptions(base: CatalogTable): PeriodKindOption[] {
  const dates = dateColumns(base);
  const options: PeriodKindOption[] = dates.map((candidate) => ({
    key: `date:${candidate.key}`,
    label: `com ${candidate.key} em`,
    hint: `a data em ${candidate.key} cai dentro do período`,
    period: (from, to) => ({ kind: "date", column: candidate.key, from, to }),
  }));
  if (base.validity || dates.length >= 2) {
    options.push({
      key: "validity",
      label: "vigentes em",
      hint: base.validity
        ? `pela vigência declarada: ${base.validity.start_column}${base.validity.end_column ? ` → ${base.validity.end_column}` : ""}`
        : "pela vigência da tabela, que ainda precisa ser declarada",
      period: (from, to) => ({ kind: "validity", reading: null, from, to }),
    });
  }
  if (dates.length > 0) {
    options.push({ key: "none", label: "em qualquer data", hint: "sem recorte de período", period: () => null });
  }
  return options;
}

export function periodKindKey(period: QuestionPeriod | null) {
  if (!period) return "none";
  return period.kind === "date" ? `date:${period.column}` : "validity";
}

function defaultRange(base: CatalogTable, period: { kind: QuestionPeriod["kind"]; column?: string }) {
  const bounds = dateBounds(base, period);
  return yearRange(bounds ? defaultYear(bounds.min, bounds.max) : new Date().getFullYear());
}

export function starterPeriod(base: CatalogTable): QuestionPeriod | null {
  const dates = dateColumns(base);
  if (base.validity) {
    const range = defaultRange(base, { kind: "validity" });
    return { kind: "validity", reading: null, ...range };
  }
  if (dates.length > 0) {
    const range = defaultRange(base, { kind: "date", column: dates[0].key });
    return { kind: "date", column: dates[0].key, ...range };
  }
  return null;
}

function standingRank(catalog: Catalog, ids: string[]) {
  return ids.reduce((worst, id) => {
    const standing = catalog.relationById.get(id)?.standing;
    const rank = standing === "confirmed" ? 0 : standing === "caveat" ? 1 : standing === "suggested" ? 2 : 3;
    return Math.max(worst, rank);
  }, 0);
}

export function starterDimension(catalog: Catalog, base: CatalogTable): QuestionDimension | null {
  const candidates = dimensionOptions(catalog, base).filter((option) => option.relationships.length > 0 && option.labelColumn !== null);
  candidates.sort(
    (a, b) =>
      a.relationships.length - b.relationships.length ||
      standingRank(catalog, a.relationships) - standingRank(catalog, b.relationships) ||
      a.table.rows - b.table.rows,
  );
  return candidates[0] ? dimensionFrom(candidates[0]) : null;
}

export function starterBase(catalog: Catalog) {
  const bySize = [...catalog.tables].sort((a, b) => b.rows - a.rows);
  return bySize.find((table) => table.validity) ?? bySize.find((table) => dateColumns(table).length > 0) ?? bySize[0] ?? null;
}

export function starterQuestion(catalog: Catalog, baseId?: string | null): QuestionSpec | null {
  const base = (baseId ? catalog.byId.get(baseId) : null) ?? starterBase(catalog);
  if (!base) return null;
  const id = column(base, "id");
  return {
    base_dataset_id: base.id,
    measure: id && !id.profile.unique ? { function: "count_distinct", column: "id" } : { function: "count" },
    period: starterPeriod(base),
    dimension: starterDimension(catalog, base),
  };
}

export function readingPhrase(reading: ValidityReading | null) {
  switch (reading) {
    case "started":
      return "que começaram em";
    case "active_any":
      return "que estiveram vigentes em algum momento de";
    case "active_at_end":
      return "que estavam vigentes no último dia de";
    default:
      return "vigentes em";
  }
}

export function sentence(catalog: Catalog, question: QuestionSpec, valueLabel: string | null = null): SentencePart[] {
  const base = catalog.byId.get(question.base_dataset_id);
  if (!base) return [];
  const measure = measureLabel(catalog, base, question.measure);
  const feminine = isFeminine(measure);
  const parts: SentencePart[] = ["Em ", { kind: "source", text: base.noun, what: "a tabela" }];

  const period = question.period;
  if (period?.kind === "date") {
    parts.push(" ", { kind: "periodKind", text: `com ${period.column} em`, what: "a data usada" }, " ", { kind: "periodValue", text: periodLabel(period.from, period.to), what: "o período" });
  } else if (period?.kind === "validity") {
    parts.push(
      " ",
      { kind: "periodKind", text: readingPhrase(period.reading), what: "a leitura do período", pending: period.reading === null },
      " ",
      { kind: "periodValue", text: periodLabel(period.from, period.to), what: "o período" },
    );
  } else if (dateColumns(base).length > 0) {
    parts.push(", ", { kind: "periodKind", text: "em qualquer data", what: "a data usada" });
  }

  parts.push(", ", question.measure.function === "sum" ? "qual a " : feminine ? "quantas " : "quantos ");
  parts.push({ kind: "measure", text: measure, what: "o que contar" });

  const option = currentDimension(catalog, base, question.dimension);
  if (!question.dimension || !option) {
    parts.push(" ", { kind: "dimension", text: "no total", what: "o recorte" });
  } else if (question.dimension.value === null) {
    parts.push(" ", { kind: "dimension", text: `por ${option.noun}`, what: "o recorte" });
  } else {
    parts.push(" de ", { kind: "dimension", text: valueLabel ?? `${option.noun} ${question.dimension.value}`, what: "o recorte" });
  }
  if (option && pathAlternatives(catalog, base, option).length > 1) {
    parts.push(" ", { kind: "path", text: `via ${option.via}`, what: "o caminho até o recorte" });
  }
  parts.push("?");
  return parts;
}

export function plainText(parts: SentencePart[]) {
  return parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

export function isQuestionSpec(value: unknown): value is QuestionSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QuestionSpec>;
  return typeof candidate.base_dataset_id === "string" && !!candidate.measure && typeof candidate.measure === "object" && "period" in candidate && "dimension" in candidate;
}

export function encodeQuestion(question: QuestionSpec) {
  return JSON.stringify(question);
}

export function decodeQuestion(text: string | null): QuestionSpec | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isQuestionSpec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function fitsCatalog(catalog: Catalog, question: QuestionSpec) {
  const base = catalog.byId.get(question.base_dataset_id);
  if (!base) return false;
  if (question.dimension && !question.dimension.relationships.every((id) => catalog.relationById.has(id))) return false;
  return true;
}
