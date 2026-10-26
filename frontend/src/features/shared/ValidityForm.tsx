"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useClearValidity, useDeclareValidity } from "@/lib/queries";
import type { ColumnType, ValidityDeclaration } from "@/lib/types";

export type ValidityTable = { id: string; key: string; columns: { key: string; type: ColumnType }[]; validity: ValidityDeclaration | null };

export function ValidityForm({ table, onDeclared }: { table: ValidityTable; onDeclared?: () => void }) {
  const declare = useDeclareValidity();
  const clear = useClearValidity();
  const toast = useToast();
  const dates = table.columns.filter((c) => c.type === "date");
  const [start, setStart] = useState(dates[0]?.key ?? "");
  const [end, setEnd] = useState(dates.find((c) => c.key !== dates[0]?.key)?.key ?? "");
  const [inclusive, setInclusive] = useState<boolean | null>(null);
  const failure = declare.error ?? clear.error;

  if (table.validity) {
    const v = table.validity;
    return (
      <div className="grid gap-3">
        <p className="m-0 text-[15px] leading-relaxed">
          <b className="font-mono">{v.start_column}</b> marca o início
          {v.end_column ? (
            <>
              {" "}
              e <b className="font-mono">{v.end_column}</b> o fim; o dia do fim {v.end_inclusive ? "ainda conta" : "já não conta"} como vigente. Fim vazio significa ainda vigente.
            </>
          ) : (
            "; não há coluna de fim, então todo registro fica vigente a partir do início."
          )}
        </p>
        <p className="small-note">Perguntas por período usam esta declaração: começaram no período, ativos em algum momento ou ativos no último dia.</p>
        <button
          type="button"
          className="btn btn-quiet justify-self-start"
          disabled={clear.isPending}
          onClick={() => clear.mutate(table.id, { onSuccess: () => toast(`Vigência de ${table.key} removida.`) })}
        >
          Remover declaração
        </button>
        {failure && (
          <p role="alert" className="small-note text-b-deep">
            {failure.message}
          </p>
        )}
      </div>
    );
  }

  if (dates.length === 0) return <p className="small-note">Esta tabela não tem colunas de data, então não há vigência para declarar.</p>;

  const needsChoice = end !== "";
  const ready = start !== "" && (!needsChoice || inclusive !== null);
  return (
    <div className="fix-box">
      <p className="small-note">Declare só se essas colunas marcam quando cada registro começou e deixou de valer. O Trace não deduz isso sozinho.</p>
      <div className="fix-row">
        <label className="grid gap-1">
          <span className="eyebrow">início</span>
          <select className="select" value={start} onChange={(event) => setStart(event.target.value)}>
            {dates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="eyebrow">fim</span>
          <select className="select" value={end} onChange={(event) => setEnd(event.target.value)}>
            <option value="">sem coluna de fim</option>
            {dates
              .filter((c) => c.key !== start)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key}
                </option>
              ))}
          </select>
        </label>
      </div>
      {needsChoice && (
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 text-[14.5px] font-semibold">O dia do fim ainda conta como vigente?</legend>
          <label className="flex items-center gap-2 text-[14.5px]">
            <input type="radio" name={`fim-${table.key}`} checked={inclusive === true} onChange={() => setInclusive(true)} />
            Sim: quem tem fim em 31/12 ainda estava vigente em 31/12
          </label>
          <label className="flex items-center gap-2 text-[14.5px]">
            <input type="radio" name={`fim-${table.key}`} checked={inclusive === false} onChange={() => setInclusive(false)} />
            Não: no dia do fim o registro já não vale
          </label>
        </fieldset>
      )}
      <button
        type="button"
        className="btn btn-ab justify-self-start"
        disabled={!ready || declare.isPending || start === end}
        onClick={() =>
          declare.mutate(
            { datasetId: table.id, start_column: start, end_column: end || null, end_inclusive: needsChoice ? inclusive === true : true },
            {
              onSuccess: () => {
                toast(`Vigência de ${table.key} declarada.`);
                onDeclared?.();
              },
            },
          )
        }
      >
        Declarar vigência
      </button>
      {failure && (
        <p role="alert" className="small-note text-b-deep">
          {failure.message}
        </p>
      )}
    </div>
  );
}
