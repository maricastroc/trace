"use client";

import { useState } from "react";
import type { Focus } from "@/components/app/focus";
import { dropLabel, type RiverModel, type RiverResult } from "@/components/river/model";
import { formatCount, formatMeasure, plural } from "@/lib/format";
import { useDiagnostics, useExclusions, useJourney } from "@/lib/queries";
import type { JourneyPath, TimelineEntry } from "@/lib/types";
import { Block, Failure, Loading, Pager, RecordButton, ValuesTable, rowName } from "./shared";

type OnFocus = (focus: Focus) => void;

export function ExclusionsView({ runId, step, resultNo, model, result, onFocus }: { runId: string; step: number; resultNo?: number; model: RiverModel; result?: RiverResult; onFocus: OnFocus }) {
  const [page, setPage] = useState(1);
  const [onlyGroup, setOnlyGroup] = useState(resultNo !== undefined);
  const exclusions = useExclusions(runId, { step, result: onlyGroup ? resultNo : undefined }, page);
  const info = model.steps.find((s) => s.position === step);

  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
      <div>
        <p className="text-[15px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Passo {step} · {info?.title}</p>
        <h2 className="mt-2 text-[34px] leading-[1.02] font-bold" style={{ fontStretch: "80%" }} tabIndex={-1} data-focus-target>
          {exclusions.data ? (
            <>
              <span className="numerals">{formatCount(exclusions.data.meta.total)}</span> {exclusions.data.meta.total === 1 ? "registro saiu aqui" : "registros saíram aqui"}
            </>
          ) : (
            "Registros que saíram aqui"
          )}
        </h2>
        {info && <p className="mt-3 text-[18px] leading-relaxed">{info.headline}.</p>}
        <ul className="mt-4 space-y-1 text-[17px]">
          {info?.drops.map((drop) => (
            <li key={drop.code}>
              <strong className="numerals">{formatCount(drop.count)}</strong> {drop.label}
            </li>
          ))}
        </ul>
        {resultNo !== undefined && result && (
          <div role="radiogroup" aria-label="Quais registros mostrar" className="mt-6 inline-flex rounded-full border border-ink/20 p-1 text-[15px]">
            {[
              { value: true, label: `só de ${result.label}` },
              { value: false, label: "todos deste passo" },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={onlyGroup === option.value}
                onClick={() => {
                  setOnlyGroup(option.value);
                  setPage(1);
                }}
                className="rounded-full px-3.5 py-1"
                style={onlyGroup === option.value ? { background: result.color.fill, color: "#fff" } : undefined}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Block title="Registros e motivos" aside={exclusions.data ? <Pager meta={exclusions.data.meta} onChange={setPage} /> : null}>
        {exclusions.isPending ? (
          <Loading />
        ) : exclusions.error ? (
          <Failure error={exclusions.error} />
        ) : (
          <ul className="space-y-1.5">
            {exclusions.data.data.map((exclusion) => {
              const subject = exclusion.sources[0];
              return (
                <li key={exclusion.tuple_no}>
                  <RecordButton accent={onlyGroup && result ? result.color.fill : "#b9aa8c"} onClick={() => onFocus({ kind: "row", rowId: subject.row.id })}>
                    <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[15px]">
                      <span className="font-semibold">
                        {subject.alias} {rowName(subject.row)}
                      </span>
                      {exclusion.sources.slice(1).map((partner) => (
                        <span key={partner.input} className="text-ink-2">
                          + {partner.alias} {rowName(partner.row)} {partner.row.values.nome ? `· ${partner.row.values.nome}` : ""}
                        </span>
                      ))}
                    </span>
                    <span className="mt-1 block text-[17px] leading-snug">{exclusion.explanation}</span>
                  </RecordButton>
                </li>
              );
            })}
          </ul>
        )}
      </Block>
    </div>
  );
}

export function UnreferencedView({ runId, step, model, onFocus }: { runId: string; step: number; model: RiverModel; onFocus: OnFocus }) {
  const [page, setPage] = useState(1);
  const diagnostics = useDiagnostics(runId, { code: "join.right_unmatched,join.lookup_null_key", step }, page);
  const lookup = model.steps.find((s) => s.position === step)?.lookup;
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
      <div>
        <p className="text-[15px] font-semibold tracking-[0.08em] uppercase" style={{ color: "#8a3f5c" }}>
          Passo {step} · sem par
        </p>
        <h2 className="mt-2 text-[34px] leading-[1.02] font-bold" style={{ fontStretch: "80%" }} tabIndex={-1} data-focus-target>
          {diagnostics.data ? formatCount(diagnostics.data.meta.total) : ""} registros de {lookup?.name.toLowerCase() ?? "origem"} sem nenhum par
        </h2>
        <p className="mt-3 text-[18px] leading-relaxed">
          Nenhum registro que chegou à junção apontou para eles. É um diagnóstico, não necessariamente um erro — pode ser esperado pela regra de negócio.
        </p>
      </div>
      <Block title="Registros" aside={diagnostics.data ? <Pager meta={diagnostics.data.meta} onChange={setPage} /> : null}>
        {diagnostics.isPending ? (
          <Loading />
        ) : diagnostics.error ? (
          <Failure error={diagnostics.error} />
        ) : (
          <ul className="space-y-1.5">
            {diagnostics.data.data.map((diagnostic) =>
              diagnostic.row ? (
                <li key={diagnostic.id}>
                  <RecordButton accent="#8a3f5c" onClick={() => onFocus({ kind: "row", rowId: diagnostic.row!.id })}>
                    <span className="block font-mono text-[15px] font-semibold">
                      {rowName(diagnostic.row)} <span className="font-normal text-ink-2">{diagnostic.row.values.nome ?? ""}</span>
                    </span>
                    <span className="mt-1 block text-[17px] leading-snug">{diagnostic.explanation}</span>
                  </RecordButton>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </Block>
    </div>
  );
}

const STATUS: Record<TimelineEntry["status"], string> = {
  passed: "passou",
  joined: "ligado",
  excluded: "saiu aqui",
  not_reached: "não chegou",
  aggregated: "agrupado",
  kept_unmatched: "seguiu sem par",
};

export function JourneyView({ runId, rowId, model, colorFor, onFocus }: { runId: string; rowId: number; model: RiverModel; colorFor: (resultNo: number) => string; onFocus: OnFocus }) {
  const [page, setPage] = useState(1);
  const journey = useJourney(runId, rowId, page);
  if (journey.isPending) return <Loading label="Lendo a história deste registro…" />;
  if (journey.error) return <Failure error={journey.error} />;
  const data = journey.data.data;

  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
      <div>
        <p className="text-[15px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
          Registro de {data.row.dataset_name.toLowerCase()} · linha {data.row.line_number} do arquivo · versão {data.row.version_number}
        </p>
        <h2 className="mt-1 font-mono text-[44px] leading-none font-medium" tabIndex={-1} data-focus-target>
          {rowName(data.row)}
        </h2>
        <p className="mt-4 text-[20px] leading-snug font-semibold">{data.summary}</p>
        <div className="mt-6">
          <ValuesTable row={data.row} />
        </div>
      </div>

      <div className="space-y-6">
        {data.paths.length > 0 ? (
          <Block title={data.paths_meta.total > 1 ? `${formatCount(data.paths_meta.total)} combinações deste registro` : "Caminho pela receita"} aside={<Pager meta={data.paths_meta} onChange={setPage} />}>
            {data.paths_meta.total > 1 && (
              <ul className="mb-4 space-y-1 text-[16px]">
                {data.outcomes.map((o) =>
                  o.status === "included" ? (
                    <li key={`i${o.result_no}`}>
                      <button type="button" className="hover:underline" onClick={() => onFocus({ kind: "result", resultNo: o.result_no })}>
                        <strong>{formatCount(o.count)}</strong> chegaram ao resultado {String(o.result_no).padStart(2, "0")}
                      </button>
                    </li>
                  ) : (
                    <li key={`e${o.step_position}${o.code}`}>
                      <strong>{formatCount(o.count)}</strong> saíram no passo {o.step_position} · {o.label.toLowerCase()}
                    </li>
                  ),
                )}
              </ul>
            )}
            <div className="space-y-6">
              {data.paths.map((path) => (
                <Timeline key={path.tuple_no} path={path} model={model} colorFor={colorFor} onFocus={onFocus} />
              ))}
            </div>
          </Block>
        ) : (
          data.references && (
            <Block title="Por que não aparece no resultado">
              <p className="text-[18px] leading-relaxed">{data.references.explanation}</p>
              {data.references.excluded_before.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {data.references.excluded_before.map((entry) => (
                    <li key={`${entry.step_position}-${entry.code}`}>
                      <RecordButton onClick={() => onFocus({ kind: "exclusions", step: entry.step_position })}>
                        <span className="text-[17px]">
                          <strong>{formatCount(entry.count)}</strong> saíram no passo {entry.step_position} · {dropLabel(model, entry.step_position, entry.code, entry.label)}
                        </span>
                      </RecordButton>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          )
        )}
        {data.diagnostics.length > 0 && (
          <Block title="Diagnósticos deste registro">
            <ul className="space-y-2 text-[16px] leading-snug">
              {data.diagnostics.map((d, i) => (
                <li key={i}>
                  <span className="font-semibold">Passo {d.step_position}:</span> {d.explanation}
                </li>
              ))}
            </ul>
            {data.diagnostics_total > data.diagnostics.length && <p className="mt-2 text-[14px] text-ink-2">mostrando {data.diagnostics.length} de {formatCount(data.diagnostics_total)}</p>}
          </Block>
        )}
      </div>
    </div>
  );
}

function Timeline({ path, model, colorFor, onFocus }: { path: JourneyPath; model: RiverModel; colorFor: (resultNo: number) => string; onFocus: OnFocus }) {
  const resultColor = path.outcome?.status === "included" ? colorFor(path.outcome.result_no) : "#111110";
  return (
    <ol>
      {path.timeline.map((entry, index) => {
        const last = index === path.timeline.length - 1;
        const excluded = entry.status === "excluded";
        const dotStyle =
          excluded
            ? { border: "3px solid #9c7a3c", background: "#f3efe6" }
            : entry.status === "not_reached"
              ? { border: "2px solid rgba(17,17,16,.25)", background: "#f3efe6" }
              : { background: entry.subject_present ? resultColor : "rgba(17,17,16,.35)" };
        return (
          <li key={entry.position} className="relative grid grid-cols-[22px_1fr] gap-3.5 pb-4">
            {!last && <span aria-hidden className="absolute top-5 left-[10px] h-full w-[2px]" style={{ background: entry.status === "not_reached" || excluded ? "rgba(17,17,16,.15)" : `${resultColor}66` }} />}
            <span aria-hidden className="relative mt-1 size-[22px] rounded-full" style={dotStyle} />
            <div className={entry.status === "not_reached" ? "opacity-50" : ""}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-[16px]">
                <span className="font-semibold">
                  {entry.position}. {entry.title}
                </span>
                <span className={excluded ? "font-semibold text-[#7a5a1f]" : "text-ink-2"}>
                  {STATUS[entry.status]}
                  {!entry.subject_present && entry.status !== "not_reached" ? " (antes de este registro entrar)" : ""}
                </span>
              </p>
              {entry.status !== "not_reached" && (
                <p className="mt-0.5 text-[16px] leading-snug text-ink">
                  {excluded || entry.status === "kept_unmatched" ? entry.explanation : model.steps.find((s) => s.position === entry.position)?.headline}
                </p>
              )}
              {entry.partner && (
                <button type="button" onClick={() => onFocus({ kind: "row", rowId: entry.partner!.row.id })} className="mt-1 text-left font-mono text-[15px] underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                  com {entry.partner.alias} {rowName(entry.partner.row)}
                  {entry.partner.row.values.nome ? ` · ${entry.partner.row.values.nome}` : ""}
                  {entry.partner.row.values.status ? ` · ${entry.partner.row.values.status}` : ""}
                </button>
              )}
              {entry.status === "aggregated" && entry.result_no && (
                <button type="button" onClick={() => onFocus({ kind: "result", resultNo: entry.result_no! })} className="mt-1 text-[16px] font-semibold hover:underline" style={{ color: resultColor }}>
                  → resultado{" "}
                  {path.outcome?.status === "included" && path.outcome.result_values
                    ? Object.values(path.outcome.result_values)
                        .map((v) => (typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? formatMeasure(v) : v))
                        .join(" · ")
                    : entry.result_no}
                </button>
              )}
            </div>
          </li>
        );
      })}
      {path.combined_with.length > 1 && <li className="text-[14px] text-ink-2">{plural(path.combined_with.length, "registro combinado", "registros combinados")}</li>}
    </ol>
  );
}
