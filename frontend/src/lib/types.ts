export type ColumnType = "text" | "identifier" | "number" | "date";

export type ScenarioSummary = { key: string; label: string; description: string };

export type Meta = {
  product: string;
  tagline: string;
  mode: string;
  uploads_enabled: boolean;
  limits: { upload_kb: number; rows: number; columns: number; tuples: number };
  workspace_ttl_days: number;
  demo_notice: string;
  scenarios: ScenarioSummary[];
  default_scenario: string;
};

export type Workspace = {
  id: string;
  name: string;
  scenario: { key: string; label: string } | null;
  created_at: string;
  counts: { datasets: number; relationships: number; recipes: number; runs: number };
  token?: string;
};

export type VersionSummary = {
  id: string;
  dataset_id: string;
  number: number;
  source_filename: string;
  row_count: number;
  column_count: number;
  created_at: string;
};

export type ColumnProfile = {
  non_null: number;
  nulls: number;
  distinct: number;
  unique: boolean;
  samples: string[];
  leading_zero_values: number;
  fixed_length: number | null;
  type_reason: string;
  min?: string;
  max?: string;
};

export type DatasetColumn = {
  key: string;
  label: string;
  position: number;
  type: ColumnType;
  profile: ColumnProfile;
};

export type DatasetSummary = {
  id: string;
  key: string;
  name: string;
  origin: string;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
  latest_version: VersionSummary | null;
};

export type DatasetVersion = VersionSummary & {
  checksum: string;
  size_bytes: number;
  encoding: string;
  delimiter: string;
  import_report: { warnings: { code: string; message: string }[] };
  dataset: { id: string; key: string; name: string; is_synthetic: boolean };
  columns: DatasetColumn[];
};

export type SourceRow = {
  id: number;
  row_number: number;
  line_number: number;
  values: Record<string, string | null>;
};

export type PageMeta = { page: number; per_page: number; total: number; last_page: number };

export type Paginated<T, M = object> = { data: T[]; meta: PageMeta & M };

export type EvidenceStatement = { kind: string; text: string };

export type EvidenceSide = {
  dataset_id: string;
  dataset_key: string;
  dataset_name: string;
  version_id: string;
  version_number: number;
  column: string;
  column_label: string;
  type: ColumnType;
  rows: number;
  non_null: number;
  nulls: number;
  distinct: number;
  unique: boolean;
};

export type Evidence = {
  from: EvidenceSide;
  to: EvidenceSide & { duplicate_values: number };
  match: {
    matched_rows: number;
    unmatched_rows: number;
    null_rows: number;
    match_ratio: number;
    matched_distinct: number;
    unmatched_distinct: number;
    unmatched_samples: { value: string; rows: number }[];
  };
  unreferenced: { rows: number; samples: string[] };
  near_matches: { value: string; candidate: string; kind: "leading_zeros" | "case_or_spacing" }[];
  join_effect?: JoinEffect;
  cardinality: string;
  name: { matched: boolean; reason: string };
  types: { compatible: boolean; detail: string };
  score: number;
  statements: EvidenceStatement[];
};

export type RelationshipStatus = "suggested" | "confirmed" | "rejected";

export type RelationshipStandingKey = "suggested" | "confirmed" | "caveat" | "rejected" | "review";

export type RelationshipStanding = { key: RelationshipStandingKey; usable: boolean; reason: string | null };

export type RelationshipPolicy = "accept_multiplicity";

export type JoinEffect = {
  source_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  null_key_rows: number;
  inner_rows: number;
  left_rows: number;
  extra_rows: number;
  multiplied_rows: number;
  repeated_keys: number;
  samples: { value: string; target_rows: number; source_rows: number; extra_rows: number }[];
};

export type Relationship = {
  id: string;
  status: RelationshipStatus;
  policy: RelationshipPolicy | null;
  standing: RelationshipStanding;
  origin: string;
  score: number;
  from: { dataset_id: string; dataset_key: string; dataset_name: string; column: string };
  to: { dataset_id: string; dataset_key: string; dataset_name: string; column: string };
  cardinality: string | null;
  cardinality_label: string | null;
  evidence: Evidence;
  evidence_is_current: boolean;
  evaluated_versions?: { from: string; to: string };
  confirmed_at: string | null;
  rejected_at: string | null;
  created_at: string;
};

