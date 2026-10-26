"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { query, request, upload } from "./api";
import type {
  BreakdownRow,
  ComparisonIdentity,
  ComparisonListItem,
  ComparisonPreview,
  ComparisonRow,
  ComparisonRowsMeta,
  ComparisonRunBrief,
  ComparisonRunDetail,
  ComparisonSpec,
  Contributor,
  DatasetDetail,
  DatasetSummary,
  DatasetVersion,
  Diagnostic,
  Exclusion,
  Flow,
  Flows,
  Journey,
  Meta,
  OutputColumn,
  IdentitiesMeta,
  ImportPreview,
  Identity,
  Paginated,
  QuestionAnswer,
  QuestionReadings,
  QuestionSpec,
  Recipe,
  Relationship,
  RelationshipDraft,
  RelationshipPair,
  RelationshipPolicy,
  ResultDetail,
  ResultRow,
  RunDetail,
  RunSummary,
  SourceRow,
  SummaryEntry,
  TracedQuestion,
} from "./types";
import { useToken } from "./workspace";

type Interval<T> = number | false | ((data: T | undefined) => number | false);

function useApi<T>(key: unknown[], path: string | null, options: { refetchInterval?: Interval<T>; keepPrevious?: boolean } = {}) {
  const token = useToken();
  return useQuery({
    queryKey: [...key, token],
    queryFn: ({ signal }) => request<T>(path!, { token, signal }),
    enabled: token !== null && path !== null,
    refetchInterval: typeof options.refetchInterval === "function"
      ? (current) => (options.refetchInterval as (data: T | undefined) => number | false)(current.state.data)
      : options.refetchInterval,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
  });
}

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => request<{ data: Meta }>("/meta"), staleTime: Infinity });
}

export function useDatasets() {
  return useApi<{ data: DatasetSummary[] }>(["datasets"], "/datasets");
}

export function useRelationships() {
  return useApi<{ data: Relationship[] }>(["relationships"], "/relationships");
}

export function useRelationship(id: string | null) {
  return useApi<{ data: Relationship }>(["relationship", id], id ? `/relationships/${id}` : null);
}

export function useUnmatched(id: string | null, side: "from" | "from_null" | "to", page: number) {
  return useApi<Paginated<SourceRow, { side: string; dataset_key: string }>>(
    ["unmatched", id, side, page],
    id ? `/relationships/${id}/unmatched${query({ side, page, per_page: 8 })}` : null,
    { keepPrevious: true },
  );
}

export function useRecipes() {
  return useApi<{ data: Recipe[] }>(["recipes"], "/recipes");
}

export function useRuns(recipeId: string | null) {
  return useApi<Paginated<RunSummary>>(["runs", recipeId], recipeId ? `/runs${query({ recipe_id: recipeId, per_page: 8 })}` : null, {
    refetchInterval: (data) => (data?.data.some((run) => run.status === "queued" || run.status === "running") ? 1200 : false),
  });
}

export function useRun(runId: string | null) {
  return useApi<{ data: RunDetail }>(["run", runId], runId ? `/runs/${runId}` : null, {
    refetchInterval: (data) => (data && (data.data.status === "queued" || data.data.status === "running") ? 900 : false),
  });
}

export function useResults(runId: string | null) {
  return useApi<Paginated<ResultRow> & { columns: OutputColumn[] }>(["results", runId], runId ? `/runs/${runId}/results${query({ per_page: 200 })}` : null);
}

export function useFlow(runId: string | null, resultNo: number | null) {
  return useApi<{ data: Flow }>(["flow", runId, resultNo], runId && resultNo ? `/runs/${runId}/flow${query({ result: resultNo })}` : null, {
    keepPrevious: true,
  });
}

export function useFlows(runId: string | null, limit = 8) {
  return useApi<{ data: Flows }>(["flows", runId, limit], runId ? `/runs/${runId}/flows${query({ limit })}` : null);
}

export function useResultDetail(runId: string | null, resultNo: number | null) {
  return useApi<{ data: ResultDetail }>(["result", runId, resultNo], runId && resultNo ? `/runs/${runId}/results/${resultNo}` : null);
}

export function useBreakdown(runId: string | null, resultNo: number | null, by: number, page: number) {
  return useApi<Paginated<BreakdownRow, { alias: string; tuples_without_input: number }>>(
    ["breakdown", runId, resultNo, by, page],
    runId && resultNo ? `/runs/${runId}/results/${resultNo}/breakdown${query({ by, page, per_page: 12 })}` : null,
    { keepPrevious: true },
  );
}

