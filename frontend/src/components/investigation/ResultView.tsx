"use client";

import { useState } from "react";
import { dropLabel, type RiverModel, type RiverResult } from "@/components/river/model";
import type { Focus } from "@/components/app/focus";
import { formatCount, formatMeasure, plural } from "@/lib/format";
import { useBreakdown, useContributors, useResultDetail } from "@/lib/queries";
import type { BreakdownRow, FieldRole, ResultDetail } from "@/lib/types";
import { Block, Failure, Loading, Pager, RecordButton } from "./shared";

const ROLE: Record<FieldRole["kind"], string> = {
  value: "entram no valor",
  group: "definem o grupo",
  condition: "decidem quem continua",
  join_key: "ligam os conjuntos",
};

type Props = { runId: string; resultNo: number; result: RiverResult; model: RiverModel; lookupInput: number | null; onFocus: (focus: Focus) => void };

export function ResultView({ runId, resultNo, result, model, lookupInput, onFocus }: Props) {
  const detail = useResultDetail(runId, resultNo);
  if (detail.isPending) return <Loading />;
  if (detail.error) return <Failure error={detail.error} />;
  const data = detail.data.data;
  const sum = data.values.find((v) => v.function === "sum");
  const count = data.values.find((v) => v.function === "count");
  const groupLabel = data.columns
    .filter((c) => c.role === "group_key")
    .map((c) => data.result.values[c.key] ?? "sem valor")
    .join(" · ");

  return (
    <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
      <div>
        <h2 className="text-[34px] leading-none font-bold tracking-[-0.01em]" style={{ fontStretch: "80%" }} tabIndex={-1} data-focus-target>
          {groupLabel || `Resultado ${resultNo}`}
        </h2>
        {sum && (
          <>
            <p className="numerals mt-3 text-[96px] leading-[0.86] font-bold tracking-[-0.03em]" style={{ fontStretch: "74%", color: result.color.text }}>
              {formatMeasure(sum.stored)}
            </p>
            <p className="mt-2 text-[18px] leading-snug">
              é a <strong>soma de {sum.source?.column}</strong> de {plural(sum.counted ?? 0, "registro", "registros")}
              {(sum.ignored_null ?? 0) + (sum.ignored_unconvertible ?? 0) > 0 && (
                <>
                  {" "}
                  — {plural((sum.ignored_null ?? 0) + (sum.ignored_unconvertible ?? 0), "registro sem valor numérico ficou", "registros sem valor numérico ficaram")} fora da soma, mas no grupo
                </>
              )}
              .
            </p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[15px] font-semibold" style={sum.consistent ? { background: "#dcefe3", color: "#1d5a3b" } : { background: "#f6dad5", color: "#8f2a1a" }}>
              <span aria-hidden>{sum.consistent ? "✓" : "✗"}</span>
              {sum.consistent ? "Conferido: o banco recalculou a soma a partir dos registros originais" : `Divergência: recalculado ${formatMeasure(sum.recomputed ?? null)}`}
            </p>
          </>
        )}
        <div className="mt-6 border-t border-ink/15 pt-4 text-[17px] leading-relaxed">
          <p>
            <strong className="numerals">{formatCount(data.result.contributor_count)}</strong> registros formam este grupo
            {count ? <> (a contagem “{count.key}” confere: {formatCount(Number(count.stored ?? 0))})</> : null}. É a largura da faixa no rio.
          </p>
          <p className="mt-2 text-ink-2">
            {data.inputs
              .filter((i) => i.contributing_rows > 0)
              .map((i) => `${formatCount(i.contributing_rows)} de ${formatCount(i.row_count)} registros de ${i.dataset_name.toLowerCase()}`)
              .join(" · ")}
          </p>
        </div>
      </div>

      <Block title={lookupInput !== null ? `Por ${model.inputs[lookupInput]?.name.toLowerCase() ?? "origem"}` : "Registros"}>
        {lookupInput !== null ? <Breakdown runId={runId} resultNo={resultNo} by={lookupInput} detail={data} color={result.color.fill} onFocus={onFocus} /> : <Contributors runId={runId} resultNo={resultNo} via={null} onFocus={onFocus} accent={result.color.fill} />}
      </Block>

      <div className="space-y-9">
        {data.related_exclusions && (
          <Block title="Ficaram de fora">
            {data.related_exclusions.matching.length === 0 ? (
              <p className="text-[17px] leading-relaxed">Nenhum registro deste grupo saiu depois que o grupo pôde ser identificado.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.related_exclusions.matching.map((entry) => (
                  <li key={`${entry.step_position}-${entry.code}`}>
                    <RecordButton accent={result.color.fill} onClick={() => onFocus({ kind: "exclusions", step: entry.step_position, resultNo })}>
                      <span className="block text-[17px] leading-snug">
                        <strong className="numerals">{formatCount(entry.count)}</strong> {entry.count === 1 ? "registro saiu" : "registros saíram"} no passo {entry.step_position} — {dropLabel(model, entry.step_position, entry.code, entry.label)}
                      </span>
                      <span className="mt-0.5 block text-[15px] text-ink-2 group-hover:underline">ver quais e por quê →</span>
                    </RecordButton>
                  </li>
                ))}
              </ul>
            )}
            {data.related_exclusions.unattributable.length > 0 && (
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Outros {formatCount(data.related_exclusions.unattributable.reduce((acc, u) => acc + u.count, 0))} saíram antes de o grupo existir e não podem ser atribuídos a ele sem uma suposição que o motor não faz.
              </p>
            )}
          </Block>
        )}
        <Block title="Colunas usadas no cálculo">
          <FieldMap detail={data} />
        </Block>
      </div>
    </div>
  );
}

