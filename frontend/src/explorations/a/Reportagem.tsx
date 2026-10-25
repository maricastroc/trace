"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { request } from "@/lib/api";
import { formatCount, formatMeasure, formatWhen, shortId } from "@/lib/format";
import { useBreakdown, useExclusions, useFlow, useJourney, useResultDetail } from "@/lib/queries";
import type { Contributor, Paginated } from "@/lib/types";
import { useToken } from "@/lib/workspace";
import { DemoGate, ExplorationBar, groupKeyOf, sumColumn, countColumn, type DemoData } from "../demo";

const C = {
  paper: "#f1ebdf",
  ink: "#161513",
  ink2: "#3d3933",
  ink3: "#625c52",
  rule: "rgba(22,21,19,.14)",
  red: "#d23f1c",
  redDeep: "#a92e12",
};

const KITCHEN_TONES = [
  { bg: "#d23f1c", fg: "#fbf3ea" },
  { bg: "#161513", fg: "#f4efe6" },
  { bg: "#e7a08c", fg: "#161513" },
  { bg: "#8c7f6a", fg: "#fbf3ea" },
  { bg: "#c9bba3", fg: "#161513" },
  { bg: "#5c4f3d", fg: "#f4efe6" },
];

export function Reportagem() {
  return (
    <div style={{ background: C.paper, color: C.ink }} className="min-h-dvh">
      <ExplorationBar current="a" />
      <DemoGate>{(data) => <Story data={data} />}</DemoGate>
    </div>
  );
}

function Story({ data }: { data: DemoData }) {
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selected]);

  if (selected !== null) {
    return <Investigation data={data} resultNo={selected} onBack={() => setSelected(null)} onSelect={setSelected} />;
  }
  return <Results data={data} onSelect={setSelected} />;
}

