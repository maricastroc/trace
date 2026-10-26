"use client";

import "./comparacoes.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTrail } from "@/components/shell/Trail";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { useToast } from "@/components/ui/Toast";
import { formatCount, formatDuration, formatWhen } from "@/lib/format";
import {
  useComparisonPreview,
  useComparisonRun,
  useComparisons,
  useDatasetDetails,
  useDatasets,
  useRecipes,
  useRelationships,
  useTraceComparison,
  useVersions,
} from "@/lib/queries";
import type { ComparisonListItem, ComparisonPreview, ComparisonRule, ComparisonRunDetail, ComparisonSpec, ComparisonSummary } from "@/lib/types";
import { Needs } from "@/features/perguntas/components/Needs";
import { buildCatalog, type Catalog } from "@/features/perguntas/model/catalog";
import { EquivalenceGate } from "./components/Equivalence";
import { History } from "./components/History";
import { Result } from "./components/Result";
import type { TraceControl } from "./components/Investigate";
import { Setup } from "./components/Setup";
import { fromPreview, fromRun, labelsOf, traceDifferences, type ResultModel } from "./model/result";
import { decodeSpec, emptyDraft, encodeSpec, fromSpec, RULE_TEXT, suggestions, toSpec, type Draft, type Naming } from "./model/spec";

export function ComparacoesScreen() {
  const datasets = useDatasets();
  const relationships = useRelationships();
  const versionIds = useMemo(() => datasets.data?.data.flatMap((d) => (d.latest_version ? [d.latest_version.id] : [])) ?? [], [datasets.data]);
  const versions = useVersions(versionIds);
  const ready = datasets.isSuccess && relationships.isSuccess && !versions.pending;
  const catalog = useMemo(
    () => (ready ? buildCatalog(datasets.data.data, versions.data, relationships.data.data) : null),
    [ready, datasets.data, versions.data, relationships.data],
  );
  const failure = datasets.error ?? relationships.error ?? versions.error;

  if (failure) {
    return (
      <Shell>
        <ErrorBlock error={failure} onRetry={() => (datasets.refetch(), relationships.refetch(), versions.refetch())} />
      </Shell>
    );
  }
  if (!catalog) {
    return (
      <Shell>
        <LoadingBlock label="Carregando tabelas e relações" />
      </Shell>
    );
  }
  if (catalog.tables.length === 0) {
    return (
      <Shell>
        <EmptyBlock title="Nenhuma tabela neste cenário ainda.">
          Importe um CSV no Mapa para comparar conjuntos de linhas.{" "}
          <Link className="btn-link" href="/mapa?importar=nova">
            Importar CSV
          </Link>
        </EmptyBlock>
      </Shell>
    );
  }
  return <Workspace catalog={catalog} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  useTrail([{ label: "Comparações" }]);
  return <div className="comparacoes">{children}</div>;
}

function nameOf(result: Pick<ResultModel, "sides" | "spec">) {
  const labels = labelsOf(result.sides);
  const rules = result.spec.rules.length ? ` · regra: ${result.spec.rules.map((rule) => RULE_TEXT[rule].name).join(", ")}` : "";
  return `${labels.a} × ${labels.b}${rules}`;
}