export type RelationshipDraft = {
  evidence: Evidence;
  cardinality: string;
  cardinality_label: string;
  existing: { id: string; status: RelationshipStatus } | null;
};

export type RelationshipPair = {
  from_dataset_id: string;
  from_column: string;
  to_dataset_id: string;
  to_column: string;
};

export type Condition = {
  alias: string;
  column: string;
  input?: number;
  operator: string;
  value: unknown;
  value_type: "text" | "number" | "date";
};

export type JoinSide = { alias: string; column: string; input: number };

export type StepPlain = { headline: string; drops: Record<string, string>; unit: string; input_unit: string };

export type CompiledStep = {
  id: string;
  plain?: StepPlain;
  position: number;
  title: string;
  summary: string;
  type: "filter" | "join" | "aggregate";
  conditions?: Condition[];
  relationship_id?: string;
  relationship_status?: RelationshipStatus;
  join_type?: "inner" | "left";
  probe?: JoinSide;
  lookup?: JoinSide;
  group_by?: { alias: string; column: string; input: number; output: string; type: ColumnType }[];
  measures?: { function: "sum" | "count"; alias?: string; column?: string; input?: number; name: string }[];
};

export type RecipeInput = {
  position: number;
  alias: string;
  dataset_id: string;
  dataset_name: string;
  version_id: string;
  version_number: number;
  columns: { key: string; label: string; type: ColumnType }[];
};

