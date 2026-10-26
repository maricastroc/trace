"use client";

import { useId, useState } from "react";
import { formatCount, formatPercent } from "@/lib/format";
import { useCorrectRelationship, useCreateRelationship, useRelationshipDraft } from "@/lib/queries";
import type { Relationship, RelationshipPair } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { CARDINALITY_SHORT, coverageState } from "../model/evidence";
import type { MapModel, MapTable } from "../model/graph";

const GLYPH = { ok: "✓", warn: "!", fail: "✕" } as const;
const STATE_WORDS = { suggested: "sugerida", confirmed: "confirmada", rejected: "rejeitada" } as const;

function Line({ state, children }: { state: keyof typeof GLYPH; children: React.ReactNode }) {
  return (
    <div className={`ck mini ${state}`}>
      <span className="cg" aria-hidden>
        {GLYPH[state]}
      </span>
      <span className="ct">{children}</span>
    </div>
  );
}

type Props = {
  model: MapModel;
  fromTable: MapTable;
  fromColumn: string;
  initialTo: { table: string; column: string } | null;
  correcting: Relationship | null;
  onDone: (relationId: string) => void;
};

function guessTarget<T extends { table: MapTable; column: string }>(targets: T[], fromColumn: string) {
  const column = fromColumn.toLowerCase();
  const stem = column.replace(/_id$/, "").replace(/^id_/, "");
  if (stem && stem !== column) {
    const named = targets.find((target) => target.column === "id" && [stem, `${stem}s`, `${stem}es`].includes(target.table.key.toLowerCase()));
    if (named) return named;
  }
  return targets[0] ?? null;
}

export function PairForm({ model, fromTable, fromColumn, initialTo, correcting, onDone }: Props) {
  const id = useId();
  const toast = useToast();
  const candidates = (table: MapTable) => table.columns.filter((c) => c.type !== "date");
  const targets = model.tables.filter((t) => t.key !== fromTable.key).flatMap((t) => candidates(t).map((c) => ({ table: t, column: c.key })));
  const [from, setFrom] = useState(fromColumn);
  const guess = guessTarget(targets, fromColumn);
  const [to, setTo] = useState(initialTo ? `${initialTo.table}.${initialTo.column}` : guess ? `${guess.table.key}.${guess.column}` : "");
  const target = targets.find((t) => `${t.table.key}.${t.column}` === to) ?? null;
  const pair: RelationshipPair | null = target ? { from_dataset_id: fromTable.id, from_column: from, to_dataset_id: target.table.id, to_column: target.column } : null;
  const draft = useRelationshipDraft(pair);
  const correct = useCorrectRelationship();
  const create = useCreateRelationship();
  const busy = correct.isPending || create.isPending;
  const failure = correct.error ?? create.error;

  const unchanged = correcting !== null && target !== null && from === correcting.from.column && target.table.key === correcting.to.dataset_key && target.column === correcting.to.column;
  const evidence = draft.data?.data.evidence;
  const existing = draft.data?.data.existing ?? null;
  const ready = Boolean(evidence) && !draft.isFetching;
  const canSave = ready && !unchanged && (evidence?.match.match_ratio ?? 0) > 0 && !busy;

  const save = () => {
    if (!pair || !target) return;
    if (correcting) {
      correct.mutate(
        { id: correcting.id, from_column: from, to_dataset_id: target.table.id, to_column: target.column },
        {
          onSuccess: (response) => {
            toast(
              response.data.status === "confirmed"
                ? `Colunas corrigidas: ${fromTable.key}.${from} → ${target.table.key}.${target.column}. A anterior foi rejeitada; a nova já estava confirmada e mantém a decisão que você tomou antes.`
                : `Colunas corrigidas: ${fromTable.key}.${from} → ${target.table.key}.${target.column}. A anterior foi rejeitada; a nova continua sugerida até você decidir.`,
            );
            onDone(response.data.id);
          },
        },
      );
    } else {
      create.mutate(pair, {
        onSuccess: (response) => {
          toast(`Relação ${fromTable.key}.${from} → ${target.table.key}.${target.column} criada como sugestão.`);
          onDone(response.data.id);
        },
      });
    }
  };

  return (
    <div className="fix-box">
      <div className="fix-row">
        <label className="sr-only" htmlFor={`${id}-from`}>
          Coluna de origem
        </label>
        <select id={`${id}-from`} className="select" value={from} onChange={(event) => setFrom(event.target.value)} disabled={!correcting}>
          {candidates(fromTable).map((c) => (
            <option key={c.key} value={c.key}>
              {fromTable.key}.{c.key}
            </option>
          ))}
        </select>
        <span aria-hidden>→</span>
        <label className="sr-only" htmlFor={`${id}-to`}>
          Coluna de destino
        </label>
        <select id={`${id}-to`} className="select" value={to} onChange={(event) => setTo(event.target.value)}>
          {targets.map((t) => (
            <option key={`${t.table.key}.${t.column}`} value={`${t.table.key}.${t.column}`}>
              {t.table.key}.{t.column}
            </option>
          ))}
        </select>
      </div>

      <div className="fix-res" aria-live="polite">
        {!target && <p className="small-note">Não há outra tabela com colunas comparáveis.</p>}
        {target && draft.isError && <p className="small-note">{draft.error.message}</p>}
        {target && !evidence && draft.isFetching && <p className="small-note">Calculando a evidência nos dados…</p>}
        {evidence && (
          <>
            <Line state={coverageState(evidence.match.match_ratio) === "ok" ? "ok" : coverageState(evidence.match.match_ratio) === "warn" ? "warn" : "fail"}>
              cobertura {formatPercent(evidence.match.match_ratio)} ({formatCount(evidence.match.matched_rows)} de {formatCount(evidence.from.non_null)} linhas)
            </Line>
            <Line state={evidence.to.unique ? "ok" : "fail"}>{evidence.to.unique ? "destino único" : `${formatCount(evidence.to.duplicate_values)} ids repetidos no destino`}</Line>
            <Line state={evidence.to.unique ? "ok" : "warn"}>cardinalidade observada {CARDINALITY_SHORT[evidence.cardinality]}</Line>
            <Line state={evidence.name.matched ? "ok" : "warn"}>{evidence.name.matched ? "nome compatível" : `o nome ${from} não sugere ${target?.table.key}`}</Line>
            {existing && (
              <p className="small-note">
                Esta relação já existe e está {STATE_WORDS[existing.status]}.
                {correcting && existing.status === "confirmed" && " Usar estas colunas rejeita a atual e mantém a decisão já tomada para a existente, sem refazer a evidência."}
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel-actions">
        {existing && !correcting ? (
          <button type="button" className="btn btn-primary" onClick={() => onDone(existing.id)}>
            Abrir a relação existente
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            {busy ? "Salvando…" : correcting ? "Usar estas colunas" : "Criar relação"}
          </button>
        )}
      </div>
      {failure && (
        <p role="alert" className="small-note text-b-deep">
          {failure.message}
        </p>
      )}
      <p className="small-note">
        {correcting
          ? "A evidência é calculada nos dados atuais antes de salvar. Corrigir não confirma: a nova relação começa sugerida e a atual é rejeitada."
          : "A evidência é calculada nos dados atuais antes de salvar. A relação começa sugerida até você decidir."}
      </p>
    </div>
  );
}
