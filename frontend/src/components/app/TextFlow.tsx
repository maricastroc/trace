import type { RiverModel } from "@/components/river/model";
import { formatCount, formatMeasure, plural } from "@/lib/format";

export function TextFlow({ model, id, visible }: { model: RiverModel; id: string; visible: boolean }) {
  const executed = model.state === "succeeded";
  return (
    <section id={id} aria-label="O fluxo descrito em texto" className={visible ? "mx-auto max-w-[1560px] px-4 pt-6 pb-2 sm:px-8" : "sr-only"}>
      <div className={visible ? "max-w-[920px] rounded-[4px] border border-ink/15 bg-white/45 p-6" : undefined}>
        {visible && <h2 className="mb-4 text-[15px] font-semibold tracking-[0.08em] text-ink-2 uppercase">O rio, em texto</h2>}
        <ol className="space-y-3 text-[17px] leading-relaxed">
          <li>
            Entram {plural(model.source.rows ?? 0, `registro de ${model.source.name.toLowerCase()}`, `registros de ${model.source.name.toLowerCase()}`)} (versão {model.source.version}).
          </li>
          {model.steps.map((step) => (
            <li key={step.position}>
              <strong>
                Passo {step.position} — {step.title}:
              </strong>{" "}
              {step.headline}.
              {step.lookup && <> Entram {plural(step.lookup.rows ?? 0, `registro de ${step.lookup.name.toLowerCase()}`, `registros de ${step.lookup.name.toLowerCase()}`)}{executed && step.lookup.unreferenced > 0 ? `; ${formatCount(step.lookup.unreferenced)} deles não encontram par` : ""}.</>}
              {executed && step.type !== "aggregate" && (
                <>
                  {" "}
                  Seguem {plural(step.output ?? 0, "registro", "registros")} ({step.unit}).
                  {step.drops.map((d) => ` Saem ${formatCount(d.count)}: ${d.label}.`).join("")}
                  {step.lookup && step.lookup.multiplied > 0 ? ` ${plural(step.lookup.multiplied, "registro encontrou", "registros encontraram")} mais de um par e se multiplicaram.` : ""}
                </>
              )}
              {executed && step.type === "aggregate" && <> Resultam {plural(model.totalResults, "grupo", "grupos")}.</>}
            </li>
          ))}
          {executed ? (
            model.results.map((r) => (
              <li key={r.key}>
                <strong>{r.label}</strong>: {model.measure ? `${model.measure.caption} ${formatMeasure(r.sum)}, ` : ""}formado por {plural(r.records, "registro", "registros")}.
              </li>
            ))
          ) : (
            <li>Os resultados ainda não existem: a receita não foi executada{model.state === "failed" ? " com sucesso" : ""}.</li>
          )}
        </ol>
      </div>
    </section>
  );
}