export function useContributors(runId: string | null, resultNo: number | null, input: number, via: { input: number; row: number } | null, page: number) {
  return useApi<Paginated<Contributor, { alias: string }>>(
    ["contributors", runId, resultNo, input, via?.input, via?.row, page],
    runId && resultNo
      ? `/runs/${runId}/results/${resultNo}/contributors${query({ input, via_input: via?.input, via_row: via?.row, page, per_page: 10 })}`
      : null,
    { keepPrevious: true },
  );
}

export function useExclusions(runId: string | null, filters: { step?: number; result?: number; code?: string }, page: number) {
  return useApi<Paginated<Exclusion, { summary: SummaryEntry[] }>>(
    ["exclusions", runId, filters.step, filters.result, filters.code, page],
    runId ? `/runs/${runId}/exclusions${query({ step: filters.step, result: filters.result, code: filters.code, page, per_page: 12 })}` : null,
    { keepPrevious: true },
  );
}

export function useDiagnostics(runId: string | null, filters: { code?: string; step?: number }, page: number) {
  return useApi<Paginated<Diagnostic, { summary: SummaryEntry[] }>>(
    ["diagnostics", runId, filters.code, filters.step, page],
    runId ? `/runs/${runId}/diagnostics${query({ code: filters.code, step: filters.step, page, per_page: 12 })}` : null,
    { keepPrevious: true },
  );
}

export function useJourney(runId: string | null, rowId: number | null, page: number) {
  return useApi<{ data: Journey }>(
    ["journey", runId, rowId, page],
    runId && rowId ? `/runs/${runId}/rows/${rowId}/journey${query({ page, per_page: 6 })}` : null,
    { keepPrevious: true },
  );
}

export function useVersion(versionId: string | null) {
  return useApi<{ data: DatasetVersion }>(["version", versionId], versionId ? `/dataset-versions/${versionId}` : null);
}

export function useVersionRows(versionId: string | null, page: number) {
  return useApi<Paginated<SourceRow>>(
    ["version-rows", versionId, page],
    versionId ? `/dataset-versions/${versionId}/rows${query({ page, per_page: 40 })}` : null,
    { keepPrevious: true },
  );
}

function combineVersions(results: UseQueryResult<{ data: DatasetVersion }>[]) {
  const data: Record<string, DatasetVersion> = {};
  for (const result of results) if (result.data) data[result.data.data.id] = result.data.data;
  return {
    data,
    pending: results.some((result) => result.isPending),
    error: results.find((result) => result.error)?.error ?? null,
    refetch: () => results.forEach((result) => result.refetch()),
  };
}

export function useVersions(versionIds: string[]) {
  const token = useToken();
  return useQueries({
    queries: versionIds.map((id) => ({
      queryKey: ["version", id, token],
      queryFn: ({ signal }: { signal: AbortSignal }) => request<{ data: DatasetVersion }>(`/dataset-versions/${id}`, { token, signal }),
      enabled: token !== null,
    })),
    combine: combineVersions,
  });
}

export function useRowsWhere(versionId: string | null, column: string | null, value: string | null, perPage = 10, page = 1) {
  const params = new URLSearchParams({ column: column ?? "", value: value ?? "", page: String(page), per_page: String(perPage) });
  return useApi<Paginated<SourceRow>>(
    ["version-rows-where", versionId, column, value, perPage, page],
    versionId && column && value !== null ? `/dataset-versions/${versionId}/rows?${params.toString()}` : null,
    { keepPrevious: true },
  );
}

export function useRelationshipDraft(pair: RelationshipPair | null) {
  const token = useToken();
  return useQuery({
    queryKey: ["relationship-draft", pair, token],
    queryFn: ({ signal }) => request<{ data: RelationshipDraft }>("/relationships/evaluate", { method: "POST", body: pair, token, signal }),
    enabled: token !== null && pair !== null,
    placeholderData: keepPreviousData,
  });
}

function useRelationshipInvalidation() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["relationships"] });
    client.invalidateQueries({ queryKey: ["relationship"] });
    client.invalidateQueries({ queryKey: ["relationship-draft"] });
    client.invalidateQueries({ queryKey: ["recipes"] });
    client.invalidateQueries({ queryKey: ["question-preview"] });
    client.invalidateQueries({ queryKey: ["question-readings"] });
  };
}