function Workspace({ catalog }: { catalog: Catalog }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const runParam = params.get("execucao");
  const specParam = useMemo(() => decodeSpec(params.get("c")), [params]);
  const location = params.toString();

  const recipes = useRecipes();
  const details = useDatasetDetails(useMemo(() => catalog.tables.map((table) => table.id), [catalog]));
  const versionLists = useMemo(() => Object.fromEntries(Object.entries(details.data).map(([id, detail]) => [id, detail.versions])), [details.data]);
  const offered = useMemo(() => suggestions(catalog, versionLists), [catalog, versionLists]);
  const naming = useMemo<Naming>(
    () => ({
      catalog,
      versions: versionLists,
      runs: Object.fromEntries((recipes.data?.data ?? []).flatMap((recipe) => (recipe.last_run ? [[recipe.last_run.id, recipe.name]] : []))),
    }),
    [catalog, versionLists, recipes.data],
  );

  const [draft, setDraft] = useState<Draft>(() => (specParam ? fromSpec(specParam, {}, { catalog }) : (suggestions(catalog)[0]?.draft ?? emptyDraft())));
  const [editingAt, setEditingAt] = useState<string | null>(null);
  const editing = editingAt === location;

  const run = useComparisonRun(runParam);
  const runDetail = run.data?.data ?? null;
  const preview = useComparisonPreview(!runParam && specParam ? specParam : null);
  const previewData = !runParam && specParam ? (preview.data?.data ?? null) : null;
  const trace = useTraceComparison();
  const comparisons = useComparisons();

  const finished = runDetail && (runDetail.status === "succeeded" || runDetail.status === "failed") ? runDetail.id : null;
  useEffect(() => {
    if (finished) {
      client.invalidateQueries({ queryKey: ["comparisons"] });
      client.invalidateQueries({ queryKey: ["comparison-runs"] });
    }
  }, [finished, client]);

  const gated = !runParam && previewData !== null && previewData.equivalence?.status === "unconfirmed";
  const result: ResultModel | null = runParam ? (runDetail ? fromRun(runDetail) : null) : previewData && !gated ? fromPreview(previewData) : null;
  const showSetup = editing || (!runParam && !specParam);

  const go = (search: string, replace = false) => (replace ? router.replace(`/comparacoes${search}`, { scroll: false }) : router.push(`/comparacoes${search}`, { scroll: false }));
  const openSpec = (spec: ComparisonSpec, replace = false) => go(`?c=${encodeURIComponent(encodeSpec(spec))}`, replace);

  const onTrace = () => {
    if (!previewData || !result) return;
    trace.mutate({ spec: previewData.spec, name: nameOf(result) }, { onSuccess: (response) => go(`?execucao=${response.data.id}`) });
  };
  const traceControl = { onTrace, pending: trace.isPending, error: trace.error };

  const edit = () => {
    const current = result?.spec ?? runDetail?.spec ?? previewData?.spec ?? specParam;
    if (current) {
      const runs: Record<string, string> = {};
      const sides = result?.sides ?? runDetail?.sides ?? previewData?.sides;
      for (const side of ["a", "b"] as const) {
        const s = current[side];
        if (s.kind === "run" && sides) runs[s.run_id] = sides[side].dataset.id;
      }
      setDraft(fromSpec(current, runs, naming));
    }
    setEditingAt(location);
  };

  const compare = () => {
    const spec = toSpec(draft, naming);
    if (!spec) return;
    setEditingAt(null);
    openSpec(spec);
  };

  const setRules = (rules: ComparisonRule[], effect: ComparisonSummary | null) => {
    if (!result) return;
    const previous = result.spec.rules;
    const spec = { ...result.spec, rules };
    openSpec(spec, result.source === "preview");
    if (rules.length > 0) {
      toast(
        effect ? `Regra aceita: ${formatCount(effect.shared_by_rule)} pares passam a contar como nos dois. A diferença líquida não muda.` : "Regra aceita.",
        result.source === "preview" ? { label: "Desfazer", onClick: () => openSpec({ ...spec, rules: previous }, true) } : undefined,
      );
    } else {
      toast("Regra removida. Os pares voltam a ser hipótese.");
    }
  };

  return (
    <div className="comparacoes">
      {showSetup ? (
        <SetupTrail>
          <Setup
            catalog={catalog}
            recipes={recipes.data?.data ?? []}
            naming={naming}
            draft={draft}
            suggestions={offered}
            editing={editing}
            onChange={setDraft}
            onCompare={compare}
            onCancel={() => setEditingAt(null)}
          />
        </SetupTrail>
      ) : runParam ? (
        <TraceState run={run} detail={runDetail} onEdit={edit} />
      ) : gated && previewData && specParam ? (
        <EquivalenceGate catalog={catalog} equivalence={previewData.equivalence} onConfirm={(equivalence) => openSpec({ ...specParam, equivalence }, true)} onEdit={edit} />
      ) : (
        <PreviewState preview={preview} data={previewData} onEdit={edit} />
      )}

      {!showSetup && result && (
        <Result
          catalog={catalog}
          result={result}
          stale={!runParam && (preview.isPlaceholderData || preview.isFetching)}
          trace={traceControl}
          status={
            runParam && runDetail ? (
              <TracedStatus catalog={catalog} run={runDetail} onCurrent={() => openSpec(runDetail.spec)} />
            ) : previewData ? (
              <PreviewStatus preview={previewData} comparisons={comparisons.data?.data ?? []} trace={traceControl} />
            ) : null
          }
          onEdit={edit}
          onRules={setRules}
          onKeep={() => toast("Os pares continuam como hipótese. Nada mudou na conta.")}
        />
      )}

      <History currentRunId={runParam} />
    </div>
  );
}

