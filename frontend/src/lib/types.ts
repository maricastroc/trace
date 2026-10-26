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
  decimal_ambiguous?: boolean;
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

export type ValidityDeclaration = {
  start_column: string;
  end_column: string | null;
  end_inclusive: boolean;
  declared_at: string | null;
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
  validity: ValidityDeclaration | null;
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
  identity_declared_at: string | null;
  decided_versions: { from: number | null; to: number | null } | null;
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

export type ComparisonCondition = {
  kind?: undefined;
  alias: string;
  column: string;
  input?: number;
  operator: string;
  value: unknown;
  value_type: "text" | "number" | "date";
};

export type ValidityReading = "started" | "active_any" | "active_at_end";

export type ValidityCondition = {
  kind: "validity";
  alias: string;
  input?: number;
  reading: ValidityReading;
  from: string;
  to: string;
  start_column?: string | null;
  end_column?: string | null;
  end_inclusive?: boolean;
};

export type Condition = ComparisonCondition | ValidityCondition;

export type MeasureFunction = "sum" | "count" | "count_distinct";

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
  measures?: { function: MeasureFunction; alias?: string; column?: string; input?: number; name: string }[];
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
  question: QuestionSpec | null;
  question_key: string | null;
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
  join: {
    relationship_id: string;
    relationship_status: RelationshipStatus | null;
    relationship_policy: RelationshipPolicy | null;
    direction: "forward" | "reverse" | null;
    join_type: "inner" | "left";
    probe: JoinSide;
    lookup: JoinSide;
  } | null;
  plain: StepPlain;
};

export type Decision =
  | { kind: "relation"; position: number; relationship_id: string; route: string; status: RelationshipStatus | null; policy: RelationshipPolicy | null; direction: "forward" | "reverse" | null }
  | { kind: "validity"; position: number | null; alias: string; dataset_id: string | null; start_column: string | null; end_column: string | null; end_inclusive: boolean | null };

export type DecisionChange = { kind: Decision["kind"]; position: number | null; message: string };

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
  function?: MeasureFunction;
  source: { alias: string; column: string; input: number } | null;
};

export type RunTotals = {
  values: Record<string, string | number | null>;
  sum_of_groups: Record<string, string | number | null>;
  groups: number;
};

