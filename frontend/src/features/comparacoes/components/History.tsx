"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { formatCount, formatWhen } from "@/lib/format";
import { useComparisonRuns, useComparisons } from "@/lib/queries";
import type { ComparisonListItem, ComparisonRunBrief } from "@/lib/types";
import { EQUIVALENCE_TAG } from "../model/result";
import { RULE_TEXT } from "../model/spec";

const STATUS: Record<ComparisonRunBrief["status"], string> = { queued: "na fila", running: "rodando", succeeded: "concluída", failed: "falhou" };

function Numbers({ run }: { run: ComparisonRunBrief }) {
  const s = run.summary;
  if (!s) return <span className="h-num">{STATUS[run.status]}</span>;
  return (
    <span className="h-num mono">
      <b className="a">{formatCount(s.a.distinct)}</b> − <b className="a">{formatCount(s.only_a)}</b> + <b className="b">{formatCount(s.only_b)}</b> ={" "}
      <b className="b">{formatCount(s.b.distinct)}</b>
      <span className="h-sub">
        {" "}
        · {formatCount(s.shared + s.shared_by_rule)} nos dois{s.shared_by_rule > 0 ? ` (${formatCount(s.shared_by_rule)} pela regra)` : ""}
      </span>
    </span>
  );
}

function Sides({ run }: { run: ComparisonRunBrief }) {
  return (
    <span className="h-sides">
      {(["a", "b"] as const).map((side) => {
        const basis = run.sides[side];
        return (
          <span key={side} className={`h-side ${side}`}>
            <i aria-hidden />
            {side.toUpperCase()} · {basis.label} · {basis.dataset.key}.{basis.key} · versão {basis.version.number}
          </span>
        );
      })}
    </span>
  );
}

function Older({ item, currentRunId }: { item: ComparisonListItem; currentRunId: string | null }) {
  const runs = useComparisonRuns(item.id);
  if (runs.isError) return <ErrorBlock error={runs.error} onRetry={() => runs.refetch()} />;
  if (!runs.data) return <LoadingBlock label="Carregando as execuções" />;
  return (
    <ol className="h-runs">
      {runs.data.data.map((run) => (
        <li key={run.id}>
          <span className="mono h-when">{formatWhen(run.finished_at ?? run.queued_at)}</span>
          <Sides run={run} />
          <Numbers run={run} />
          {run.id === currentRunId ? (
            <span className="tagx in">aberta</span>
          ) : run.status === "succeeded" ? (
            <Link className="btn-link" href={`/comparacoes?execucao=${run.id}`}>
              Abrir
            </Link>
          ) : (
            <span className="small-note">{STATUS[run.status]}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Item({ item, currentRunId }: { item: ComparisonListItem; currentRunId: string | null }) {
  const [open, setOpen] = useState(false);
  const run = item.last_run;
  return (
    <li className="h-item">
      <div className="h-main">
        <p className="h-name">{item.name}</p>
        {run && <Sides run={run} />}
        <p className="h-meta">
          {run?.equivalence && <span className={`eq-tag ${run.equivalence.status === "declared" ? "user" : "ok"}`}>{EQUIVALENCE_TAG[run.equivalence.status]}</span>}
          {item.spec.rules.length ? `regra aceita: ${item.spec.rules.map((rule) => RULE_TEXT[rule].name).join(", ")}` : "sem regra de normalização"} · {formatCount(item.runs)}{" "}
          {item.runs === 1 ? "execução" : "execuções"}
          {run ? ` · última ${STATUS[run.status]} em ${formatWhen(run.finished_at ?? run.queued_at)}` : ""}
        </p>
      </div>
      {run && <Numbers run={run} />}
      <div className="h-actions">
        {run?.status === "succeeded" &&
          (run.id === currentRunId ? (
            <span className="tagx in">aberta</span>
          ) : (
            <Link className="btn btn-quiet" href={`/comparacoes?execucao=${run.id}`}>
              Abrir a execução
            </Link>
          ))}
        {item.runs > 1 && (
          <button type="button" className="btn-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Esconder as anteriores" : "Ver todas as execuções"}
          </button>
        )}
      </div>
      {open && <Older item={item} currentRunId={currentRunId} />}
    </li>
  );
}

export function History({ currentRunId }: { currentRunId: string | null }) {
  const list = useComparisons();
  return (
    <section className="cmp-history" aria-labelledby="cmp-history-title">
      <header>
        <h2 id="cmp-history-title">Comparações rastreadas</h2>
        <p className="small-note">Cada execução abre como foi gravada: as mesmas versões, chaves, regras e números. Nada é recalculado ao abrir.</p>
      </header>
      {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {!list.data && list.isPending && <LoadingBlock label="Carregando as comparações rastreadas" />}
      {list.data &&
        (list.data.data.length === 0 ? (
          <p className="small-note">Nenhuma comparação rastreada ainda. Rastreie uma comparação para guardá-la aqui.</p>
        ) : (
          <ul className="h-list">
            {list.data.data.map((item) => (
              <Item key={item.id} item={item} currentRunId={currentRunId} />
            ))}
          </ul>
        ))}
    </section>
  );
}
