import type { ColumnProfile, ColumnType, DatasetSummary, DatasetVersion, Evidence, JoinEffect, Relationship, RelationshipPolicy, RelationshipStandingKey, RelationshipStatus } from "@/lib/types";

export function profile(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    non_null: 10,
    nulls: 0,
    distinct: 10,
    unique: true,
    samples: [],
    leading_zero_values: 0,
    fixed_length: null,
    type_reason: "",
    ...overrides,
  };
}

export function dataset(key: string, rows: number, validity: DatasetSummary["validity"] = null): DatasetSummary {
  return {
    id: `ds-${key}`,
    key,
    name: key,
    origin: "demo",
    is_synthetic: true,
    created_at: "2026-10-24T00:00:00Z",
    updated_at: "2026-10-24T00:00:00Z",
    latest_version: { id: `v-${key}`, dataset_id: `ds-${key}`, number: 1, source_filename: `${key}.csv`, row_count: rows, column_count: 0, created_at: "2026-10-24T00:00:00Z" },
    validity,
  };
}

export function version(key: string, columns: { key: string; type?: ColumnType; profile?: Partial<ColumnProfile> }[]): DatasetVersion {
  return {
    id: `v-${key}`,
    dataset_id: `ds-${key}`,
    number: 1,
    source_filename: `${key}.csv`,
    row_count: 0,
    column_count: columns.length,
    created_at: "2026-10-24T00:00:00Z",
    checksum: "",
    size_bytes: 0,
    encoding: "UTF-8",
    delimiter: ",",
    import_report: { warnings: [] },
    dataset: { id: `ds-${key}`, key, name: key, is_synthetic: true },
    columns: columns.map((c, position) => ({ key: c.key, label: c.key, position, type: c.type ?? "identifier", profile: profile(c.profile) })),
  };
}

type EvidenceOverrides = {
  ratio?: number;
  matchedRows?: number;
  unmatchedRows?: number;
  unmatchedDistinct?: number;
  nullRows?: number;
  matchedDistinct?: number;
  fromNonNull?: number;
  fromDistinct?: number;
  toDistinct?: number;
  toUnique?: boolean;
  duplicates?: number;
  unreferencedRows?: number;
  near?: Evidence["near_matches"];
  cardinality?: string;
  nameMatched?: boolean;
  policy?: RelationshipPolicy | null;
  standing?: RelationshipStandingKey;
  effect?: Partial<JoinEffect>;
};

export function relation(id: string, from: [string, string], to: [string, string], status: RelationshipStatus = "suggested", o: EvidenceOverrides = {}): Relationship {
  const toUnique = o.toUnique ?? true;
  const cardinality = o.cardinality ?? (toUnique ? "many_to_one" : "many_to_many");
  const side = (key: string, column: string) => ({
    dataset_id: `ds-${key}`,
    dataset_key: key,
    dataset_name: key,
    version_id: `v-${key}`,
    version_number: 1,
    column,
    column_label: column,
    type: "identifier" as const,
    rows: 0,
    non_null: 0,
    nulls: 0,
    distinct: 0,
    unique: false,
  });
  const evidence: Evidence = {
    from: { ...side(from[0], from[1]), non_null: o.fromNonNull ?? 10, distinct: o.fromDistinct ?? 5 },
    to: { ...side(to[0], to[1]), distinct: o.toDistinct ?? 5, unique: toUnique, duplicate_values: o.duplicates ?? 0 },
    match: {
      matched_rows: o.matchedRows ?? 10,
      unmatched_rows: o.unmatchedRows ?? 0,
      null_rows: o.nullRows ?? 0,
      match_ratio: o.ratio ?? 1,
      matched_distinct: o.matchedDistinct ?? 5,
      unmatched_distinct: o.unmatchedDistinct ?? 0,
      unmatched_samples: [],
    },
    unreferenced: { rows: o.unreferencedRows ?? 0, samples: [] },
    near_matches: o.near ?? [],
    join_effect: {
      source_rows: (o.fromNonNull ?? 10) + (o.nullRows ?? 0),
      matched_rows: o.matchedRows ?? 10,
      unmatched_rows: o.unmatchedRows ?? 0,
      null_key_rows: o.nullRows ?? 0,
      inner_rows: o.matchedRows ?? 10,
      left_rows: (o.fromNonNull ?? 10) + (o.nullRows ?? 0),
      extra_rows: 0,
      multiplied_rows: 0,
      repeated_keys: 0,
      samples: [],
      ...o.effect,
    },
    cardinality,
    name: { matched: o.nameMatched ?? true, reason: o.nameMatched === false ? "O nome não indica relação." : "O nome indica relação." },
    types: { compatible: true, detail: "As duas colunas têm o mesmo tipo inferido." },
    score: 0.9,
    statements: [],
  };
  const policy = o.policy ?? null;
  const standing: RelationshipStandingKey =
    o.standing ?? (status === "confirmed" ? (policy ? "caveat" : toUnique ? "confirmed" : "review") : status);
  return {
    id,
    status,
    policy,
    standing: { key: standing, usable: standing === "confirmed" || standing === "caveat", reason: standing === "review" ? "Reavalie." : null },
    origin: "discovered",
    score: 0.9,
    from: { dataset_id: `ds-${from[0]}`, dataset_key: from[0], dataset_name: from[0], column: from[1] },
    to: { dataset_id: `ds-${to[0]}`, dataset_key: to[0], dataset_name: to[0], column: to[1] },
    cardinality,
    cardinality_label: null,
    evidence,
    evidence_is_current: true,
    confirmed_at: null,
    rejected_at: null,
    created_at: "2026-10-24T00:00:00Z",
  };
}
