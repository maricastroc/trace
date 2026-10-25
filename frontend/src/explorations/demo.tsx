"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { request } from "@/lib/api";
import { useConfirmRelationship, useLaunchRun, useRecipes, useResults, useRun, useRuns } from "@/lib/queries";
import type { Contributor, Paginated, Recipe, ResultRow, RunDetail, OutputColumn } from "@/lib/types";
import { useToken, useWorkspace } from "@/lib/workspace";

export type DemoData = {
  recipe: Recipe;
  run: RunDetail;
  results: ResultRow[];
  columns: OutputColumn[];
};

type GateStatus = "booting" | "error" | "empty" | "needs-prep" | "running" | "ready";

export function useDemoRun() {
  const { state } = useWorkspace();
  const recipes = useRecipes();
  const recipe = recipes.data?.data[0] ?? null;
  const runs = useRuns(recipe?.id ?? null);
  const [launchedId, setLaunchedId] = useState<string | null>(null);
  const succeeded = runs.data?.data.find((r) => r.status === "succeeded") ?? null;
  const runId = launchedId ?? succeeded?.id ?? null;
  const run = useRun(runId);
  const results = useResults(run.data?.data.status === "succeeded" ? runId : null);
  const confirm = useConfirmRelationship();
  const launch = useLaunchRun();
  const [error, setError] = useState<string | null>(null);

  const prepare = async () => {
    if (!recipe) return;
    setError(null);
    try {
      for (const issue of recipe.compiled.issues) {
        const id = issue.details?.relationship_id;
        if (typeof id === "string") await confirm.mutateAsync({ id, action: "confirm" });
      }
      const created = await launch.mutateAsync(recipe.id);
      setLaunchedId(created.data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  let status: GateStatus = "booting";
  if (state.status === "error" || recipes.error) status = "error";
  else if (state.status !== "ready" || recipes.isPending || runs.isPending) status = "booting";
  else if (!recipe) status = "empty";
  else if (confirm.isPending || launch.isPending || run.data?.data.status === "queued" || run.data?.data.status === "running") status = "running";
  else if (run.data?.data.status === "succeeded" && results.data) status = "ready";
  else if (runId && (run.isPending || results.isPending)) status = "booting";
  else status = "needs-prep";

  const data: DemoData | null =
    status === "ready" && recipe && run.data && results.data
      ? { recipe, run: run.data.data, results: results.data.data, columns: results.data.columns }
      : null;

  return { status, data, prepare, error: error ?? (state.status === "error" ? state.error.message : null) };
}

export function DemoGate({ tone = "light", children }: { tone?: "light" | "dark"; children: (data: DemoData) => ReactNode }) {
  const { status, data, prepare, error } = useDemoRun();

  if (data) return <>{children(data)}</>;

  const dark = tone === "dark";
  return (
    <div className={`flex min-h-[70vh] items-center justify-center px-6 ${dark ? "text-[#efe9dc]" : "text-[#161513]"}`}>
      <div className="max-w-xl">
        {status === "needs-prep" ? (
          <>
            <p className="text-[15px] tracking-wide uppercase opacity-70">Demonstração</p>
            <h1 className="mt-3 font-display text-[44px] leading-[1.05]">Este espaço ainda não tem uma execução para investigar.</h1>
            <p className="mt-4 text-[18px] leading-relaxed opacity-80">
              Para preparar, o Trace confirma o relacionamento sugerido entre refeições e cozinhas e executa a receita no Laravel. Os números que aparecem depois vêm dessa execução.
            </p>
            <button type="button" onClick={prepare} className={`mt-7 rounded-full px-6 py-3 text-[16px] font-medium ${dark ? "bg-[#efe9dc] text-[#161513]" : "bg-[#161513] text-[#f4efe6]"}`}>
              Preparar demonstração
            </button>
          </>
        ) : status === "running" ? (
          <p className="font-display text-[34px]">Executando a receita no Laravel…</p>
        ) : status === "error" ? (
          <p className="text-[18px] text-[#b4321f]">{error ?? "Não foi possível falar com a API."} Verifique se o Laravel está rodando.</p>
        ) : status === "empty" ? (
          <p className="text-[18px]">Este espaço não tem receitas.</p>
        ) : (
          <p className="font-display text-[34px] opacity-70">Carregando dados reais…</p>
        )}
        {error && status !== "error" && <p className="mt-4 text-[15px] text-[#b4321f]">{error}</p>}
      </div>
    </div>
  );
}

export function useAllContributors(runId: string, results: ResultRow[]) {
  const token = useToken();
  return useQueries({
    queries: results.map((r) => ({
      queryKey: ["contributors-all", runId, r.result_no, token],
      queryFn: () => request<Paginated<Contributor>>(`/runs/${runId}/results/${r.result_no}/contributors?input=0&per_page=100`, { token }),
      staleTime: Infinity,
    })),
  });
}

export function groupKeyOf(columns: OutputColumn[], row: ResultRow) {
  return columns
    .filter((c) => c.role === "group_key")
    .map((c) => row.values[c.key] ?? "∅")
    .join(" · ");
}

export function sumColumn(columns: OutputColumn[]) {
  return columns.find((c) => c.role === "measure" && c.function === "sum") ?? null;
}

export function countColumn(columns: OutputColumn[]) {
  return columns.find((c) => c.role === "measure" && c.function === "count") ?? null;
}

export function ExplorationBar({ current, tone = "light" }: { current: "a" | "b" | "c"; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  const items = [
    { id: "a", label: "A · Reportagem" },
    { id: "b", label: "B · Rio (interface principal)" },
    { id: "c", label: "C · Arquivo" },
  ];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3 text-[14px] ${dark ? "border-white/15 text-[#efe9dc]" : "border-black/10 text-[#161513]"}`}>
      <Link href="/exploracoes" className="font-medium hover:underline">
        Trace · explorações de direção
      </Link>
      <nav className="flex gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.id === "b" ? "/" : `/exploracoes/${item.id}`}
            className={`rounded-full px-3 py-1 ${item.id === current ? (dark ? "bg-[#efe9dc] text-[#161513]" : "bg-[#161513] text-[#f4efe6]") : "opacity-70 hover:opacity-100"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <span className="opacity-70">protótipo com dados reais · dados sintéticos</span>
    </div>
  );
}
