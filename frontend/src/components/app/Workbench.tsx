"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Investigation } from "@/components/investigation/Investigation";
import type { Orientation } from "@/components/river/layout";
import { buildRiverModel } from "@/components/river/model";
import { River, type RecordTrace } from "@/components/river/River";
import { API_URL, type ApiError } from "@/lib/api";
import { shortId } from "@/lib/format";
import { useDatasets, useFlows, useJourney, useLaunchRun, useMeta, useRecipes, useRelationships, useResults, useRun, useRuns } from "@/lib/queries";
import { useWorkspace } from "@/lib/workspace";
import { ContextBar } from "./ContextBar";
import { DataSection } from "./DataSection";
import { type Focus, sameFocus } from "./focus";
import { Hero } from "./Hero";
import { TextFlow } from "./TextFlow";

export function Workbench() {
  const { state, retry } = useWorkspace();
  if (state.status === "loading") return <Boot message={state.message} />;
  if (state.status === "error") return <BootError error={state.error} retry={retry} />;
  return <Ready workspaceId={state.workspace.id} renewed={state.renewed} />;
}

function TopBar({ workspaceId }: { workspaceId?: string }) {
  return (
    <div className="sticky top-0 z-30 border-b border-ink/12 bg-paper/95 backdrop-blur-[2px]">
      <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between gap-4 px-4 sm:px-8">
        <p className="flex items-baseline gap-3">
          <span className="text-[28px] leading-none font-bold tracking-[-0.02em]" style={{ fontStretch: "76%" }}>
            Trace<span style={{ color: "#2b4be0" }}>.</span>
          </span>
          <span className="hidden text-[15px] text-ink-2 sm:inline">Every number has a story.</span>
        </p>
        {workspaceId && (
          <p className="text-[14px] text-ink-2" title="Seu espaço é privado e identificado por um token guardado neste navegador.">
            espaço {shortId(workspaceId)}
          </p>
        )}
      </div>
    </div>
  );
}

function Boot({ message }: { message: string }) {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <div className="mx-auto flex max-w-[1560px] items-center gap-3 px-4 py-24 text-[20px] sm:px-8" role="status">
        <span aria-hidden className="pulse-dot inline-block size-2.5 rounded-full bg-[#2b4be0]" />
        {message}…
      </div>
    </div>
  );
}

