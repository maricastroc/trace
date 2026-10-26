"use client";

import "./perguntas.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTrail } from "@/components/shell/Trail";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { useDatasets, useQuestionPreview, useRecipes, useRelationships, useResults, useRowsWhere, useRun, useTraceQuestion, useVersions } from "@/lib/queries";
import type { Preview, QuestionSpec, RunDetail, RunTotals } from "@/lib/types";
import { Answer } from "./components/Answer";
import { Clarification } from "./components/Clarification";
import { GroupBars } from "./components/GroupBars";
import { Investigation } from "./components/Investigation";
import { QuestionHead } from "./components/QuestionHead";
import { TracedList } from "./components/TracedList";
import { answerNotes, groups as groupsOf, previewOutcome, runOutcome, type Outcome } from "./model/answer";
import { buildCatalog, dateColumns, type Catalog } from "./model/catalog";
import { dateBounds, periodLabel, wholeYear, yearRange } from "./model/period";
import {
  currentDimension,
  decodeQuestion,
  dimensionFrom,
  encodeQuestion,
  fitsCatalog,
  measureLabel,
  measureOptions,
  plainText,
  READING_TITLE,
  readingPhrase,
  sentence,
  starterQuestion,
} from "./model/question";

export function PerguntasScreen() {
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
          Importe um CSV no Mapa para fazer a primeira pergunta.{" "}
          <Link className="btn-link" href="/mapa?importar=nova">
            Importar CSV
          </Link>
        </EmptyBlock>
      </Shell>
    );
  }
  return <QuestionWorkspace catalog={catalog} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  useTrail([{ label: "Perguntas" }]);
  return <div className="perguntas">{children}</div>;
}

function sameTotals(a: RunTotals | null | undefined, b: RunTotals | null | undefined) {
  if (!a || !b) return a === b;
  const same = (x: Record<string, string | number | null>, y: Record<string, string | number | null>) =>
    Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((key) => String(x[key]) === String(y[key]));
  return a.groups === b.groups && same(a.values, b.values) && same(a.sum_of_groups, b.sum_of_groups);
}

const versionsOf = (list: { version_id: string }[]) => list.map((input) => input.version_id).join("|");

function matches(run: RunDetail, preview: Preview) {
  return (
    !run.recipe_changed_since &&
    versionsOf(run.inputs) === versionsOf(preview.basis.inputs) &&
    run.decisions_key === preview.basis.decisions_key &&
    sameTotals(run.totals, preview.totals)
  );
}

function differences(run: RunDetail, preview: Preview) {
  const reasons: string[] = [];
  if (versionsOf(run.inputs) !== versionsOf(preview.basis.inputs)) {
    reasons.push(`Ela usou ${run.inputs.map((input) => `${input.alias} versão ${input.version_number}`).join(" e ")}; agora a pergunta usa ${preview.basis.inputs.map((input) => `${input.alias} versão ${input.version_number}`).join(" e ")}.`);
  }
  if (run.recipe_deleted) reasons.push("A receita gravada com ela foi apagada.");
  for (const change of run.decision_changes) reasons.push(change.message);
  if (reasons.length === 0 && run.decisions_key !== preview.basis.decisions_key) reasons.push("As decisões registradas nela são diferentes das decisões atuais do Mapa.");
  if (reasons.length === 0) reasons.push("O resultado gravado é diferente do calculado agora com as mesmas versões.");
  return reasons;
}

function initialQuestion(catalog: Catalog, params: URLSearchParams) {
  const fromUrl = decodeQuestion(params.get("q"));
  if (fromUrl && fitsCatalog(catalog, fromUrl)) return fromUrl;
  const table = params.get("tabela");
  return starterQuestion(catalog, table ? catalog.tables.find((candidate) => candidate.key === table)?.id : null);
}