function SetupTrail({ children }: { children: React.ReactNode }) {
  useTrail([{ label: "Comparações", href: "/comparacoes" }, { label: "Escolher os conjuntos" }]);
  return <>{children}</>;
}

function TraceState({ run, detail, onEdit }: { run: ReturnType<typeof useComparisonRun>; detail: ComparisonRunDetail | null; onEdit: () => void }) {
  if (run.isError) return <ErrorBlock error={run.error} onRetry={() => run.refetch()} />;
  if (!detail) return <LoadingBlock label="Abrindo a execução rastreada" />;
  if (detail.status === "queued" || detail.status === "running") {
    return (
      <div className="cmp-wait" role="status">
        <p className="eyebrow eyebrow-ab">Comparação · rastreando</p>
        <LoadingBlock label="Rastreando a comparação: executando cada lado e gravando cada identidade classificada" />
      </div>
    );
  }
  if (detail.status === "failed") {
    return (
      <div className="cmp-blocked" role="alert">
        <p className="eyebrow eyebrow-b">A execução rastreada falhou</p>
        <p>{detail.error?.message ?? "Erro desconhecido."}</p>
        <button type="button" className="btn" onClick={onEdit}>
          Editar os conjuntos
        </button>
      </div>
    );
  }
  return null;
}

