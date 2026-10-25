"use client";

import { useEffect, useRef } from "react";
import type { Focus } from "@/components/app/focus";
import type { RiverModel } from "@/components/river/model";
import { groupLabel } from "@/components/river/model";
import { formatMeasure, plural } from "@/lib/format";
import type { OutputColumn, ResultRow, RunDetail } from "@/lib/types";
import { ExclusionsView, JourneyView, UnreferencedView } from "./RecordViews";
import { RelationshipView } from "./RelationshipView";
import { ResultView } from "./ResultView";

type Props = {
  focus: Focus;
  depth: number;
  model: RiverModel;
  run: RunDetail | null;
  results: ResultRow[];
  columns: OutputColumn[];
  accent: string;
  anchorX: number | null;
  variant: "inline" | "sheet";
  onFocus: (focus: Focus) => void;
  onBack: () => void;
  onClose: () => void;
};

export function Investigation({ focus, depth, model, run, results, columns, accent, anchorX, variant, onFocus, onBack, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const executed = run?.status === "succeeded";
  const lookupInput = run?.steps.find((s) => s.join)?.join?.lookup.input ?? null;
  const resultFor = (resultNo: number) => model.results.find((r) => r.resultNos.includes(resultNo));
  const colorFor = (resultNo: number) => resultFor(resultNo)?.color.fill ?? "#111110";

  useEffect(() => {
    if (variant === "sheet") ref.current?.querySelector<HTMLElement>("[data-focus-target]")?.focus();
  }, [focus, variant]);

  const label =
    focus.kind === "result"
      ? "Investigação do resultado"
      : focus.kind === "exclusions"
        ? "Registros que ficaram de fora"
        : focus.kind === "unreferenced"
          ? "Registros sem par"
          : focus.kind === "row"
            ? "História de um registro"
            : focus.kind === "relationship"
              ? "Evidências do relacionamento"
              : "Outros resultados";

  const body = () => {
    if (focus.kind === "relationship") return <RelationshipView key={focus.id} id={focus.id} />;
    if (!executed || !run) return <p className="text-[18px]">A investigação fica disponível depois que a execução terminar.</p>;
    if (focus.kind === "result") {
      const result = resultFor(focus.resultNo);
      if (!result) return null;
      return <ResultView key={focus.resultNo} runId={run.id} resultNo={focus.resultNo} result={result} model={model} lookupInput={lookupInput} onFocus={onFocus} />;
    }
    if (focus.kind === "exclusions") {
      return <ExclusionsView key={`${focus.step}-${focus.resultNo}`} runId={run.id} step={focus.step} resultNo={focus.resultNo} model={model} result={focus.resultNo ? resultFor(focus.resultNo) : undefined} onFocus={onFocus} />;
    }
    if (focus.kind === "unreferenced") return <UnreferencedView key={focus.step} runId={run.id} step={focus.step} model={model} onFocus={onFocus} />;
    if (focus.kind === "row") return <JourneyView key={focus.rowId} runId={run.id} rowId={focus.rowId} model={model} colorFor={colorFor} onFocus={onFocus} />;
    const others = model.results.find((r) => r.key === "others");
    return (
      <div>
        <h2 className="text-[30px] font-bold" style={{ fontStretch: "80%" }} tabIndex={-1} data-focus-target>
          {others?.label}
        </h2>
        <p className="mt-2 text-[17px] text-ink-2">Agrupados numa só faixa para manter o rio legível. Escolha um para investigar.</p>
        <ul className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {results
            .filter((r) => others?.resultNos.includes(r.result_no))
            .map((r) => (
              <li key={r.result_no}>
                <button type="button" onClick={() => onFocus({ kind: "result", resultNo: r.result_no })} className="flex w-full items-baseline justify-between gap-3 rounded-[3px] px-2 py-2 text-left hover:bg-ink/[0.04]">
                  <span className="truncate text-[17px] font-semibold">{groupLabel(columns, r.values, r.result_no)}</span>
                  <span className="numerals text-[15px] text-ink-2">
                    {model.measure ? formatMeasure(r.values[model.measure.key] ?? null) : ""} · {plural(r.contributor_count, "registro", "registros")}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    );
  };

  return (
    <section
      ref={ref}
      aria-label={label}
      className={variant === "inline" ? "relative mt-2 border-t-[3px] bg-paper pt-6 pb-16" : "relative"}
      style={variant === "inline" ? { borderColor: accent } : undefined}
    >
      {variant === "inline" && anchorX !== null && (
        <span aria-hidden className="absolute -top-[10px] size-[17px] rotate-45 border-t-[3px] border-l-[3px] bg-paper transition-[left] duration-300 motion-reduce:transition-none" style={{ left: anchorX - 8, borderColor: accent }} />
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[0.08em] uppercase" style={{ color: accent === "#111110" ? undefined : accent }}>
          <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: accent }} />
          {label}
        </p>
        <div className="flex items-center gap-2 text-[15px]">
          {depth > 1 && (
            <button type="button" onClick={onBack} className="rounded-full border border-ink/20 px-3.5 py-1.5 hover:border-ink">
              ← voltar
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-full border border-ink/20 px-3.5 py-1.5 hover:border-ink" aria-keyshortcuts="Escape">
            limpar seleção <span className="text-ink-2">· esc</span>
          </button>
        </div>
      </div>
      {body()}
    </section>
  );
}
