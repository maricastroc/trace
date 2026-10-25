"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { query, request } from "./api";
import type {
  BreakdownRow,
  Contributor,
  DatasetSummary,
  DatasetVersion,
  Diagnostic,
  Exclusion,
  Flow,
  Flows,
  Journey,
  Meta,
  OutputColumn,
  Paginated,
  Recipe,
  Relationship,
  ResultDetail,
  ResultRow,
  RunDetail,
  RunSummary,
  SourceRow,
  SummaryEntry,
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

export function useExclusions(runId: string | null, filters: { step?: number; result?: number }, page: number) {
  return useApi<Paginated<Exclusion, { summary: SummaryEntry[] }>>(
    ["exclusions", runId, filters.step, filters.result, page],
    runId ? `/runs/${runId}/exclusions${query({ step: filters.step, result: filters.result, page, per_page: 12 })}` : null,
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

export function useConfirmRelationship() {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "confirm" | "reject" }) =>
      request<{ data: Relationship }>(`/relationships/${id}/${action}`, { method: "POST", token }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["relationships"] });
      client.invalidateQueries({ queryKey: ["relationship"] });
      client.invalidateQueries({ queryKey: ["recipes"] });
    },
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