export type RelationshipDecision = "confirm" | "reject" | "reopen";

export function useDecideRelationship() {
  const token = useToken();
  const invalidate = useRelationshipInvalidation();
  return useMutation({
    mutationFn: ({ id, action, policy }: { id: string; action: RelationshipDecision; policy?: RelationshipPolicy }) =>
      request<{ data: Relationship }>(`/relationships/${id}/${action}`, { method: "POST", token, body: policy ? { policy } : undefined }),
    onSuccess: invalidate,
  });
}

export function useCorrectRelationship() {
  const token = useToken();
  const invalidate = useRelationshipInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; from_column: string; to_dataset_id: string; to_column: string }) =>
      request<{ data: Relationship; replaced: Relationship }>(`/relationships/${id}/correct`, { method: "POST", body, token }),
    onSuccess: invalidate,
  });
}

export function useCreateRelationship() {
  const token = useToken();
  const invalidate = useRelationshipInvalidation();
  return useMutation({
    mutationFn: (pair: RelationshipPair) => request<{ data: Relationship }>("/relationships", { method: "POST", body: pair, token }),
    onSuccess: invalidate,
  });
}

function useDatasetInvalidation() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["datasets"] });
    client.invalidateQueries({ queryKey: ["recipes"] });
    client.invalidateQueries({ queryKey: ["question-preview"] });
    client.invalidateQueries({ queryKey: ["question-readings"] });
  };
}

export function useDeclareValidity() {
  const token = useToken();
  const invalidate = useDatasetInvalidation();
  return useMutation({
    mutationFn: ({ datasetId, ...body }: { datasetId: string; start_column: string; end_column: string | null; end_inclusive: boolean }) =>
      request<{ data: DatasetSummary }>(`/datasets/${datasetId}/validity`, { method: "PUT", body, token }),
    onSuccess: invalidate,
  });
}

export function useClearValidity() {
  const token = useToken();
  const invalidate = useDatasetInvalidation();
  return useMutation({
    mutationFn: (datasetId: string) => request<{ data: DatasetSummary }>(`/datasets/${datasetId}/validity`, { method: "DELETE", token }),
    onSuccess: invalidate,
  });
}

export function useDiscoverRelationships() {
  const token = useToken();
  const invalidate = useRelationshipInvalidation();
  return useMutation({
    mutationFn: () => request<{ data: Relationship[]; meta: { found: number } }>("/relationships/discover", { method: "POST", token }),
    onSuccess: invalidate,
  });
}

export function useLaunchRun() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => request<{ data: RunDetail }>(`/recipes/${recipeId}/runs`, { method: "POST", token }),
    onSuccess: (response) => {
      client.setQueryData(["run", response.data.id, token], response);
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["recipes"] });
    },
  });
}

export function useQuestionPreview(question: QuestionSpec | null) {
  const token = useToken();
  return useQuery({
    queryKey: ["question-preview", question, token],
    queryFn: ({ signal }) => request<{ data: QuestionAnswer }>("/questions/preview", { method: "POST", body: { question }, token, signal }),
    enabled: token !== null && question !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useQuestionReadings(question: QuestionSpec | null) {
  const token = useToken();
  return useQuery({
    queryKey: ["question-readings", question, token],
    queryFn: ({ signal }) => request<{ data: QuestionReadings }>("/questions/readings", { method: "POST", body: { question }, token, signal }),
    enabled: token !== null && question !== null,
    retry: false,
  });
}

export function useTraceQuestion() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ question, title }: { question: QuestionSpec; title: string }) =>
      request<{ data: TracedQuestion }>("/questions/trace", { method: "POST", body: { question, title }, token }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["recipes"] });
    },
  });
}

export function useIdentities(runId: string | null, resultNo: number | null, measure: string | null, page: number) {
  return useApi<Paginated<Identity, IdentitiesMeta>>(
    ["identities", runId, resultNo, measure, page],
    runId && resultNo && measure ? `/runs/${runId}/results/${resultNo}/identities${query({ measure, page, per_page: 12 })}` : null,
    { keepPrevious: true },
  );
}

export function useImportPreview() {
  const token = useToken();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload<{ data: ImportPreview }>("/imports/preview", form, token);
    },
  });
}