export type RunDetail = RunSummary & {
  totals?: RunTotals | null;
  recipe: { id: string; name: string; revision: number };
  current_recipe_revision: number | null;
  recipe_deleted: boolean;
  recipe_changed_since: boolean;
  decisions: Decision[];
  decisions_key: string;
  decision_changes: DecisionChange[];
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
  function?: MeasureFunction;
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

export type MeasureValue = { measure: string; column: string; raw: string | null; status: "counted" | "repeated" | "ignored_null" | "ignored_unconvertible" };

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

export type QuestionMeasure = { function: "count"; column?: null } | { function: "count_distinct" | "sum"; column: string };

export type QuestionPeriod =
  | { kind: "date"; column: string; from: string; to: string }
  | { kind: "validity"; reading: ValidityReading | null; from: string; to: string };

export type QuestionDimension = { relationships: string[]; column: string; label_column: string | null; value: string | null };

export type QuestionSpec = {
  base_dataset_id: string;
  measure: QuestionMeasure;
  period: QuestionPeriod | null;
  dimension: QuestionDimension | null;
};

export type PreviewStep = {
  position: number;
  type: CompiledStep["type"];
  title: string | null;
  plain: StepPlain | null;
  input_count: number;
  output_count: number;
  excluded_count: number;
  stats: StepStats | null;
};

export type Preview = {
  kind: "preview";
  traceable: false;
  computed: boolean;
  reason: "blocked" | "empty" | "failed" | null;
  error: RunError | null;
  basis: {
    recipe: { id: string; revision: number } | null;
    inputs: { position: number; alias: string; dataset_id: string; dataset_name: string; version_id: string; version_number: number }[];
    decisions: Decision[];
    decisions_key: string;
  };
  issues: Issue[];
  recipe_steps: CompiledStep[];
  pending: Issue[];
  steps: PreviewStep[];
  columns: OutputColumn[] | null;
  results: ResultRow[];
  totals: RunTotals | null;
  tuple_count: number | null;
  computed_at: string;
};

export type QuestionAnswer = {
  question: QuestionSpec;
  question_key: string;
  needs_reading: boolean;
  recipe: { base_dataset_id: string; steps: unknown[] } | null;
  preview: Preview | null;
};

export type ReadingCriteria = { enters: string; leaves: string; rule: string; undetermined: string };

export type ReadingOption = {
  reading: ValidityReading;
  question_key: string;
  computed: boolean;
  reason: Preview["reason"];
  value: number | string | null;
  rows: number | null;
  excluded: { out: number; undetermined: number } | null;
  pending: Issue[];
  criteria: ReadingCriteria | null;
};

export type QuestionReadings = { declaration: ValidityDeclaration | null; readings: ReadingOption[] };

export type TracedQuestion = { recipe_id: string; question_key: string; run: RunSummary };

export type Identity = { value: string; tuples: number; source_rows: number; repeated: number };

export type IdentitiesMeta = {
  measure: string;
  source: { alias: string; column: string; input: number };
  distinct: number;
  rows: number;
  repeated: number;
  ignored_null: number;
};

export type ImportPreview = {
  filename: string;
  suggested_key: string;
  encoding: string;
  delimiter: string;
  row_count: number;
  column_count: number;
  size_bytes: number;
  checksum: string;
  warnings: { code: string; message: string }[];
  columns: { position: number; key: string; label: string; type: ColumnType; profile: ColumnProfile }[];
  rows: { line_number: number; values: Record<string, string | null> }[];
};

export type ComparisonRule = "leading_zeros" | "case_and_spacing";

export type ComparisonPopulationSide = {
  kind: "population";
  label?: string;
  dataset_id: string;
  version_id: string | null;
  key: string;
  period?: QuestionPeriod | null;
  dimension?: QuestionDimension | null;
};

export type ComparisonRunSide = { kind: "run"; label?: string; run_id: string; key: string };

export type ComparisonSideSpec = ComparisonPopulationSide | ComparisonRunSide;

export type EquivalenceDeclaration = { a: { dataset_id: string; key: string }; b: { dataset_id: string; key: string } };

export type ComparisonSpec = {
  a: ComparisonSideSpec;
  b: ComparisonSideSpec;
  rules: ComparisonRule[];
  fields: { a: string; b: string }[];
  equivalence?: EquivalenceDeclaration;
};

export type EquivalenceStatus = "same_field" | "map_declared" | "relation" | "declared" | "unconfirmed";

export type EquivalenceField = { dataset_id: string; dataset: string; key: string; name: string };

export type ComparisonReading = {
  kind: "registry_references" | "same_field" | "unknown";
  registry: "a" | "b" | null;
  entity: { dataset: string; name: string } | null;
  key_unique: boolean | null;
};

export type ComparisonEquivalence = {
  reading?: ComparisonReading | null;
  status: EquivalenceStatus;
  a: EquivalenceField;
  b: EquivalenceField;
  relationship_id: string | null;
  relationship_standing: RelationshipStandingKey | null;
  statement: string;
};

export type ComparisonSideBasis = {
  kind: "population" | "run";
  label: string;
  dataset: { id: string; key: string; name: string };
  version: { id: string; number: number; rows: number };
  key: string;
  key_type: ColumnType | null;
  run_id: string | null;
  period: QuestionPeriod | null;
  dimension: QuestionDimension | null;
  steps: { position: number; type: CompiledStep["type"]; summary: string }[];
  decisions?: Decision[];
  decisions_key?: string;
};

export type ComparisonExplanation = "excluded_in_other" | "outside_other_period" | "possible_match" | "ambiguous_match" | "variant_of_matched" | "absent";

export type ComparisonCategory = "shared" | "shared_by_rule" | "only_a" | "only_b";

export type ComparisonSideCounts = { rows: number; rows_with_key: number; empty_rows: number; distinct: number; repeated_identities: number; repeated_rows: number };

export type ComparisonCheck = { name: string; formula: string; left: number; right: number; holds: boolean };

export type ComparisonSummary = {
  unit: string;
  a: ComparisonSideCounts;
  b: ComparisonSideCounts;
  shared: number;
  shared_by_rule: number;
  only_a: number;
  only_b: number;
  net_difference: number;
  unmatched: number;
  possible_matches: number;
  explanations: { only_a: Record<ComparisonExplanation, number>; only_b: Record<ComparisonExplanation, number> };
  fields: { a: string; b: string; compared: number; same: number; different: number; partial: number }[];
  checks: ComparisonCheck[];
};

export type ComparisonIssue = { severity: "error" | "blocker" | "warning"; code: string; message: string; side: "a" | "b" | null; path: string; details: Record<string, unknown> };

export type ComparisonAttribution = { kind: "identical" | "versions" | "criteria" | "relations" | "keys" | "mixed" | "sources"; differences: string[]; statement: string };

export type ComparisonIdentity = {
  identity: string;
  a_value: string | null;
  b_value: string | null;
  category: ComparisonCategory;
  explanation: ComparisonExplanation | null;
  detail: Record<string, unknown> | null;
  a_rows: number;
  b_rows: number;
  fields: { a: string; b: string; status: "same" | "different" | "partial"; a_values: (string | null)[]; b_values: (string | null)[] }[];
};

export type ComparisonPreview = {
  kind: "preview";
  traceable: false;
  computed: boolean;
  reason: "blocked" | "failed" | null;
  error: { code: string; message: string } | null;
  spec: ComparisonSpec;
  spec_key: string;
  sides: { a: ComparisonSideBasis; b: ComparisonSideBasis };
  attribution: ComparisonAttribution;
  equivalence: ComparisonEquivalence;
  issues: ComparisonIssue[];
  pending: Issue[];
  summary: ComparisonSummary | null;
  samples: Record<ComparisonCategory, ComparisonIdentity[]> | null;
  explained_samples: Record<"only_a" | "only_b", Partial<Record<ComparisonExplanation, ComparisonIdentity[]>>> | null;
  computed_at: string;
};

export type ComparisonRunStatus = "queued" | "running" | "succeeded" | "failed";

export type ComparisonRunDetail = {
  id: string;
  kind: "run";
  traceable: true;
  comparison_id: string;
  status: ComparisonRunStatus;
  spec: ComparisonSpec;
  sides: { a: ComparisonSideBasis; b: ComparisonSideBasis };
  attribution: ComparisonAttribution;
  equivalence: ComparisonEquivalence | null;
  issues: ComparisonIssue[];
  changes: { a: DecisionChange[]; b: DecisionChange[]; equivalence: string | null; recorded: boolean } | null;
  summary: ComparisonSummary | null;
  error: { code: string; message: string } | null;
  duration_ms: number | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type ComparisonRunBrief = {
  id: string;
  status: ComparisonRunStatus;
  rules: ComparisonRule[];
  equivalence: (Pick<ComparisonEquivalence, "status" | "statement"> & { reading: ComparisonReading["kind"] | null }) | null;
  sides: Record<
    "a" | "b",
    { label: string; kind: "population" | "run"; dataset: { id: string; key: string; name: string }; version: { id: string; number: number; rows: number }; key: string; decisions_key: string | null }
  >;
  summary: Pick<ComparisonSummary, "a" | "b" | "shared" | "shared_by_rule" | "only_a" | "only_b" | "net_difference" | "unmatched"> | null;
  queued_at: string | null;
  finished_at: string | null;
};

export type ComparisonListItem = { id: string; name: string; spec: ComparisonSpec; spec_key: string; last_run: ComparisonRunBrief | null; runs: number; created_at: string };

export type ComparisonRow = SourceRow & {
  state: "selected" | "excluded";
  exclusion: { step_position: number; step_title: string | null; code: string; label: string; explanation: string } | null;
};

export type ComparisonRowsMeta = PageMeta & {
  side: "a" | "b";
  label: string;
  dataset: { id: string; key: string; name: string };
  version: { id: string; number: number; rows: number };
  key: string;
  identity: string | null;
  run_id: string;
};

export type DatasetDetail = DatasetSummary & { versions: VersionSummary[]; columns: DatasetColumn[] };