function Results({ data, onSelect }: { data: DemoData; onSelect: (n: number) => void }) {
  const sum = sumColumn(data.columns);
  const count = countColumn(data.columns);
  const rows = useMemo(
    () => [...data.results].sort((a, b) => Number(b.values[sum?.key ?? ""] ?? 0) - Number(a.values[sum?.key ?? ""] ?? 0)),
    [data.results, sum],
  );
  const max = Math.max(...rows.map((r) => Number(r.values[sum?.key ?? ""] ?? 0)), 1);

  return (
    <main className="mx-auto max-w-[1360px] px-[5vw] pt-[8vh] pb-32">
      <div className="grid items-end gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[15px] font-medium tracking-[0.12em] uppercase" style={{ color: C.red }}>
            {data.recipe.name} · dados sintéticos
          </p>
          <h1 className="mt-5 font-display text-[clamp(52px,6.4vw,104px)] leading-[0.94] tracking-[-0.02em]">
            {formatCount(rows.length)} números.
            <br />
            <em>Cada um tem uma história.</em>
          </h1>
        </div>
        <div className="pb-2">
          <p className="text-[20px] leading-[1.5]" style={{ color: C.ink2 }}>
            {data.recipe.description}
          </p>
          <p className="mt-4 text-[16px]" style={{ color: C.ink3 }}>
            Execução {shortId(data.run.id)} · {formatWhen(data.run.finished_at)} · {data.run.inputs.map((i) => `${i.dataset_name} v${i.version_number}`).join(", ")}
          </p>
        </div>
      </div>

      <ol className="mt-[7vh]">
        {rows.map((row, index) => {
          const value = Number(row.values[sum?.key ?? ""] ?? 0);
          const size = Math.max(64, Math.round(176 * Math.sqrt(value / max)));
          return (
            <li key={row.result_no} style={{ borderTop: `1px solid ${C.rule}` }}>
              <button
                type="button"
                onClick={() => onSelect(row.result_no)}
                className="group grid w-full grid-cols-1 items-end gap-x-10 gap-y-3 py-9 text-left md:grid-cols-[minmax(240px,1fr)_auto]"
              >
                <span>
                  <span className="block text-[15px] tracking-[0.1em] uppercase" style={{ color: C.ink3 }}>
                    {String(index + 1).padStart(2, "0")} · {count ? `${formatCount(Number(row.values[count.key] ?? 0))} registros` : ""}
                  </span>
                  <span className="mt-2 block font-display text-[clamp(36px,4vw,56px)] leading-none">{groupKeyOf(data.columns, row)}</span>
                  <span
                    className="mt-4 inline-flex items-center gap-2 text-[18px] underline decoration-1 underline-offset-[6px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    style={{ color: C.red, opacity: index === 0 ? 1 : undefined }}
                  >
                    De onde veio esse número? <span aria-hidden>→</span>
                  </span>
                </span>
                <span className="text-right">
                  <span
                    className="numerals block font-display leading-[0.85] tracking-[-0.03em] transition-colors group-hover:text-[var(--hover)]"
                    style={{ fontSize: size, ["--hover" as string]: C.red }}
                  >
                    {formatMeasure(row.values[sum?.key ?? ""] ?? null)}
                  </span>
                  <span className="mt-4 ml-auto block h-[10px] w-[min(46vw,560px)]" style={{ background: "rgba(22,21,19,.07)" }}>
                    <span className="ml-auto block h-full transition-all group-hover:brightness-110" style={{ width: `${(value / max) * 100}%`, background: C.red }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 max-w-[64ch] text-[16px] leading-relaxed" style={{ color: C.ink3 }}>
        O tamanho de cada número acompanha a raiz do seu valor; a barra mostra a proporção exata. Todos os números vêm da execução registrada no Laravel.
      </p>
    </main>
  );
}

function Investigation({ data, resultNo, onBack, onSelect }: { data: DemoData; resultNo: number; onBack: () => void; onSelect: (n: number) => void }) {
  const row = data.results.find((r) => r.result_no === resultNo)!;
  const sum = sumColumn(data.columns);
  const detail = useResultDetail(data.run.id, resultNo);
  const flow = useFlow(data.run.id, resultNo);
  const lookupInput = data.run.steps.find((s) => s.join)?.join?.lookup.input ?? null;
  const breakdown = useBreakdown(data.run.id, resultNo, lookupInput ?? 0, 1);
  const allContributors = useContributorsAll(data.run.id, resultNo);
  const exclusions = useExclusions(data.run.id, { result: resultNo }, 1);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const name = groupKeyOf(data.columns, row);
  const ordered = [...data.results].sort((a, b) => a.result_no - b.result_no);
  const position = ordered.findIndex((r) => r.result_no === resultNo);

  const sumDep = detail.data?.data.values.find((v) => v.function === "sum");
  const kitchenTone = new Map((breakdown.data?.data ?? []).map((k, i) => [k.id, KITCHEN_TONES[i % KITCHEN_TONES.length]]));

  return (
    <div>
      <section className="rise-in px-[5vw] pt-10 pb-16" style={{ background: C.red, color: C.ink }}>
        <div className="mx-auto max-w-[1360px]">
          <div className="flex flex-wrap items-center justify-between gap-4 text-[17px]">
            <button type="button" onClick={onBack} className="underline decoration-1 underline-offset-4">
              ← todos os municípios
            </button>
            <span className="flex gap-5">
              {position > 0 && (
                <button type="button" onClick={() => onSelect(ordered[position - 1].result_no)} className="hover:underline">
                  ← {groupKeyOf(data.columns, ordered[position - 1])}
                </button>
              )}
              {position < ordered.length - 1 && (
                <button type="button" onClick={() => onSelect(ordered[position + 1].result_no)} className="hover:underline">
                  {groupKeyOf(data.columns, ordered[position + 1])} →
                </button>
              )}
            </span>
          </div>
          <p className="mt-14 text-[16px] font-medium tracking-[0.12em] uppercase">Investigação · {name}</p>
          <p className="numerals font-display text-[clamp(120px,20vw,300px)] leading-[0.82] tracking-[-0.04em]">{formatMeasure(row.values[sum?.key ?? ""] ?? null)}</p>
          <p className="mt-6 max-w-[30ch] font-display text-[clamp(30px,3.4vw,46px)] leading-[1.08]">
            {sum?.source ? `é a soma de “${sum.source.column}” nas ${(data.run.inputs[sum.source.input]?.dataset_name ?? sum.source.alias).toLowerCase()} de ${name}.` : ""} De onde veio esse número?
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1360px] gap-x-16 px-[5vw] md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="sticky top-6 hidden self-start pt-16 md:block" aria-label="Capítulos">
          <ol className="space-y-3 text-[16px]" style={{ color: C.ink3 }}>
            {["O número", "Os registros", "As cozinhas", "O caminho", "O que ficou de fora", "Os dados originais"].map((title, i) => (
              <li key={title}>
                <a href={`#cap-${i + 1}`} className="hover:underline">
                  <span className="mr-3 tabular-nums" style={{ color: C.red }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="max-w-[860px] pb-40">
          <Chapter id="cap-1" n={1} title="O número">
            {sumDep ? (
              <>
                <Statement>
                  {formatMeasure(sumDep.stored)} é a soma de <Mono>{sumDep.source?.alias}.{sumDep.source?.column}</Mono> em {formatCount(sumDep.counted ?? 0)} registros.
                  {(sumDep.ignored_null ?? 0) + (sumDep.ignored_unconvertible ?? 0) > 0 && (
                    <span style={{ color: C.ink3 }}>
                      {" "}
                      {(sumDep.ignored_null ?? 0) + (sumDep.ignored_unconvertible ?? 0) === 1
                        ? "1 registro sem valor numérico ficou fora da soma, mas continua no grupo."
                        : `${formatCount((sumDep.ignored_null ?? 0) + (sumDep.ignored_unconvertible ?? 0))} registros sem valor numérico ficaram fora da soma, mas continuam no grupo.`}
                    </span>
                  )}
                </Statement>
                <p className="mt-6 inline-flex items-center gap-3 rounded-full px-5 py-2.5 text-[17px]" style={{ background: sumDep.consistent ? "#1f5f43" : C.redDeep, color: "#f4efe6" }}>
                  <span aria-hidden>{sumDep.consistent ? "✓" : "✗"}</span>
                  {sumDep.consistent ? `O banco recalculou ${formatMeasure(sumDep.recomputed ?? null)} a partir dos registros originais.` : "O recálculo divergiu do valor gravado."}
                </p>
              </>
            ) : (
              <Placeholder />
            )}
          </Chapter>

          <Chapter id="cap-2" n={2} title="Os registros">
            <Statement>
              {formatCount(row.contributor_count)} refeições formam este grupo. Cada quadro é um registro original — clique para ver sua história.
            </Statement>
            {allContributors && breakdown.data ? (
              <>
                <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
                  {sortByKitchen(allContributors, breakdown.data.data).map((c) => (
                    <MealTile key={c.id} row={c} tone={kitchenTone.get(findKitchenRowId(c, breakdown.data!.data)) ?? KITCHEN_TONES[1]} onOpen={() => setOpenRow(c.id)} />
                  ))}
                </div>
                <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[16px]" style={{ color: C.ink2 }}>
                  {breakdown.data.data.map((k, i) => (
                    <li key={k.id} className="flex items-center gap-2">
                      <span className="inline-block size-3.5" style={{ background: KITCHEN_TONES[i % KITCHEN_TONES.length].bg }} aria-hidden />
                      {k.values.nome ?? k.values.id}
                    </li>
                  ))}
                  <li className="flex items-center gap-2">
                    <span className="inline-block size-3.5" style={{ border: `2px dashed ${C.red}` }} aria-hidden />
                    sem quantidade (fora da soma)
                  </li>
                </ul>
              </>
            ) : (
              <Placeholder />
            )}
          </Chapter>

          <Chapter id="cap-3" n={3} title="As cozinhas">
            {breakdown.data ? (
              <>
                <Statement>{formatCount(breakdown.data.meta.total)} cozinhas participaram.</Statement>
                <ul className="mt-8">
                  {breakdown.data.data.map((k, i) => {
                    const partial = Number(k.partials[sum?.key ?? ""] ?? 0);
                    const total = Number(row.values[sum?.key ?? ""] ?? 1);
                    return (
                      <li key={k.id} className="grid grid-cols-[1fr_auto] items-end gap-6 py-5" style={{ borderTop: `1px solid ${C.rule}` }}>
                        <span>
                          <span className="block font-display text-[34px] leading-none">{k.values.nome ?? k.values.id}</span>
                          <span className="mt-2 block text-[16px]" style={{ color: C.ink3 }}>
                            cozinha {k.values.id} · {formatCount(k.tuples)} refeições · {k.values.status}
                          </span>
                          <span className="mt-3 block h-[8px]" style={{ background: "rgba(22,21,19,.07)" }}>
                            <span className="block h-full" style={{ width: `${(partial / total) * 100}%`, background: KITCHEN_TONES[i % KITCHEN_TONES.length].bg }} />
                          </span>
                        </span>
                        <span className="numerals font-display text-[48px] leading-none">{formatMeasure(k.partials[sum?.key ?? ""] ?? null)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <Placeholder />
            )}
          </Chapter>

          <Chapter id="cap-4" n={4} title="O caminho">
            <Statement>Antes de chegar aqui, os dados passaram por {data.run.steps.length} transformações.</Statement>
            {flow.data?.data.result ? (
              <ol className="mt-8 space-y-0">
                {data.run.steps.map((step) => {
                  const point = flow.data!.data.result!.trace.find((t) => t.position === step.position);
                  const all = step.input_count ?? 0;
                  const mine = point?.input_count ?? 0;
                  return (
                    <li key={step.position} className="grid grid-cols-[72px_1fr] gap-6 py-6" style={{ borderTop: `1px solid ${C.rule}` }}>
                      <span className="font-display text-[56px] leading-none" style={{ color: C.red }}>
                        {step.position}
                      </span>
                      <span>
                        <span className="block text-[15px] tracking-[0.1em] uppercase" style={{ color: C.ink3 }}>
                          {step.title}
                        </span>
                        <span className="mt-1 block text-[21px] leading-snug">{step.summary}</span>
                        <span className="mt-4 block h-[14px] w-full" style={{ background: "rgba(22,21,19,.1)" }}>
                          <span className="block h-full" style={{ width: `${(mine / Math.max(all, 1)) * 100}%`, background: C.red }} />
                        </span>
                        <span className="mt-2 block text-[16px]" style={{ color: C.ink2 }}>
                          {formatCount(all)} registros chegaram a este passo · <strong style={{ color: C.red }}>{formatCount(mine)}</strong> viriam a formar {name}
                          {step.excluded_count ? ` · ${formatCount(step.excluded_count)} saíram aqui` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Placeholder />
            )}
          </Chapter>

          <Chapter id="cap-5" n={5} title="O que ficou de fora">
            {detail.data && exclusions.data ? (
              <>
                <Statement>
                  {exclusions.data.meta.total === 0
                    ? `Nenhum registro de ${name} saiu depois que o município pôde ser identificado.`
                    : `${formatCount(exclusions.data.meta.total)} ${exclusions.data.meta.total === 1 ? "refeição" : "refeições"} de ${name} ficaram de fora.`}
                </Statement>
                <ul className="mt-6 space-y-4">
                  {exclusions.data.data.map((e) => (
                    <li key={e.tuple_no} className="grid grid-cols-[auto_1fr] items-start gap-5 rounded-[2px] p-5" style={{ border: `1.5px dashed ${C.red}` }}>
                      <button type="button" onClick={() => setOpenRow(e.sources[0].row.id)} className="font-mono text-[18px] underline underline-offset-4">
                        {e.sources[0].row.values.id}
                      </button>
                      <span className="text-[18px] leading-relaxed">
                        <span className="mr-2 rounded-sm px-2 py-0.5 text-[13px] font-semibold tracking-[0.1em] uppercase" style={{ background: C.red, color: "#fff" }}>
                          passo {e.step_position}
                        </span>
                        {e.explanation}
                      </span>
                    </li>
                  ))}
                </ul>
                {detail.data.data.related_exclusions && detail.data.data.related_exclusions.unattributable.length > 0 && (
                  <p className="mt-8 text-[18px] leading-relaxed" style={{ color: C.ink2 }}>
                    Outras {formatCount(detail.data.data.related_exclusions.unattributable.reduce((s, u) => s + u.count, 0))} refeições saíram antes de o município ser conhecido (
                    {detail.data.data.related_exclusions.unattributable.map((u) => `${formatCount(u.count)} no passo ${u.step_position}`).join(", ")}). O Trace não as atribui a nenhum município sem evidência.
                  </p>
                )}
              </>
            ) : (
              <Placeholder />
            )}
          </Chapter>

          <Chapter id="cap-6" n={6} title="Os dados originais">
            <Statement>Os {formatCount(row.contributor_count)} registros exatamente como estavam no arquivo.</Statement>
            {allContributors ? (
              <div className="mt-8 overflow-x-auto">
                <table className="w-full text-left text-[17px]">
                  <thead>
                    <tr className="text-[14px] tracking-[0.1em] uppercase" style={{ color: C.ink3 }}>
                      <th className="pb-3 font-normal">linha</th>
                      {Object.keys(allContributors[0]?.values ?? {}).map((k) => (
                        <th key={k} className="pb-3 font-normal">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {allContributors.map((c) => (
                      <tr key={c.id} style={{ borderTop: `1px solid ${C.rule}` }}>
                        <td className="py-2.5" style={{ color: C.ink3 }}>
                          {c.line_number}
                        </td>
                        {Object.values(c.values).map((v, i) => (
                          <td key={i} className="numerals py-2.5 pr-6">
                            {v ?? <span style={{ color: C.red }}>vazio</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Placeholder />
            )}
          </Chapter>
        </div>
      </div>

      {openRow !== null && <RecordDrawer runId={data.run.id} rowId={openRow} onClose={() => setOpenRow(null)} onOpen={setOpenRow} />}
    </div>
  );
}

function useContributorsAll(runId: string, resultNo: number) {
  const token = useToken();
  const query = useQuery({
    queryKey: ["contributors-100", runId, resultNo, token],
    queryFn: () => request<Paginated<Contributor>>(`/runs/${runId}/results/${resultNo}/contributors?input=0&per_page=100`, { token }),
    enabled: token !== null,
  });
  return query.data?.data ?? null;
}

function sortByKitchen(meals: Contributor[], kitchens: { id: number; values: Record<string, string | null> }[]) {
  const order = new Map(kitchens.map((k, i) => [k.values.id, i]));
  return [...meals].sort((a, b) => (order.get(a.values.cozinha_id) ?? 99) - (order.get(b.values.cozinha_id) ?? 99) || a.row_number - b.row_number);
}

function findKitchenRowId(meal: Contributor, kitchens: { id: number; values: Record<string, string | null> }[]) {
  return kitchens.find((k) => k.values.id === meal.values.cozinha_id)?.id ?? -1;
}

function MealTile({ row, tone, onOpen }: { row: Contributor; tone: { bg: string; fg: string }; onOpen: () => void }) {
  const measure = row.measure_values[0];
  const counted = measure?.status === "counted";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex aspect-square flex-col justify-between p-3 text-left transition-transform hover:-translate-y-0.5"
      style={counted ? { background: tone.bg, color: tone.fg } : { border: `2px dashed ${C.red}`, color: C.red }}
    >
      <span className="font-mono text-[13px] opacity-85">{row.values.id}</span>
      <span>
        <span className="numerals block font-display text-[34px] leading-none">{counted ? formatMeasure(measure.raw) : "∅"}</span>
        <span className="block text-[12.5px] opacity-85">{counted ? row.values.data : "sem quantidade"}</span>
      </span>
    </button>
  );
}

function RecordDrawer({ runId, rowId, onClose, onOpen }: { runId: string; rowId: number; onClose: () => void; onOpen: (id: number) => void }) {
  const journey = useJourney(runId, rowId, 1);
  const data = journey.data?.data;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="História do registro">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Fechar" />
      <aside className="rise-in relative h-full w-full max-w-[560px] overflow-y-auto p-10" style={{ background: C.paper, color: C.ink }}>
        <button type="button" onClick={onClose} className="text-[17px] underline underline-offset-4">
          fechar
        </button>
        {!data ? (
          <Placeholder />
        ) : (
          <>
            <p className="mt-10 text-[15px] tracking-[0.1em] uppercase" style={{ color: C.ink3 }}>
              registro de {data.row.alias} · linha {data.row.line_number} do arquivo
            </p>
            <p className="font-display text-[88px] leading-none">{data.row.values.id ?? data.row.row_number}</p>
            <p className="mt-6 font-display text-[28px] leading-[1.2]">{data.summary}</p>
            <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-[17px]">
              {Object.entries(data.row.values).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt style={{ color: C.ink3 }}>{k}</dt>
                  <dd>{v ?? <span style={{ color: C.red }}>vazio</span>}</dd>
                </div>
              ))}
            </dl>
            {data.paths[0] && (
              <ol className="mt-10">
                {data.paths[0].timeline.map((t) => (
                  <li key={t.position} className="grid grid-cols-[48px_1fr] gap-4 py-4" style={{ borderTop: `1px solid ${C.rule}`, opacity: t.status === "not_reached" ? 0.4 : 1 }}>
                    <span className="font-display text-[36px] leading-none" style={{ color: t.status === "excluded" ? C.red : C.ink }}>
                      {t.position}
                    </span>
                    <span>
                      <span className="block text-[14px] tracking-[0.1em] uppercase" style={{ color: t.status === "excluded" ? C.red : C.ink3 }}>
                        {t.title} · {t.status === "excluded" ? "saiu aqui" : t.status === "not_reached" ? "não chegou" : t.status === "joined" ? "relacionado" : t.status === "aggregated" ? "agrupado" : "passou"}
                      </span>
                      {t.explanation && t.status !== "not_reached" && <span className="mt-1 block text-[17px] leading-snug">{t.explanation}</span>}
                      {t.partner && (
                        <button type="button" onClick={() => onOpen(t.partner!.row.id)} className="mt-1 text-[16px] underline underline-offset-4">
                          com {t.partner.alias} {t.partner.row.values.id} · {t.partner.row.values.nome}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function Chapter({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 pt-16" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="text-[15px] font-medium tracking-[0.12em] uppercase" style={{ color: C.red }}>
        {String(n).padStart(2, "0")} · {title}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Statement({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-[clamp(30px,3vw,42px)] leading-[1.14] tracking-[-0.01em]">{children}</p>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[0.62em] tracking-normal">{children}</span>;
}

function Placeholder() {
  return <p className="text-[18px]" style={{ color: C.ink3 }}>Carregando…</p>;
}

