"use client";

import type { RiverModel } from "@/components/river/model";
import { formatCount } from "@/lib/format";
import type { Recipe } from "@/lib/types";

type Props = {
  recipe: Recipe;
  model: RiverModel;
  synthetic: boolean;
  collapsed: boolean;
  launching: boolean;
  launchError: string | null;
  onRun: () => void;
  onRelationship: (id: string) => void;
};

export function Hero({ recipe, model, synthetic, collapsed, launching, launchError, onRun, onRelationship }: Props) {
  const executed = model.state === "succeeded";
  const running = model.state === "queued" || model.state === "running" || launching;
  const blocker = recipe.compiled.issues.find((i) => i.severity !== "warning" && typeof i.details?.relationship_id === "string");
  const otherBlocker = recipe.compiled.issues.find((i) => i.severity !== "warning" && typeof i.details?.relationship_id !== "string");
  const excluded = model.steps.reduce((acc, s) => acc + s.excluded, 0);
  const contributors = model.results.reduce((acc, r) => acc + r.records, 0);
  const lookups = model.steps.filter((s) => s.lookup);

  const title = executed
    ? "De onde vieram estes números?"
    : running
      ? "Os registros estão atravessando a receita."
      : model.state === "failed"
        ? "A execução parou no meio do caminho."
        : "Antes dos números, o caminho.";

  const stats: [string, string][] = executed
    ? [
        [formatCount(model.source.rows), `registros de ${model.source.name.toLowerCase()} entraram`],
        [formatCount(excluded), "registros ficaram pelo caminho"],
        [formatCount(contributors), `registros formaram ${formatCount(model.totalResults)} ${model.totalResults === 1 ? "resultado" : "resultados"}`],
      ]
    : [
        [formatCount(model.source.rows), `registros de ${model.source.name.toLowerCase()}`],
        ...lookups.map((s) => [formatCount(s.lookup!.rows), `registros de ${s.lookup!.name.toLowerCase()}`] as [string, string]),
        [formatCount(model.steps.length), "transformações"],
      ];

  return (
    <header
      className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
      aria-hidden={collapsed}
      inert={collapsed}
    >
      <div className="overflow-hidden">
        <div className="mx-auto max-w-[1560px] px-4 pt-7 pb-5 sm:px-8">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
            <span>{recipe.name}</span>
            <span className="text-ink/30">·</span>
            <span>revisão {recipe.revision}</span>
            {synthetic && <span className="rounded-full bg-[#f6e8c6] px-2.5 py-0.5 text-[13px] tracking-[0.04em] text-[#7a5300]">dados sintéticos</span>}
          </p>
          <div className="mt-3 grid items-end gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <h1 className="text-[clamp(42px,5vw,72px)] leading-[0.92] font-bold tracking-[-0.03em]" style={{ fontStretch: "76%" }}>
              {title}
            </h1>
            {!executed && (
              <dl className="grid grid-cols-3 gap-4 sm:gap-6">
                {stats.map(([value, label]) => (
                  <div key={label}>
                    <dd className="numerals text-[clamp(34px,3.2vw,48px)] leading-none font-bold" style={{ fontStretch: "78%" }}>
                      {value}
                    </dd>
                    <dt className="mt-1.5 text-[15px] leading-snug sm:text-[16px]">{label}</dt>
                  </div>
                ))}
              </dl>
            )}
            {executed && (
              <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px] lg:pb-1">
                A <strong className="text-ink">largura de cada faixa é o número de registros</strong> que atravessa cada passo. Os números grandes à direita são{" "}
                <strong className="text-ink">{model.measure?.caption ?? "valores agregados"}</strong> — outra grandeza, não registros. Escolha um resultado para ver de onde ele veio.
              </p>
            )}
          </div>
          <div className={`flex flex-wrap items-center justify-between gap-x-8 gap-y-4 ${executed ? "" : "mt-6"}`}>
            {!executed && (
              <p className="max-w-[78ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
                Os passos da receita já estão no rio. As faixas ganham largura real quando o Laravel executar a receita e registrar a linhagem de cada registro.
              </p>
            )}
            {!executed && (
              <div className="flex flex-col items-start gap-2">
                {blocker ? (
                  <>
                    <p className="max-w-sm text-[16px] leading-snug">
                      <strong>Antes de executar:</strong> o relacionamento sugerido entre as fontes precisa da sua confirmação.
                    </p>
                    <button type="button" onClick={() => onRelationship(blocker.details.relationship_id as string)} className="rounded-full bg-ink px-6 py-3 text-[17px] font-semibold text-[#f3efe6] hover:bg-ink-2">
                      Examinar evidências
                    </button>
                  </>
                ) : otherBlocker ? (
                  <p className="max-w-sm text-[16px] text-[#8f2a1a]">{otherBlocker.message}</p>
                ) : (
                  <button type="button" disabled={running} onClick={onRun} className="inline-flex items-center gap-2.5 rounded-full bg-ink px-6 py-3 text-[17px] font-semibold text-[#f3efe6] hover:bg-ink-2 disabled:opacity-60">
                    {running && <span aria-hidden className="pulse-dot inline-block size-2 rounded-full bg-current" />}
                    {running ? (model.state === "queued" ? "Na fila do Laravel…" : "Executando…") : model.state === "failed" ? "Tentar novamente" : "Executar receita"}
                  </button>
                )}
                {launchError && (
                  <p className="max-w-sm text-[15px] text-[#8f2a1a]" role="alert">
                    {launchError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