function PreviewState({ preview, data, onEdit }: { preview: ReturnType<typeof useComparisonPreview>; data: ComparisonPreview | null; onEdit: () => void }) {
  if (preview.isError && !data) return <ErrorBlock error={preview.error} onRetry={() => preview.refetch()} />;
  if (!data) return <LoadingBlock label="Calculando a prévia da comparação" />;
  if (data.computed) return null;
  const errors = data.issues.filter((issue) => issue.severity !== "warning");
  return (
    <div className="cmp-blocked" role="alert">
      <p className="eyebrow eyebrow-b">{data.reason === "failed" ? "Não foi possível calcular" : "A comparação ainda não pode ser calculada"}</p>
      {data.error && <p>{data.error.message}</p>}
      {errors.length > 0 && (
        <ul>
          {errors.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      <Needs issues={data.pending} />
      <button type="button" className="btn justify-self-start" onClick={onEdit}>
        Editar os conjuntos
      </button>
    </div>
  );
}

function PreviewStatus({ preview, comparisons, trace }: { preview: ComparisonPreview; comparisons: ComparisonListItem[]; trace: TraceControl }) {
  const last = comparisons.find((item) => item.spec_key === preview.spec_key)?.last_run ?? null;
  const done = last?.status === "succeeded" ? last : null;
  const reasons = done ? traceDifferences(done, preview) : [];
  const matches = done !== null && reasons.length === 0;
  const pending = preview.pending;
  return (
    <div className={`trace-bar ${(done && !matches) || pending.length > 0 ? "warn" : ""}`} role="status">
      {pending.length > 0 && (
        <div className="trace-why">
          <p>
            <b>Prévia provisória.</b> Ela usa {pending.length === 1 ? "uma relação que ainda não foi decidida" : `${pending.length} relações que ainda não foram decididas`} no
            Mapa. O número mostra o efeito, mas não pode ser rastreado enquanto a decisão estiver pendente.
          </p>
          <Needs issues={pending} />
        </div>
      )}
      {done && matches ? (
        <p>
          <b>Prévia calculada agora.</b> Confere com a execução rastreada de {formatWhen(done.finished_at)}: mesmas versões, mesmas decisões e mesmos números.
        </p>
      ) : done ? (
        <div className="trace-why">
          <p>
            <b>Esta prévia não confere com a execução rastreada de {formatWhen(done.finished_at)}.</b>
            {done.summary
              ? ` A execução deu ${formatCount(done.summary.a.distinct)} − ${formatCount(done.summary.only_a)} + ${formatCount(done.summary.only_b)} = ${formatCount(done.summary.b.distinct)}.`
              : ""}
          </p>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>Ela continua gravada como estava; esta prévia não a substitui.</p>
        </div>
      ) : (
        <p>
          <b>Prévia calculada agora, sem gravar nada.</b> Rastrear grava a comparação, fixa as versões e permite abrir cada identidade e as linhas de origem.
        </p>
      )}
      <div className="q-actions">
        {done && (
          <Link className="btn btn-quiet" href={`/comparacoes?execucao=${done.id}`}>
            Abrir a execução rastreada
          </Link>
        )}
        {!matches && (
          <button type="button" className="btn btn-ab" disabled={trace.pending || pending.length > 0} onClick={trace.onTrace}>
            {trace.pending ? "Rastreando…" : done ? "Rastrear de novo" : "Rastrear a comparação"}
          </button>
        )}
      </div>
      {trace.error && <ErrorBlock error={trace.error} />}
    </div>
  );
}

function TracedStatus({ catalog, run, onCurrent }: { catalog: Catalog; run: ComparisonRunDetail; onCurrent: () => void }) {
  const newer = (["a", "b"] as const).flatMap((side) => {
    const basis = run.sides[side];
    const spec = run.spec[side];
    const table = catalog.byId.get(basis.dataset.id);
    return spec.kind === "population" && spec.version_id === null && table && table.versionNumber > basis.version.number
      ? [`${basis.dataset.key} tem a versão ${table.versionNumber}`]
      : [];
  });
  const changes = run.changes
    ? [
        ...run.changes.a.map((change) => `${run.sides.a.label}: ${change.message}`),
        ...run.changes.b.map((change) => `${run.sides.b.label}: ${change.message}`),
        ...(run.changes.equivalence ? [run.changes.equivalence] : []),
      ]
    : [];
  return (
    <div className={`trace-bar traced ${newer.length || changes.length ? "warn" : ""}`} role="status">
      <p>
        <b>Execução rastreada em {formatWhen(run.finished_at)}.</b> Versões fixadas: {run.sides.a.dataset.key} versão {run.sides.a.version.number} e {run.sides.b.dataset.key}{" "}
        versão {run.sides.b.version.number}. Cada identidade está gravada{run.duration_ms !== null ? ` · ${formatDuration(run.duration_ms)}` : ""}.
        {newer.length > 0 && ` Desde então, ${newer.join(" e ")}; esta execução continua apontando para as versões que usou.`}
      </p>
      {changes.length > 0 && (
        <div className="trace-why">
          <p>Decisões que mudaram depois desta execução (ela continua com as que usou):</p>
          <ul>
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      )}
      {run.changes && !run.changes.recorded && <p className="small-note">Esta execução foi gravada antes de o Trace registrar as relações e vigências usadas em cada lado.</p>}
      <div className="q-actions">
        <button type="button" className="btn btn-quiet" onClick={onCurrent}>
          Comparar com os dados atuais
        </button>
      </div>
    </div>
  );
}