function Breakdown({ runId, resultNo, by, detail, color, onFocus }: { runId: string; resultNo: number; by: number; detail: ResultDetail; color: string; onFocus: (focus: Focus) => void }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const breakdown = useBreakdown(runId, resultNo, by, page);
  const measure = detail.columns.find((c) => c.function === "sum");
  if (breakdown.isPending) return <Loading />;
  if (breakdown.error) return <Failure error={breakdown.error} />;
  const rows = breakdown.data.data;
  const total = Number(measure ? detail.result.values[measure.key] ?? 0 : detail.result.contributor_count) || 1;

  return (
    <div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id}>
            <BreakdownItem row={row} measureKey={measure?.key} total={total} color={color} open={open === row.id} onToggle={() => setOpen(open === row.id ? null : row.id)} />
            {open === row.id && (
              <div className="mt-1 mb-4 ml-4">
                <Contributors runId={runId} resultNo={resultNo} via={{ input: by, row: row.id }} onFocus={onFocus} accent={color} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {breakdown.data.meta.tuples_without_input > 0 && (
        <p className="mt-2 text-[15px] text-ink-2">
          {plural(breakdown.data.meta.tuples_without_input, "registro chegou", "registros chegaram")} sem par em {breakdown.data.meta.alias}.
        </p>
      )}
      <div className="mt-3">
        <Pager meta={breakdown.data.meta} onChange={setPage} />
      </div>
    </div>
  );
}

function BreakdownItem({ row, measureKey, total, color, open, onToggle }: { row: BreakdownRow; measureKey?: string; total: number; color: string; open: boolean; onToggle: () => void }) {
  const value = measureKey ? row.partials[measureKey] : null;
  const share = Number(value ?? row.tuples) / total;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="group w-full rounded-[3px] py-2.5 text-left hover:bg-ink/[0.03]">
      <span className="flex items-baseline justify-between gap-4">
        <span className="min-w-0">
          <span className="block truncate text-[18px] leading-tight font-semibold group-hover:underline">{row.values.nome ?? row.values.name ?? row.values.id}</span>
          <span className="block text-[15px] text-ink-2">
            {row.values.id} · {plural(row.tuples, "registro", "registros")} {open ? "· ocultar" : "· ver registros"}
          </span>
        </span>
        <span className="numerals shrink-0 text-[28px] leading-none font-bold" style={{ fontStretch: "78%" }}>
          {value !== null ? formatMeasure(value) : formatCount(row.tuples)}
        </span>
      </span>
      <span className="mt-2 block h-[7px] rounded-full bg-ink/[0.08]">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 1.5)}%`, background: color }} />
      </span>
    </button>
  );
}

export function Contributors({ runId, resultNo, via, onFocus, accent }: { runId: string; resultNo: number; via: { input: number; row: number } | null; onFocus: (focus: Focus) => void; accent: string }) {
  const [page, setPage] = useState(1);
  const contributors = useContributors(runId, resultNo, 0, via, page);
  if (contributors.isPending) return <Loading />;
  if (contributors.error) return <Failure error={contributors.error} />;
  return (
    <div>
      <ul className="divide-y divide-ink/10">
        {contributors.data.data.map((row) => {
          const measure = row.measure_values[0];
          return (
            <li key={row.id}>
              <button type="button" onClick={() => onFocus({ kind: "row", rowId: row.id })} className="flex w-full items-baseline justify-between gap-3 py-2 text-left hover:bg-ink/[0.03]">
                <span className="font-mono text-[15px]">
                  {row.values.id ?? row.line_number} <span className="text-ink-2">{row.values.data ?? ""}</span>
                </span>
                {measure && (
                  <span className={`numerals font-mono text-[15px] ${measure.status === "counted" ? "" : "font-semibold text-[#8f2a1a]"}`}>
                    {measure.status === "counted" ? formatMeasure(measure.raw) : measure.raw === null ? "vazio · fora da soma" : `“${measure.raw}” · fora da soma`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[14px] text-ink-2" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
          clique num registro para ver sua história
        </span>
        <Pager meta={contributors.data.meta} onChange={setPage} />
      </div>
    </div>
  );
}

function FieldMap({ detail }: { detail: ResultDetail }) {
  const used: Record<FieldRole["kind"], string[]> = { value: [], group: [], condition: [], join_key: [] };
  const unused: string[] = [];
  for (const input of detail.fields) {
    for (const column of input.columns) {
      const name = `${input.alias}.${column.key}`;
      if (!column.participates) unused.push(name);
      for (const kind of new Set(column.roles.map((r) => r.kind))) used[kind].push(name);
    }
  }
  return (
    <div>
      <dl className="space-y-2.5">
        {(Object.keys(ROLE) as FieldRole["kind"][]).map((kind) =>
          used[kind].length ? (
            <div key={kind}>
              <dt className="text-[15px] text-ink-2">{ROLE[kind]}</dt>
              <dd className="font-mono text-[15px]">{used[kind].join(", ")}</dd>
            </div>
          ) : null,
        )}
        {unused.length > 0 && (
          <div>
            <dt className="text-[15px] text-ink-2">não participaram</dt>
            <dd className="font-mono text-[15px] text-ink-2 line-through decoration-ink/40">{unused.join(", ")}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Um registro pode contribuir para o grupo sem que todas as suas colunas entrem no cálculo.</p>
    </div>
  );
}
