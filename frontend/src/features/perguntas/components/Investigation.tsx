"use client";

import { useState } from "react";
import { LoadingBlock } from "@/components/ui/ScreenStates";
import type { Preview, QuestionSpec, RunDetail, RunSummary } from "@/lib/types";
import type { Group, Note, Outcome } from "../model/answer";
import type { Catalog, CatalogTable } from "../model/catalog";
import { Criteria, Spec } from "./Criteria";
import { Needs } from "./Needs";
import { stepViews } from "../model/steps";
import { Ladder, Records, type RecordFilter, type SelectedRow } from "./Steps";

const TABS = [
  ["steps", "Passos e registros"],
  ["criteria", "Critérios e relações"],
  ["spec", "Pergunta estruturada"],
] as const;

type Tab = (typeof TABS)[number][0];

type Props = {
  catalog: Catalog;
  base: CatalogTable;
  question: QuestionSpec;
  text: string;
  preview: Preview | null;
  outcome: Outcome | null;
  notes: Note[];
  groups: Group[];
  run: RunDetail | null;
  tracing: RunSummary | RunDetail | null;
  traceError: Error | null;
  tracePending: boolean;
  onTrace: () => void;
  onClose: () => void;
};

export function Investigation(props: Props) {
  const { catalog, base, question, text, preview, outcome, notes, run, onClose } = props;
  const [tab, setTab] = useState<Tab>("steps");

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex(([key]) => key === tab);
    const next =
      event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next][0]);
    window.setTimeout(() => document.getElementById(`qtab-${TABS[next][0]}`)?.focus(), 0);
  };

  return (
    <section className="q-inv" id="q-inv" aria-labelledby="inv-title">
      <div className="inv-head">
        <h2 id="inv-title">Investigar a resposta</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Recolher
        </button>
      </div>
      <div className="inv-tabs" role="tablist" aria-label="Investigar a resposta" onKeyDown={onKeyDown}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`qtab-${key}`}
            aria-selected={tab === key}
            aria-controls="q-inv-panel"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inv-panel" role="tabpanel" id="q-inv-panel" aria-labelledby={`qtab-${tab}`}>
        {tab === "steps" && <StepsTab {...props} />}
        {tab === "criteria" && <Criteria catalog={catalog} base={base} question={question} notes={notes} />}
        {tab === "spec" && <Spec catalog={catalog} base={base} question={question} text={text} preview={preview} run={run} outcome={outcome} />}
      </div>
    </section>
  );
}

function StepsTab({ base, question, preview, outcome, groups, run, tracing, traceError, tracePending, onTrace }: Props) {
  const [filter, setFilter] = useState<RecordFilter>({ kind: "in" });
  const [chosen, setChosen] = useState<number | null>(null);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const pending = preview?.pending ?? [];

  if (!run) {
    if (pending.length > 0) {
      return (
        <>
          <div className="gate">
            <p className="gate-t">Este número ainda é uma prévia.</p>
            <p>
              Passos e registros aparecem depois de {pending.length === 1 ? "resolver 1 decisão" : `resolver ${pending.length} decisões`}, para o rastreio não se apoiar
              em suposições.
            </p>
          </div>
          <Needs issues={pending} />
        </>
      );
    }
    if (tracing && tracing.status !== "failed") return <LoadingBlock label="Rastreando: o motor está gravando cada passo e cada registro" />;
    return (
      <div className="gate">
        <p className="gate-t">Pronto para rastrear.</p>
        <p>
          Rastrear executa a mesma pergunta pelo motor e grava as versões dos dados, as regras, o resultado e cada registro que entrou ou saiu. A prévia não grava nada.
        </p>
        {tracing?.status === "failed" && (
          <p role="alert" className="text-b-deep">
            A execução falhou: {tracing.error?.message ?? "erro desconhecido"}.
          </p>
        )}
        {traceError && (
          <p role="alert" className="text-b-deep">
            {traceError.message}
          </p>
        )}
        <div className="q-actions">
          <button type="button" className="btn btn-primary" disabled={tracePending || !preview?.computed} onClick={onTrace}>
            Rastrear agora
          </button>
        </div>
      </div>
    );
  }

  const resultNo = chosen ?? groups[0]?.resultNo ?? 1;
  const views = stepViews(run, question);
  const choose = (next: RecordFilter) => {
    setSelected(null);
    setFilter(next);
  };
  return (
    <div className="inv-grid">
      <div className="inv-col">
        <h3>Percurso dos registros</h3>
        <p className="small-note">Escolha um passo ou um motivo de saída para ver aqueles registros à direita.</p>
        <Ladder views={views} filter={filter} onFilter={choose} />
      </div>
      <div className="inv-col">
        <h3>Registros</h3>
        {run.result_count === 0 ? (
          <p className="small-note">Nenhum registro chegou ao fim. Veja quem ficou de fora em cada passo.</p>
        ) : null}
        <Records
          run={run}
          base={base}
          question={question}
          views={views}
          groups={groups}
          resultNo={resultNo}
          entering={outcome?.results.find((result) => result.result_no === resultNo)?.contributor_count ?? null}
          onResult={setChosen}
          filter={filter}
          onFilter={choose}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
