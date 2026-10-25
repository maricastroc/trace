import { plural } from "@/lib/format";
import type { ColumnProfile, ColumnType, DatasetSummary, DatasetVersion, Relationship } from "@/lib/types";

export type ColumnRole = "key" | "fk" | null;

export type ColumnIssue = { kind: "dup" | "null" | "near"; text: string };

export type MapColumn = {
  key: string;
  type: ColumnType;
  typeReason: string;
  profile: ColumnProfile;
  role: ColumnRole;
  issues: ColumnIssue[];
  relevant: boolean;
};

export type MapTable = {
  id: string;
  key: string;
  name: string;
  versionId: string;
  versionNumber: number;
  file: string;
  rows: number;
  columns: MapColumn[];
};

export type MapModel = {
  tables: MapTable[];
  relations: Relationship[];
  byKey: Map<string, MapTable>;
};

export function isActive(relation: Relationship) {
  return relation.status !== "rejected";
}

export function competitorsOf(relation: Relationship, relations: Relationship[]) {
  return relations.filter(
    (other) =>
      other.id !== relation.id &&
      isActive(other) &&
      other.from.dataset_id === relation.from.dataset_id &&
      other.from.column === relation.from.column,
  );
}

export function standingOf(relation: Relationship) {
  return relation.standing?.key ?? relation.status;
}

export function needsAttention(relation: Relationship) {
  return !relation.evidence.to.unique || standingOf(relation) === "review";
}

function roleOf(table: string, column: string, type: ColumnType, profile: ColumnProfile, relations: Relationship[]): ColumnRole {
  if (relations.some((r) => isActive(r) && r.to.dataset_key === table && r.to.column === column)) return "key";
  if (relations.some((r) => isActive(r) && r.from.dataset_key === table && r.from.column === column)) return "fk";
  if (column === "id" && type === "identifier" && profile.unique) return "key";
  return null;
}

function issuesOf(table: string, column: string, role: ColumnRole, profile: ColumnProfile, relations: Relationship[]): ColumnIssue[] {
  const issues: ColumnIssue[] = [];
  if (role === "key" && !profile.unique && profile.non_null > 0) {
    const target = relations.find((r) => isActive(r) && r.to.dataset_key === table && r.to.column === column);
    const repeated = target?.evidence.to.duplicate_values;
    issues.push({
      kind: "dup",
      text: repeated !== undefined ? plural(repeated, "id repetido", "ids repetidos") : plural(profile.non_null - profile.distinct, "repetição", "repetições"),
    });
  }
  if (role === "fk" && profile.nulls > 0) issues.push({ kind: "null", text: plural(profile.nulls, "vazio", "vazios") });
  const near = relations
    .filter((r) => isActive(r) && r.from.dataset_key === table && r.from.column === column)
    .reduce((total, r) => total + r.evidence.near_matches.length, 0);
  if (near > 0) issues.push({ kind: "near", text: plural(near, "quase-par", "quase-pares") });
  return issues;
}

export function buildMapModel(datasets: DatasetSummary[], versions: Record<string, DatasetVersion | undefined>, relations: Relationship[]): MapModel {
  const tables: MapTable[] = [];
  for (const dataset of datasets) {
    const latest = dataset.latest_version;
    const version = latest ? versions[latest.id] : undefined;
    if (!latest || !version) continue;
    const columns = version.columns.map((column) => {
      const role = roleOf(dataset.key, column.key, column.type, column.profile, relations);
      const issues = issuesOf(dataset.key, column.key, role, column.profile, relations);
      return {
        key: column.key,
        type: column.type,
        typeReason: column.profile.type_reason,
        profile: column.profile,
        role,
        issues,
        relevant: role !== null || issues.length > 0,
      };
    });
    tables.push({
      id: dataset.id,
      key: dataset.key,
      name: dataset.name,
      versionId: latest.id,
      versionNumber: latest.number,
      file: latest.source_filename,
      rows: latest.row_count,
      columns,
    });
  }
  const known = new Set(tables.map((t) => t.key));
  return {
    tables,
    relations: relations.filter((r) => known.has(r.from.dataset_key) && known.has(r.to.dataset_key)),
    byKey: new Map(tables.map((t) => [t.key, t])),
  };
}

export function neighborsOf(table: string, relations: Relationship[]) {
  const set = new Set<string>([table]);
  for (const r of relations) {
    if (!isActive(r)) continue;
    if (r.from.dataset_key === table) set.add(r.to.dataset_key);
    if (r.to.dataset_key === table) set.add(r.from.dataset_key);
  }
  return set;
}

export function findPaths(from: string, to: string, relations: Relationship[], maxSteps = 4): Relationship[][] {
  if (from === to) return [];
  const usable = relations.filter((r) => isActive(r) && r.from.dataset_key !== r.to.dataset_key);
  const found: Relationship[][] = [];
  const walk = (node: string, visited: Set<string>, path: Relationship[]) => {
    if (node === to) {
      found.push(path);
      return;
    }
    if (path.length >= maxSteps) return;
    for (const r of usable) {
      const next = r.from.dataset_key === node ? r.to.dataset_key : r.to.dataset_key === node ? r.from.dataset_key : null;
      if (!next || visited.has(next)) continue;
      walk(next, new Set([...visited, next]), [...path, r]);
    }
  };
  walk(from, new Set([from]), []);
  return found.sort((a, b) => a.length - b.length);
}

export function pathTables(from: string, path: Relationship[]) {
  const nodes = [from];
  let node = from;
  for (const r of path) {
    node = r.from.dataset_key === node ? r.to.dataset_key : r.from.dataset_key;
    nodes.push(node);
  }
  return nodes;
}
