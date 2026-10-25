"use client";

import { useState, type KeyboardEvent } from "react";
import type { RiverModel } from "@/components/river/model";
import { groupLabel } from "@/components/river/model";
import { Pager } from "@/components/investigation/shared";
import { TYPE_LABEL, formatCount, formatMeasure } from "@/lib/format";
import { useVersion, useVersionRows } from "@/lib/queries";
import type { OutputColumn, ResultRow } from "@/lib/types";

type Props = {
  model: RiverModel;
  tab: string;
  onTab: (tab: string) => void;
  results: ResultRow[] | undefined;
  columns: OutputColumn[];
  selectedResult: number | null;
  selectedRow: number | null;
  onSelectResult: (resultNo: number) => void;
  onSelectRow: (rowId: number) => void;
};

export function DataSection(props: Props) {
  const { model, tab, onTab, results } = props;
  const executed = model.state === "succeeded";
  const tabs = [{ id: "result", label: "Resultado", count: executed ? results?.length ?? null : null }, ...model.inputs.map((i) => ({ id: i.alias, label: i.name, count: i.rows }))];

  return (
    <section id="dados" aria-label="Dados por trás do rio" className="mx-auto max-w-[1560px] scroll-mt-20 px-4 pt-14 pb-24 sm:px-8">
      <h2 className="text-[34px] leading-none font-bold" style={{ fontStretch: "80%" }}>
        Os dados por trás do rio
      </h2>
      <p className="mt-2 max-w-[70ch] text-[17px] leading-relaxed text-ink-2">Tabelas completas, exatamente como o Laravel as registrou. Clique numa linha para investigá-la no rio.</p>
      <div role="tablist" aria-label="Tabelas" className="mt-6 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
            className={`rounded-full px-4 py-1.5 text-[16px] ${tab === item.id ? "bg-ink text-[#f3efe6]" : "border border-ink/20 hover:border-ink"}`}
          >
            {item.label}
            {item.count !== null && <span className="numerals ml-2 opacity-75">{formatCount(item.count)}</span>}
          </button>
        ))}
      </div>
      <div className="mt-6">{tab === "result" ? <ResultsTable {...props} /> : <SourceTable key={tab} {...props} input={model.inputs.find((i) => i.alias === tab)} />}</div>
    </section>
  );
}

function ResultsTable({ model, results, columns, selectedResult, onSelectResult }: Props) {
  if (model.state !== "succeeded") return <p className="text-[17px] text-ink-2">O resultado aparece aqui depois da execução.</p>;
  if (!results) return <p className="text-[17px] text-ink-2">Carregando…</p>;
  const colorFor = (no: number) => model.results.find((r) => r.resultNos.includes(no))?.color;

  const onKey = (event: KeyboardEvent<HTMLTableRowElement>, no: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectResult(no);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[17px]">
        <thead>
          <tr className="border-b border-ink/20 text-left text-[14px] tracking-[0.06em] text-ink-2 uppercase">
            {columns.map((c) => (
              <th key={c.key} className={`pb-2 font-semibold ${c.role === "measure" ? "text-right" : ""}`}>
                {c.label}
                {c.role === "measure" && <span className="ml-1.5 font-normal tracking-normal normal-case">{c.function === "sum" ? `soma de ${c.source?.column}` : "registros"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row) => {
            const color = colorFor(row.result_no);
            const selected = row.result_no === selectedResult;
            return (
              <tr
                key={row.result_no}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onSelectResult(row.result_no)}
                onKeyDown={(e) => onKey(e, row.result_no)}
                className={`cursor-pointer border-b border-ink/10 ${selected ? "bg-ink/[0.05]" : "hover:bg-ink/[0.03]"}`}
              >
                {columns.map((c, i) => (
                  <td key={c.key} className={`py-3 ${c.role === "measure" ? "numerals text-right font-mono" : "font-semibold"}`}>
                    {i === 0 && <span aria-hidden className="mr-2.5 inline-block size-3 rounded-full align-middle" style={{ background: color?.fill ?? "#8f8778" }} />}
                    {c.role === "measure" ? formatMeasure(row.values[c.key] ?? null) : (row.values[c.key] ?? groupLabel(columns, row.values, row.result_no))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceTable({ model, input, selectedRow, onSelectRow }: Props & { input: RiverModel["inputs"][number] | undefined }) {
  const [page, setPage] = useState(1);
  const version = useVersion(input?.versionId ?? null);
  const rows = useVersionRows(input?.versionId ?? null, page);
  const executed = model.state === "succeeded";
  if (!input) return null;
  if (version.isPending || rows.isPending) return <p className="text-[17px] text-ink-2">Carregando registros…</p>;
  if (version.error || rows.error) return <p className="text-[17px] text-[#8f2a1a]">Não foi possível carregar os registros desta fonte.</p>;
  const columns = version.data.data.columns;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[16px] text-ink-2">
          {version.data.data.source_filename} · versão {version.data.data.number} · {version.data.data.encoding}
          {executed && <> · clique num registro para ver o que aconteceu com ele</>}
        </p>
        <Pager meta={rows.data.meta} onChange={setPage} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="border-b border-ink/20 text-left">
              <th className="pb-2 text-[14px] font-semibold tracking-[0.06em] text-ink-2 uppercase">linha</th>
              {columns.map((c) => (
                <th key={c.key} className="pr-6 pb-2 align-bottom" title={c.profile.type_reason}>
                  <span className="block font-mono text-[15px] font-medium">{c.key}</span>
                  <span className="text-[13px] tracking-[0.06em] text-ink-2 uppercase">
                    {TYPE_LABEL[c.type]}
                    {c.profile.nulls > 0 ? ` · ${c.profile.nulls} vazios` : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-[15px]">
            {rows.data.data.map((row) => (
              <tr
                key={row.id}
                tabIndex={executed ? 0 : -1}
                aria-selected={row.id === selectedRow}
                onClick={() => executed && onSelectRow(row.id)}
                onKeyDown={(e) => {
                  if (executed && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelectRow(row.id);
                  }
                }}
                className={`border-b border-ink/10 ${executed ? "cursor-pointer hover:bg-ink/[0.03]" : ""} ${row.id === selectedRow ? "bg-ink/[0.05]" : ""}`}
              >
                <td className="py-2 text-ink-2">{row.line_number}</td>
                {columns.map((c) => (
                  <td key={c.key} className="numerals py-2 pr-6">
                    {row.values[c.key] ?? <span className="text-[#8f2a1a]">vazio</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