function QuestionWorkspace({ catalog }: { catalog: Catalog }) {
  const params = useSearchParams();
  const router = useRouter();
  const [question, setQuestionState] = useState<QuestionSpec>(() => initialQuestion(catalog, params)!);
  const [invOpen, setInvOpen] = useState(false);
  const [traces, setTraces] = useState<Record<string, string>>({});

  const setQuestion = useCallback(
    (next: QuestionSpec) => {
      setQuestionState(next);
      router.replace(`/perguntas?q=${encodeURIComponent(encodeQuestion(next))}`, { scroll: false });
    },
    [router],
  );

  const base = catalog.byId.get(question.base_dataset_id)!;
  const dimension = currentDimension(catalog, base, question.dimension);
  const needsReading = question.period?.kind === "validity" && question.period.reading === null;
  const unit = measureLabel(catalog, base, question.measure);

  const labelRows = useRowsWhere(
    dimension?.labelColumn && question.dimension?.value ? dimension.table.versionId : null,
    dimension?.column ?? null,
    question.dimension?.value ?? null,
    1,
  );
  const valueLabel = dimension?.labelColumn ? (labelRows.data?.data[0]?.values[dimension.labelColumn] ?? null) : null;
  const text = plainText(sentence(catalog, question, valueLabel));
  useTrail([{ label: "Perguntas", href: "/perguntas" }, { label: `Pergunta sobre ${base.key}` }]);

  const answer = useQuestionPreview(needsReading ? null : question);
  const answerData = answer.data && !answer.isPlaceholderData ? answer.data.data : null;
  const preview = answer.data?.data.preview ?? null;
  const key = answerData?.question_key ?? null;

  const recipes = useRecipes();
  const saved = key ? recipes.data?.data.find((recipe) => recipe.question_key === key) : undefined;
  const runId = key ? (traces[key] ?? saved?.last_run?.id ?? null) : null;
  const runQuery = useRun(runId);
  const runDetail = runQuery.data?.data ?? null;
  const results = useResults(runDetail?.status === "succeeded" ? runDetail.id : null);
  const traced = runDetail?.status === "succeeded" && results.data && preview?.computed && matches(runDetail, preview) ? runDetail : null;
  const earlier = runDetail?.status === "succeeded" && preview && !traced ? { run: runDetail, reasons: differences(runDetail, preview) } : null;
  const tracing = runDetail && runDetail.status !== "succeeded" ? runDetail : null;
  const trace = useTraceQuestion();
  const client = useQueryClient();
  const finished = runDetail && (runDetail.status === "succeeded" || runDetail.status === "failed") ? runDetail.id : null;
  useEffect(() => {
    if (finished) client.invalidateQueries({ queryKey: ["recipes"] });
  }, [finished, client]);

  const outcome: Outcome | null = traced && results.data ? runOutcome(traced, results.data.data) : preview?.computed ? previewOutcome(preview) : null;
  const notes = outcome ? answerNotes(question, outcome, dimension?.noun ?? null) : [];
  const groups = outcome && question.dimension?.value === null ? groupsOf(outcome) : [];

  const distinctOption = measureOptions(catalog, base).find((option) => option.measure.function === "count_distinct");
  const remedy =
    question.measure.function === "count" && notes.some((note) => note.kind === "warn") && distinctOption
      ? { label: `Contar ${distinctOption.label}`, apply: () => setQuestion({ ...question, measure: distinctOption.measure }) }
      : null;

  const period = question.period;
  const periodText = !period
    ? dateColumns(base).length > 0
      ? "em qualquer data"
      : ""
    : period.kind === "date"
      ? `com ${period.column} em ${periodLabel(period.from, period.to)}`
      : period.reading
        ? `${READING_TITLE[period.reading].toLocaleLowerCase("pt-BR")} ${periodLabel(period.from, period.to)}`
        : "";
  const scopeText = !question.dimension
    ? "sem recorte"
    : question.dimension.value === null
      ? `total geral · agrupado por ${dimension?.noun ?? question.dimension.column}`
      : (valueLabel ?? question.dimension.value);
  const context = [periodText, scopeText].filter(Boolean).join(" · ");

  const onTrace = () =>
    trace.mutate(
      { question, title: text },
      { onSuccess: (response) => setTraces((current) => ({ ...current, [response.data.question_key]: response.data.run.id })) },
    );

  const related = relatedLinks(catalog, question, dimension?.noun ?? null);

  return (
    <div className="perguntas">
      <QuestionHead catalog={catalog} question={question} valueLabel={valueLabel} busy={answer.isFetching} onChange={setQuestion} />

      {needsReading && period?.kind === "validity" && (
        <Clarification
          question={question}
          table={base}
          unit={unit}
          onChoose={(reading) => {
            setQuestion({ ...question, period: { ...period, reading } });
            window.setTimeout(() => document.getElementById("q-answer")?.focus(), 60);
          }}
        />
      )}

      {!needsReading && answer.isError && <ErrorBlock error={answer.error} onRetry={() => answer.refetch()} />}
      {!needsReading && !answer.data && answer.isPending && <LoadingBlock label="Calculando a prévia" />}
      {!needsReading && answer.data && (
        <Answer
          outcome={outcome}
          preview={preview}
          run={traced}
          earlier={earlier}
          tracing={tracing}
          unit={unit}
          context={context}
          stale={answer.isPlaceholderData || answer.isFetching}
          notes={notes}
          invOpen={invOpen}
          onInvestigate={() => {
            setInvOpen((open) => !open);
            if (!invOpen) window.setTimeout(() => document.getElementById("q-inv")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
          }}
          remedy={remedy}
        />
      )}

      {!needsReading && outcome && groups.length > 0 && dimension && outcome.totals && (
        <GroupBars
          groups={groups}
          total={outcome.totals.values.resposta ?? null}
          sumOfGroups={outcome.totals.sum_of_groups.resposta ?? null}
          unit={unit}
          noun={dimension.noun}
          onPick={(value) => setQuestion({ ...question, dimension: dimensionFrom(dimension, value) })}
        />
      )}

      {!needsReading && answer.data && related.length > 0 && (
        <nav className="q-related" aria-label="Variar a pergunta">
          <span className="rl-k">Variar a pergunta</span>
          {related.map((link) => (
            <button key={link.label} type="button" className="btn-link" onClick={() => setQuestion(link.question)}>
              {link.label}
            </button>
          ))}
        </nav>
      )}

      {!needsReading && invOpen && answer.data && (
        <Investigation
          catalog={catalog}
          base={base}
          question={question}
          text={text}
          preview={preview}
          outcome={outcome}
          notes={notes}
          groups={groups}
          run={traced}
          tracing={tracing}
          traceError={trace.error}
          tracePending={trace.isPending}
          onTrace={onTrace}
          onClose={() => {
            setInvOpen(false);
            window.setTimeout(() => document.querySelector<HTMLButtonElement>('[aria-controls="q-inv"]')?.focus(), 0);
          }}
        />
      )}

      {recipes.data && <TracedList recipes={recipes.data.data} currentKey={key} onOpen={(next) => (fitsCatalog(catalog, next) ? setQuestion(next) : undefined)} />}
    </div>
  );
}

function relatedLinks(catalog: Catalog, question: QuestionSpec, noun: string | null) {
  const links: { label: string; question: QuestionSpec }[] = [];
  const base = catalog.byId.get(question.base_dataset_id)!;
  if (question.dimension && question.dimension.value !== null && noun) {
    links.push({ label: `por ${noun}`, question: { ...question, dimension: { ...question.dimension, value: null } } });
  }
  const period = question.period;
  const year = period ? wholeYear(period.from, period.to) : null;
  const bounds = period ? dateBounds(base, period.kind === "date" ? { kind: "date", column: period.column } : { kind: "validity" }) : null;
  if (period && year !== null && bounds) {
    const when = (target: number) => (period.kind === "date" ? `com ${period.column} em ${target}` : `${readingPhrase(period.reading)} ${target}`);
    if (year - 1 >= Number(bounds.min.slice(0, 4))) links.push({ label: when(year - 1), question: { ...question, period: { ...period, ...yearRange(year - 1) } } });
    if (year + 1 <= Number(bounds.max.slice(0, 4))) links.push({ label: when(year + 1), question: { ...question, period: { ...period, ...yearRange(year + 1) } } });
  }
  const neighbours = new Set<string>();
  for (const relation of catalog.relations) {
    if (relation.standing === "rejected") continue;
    if (relation.from.table === base.id) neighbours.add(relation.to.table);
    if (relation.to.table === base.id) neighbours.add(relation.from.table);
  }
  for (const id of neighbours) {
    const table = catalog.byId.get(id);
    const next = table ? starterQuestion(catalog, table.id) : null;
    if (table && next && table.columns.some((column) => column.type === "date")) links.push({ label: `perguntar em ${table.noun}`, question: next });
  }
  return links;
}
