import type { ColumnProfile, ColumnType, DatasetSummary, DatasetVersion, Relationship, RelationshipStandingKey, ValidityDeclaration } from "@/lib/types";

export type CatalogColumn = { key: string; type: ColumnType; profile: ColumnProfile };

export type CatalogTable = {
  id: string;
  key: string;
  name: string;
  noun: string;
  rows: number;
  versionId: string;
  versionNumber: number;
  columns: CatalogColumn[];
  validity: ValidityDeclaration | null;
};

export type CatalogRelation = {
  id: string;
  from: { table: string; column: string };
  to: { table: string; column: string };
  standing: RelationshipStandingKey;
  usable: boolean;
  reason: string | null;
};

export type Catalog = {
  tables: CatalogTable[];
  byId: Map<string, CatalogTable>;
  relations: CatalogRelation[];
  relationById: Map<string, CatalogRelation>;
};

const LABEL_NAMES = ["nome", "name", "titulo", "title", "descricao", "rotulo", "label"];
const NUMERIC = /^-?\d+([.,]\d+)?$/;
const CATEGORY_LIMIT = 60;

function lowerFirst(text: string) {
  return text.charAt(0).toLocaleLowerCase("pt-BR") + text.slice(1);
}

export function buildCatalog(datasets: DatasetSummary[], versions: Record<string, DatasetVersion>, relationships: Relationship[]): Catalog {
  const tables: CatalogTable[] = [];
  for (const dataset of datasets) {
    const summary = dataset.latest_version;
    const version = summary ? versions[summary.id] : undefined;
    if (!summary || !version) continue;
    tables.push({
      id: dataset.id,
      key: dataset.key,
      name: dataset.name,
      noun: lowerFirst(dataset.name),
      rows: summary.row_count,
      versionId: version.id,
      versionNumber: version.number,
      columns: version.columns.map((column) => ({ key: column.key, type: column.type, profile: column.profile })),
      validity: dataset.validity,
    });
  }
  const byId = new Map(tables.map((table) => [table.id, table]));
  const relations = relationships
    .filter((relationship) => byId.has(relationship.from.dataset_id) && byId.has(relationship.to.dataset_id))
    .map<CatalogRelation>((relationship) => ({
      id: relationship.id,
      from: { table: relationship.from.dataset_id, column: relationship.from.column },
      to: { table: relationship.to.dataset_id, column: relationship.to.column },
      standing: relationship.standing.key,
      usable: relationship.standing.usable,
      reason: relationship.standing.reason,
    }));
  return { tables, byId, relations, relationById: new Map(relations.map((relation) => [relation.id, relation])) };
}

export function column(table: CatalogTable, key: string) {
  return table.columns.find((candidate) => candidate.key === key) ?? null;
}

export function dateColumns(table: CatalogTable) {
  return table.columns.filter((candidate) => candidate.type === "date");
}

export function isSummable(candidate: CatalogColumn) {
  if (candidate.type === "number") return true;
  if (candidate.type !== "text") return false;
  return candidate.profile.samples.length > 0 && candidate.profile.samples.every((sample) => NUMERIC.test(sample.trim()));
}

export function labelColumn(table: CatalogTable, keyColumn: string) {
  if (column(table, keyColumn)?.profile.unique !== true) return null;
  const texts = table.columns.filter((candidate) => candidate.key !== keyColumn && candidate.type === "text");
  return texts.find((candidate) => LABEL_NAMES.includes(candidate.key.toLowerCase()))?.key ?? texts.find((candidate) => candidate.profile.unique)?.key ?? null;
}

export function isCategory(candidate: CatalogColumn) {
  return (candidate.type === "text" || candidate.type === "identifier") && !candidate.profile.unique && candidate.profile.distinct > 0 && candidate.profile.distinct <= CATEGORY_LIMIT;
}

export function outgoing(catalog: Catalog, tableId: string) {
  return catalog.relations.filter((relation) => relation.from.table === tableId && relation.standing !== "rejected");
}

export type ForwardPath = { relations: CatalogRelation[]; table: CatalogTable };

export function forwardPaths(catalog: Catalog, baseId: string, maxHops = 3): ForwardPath[] {
  const found: ForwardPath[] = [];
  const walk = (tableId: string, trail: CatalogRelation[], visited: Set<string>) => {
    if (trail.length >= maxHops) return;
    for (const relation of outgoing(catalog, tableId)) {
      if (visited.has(relation.to.table)) continue;
      const table = catalog.byId.get(relation.to.table);
      if (!table) continue;
      const next = [...trail, relation];
      found.push({ relations: next, table });
      walk(relation.to.table, next, new Set([...visited, relation.to.table]));
    }
  };
  walk(baseId, [], new Set([baseId]));
  return found.sort((a, b) => a.relations.length - b.relations.length || a.table.key.localeCompare(b.table.key));
}