export function useImportFile() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name, datasetId }: { file: File; name?: string; datasetId?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (name) form.append("name", name);
      return upload<{ data: DatasetSummary }>(datasetId ? `/datasets/${datasetId}/versions` : "/datasets", form, token);
    },
    onSuccess: () => {
      for (const key of ["datasets", "version", "version-rows", "relationships", "relationship", "recipes", "question-preview", "question-readings"]) {
        client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useDeleteDataset() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (datasetId: string) => request<void>(`/datasets/${datasetId}`, { method: "DELETE", token }),
    onSuccess: () => {
      for (const key of ["datasets", "relationships", "relationship", "recipes", "question-preview", "question-readings"]) {
        client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useDatasetDetail(datasetId: string | null) {
  return useApi<{ data: DatasetDetail }>(["dataset", datasetId], datasetId ? `/datasets/${datasetId}` : null);
}

export function useDatasetDetails(datasetIds: string[]) {
  const token = useToken();
  return useQueries({
    queries: datasetIds.map((id) => ({
      queryKey: ["dataset", id, token],
      queryFn: ({ signal }: { signal: AbortSignal }) => request<{ data: DatasetDetail }>(`/datasets/${id}`, { token, signal }),
      enabled: token !== null,
    })),
    combine: combineDetails,
  });
}

function combineDetails(results: UseQueryResult<{ data: DatasetDetail }>[]) {
  return {
    data: Object.fromEntries(results.flatMap((result) => (result.data ? [[result.data.data.id, result.data.data]] : []))) as Record<string, DatasetDetail>,
    pending: results.some((result) => result.isPending),
  };
}

export function useComparisonPreview(spec: ComparisonSpec | null) {
  const token = useToken();
  return useQuery({
    queryKey: ["comparison-preview", spec, token],
    queryFn: ({ signal }) => request<{ data: ComparisonPreview }>("/comparisons/preview", { method: "POST", body: { spec }, token, signal }),
    enabled: token !== null && spec !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useTraceComparison() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ spec, name }: { spec: ComparisonSpec; name: string }) =>
      request<{ data: ComparisonRunDetail }>("/comparisons/trace", { method: "POST", body: { spec, name }, token }),
    onSuccess: (response) => {
      client.setQueryData(["comparison-run", response.data.id, token], response);
      client.invalidateQueries({ queryKey: ["comparisons"] });
      client.invalidateQueries({ queryKey: ["comparison-runs"] });
    },
  });
}

export function useComparisonRun(runId: string | null) {
  return useApi<{ data: ComparisonRunDetail }>(["comparison-run", runId], runId ? `/comparison-runs/${runId}` : null, {
    refetchInterval: (data) => (data && (data.data.status === "queued" || data.data.status === "running") ? 800 : false),
  });
}

export function useComparisons() {
  return useApi<{ data: ComparisonListItem[] }>(["comparisons"], "/comparisons");
}

export function useComparisonRuns(comparisonId: string | null) {
  return useApi<Paginated<ComparisonRunBrief>>(["comparison-runs", comparisonId], comparisonId ? `/comparison-runs${query({ comparison_id: comparisonId, per_page: 20 })}` : null);
}

export type IdentityFilters = { category?: string; explanation?: string; repeated?: "a" | "b"; changed?: boolean; search?: string };

export function useComparisonIdentities(runId: string | null, filters: IdentityFilters, page: number, perPage = 12) {
  return useApi<Paginated<ComparisonIdentity>>(
    ["comparison-identities", runId, filters, page, perPage],
    runId
      ? `/comparison-runs/${runId}/identities${query({ category: filters.category, explanation: filters.explanation, repeated: filters.repeated, changed: filters.changed ? 1 : undefined, search: filters.search, page, per_page: perPage })}`
      : null,
    { keepPrevious: true },
  );
}

export function useComparisonRows(runId: string | null, side: "a" | "b", target: { identity: string } | { empty: true } | null, state: "selected" | "excluded" | "all", page: number) {
  const identity = target && "identity" in target ? target.identity : undefined;
  const empty = target && "empty" in target ? 1 : undefined;
  return useApi<{ data: ComparisonRow[]; meta: ComparisonRowsMeta }>(
    ["comparison-rows", runId, side, identity, empty, state, page],
    runId && target ? `/comparison-runs/${runId}/rows${query({ side, identity, empty, state, page, per_page: 10 })}` : null,
    { keepPrevious: true },
  );
}