function BootError({ error, retry }: { error: ApiError; retry: () => void }) {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <div className="mx-auto max-w-[760px] px-4 py-20 sm:px-8" role="alert">
        <p className="text-[15px] font-semibold tracking-[0.08em] text-[#8f2a1a] uppercase">Sem conexão com o backend</p>
        <h1 className="mt-3 text-[52px] leading-[0.95] font-bold tracking-[-0.02em]" style={{ fontStretch: "78%" }}>
          O Trace não conseguiu falar com a API.
        </h1>
        <p className="mt-5 text-[19px] leading-relaxed">{error.message}</p>
        {error.isUnreachable && (
          <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
            Inicie o Laravel em <code className="font-mono">backend/</code> com <code className="font-mono">composer dev</code> e confirme que ele responde em <code className="font-mono">{API_URL}</code>.
          </p>
        )}
        <button type="button" onClick={retry} className="mt-7 rounded-full bg-ink px-6 py-3 text-[17px] font-semibold text-[#f3efe6]">
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

function useTallViewport() {
  const [tall, setTall] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(min-height: 760px)");
    const update = () => setTall(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return tall;
}

function Ready({ workspaceId, renewed }: { workspaceId: string; renewed: boolean }) {
  const meta = useMeta();
  const recipes = useRecipes();
  const datasets = useDatasets();
  const relationships = useRelationships();
  const recipe = recipes.data?.data[0] ?? null;
  const runs = useRuns(recipe?.id ?? null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runId = selectedRunId ?? recipe?.last_run?.id ?? null;
  const run = useRun(runId);
  const runDetail = run.data?.data ?? null;
  const executed = runDetail?.status === "succeeded";
  const results = useResults(executed ? runId : null);
  const flows = useFlows(executed ? runId : null, 8);
  const launch = useLaunchRun();

  const [stack, setStack] = useState<Focus[]>([]);
  const [tab, setTab] = useState("result");
  const [textMode, setTextMode] = useState(false);
  const [anchorX, setAnchorX] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("h");
  const [announcement, setAnnouncement] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const tall = useTallViewport();
  const focus = stack[stack.length - 1] ?? null;

  const model = useMemo(
    () => (recipe ? buildRiverModel(recipe, runDetail, flows.data?.data, results.data?.data, relationships.data?.data ?? [], datasets.data?.data ?? []) : null),
    [recipe, runDetail, flows.data, results.data, relationships.data, datasets.data],
  );

  const resultFocus = [...stack].reverse().find((f) => f.kind === "result" || f.kind === "others");
  const selectedKey = !model || !resultFocus ? null : resultFocus.kind === "others" ? "others" : (model.results.find((r) => r.resultNos.includes(resultFocus.resultNo))?.key ?? null);
  const poolFocus = [...stack].reverse().find((f) => f.kind === "exclusions") as Extract<Focus, { kind: "exclusions" }> | undefined;
  const activePool = focus && (focus.kind === "exclusions" || focus.kind === "row") && poolFocus ? poolFocus.step : null;
  const rowId = focus?.kind === "row" ? focus.rowId : null;
  const journey = useJourney(executed ? runId : null, rowId, 1);

  const record: RecordTrace | null = useMemo(() => {
    const data = journey.data?.data;
    if (!model || !data || rowId === null || data.row.id !== rowId) return null;
    const path = data.paths[0];
    if (!path) {
      const diagnostic = data.diagnostics.find((d) => d.code === "join.right_unmatched" || d.code === "join.lookup_null_key");
      return diagnostic ? { kind: "unreferenced", step: diagnostic.step_position } : null;
    }
    const from = path.subject_joined_at ?? 0;
    if (path.outcome?.status === "included") {
      const outcome = path.outcome;
      const key = model.results.find((r) => r.resultNos.includes(outcome.result_no))?.key;
      return key ? { kind: "result", key, from } : null;
    }
    if (path.outcome?.status === "excluded") return { kind: "drop", step: path.outcome.step_position, from };
    return null;
  }, [journey.data, model, rowId]);

  const accent = useMemo(() => {
    if (!model || !focus) return "#111110";
    if (focus.kind === "relationship") return "#7a5300";
    if (focus.kind === "unreferenced") return "#8a3f5c";
    if (focus.kind === "exclusions" && !focus.resultNo) return "#9c8a64";
    const key = selectedKey ?? (record?.kind === "result" ? record.key : null);
    return model.results.find((r) => r.key === key)?.color.fill ?? "#111110";
  }, [model, focus, selectedKey, record]);

  const scrollToStage = useCallback(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stageRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  const open = useCallback(
    (next: Focus, mode: "replace" | "push" = "push", fromData = false) => {
      setStack((current) => {
        if (mode === "replace") return [next];
        if (sameFocus(current[current.length - 1], next)) return current;
        return [...current, next].slice(-10);
      });
      if (fromData) scrollToStage();
    },
    [scrollToStage],
  );

  const onFocus = useCallback(
    (next: Focus) => {
      if (next.kind === "result" || next.kind === "relationship") open(next, next.kind === "relationship" ? "replace" : "push");
      else open(next);
    },
    [open],
  );

  const clear = useCallback(() => {
    setStack([]);
    setAnnouncement("Seleção limpa.");
  }, []);

  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sheetOpen = stack.length > 0 && orientation === "v";

  useEffect(() => {
    if (!sheetOpen) return;
    if (!returnFocus.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocus.current = document.activeElement;
    }
    const anchor = document.querySelector<HTMLElement>("figure [aria-pressed=true]");
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    sheetRef.current?.focus({ preventScroll: true });
  }, [sheetOpen, focus]);

  useEffect(() => {
    if (sheetOpen || !returnFocus.current) return;
    returnFocus.current.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [sheetOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.length > 0) {
        event.preventDefault();
        clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, clear]);

  const selectResultKey = (key: string | null) => {
    if (!key || !model) return clear();
    if (key === "others") return open({ kind: "others" }, "replace");
    const result = model.results.find((r) => r.key === key);
    if (!result?.resultNo) return;
    open({ kind: "result", resultNo: result.resultNo }, "replace");
    setAnnouncement(`Investigação de ${result.label} aberta. Pressione Esc para limpar a seleção.`);
  };

  const onPool = (step: number) => {
    const current = resultFocus?.kind === "result" ? resultFocus : null;
    const related = current && model?.results.find((r) => r.resultNos.includes(current.resultNo))?.related[step];
    if (current && related) setStack([current, { kind: "exclusions", step, resultNo: current.resultNo }]);
    else open({ kind: "exclusions", step }, "replace");
    setAnnouncement(`Registros que saíram no passo ${step} abertos.`);
  };

  const runRecipe = () => {
    if (!recipe) return;
    launch.mutate(recipe.id, {
      onSuccess: (response) => {
        setSelectedRunId(response.data.id);
        setStack([]);
      },
    });
  };

  const loading = recipes.isPending || datasets.isPending || relationships.isPending;
  const loadError = recipes.error ?? datasets.error ?? relationships.error;
  const investigating = stack.length > 0;
  const horizontal = orientation === "h";
  const compact = investigating && horizontal;
  const synthetic = (datasets.data?.data ?? []).some((d) => d.is_synthetic);

  return (
    <div className="min-h-dvh">
      <TopBar workspaceId={workspaceId} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {renewed && <p className="mx-auto max-w-[1560px] px-4 pt-3 text-[15px] text-ink-2 sm:px-8">Seu espaço anterior expirou. Criamos um novo, com a demonstração sintética.</p>}

      {loading ? (
        <div className="mx-auto max-w-[1560px] px-4 py-20 text-[20px] sm:px-8" role="status">
          Carregando o espaço de investigação…
        </div>
      ) : loadError ? (
        <div className="mx-auto max-w-[760px] px-4 py-20 sm:px-8" role="alert">
          <p className="text-[22px] font-semibold text-[#8f2a1a]">Não foi possível carregar os dados do espaço.</p>
          <p className="mt-2 text-[18px]">{loadError.message}</p>
          <button type="button" onClick={() => [recipes, datasets, relationships].forEach((q) => q.refetch())} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-[16px] font-semibold text-[#f3efe6]">
            Tentar novamente
          </button>
        </div>
      ) : !recipe || !model ? (
        <div className="mx-auto max-w-[1560px] px-4 py-20 text-[20px] sm:px-8">Este espaço ainda não tem receitas.</div>
      ) : (
        <>
          <Hero
            recipe={recipe}
            model={model}
            synthetic={synthetic}
            collapsed={compact}
            launching={launch.isPending}
            launchError={launch.error?.message ?? null}
            onRun={runRecipe}
            onRelationship={(id) => open({ kind: "relationship", id }, "replace")}
          />

          <div ref={stageRef} className="scroll-mt-14">
            <div className={compact && tall ? "sticky top-14 z-20 bg-paper" : undefined}>
              <ContextBar
                recipe={recipe}
                datasets={datasets.data?.data ?? []}
                relationships={relationships.data?.data ?? []}
                runs={runs.data?.data ?? []}
                run={runDetail}
                runId={runId}
                textMode={textMode}
                launching={launch.isPending}
                onRunSelect={(id) => {
                  setSelectedRunId(id);
                  setStack([]);
                }}
                onRun={runRecipe}
                onRelationship={(id) => open({ kind: "relationship", id }, "replace")}
                onDataset={(alias) => {
                  setTab(alias);
                  document.getElementById("dados")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                onTextMode={setTextMode}
              />
              <figure className="mx-auto max-w-[1560px] px-4 pt-6 pb-2 sm:px-8" aria-describedby="rio-em-texto">
                {run.error ? (
                  <p className="py-10 text-[18px] text-[#8f2a1a]" role="alert">
                    Não foi possível carregar esta execução: {run.error.message}
                  </p>
                ) : executed && (flows.isPending || results.isPending) ? (
                  <p className="py-16 text-[20px]" role="status">
                    Lendo a linhagem registrada pelo motor…
                  </p>
                ) : flows.error ? (
                  <p className="py-10 text-[18px] text-[#8f2a1a]" role="alert">
                    {flows.error.message}
                  </p>
                ) : (
                  <River
                    model={model}
                    compact={compact}
                    selectedKey={selectedKey}
                    activePool={activePool}
                    record={record}
                    onSelect={selectResultKey}
                    onPool={onPool}
                    onUnreferenced={(step) => open({ kind: "unreferenced", step }, "replace")}
                    onRelationship={(id) => open({ kind: "relationship", id }, "replace")}
                    onSource={(alias) => {
                      setTab(alias);
                      document.getElementById("dados")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    onAnchor={setAnchorX}
                    onOrientation={setOrientation}
                  />
                )}
              </figure>
            </div>

            {investigating && horizontal && focus && (
              <div className="mx-auto max-w-[1560px] px-4 sm:px-8">
                <Investigation
                  focus={focus}
                  depth={stack.length}
                  model={model}
                  run={runDetail}
                  results={results.data?.data ?? []}
                  columns={runDetail?.output_columns ?? []}
                  accent={accent}
                  anchorX={anchorX}
                  variant="inline"
                  onFocus={onFocus}
                  onBack={() => setStack((s) => s.slice(0, -1))}
                  onClose={clear}
                />
              </div>
            )}
          </div>

          <TextFlow model={model} id="rio-em-texto" visible={textMode} />

          <DataSection
            model={model}
            tab={tab}
            onTab={setTab}
            results={results.data?.data}
            columns={runDetail?.output_columns ?? []}
            selectedResult={resultFocus?.kind === "result" ? resultFocus.resultNo : null}
            selectedRow={rowId}
            onSelectResult={(no) => open({ kind: "result", resultNo: no }, "replace", true)}
            onSelectRow={(id) => open({ kind: "row", rowId: id }, "replace", true)}
          />

          {meta.data && <p className="mx-auto max-w-[1560px] px-4 pb-10 text-[15px] text-ink-2 sm:px-8">{meta.data.data.demo_notice}</p>}

          {investigating && !horizontal && focus && (
            <div className="pointer-events-none fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="false" aria-label="Investigação">
              <div ref={sheetRef} tabIndex={-1} className="sheet-up pointer-events-auto relative max-h-[72dvh] overflow-y-auto rounded-t-[14px] border-t-[4px] bg-paper px-4 pt-3 pb-10 shadow-[0_-18px_40px_-24px_rgba(17,17,16,.45)] outline-none" style={{ borderColor: accent }}>
                <span aria-hidden className="mx-auto mb-4 block h-1.5 w-12 rounded-full bg-ink/20" />
                <Investigation
                  focus={focus}
                  depth={stack.length}
                  model={model}
                  run={runDetail}
                  results={results.data?.data ?? []}
                  columns={runDetail?.output_columns ?? []}
                  accent={accent}
                  anchorX={null}
                  variant="sheet"
                  onFocus={onFocus}
                  onBack={() => setStack((s) => s.slice(0, -1))}
                  onClose={clear}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
