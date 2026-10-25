"use client";

import { useState } from "react";
import { formatCount, formatPercent, plural } from "@/lib/format";
import { useConfirmRelationship, useRelationship, useUnmatched } from "@/lib/queries";
import type { Relationship } from "@/lib/types";
import { Block, Failure, Loading, Pager, ValuesTable } from "./shared";

const STATUS = { suggested: "sugerido", confirmed: "confirmado", rejected: "rejeitado" } as const;

export function RelationshipView({ id }: { id: string }) {
  const relationship = useRelationship(id);
  const mutation = useConfirmRelationship();
  if (relationship.isPending) return <Loading label="Calculando evidências nas versões atuais…" />;
  if (relationship.error) return <Failure error={relationship.error} />;
  const data = relationship.data.data;
  const match = data.evidence.match;
  const total = match.matched_rows + match.unmatched_rows + match.null_rows || 1;
  const segments = [
    { key: "m", value: match.matched_rows, color: "#2b4be0", label: "com par" },
    { key: "u", value: match.unmatched_rows, color: "#8a3f5c", label: "sem par" },
    { key: "n", value: match.null_rows, color: "#8f8778", label: "vazios" },
  ];

  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <p className="text-[15px] font-semibold tracking-[0.08em] uppercase" style={{ color: data.status === "confirmed" ? "#1d5a3b" : data.status === "rejected" ? "#5d564b" : "#7a5300" }}>
          Relacionamento {STATUS[data.status]} · {data.origin === "manual" ? "definido manualmente" : "encontrado pelo Trace nos dados"}
        </p>
        <h2 className="mt-2 font-mono text-[24px] leading-snug font-medium" tabIndex={-1} data-focus-target>
          {data.from.dataset_key}.{data.from.column} → {data.to.dataset_key}.{data.to.column}
        </h2>
        <p className="mt-5 flex items-end gap-4">
          <span className="numerals text-[88px] leading-[0.85] font-bold tracking-[-0.03em]" style={{ fontStretch: "74%" }}>
            {formatPercent(match.match_ratio)}
          </span>
          <span className="max-w-[220px] pb-1 text-[17px] leading-snug">dos registros com valor encontram par exato</span>
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink/[0.06]" role="img" aria-label={segments.map((s) => `${s.value} ${s.label}`).join(", ")}>
          {segments.map((s) => (s.value > 0 ? <span key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} /> : null))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 text-[15px] text-ink-2">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />
              {plural(s.value, "registro", "registros")} de {data.from.dataset_key} {s.label}
            </li>
          ))}
        </ul>

        <div className="mt-8 border-t border-ink/15 pt-5">
          <p className="text-[17px] leading-relaxed">O Trace só usa um relacionamento numa junção depois que você o confirma. Registros sem par são diagnóstico, não necessariamente erro.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {data.status !== "confirmed" && (
              <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate({ id, action: "confirm" })} className="rounded-full bg-ink px-6 py-3 text-[17px] font-semibold text-[#f3efe6] hover:bg-ink-2 disabled:opacity-50">
                Confirmar relacionamento
              </button>
            )}
            {data.status !== "rejected" && (
              <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate({ id, action: "reject" })} className="rounded-full border-2 border-ink/25 px-6 py-3 text-[17px] font-semibold hover:border-ink disabled:opacity-50">
                Rejeitar
              </button>
            )}
          </div>
          {mutation.error && (
            <div className="mt-3">
              <Failure error={mutation.error} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-8">
        <Block title="Evidências calculadas nos dados">
          <ul className="space-y-2.5">
            {data.evidence.statements.map((statement, index) => (
              <li key={index} className={`text-[17px] leading-snug ${statement.kind === "near_match" ? "font-semibold text-[#7a5300]" : statement.kind === "name" ? "text-ink-2" : ""}`}>
                {statement.text}
              </li>
            ))}
          </ul>
        </Block>
        <Unmatched relationship={data} />
      </div>
    </div>
  );
}

function Unmatched({ relationship }: { relationship: Relationship }) {
  const [side, setSide] = useState<"from" | "from_null" | "to">("from");
  const [page, setPage] = useState(1);
  const rows = useUnmatched(relationship.id, side, page);
  const options = [
    { id: "from", label: `${relationship.from.dataset_key} sem par`, count: relationship.evidence.match.unmatched_rows },
    { id: "from_null", label: "chave vazia", count: relationship.evidence.match.null_rows },
    { id: "to", label: `${relationship.to.dataset_key} nunca citados`, count: relationship.evidence.unreferenced.rows },
  ] as const;
  return (
    <Block title="Examinar registros" aside={rows.data ? <Pager meta={rows.data.meta} onChange={setPage} /> : null}>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={side === option.id}
            onClick={() => {
              setSide(option.id);
              setPage(1);
            }}
            className={`rounded-full px-3.5 py-1 text-[15px] ${side === option.id ? "bg-ink text-[#f3efe6]" : "border border-ink/20 hover:border-ink"}`}
          >
            {option.label} · {formatCount(option.count)}
          </button>
        ))}
      </div>
      {rows.isPending ? (
        <Loading />
      ) : rows.error ? (
        <Failure error={rows.error} />
      ) : rows.data.data.length === 0 ? (
        <p className="text-[16px] text-ink-2">Nenhum registro nesta categoria.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {rows.data.data.map((row) => (
            <div key={row.id} className="border-l-[3px] border-ink/15 pl-3">
              <p className="mb-1 text-[14px] text-ink-2">linha {row.line_number}</p>
              <ValuesTable row={row} emphasize={[side === "to" ? relationship.to.column : relationship.from.column]} />
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}