export type Issue = {
  severity: "error" | "blocker" | "warning";
  code: string;
  message: string;
  step_position: number | null;
  path: string;
  details: Record<string, unknown>;
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export type RunError = { code: string; message: string; step_position: number | null };

export type RunSummary = {
  id: string;
  status: RunStatus;
  recipe_id: string | null;
  recipe_name: string | null;
  recipe_revision: number;
  result_count: number | null;
  tuple_count: number | null;
  error: RunError | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
};

export type Recipe = {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  base_dataset: { id: string; key: string; name: string };
  definition: { base_dataset_id: string; steps: unknown[] };
  compiled: {
    base_dataset_id: string | null;
    inputs: RecipeInput[];
    steps: CompiledStep[];
    issues: Issue[];
    savable: boolean;
    runnable: boolean;
  };
  last_run: RunSummary | null;
  created_at: string;
  updated_at: string;
};

export type StepStats = {
  excluded_by_reason?: Record<string, number>;
  excluded_by_condition?: number[];
  matched_tuples?: number;
  unmatched_tuples?: number;
  null_key_tuples?: number;
  multiplied_tuples?: number;
  max_matches?: number;
  created_tuples?: number;
  lookup_rows?: number;
  unreferenced_lookup_rows?: number;
  lookup_null_key_rows?: number;
  groups?: number;
  aggregated_tuples?: number;
  ignored_values?: Record<string, { null: number; unconvertible: number }>;
};

export type RunStep = {
  position: number;
  id: string;
  type: CompiledStep["type"];
  title: string;
  summary: string;
  input_count: number | null;
  output_count: number | null;
  excluded_count: number | null;
  duration_ms: number | null;
  stats: StepStats | null;
  join: { relationship_id: string; join_type: "inner" | "left"; probe: JoinSide; lookup: JoinSide } | null;
  plain: StepPlain;
};

export type RunInput = RecipeInput & {
  row_count: number;
  latest_version_number: number | null;
  newer_version_available: boolean;
  contributing_rows?: number;
};

export type OutputColumn = {
  key: string;
  label: string;
  role: "group_key" | "measure" | "field";
  type: ColumnType;
  function?: "sum" | "count";
  source: { alias: string; column: string; input: number } | null;
};

export type RunDetail = RunSummary & {
  recipe: { id: string; name: string; revision: number };
  current_recipe_revision: number | null;
  recipe_changed_since: boolean;
  inputs: RunInput[];
  steps: RunStep[];
  output_columns: OutputColumn[] | null;
};

export type ResultRow = {
  result_no: number;
  values: Record<string, string | number | null>;
  contributor_count: number;
};

export type TracePoint = { position: number; input_count: number; output_count: number };

export type Flow = {
  inputs: (RunInput & { contributing_rows?: number })[];
  steps: RunStep[];
  result: (ResultRow & { base_tuples: number; trace: TracePoint[] }) | null;
};

export type ValueDependency = {
  key: string;
  role: OutputColumn["role"];
  function?: "sum" | "count";
  source?: { alias: string; column: string; input: number } | null;
  stored: string | number | null;
  recomputed?: string | number | null;
  counted?: number;
  ignored_null?: number;
  ignored_unconvertible?: number;
  consistent?: boolean;
  statement: string;
};

export type FieldRole = { kind: "condition" | "join_key" | "group" | "value"; step_position: number | null; description: string };

export type FieldRoles = {
  input: number;
  alias: string;
  columns: { key: string; label: string; roles: FieldRole[]; participates: boolean }[];
}[];

export type RelatedExclusions = {
  group: string;
  matching: { step_position: number; step_title: string | null; code: string; label: string; count: number }[];
  unattributable: { step_position: number; step_title: string | null; count: number }[];
  note: string;
};

export type ResultDetail = {
  result: ResultRow & { base_tuples: number; trace: TracePoint[] };
  columns: OutputColumn[];
  inputs: (RunInput & { contributing_rows: number })[];
  steps: RunStep[];
  values: ValueDependency[];
  fields: FieldRoles;
  related_exclusions: RelatedExclusions | null;
};

export type MeasureValue = { measure: string; column: string; raw: string | null; status: "counted" | "ignored_null" | "ignored_unconvertible" };

export type Contributor = SourceRow & { tuples: number; measure_values: MeasureValue[] };

export type BreakdownRow = SourceRow & { tuples: number; partials: Record<string, string | null> };

export type TupleSource = { input: number; alias: string; row: SourceRow };

export type Exclusion = {
  tuple_no: number;
  step_position: number;
  step_title: string | null;
  code: string;
  label: string;
  explanation: string;
  detail: Record<string, unknown>;
  sources: TupleSource[];
};

export type SummaryEntry = {
  step_position: number;
  step_title: string | null;
  code: string;
  label: string;
  count: number;
  severity?: string;
};

export type Diagnostic = {
  id: number;
  step_position: number;
  step_title: string | null;
  code: string;
  label: string;
  severity: "info" | "warning";
  tuple_no: number | null;
  explanation: string;
  detail: Record<string, unknown>;
  row: (SourceRow & { alias: string | null }) | null;
};

export type TimelineEntry = {
  position: number;
  type: CompiledStep["type"];
  title: string;
  subject_present: boolean;
  status: "passed" | "joined" | "excluded" | "not_reached" | "aggregated" | "kept_unmatched";
  explanation?: string;
  code?: string;
  label?: string;
  partner?: TupleSource | null;
  result_no?: number | null;
  detail?: Record<string, unknown>;
};

export type JourneyPath = {
  tuple_no: number;
  subject_joined_at: number | null;
  combined_with: TupleSource[];
  timeline: TimelineEntry[];
  outcome:
    | { status: "included"; result_no: number; result_values: Record<string, string | number | null> | null; explanation: string }
    | { status: "excluded"; step_position: number; step_title: string; code: string; explanation: string }
    | null;
};

export type JourneyOutcome =
  | { status: "included"; result_no: number; count: number }
  | { status: "excluded"; step_position: number; step_title: string | null; code: string; label: string; count: number; uniform: boolean; explanation: string };

export type Journey = {
  row: SourceRow & { alias: string; input: number; dataset_name: string; version_number: number };
  steps: { position: number; type: CompiledStep["type"]; title: string; summary: string }[];
  outcomes: JourneyOutcome[];
  paths: JourneyPath[];
  paths_meta: PageMeta;
  diagnostics: Omit<Diagnostic, "id" | "row">[];
  diagnostics_total: number;
  references: {
    step_position: number;
    key: string | null;
    probe?: { alias: string; column: string };
    referencing_rows: number;
    reached_join: number;
    excluded_before: SummaryEntry[];
    explanation: string;
  } | null;
  summary: string;
};

export type RelatedCount = { step_position: number; code: string; count: number };

export type FlowItem = {
  result_no: number;
  values: Record<string, string | number | null>;
  contributor_count: number;
  base_tuples: number;
  trace: TracePoint[];
  contributing_rows: Record<string, number>;
  related_exclusions: RelatedCount[];
};

export type Flows = {
  total_results: number;
  base_contributors: number;
  results: FlowItem[];
  others: { result_nos: number[]; contributor_count: number; base_tuples: number; trace: TracePoint[]; related_exclusions: RelatedCount[] } | null;
};
