"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/lib/api";
import { formatCount, formatMeasure } from "@/lib/format";
import { useBreakdown, useExclusions, useJourney, useVersionRows } from "@/lib/queries";
import type { Exclusion, Paginated, SourceRow, SummaryEntry } from "@/lib/types";
import { useToken } from "@/lib/workspace";
import { DemoGate, ExplorationBar, groupKeyOf, sumColumn, useAllContributors, type DemoData } from "../demo";

const K = {
  bg: "#e9e1cf",
  card: "#fbf8f0",
  ink: "#1c2320",
  ink2: "#3f4741",
  ink3: "#5d655f",
  red: "#bf331c",
  blue: "#1d3fae",
  rule: "rgba(28,35,32,.16)",
};

type Fate = { kind: "result"; resultNo: number } | { kind: "excluded"; step: number; code: string; explanation: string };
type Rec = { id: number; row: SourceRow; fate: Fate; counted: boolean };
type Cluster = { key: string; title: string; subtitle: string; items: Rec[]; cols: number; tone?: "ink" | "red" | "blue" | "faint" | "neutral"; cell?: number };
type Mode = { kind: "destino" } | { kind: "replay"; stage: number } | { kind: "foco"; resultNo: number };

export function Arquivo() {
  return (
    <div style={{ background: K.bg, color: K.ink }} className="min-h-dvh">
      <ExplorationBar current="c" />
      <DemoGate>{(data) => <Loader data={data} />}</DemoGate>
    </div>
  );
}

function useAllExclusions(runId: string) {
  const token = useToken();
  return useQuery({
    queryKey: ["exclusions-all", runId, token],
    enabled: token !== null,
    queryFn: async () => {
      const all: Exclusion[] = [];
      let summary: SummaryEntry[] = [];
      for (let page = 1; page <= 20; page++) {
        const response = await request<Paginated<Exclusion, { summary: SummaryEntry[] }>>(`/runs/${runId}/exclusions?per_page=100&page=${page}`, { token });
        all.push(...response.data);
        summary = response.meta.summary;
        if (page >= response.meta.last_page) break;
      }
      return { all, summary };
    },
  });
}

function Loader({ data }: { data: DemoData }) {
  const contributors = useAllContributors(data.run.id, data.results);
  const exclusions = useAllExclusions(data.run.id);
  const lookup = data.run.steps.find((s) => s.join)?.join?.lookup;
  const kitchens = useVersionRows(lookup ? data.run.inputs[lookup.input].version_id : null, 1);

  if (contributors.some((c) => !c.data) || !exclusions.data || (lookup && !kitchens.data)) {
    return <p className="px-[5vw] py-24 font-display text-[34px]">Abrindo o arquivo de registros…</p>;
  }

  const records = new Map<number, Rec>();
  contributors.forEach((c, i) => {
    for (const row of c.data!.data) {
      if (!records.has(row.id)) {
        records.set(row.id, { id: row.id, row, fate: { kind: "result", resultNo: data.results[i].result_no }, counted: row.measure_values[0]?.status !== "ignored_null" && row.measure_values[0]?.status !== "ignored_unconvertible" });
      }
    }
  });
  for (const e of exclusions.data.all) {
    const base = e.sources.find((s) => s.input === 0);
    if (base && !records.has(base.row.id)) {
      records.set(base.row.id, { id: base.row.id, row: base.row, fate: { kind: "excluded", step: e.step_position, code: e.code, explanation: e.explanation }, counted: true });
    }
  }
  const kitchenNames = new Map((kitchens.data?.data ?? []).map((k) => [k.values.id, k.values.nome ?? k.values.id]));

  return <Board data={data} records={[...records.values()].sort((a, b) => a.row.row_number - b.row.row_number)} summary={exclusions.data.summary} kitchenNames={kitchenNames} />;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function pack(clusters: Cluster[], width: number, top: number, cell: number, gap: number) {
  const positions = new Map<number, { x: number; y: number; size: number; tone: Cluster["tone"] }>();
  const labels: { key: string; x: number; y: number; w: number; title: string; subtitle: string; tone: Cluster["tone"] }[] = [];
  let x = 0;
  let y = top;
  let rowHeight = 0;
  const labelSpace = 108;

  for (const cluster of clusters) {
    const size = cluster.cell ?? cell;
    const cols = Math.max(1, cluster.cols);
    const rows = Math.max(1, Math.ceil(cluster.items.length / cols));
    const w = Math.max(cols * (size + gap) - gap, 180);
    const h = labelSpace + rows * (size + gap);
    if (x > 0 && x + w > width) {
      x = 0;
      y += rowHeight + 40;
      rowHeight = 0;
    }
    labels.push({ key: cluster.key, x, y, w, title: cluster.title, subtitle: cluster.subtitle, tone: cluster.tone });
    cluster.items.forEach((item, i) => {
      positions.set(item.id, { x: x + (i % cols) * (size + gap), y: y + labelSpace + Math.floor(i / cols) * (size + gap), size, tone: cluster.tone });
    });
    x += w + 56;
    rowHeight = Math.max(rowHeight, h);
  }
  return { positions, labels, height: y + rowHeight };
}

function colsFor(n: number, ratio = 1.6) {
  return Math.max(4, Math.ceil(Math.sqrt(n * ratio)));
}

function Board({ data, records, summary, kitchenNames }: { data: DemoData; records: Rec[]; summary: SummaryEntry[]; kitchenNames: Map<string | null, string | null> }) {
  const [ref, width] = useWidth();
  const [mode, setMode] = useState<Mode>({ kind: "destino" });
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [hover, setHover] = useState<Rec | null>(null);
  const sum = sumColumn(data.columns);
  const steps = data.run.steps;
  const lastFilterStage = steps.filter((s) => s.type !== "aggregate").length;
  const focusResult = mode.kind === "foco" ? mode.resultNo : null;
  const focusExclusions = useExclusions(data.run.id, { result: focusResult ?? undefined }, 1);
  const lookupInput = steps.find((s) => s.join)?.join?.lookup.input ?? 0;
  const breakdown = useBreakdown(focusResult ? data.run.id : null, focusResult, lookupInput, 1);

  const ordered = useMemo(
    () => [...data.results].sort((a, b) => Number(b.values[sum?.key ?? ""] ?? 0) - Number(a.values[sum?.key ?? ""] ?? 0)),
    [data.results, sum],
  );

  const layout = useMemo(() => {
    const reasonFor = (step: number) =>
      summary
        .filter((s) => s.step_position === step)
        .map((s) => s.label.toLowerCase())
        .join(", ");
    const cell = 26;
    const gap = 5;
    const resultClusters = (): Cluster[] =>
      ordered.map((r) => {
        const items = records.filter((rec) => rec.fate.kind === "result" && rec.fate.resultNo === r.result_no);
        return { key: `r-${r.result_no}`, title: groupKeyOf(data.columns, r), subtitle: `${formatMeasure(r.values[sum?.key ?? ""] ?? null)} · ${formatCount(items.length)} registros`, items, cols: colsFor(items.length, 1.2), tone: "ink" };
      });
    const excludedClusters = (upTo: number): Cluster[] =>
      steps
        .filter((s) => s.position <= upTo && s.excluded_count)
        .map((s) => {
          const items = records.filter((rec) => rec.fate.kind === "excluded" && rec.fate.step === s.position);
          return { key: `x-${s.position}`, title: `Passo ${s.position} · ${s.title}`, subtitle: `${formatCount(items.length)} · ${reasonFor(s.position)}`, items, cols: colsFor(items.length, 2.2), tone: "red" };
        });

    if (mode.kind === "destino") {
      const top = pack(resultClusters(), width, 0, cell, gap);
      const bottom = pack(excludedClusters(99), width, top.height + 110, cell, gap);
      return { positions: new Map([...top.positions, ...bottom.positions]), labels: [...top.labels, ...bottom.labels], height: bottom.height, section: top.height + 60 };
    }

    if (mode.kind === "replay") {
      if (mode.stage >= lastFilterStage) {
        const top = pack(resultClusters(), width, 0, cell, gap);
        const bottom = pack(excludedClusters(99), width, top.height + 110, cell, gap);
        return { positions: new Map([...top.positions, ...bottom.positions]), labels: [...top.labels, ...bottom.labels], height: bottom.height, section: top.height + 60 };
      }
      const alive = records.filter((rec) => !(rec.fate.kind === "excluded" && rec.fate.step <= mode.stage));
      const title = mode.stage === 0 ? `${data.run.inputs[0].dataset_name} na fonte` : `Seguem depois do passo ${mode.stage}`;
      const top = pack([{ key: "alive", title, subtitle: `${formatCount(alive.length)} registros`, items: alive, cols: Math.min(26, colsFor(alive.length, 3.2)), tone: "neutral" }], width, 0, cell, gap);
      const bottom = pack(excludedClusters(mode.stage), width, top.height + 110, cell, gap);
      return { positions: new Map([...top.positions, ...bottom.positions]), labels: [...top.labels, ...bottom.labels], height: Math.max(bottom.height, top.height + 200), section: top.height + 60 };
    }

    const result = data.results.find((r) => r.result_no === mode.resultNo)!;
    const mine = records.filter((rec) => rec.fate.kind === "result" && rec.fate.resultNo === mode.resultNo);
    const kitchenIds = [...new Set(mine.map((rec) => rec.row.values.cozinha_id))];
    const kitchenClusters: Cluster[] = kitchenIds.map((id) => {
      const items = mine.filter((rec) => rec.row.values.cozinha_id === id);
      const partial = breakdown.data?.data.find((k) => k.values.id === id)?.partials[sum?.key ?? ""] ?? null;
      return { key: `k-${id}`, title: kitchenNames.get(id ?? null) ?? `cozinha ${id}`, subtitle: `${partial ? formatMeasure(partial) + " · " : ""}${formatCount(items.length)} refeições`, items, cols: 4, tone: "blue", cell: 40 };
    });
    const excludedIds = new Set((focusExclusions.data?.data ?? []).map((e) => e.sources.find((s) => s.input === 0)?.row.id));
    const left = records.filter((rec) => excludedIds.has(rec.id));
    const others = records.filter((rec) => !mine.includes(rec) && !excludedIds.has(rec.id));
    const top = pack(
      [...kitchenClusters, ...(left.length ? [{ key: "fora", title: `Ficaram de fora`, subtitle: `${formatCount(left.length)} de ${groupKeyOf(data.columns, result)}`, items: left, cols: 4, tone: "red" as const, cell: 40 }] : [])],
      width,
      0,
      cell,
      gap,
    );
    const bottom = pack([{ key: "outros", title: "Os outros registros", subtitle: `${formatCount(others.length)} · fora deste grupo`, items: others, cols: Math.min(40, colsFor(others.length, 5)), tone: "faint", cell: 12 }], width, top.height + 110, cell, 3);
    return { positions: new Map([...top.positions, ...bottom.positions]), labels: [...top.labels, ...bottom.labels], height: bottom.height, section: top.height + 60 };
  }, [mode, records, ordered, width, data, steps, sum, lastFilterStage, breakdown.data, focusExclusions.data, kitchenNames, summary]);

  const included = records.filter((r) => r.fate.kind === "result").length;
  const excluded = records.length - included;
  const focusRow = focusResult ? data.results.find((r) => r.result_no === focusResult) : null;

  return (
    <main className="px-[5vw] pt-12 pb-32">
      <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <p className="font-mono text-[15px] tracking-[0.12em] uppercase" style={{ color: K.red }}>
            Arquivo de registros · {data.recipe.name}
          </p>
          <h1 className="mt-4 font-display text-[clamp(48px,6vw,92px)] leading-[0.95] tracking-[-0.02em]">
            {focusRow ? (
              <>
                {groupKeyOf(data.columns, focusRow)}: <span style={{ color: K.blue }}>{formatMeasure(focusRow.values[sum?.key ?? ""] ?? null)}</span>
              </>
            ) : (
              <>Cada quadrado é um registro de {data.run.inputs[0].dataset_name.toLowerCase()}.</>
            )}
          </h1>
        </div>
        <p className="text-[20px] leading-relaxed" style={{ color: K.ink2 }}>
          {focusRow ? (
            <>Agrupados por cozinha, em azul, os registros que formaram este número. Em vermelho, os que pertenciam a {groupKeyOf(data.columns, focusRow)} e ficaram de fora — clique em qualquer um para ler a ficha.</>
          ) : (
            <>
              <strong>{formatCount(included)}</strong> formaram os resultados. <strong style={{ color: K.red }}>{formatCount(excluded)}</strong> ficaram pelo caminho, cada um com um motivo registrado. Passe o cursor para ler; clique para abrir a ficha.
            </>
          )}
        </p>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 font-mono text-[15px]">
        <ModeButton active={mode.kind === "destino"} onClick={() => setMode({ kind: "destino" })}>
          por destino
        </ModeButton>
        <ModeButton active={mode.kind === "replay"} onClick={() => setMode({ kind: "replay", stage: 0 })}>
          passo a passo
        </ModeButton>
        {mode.kind === "replay" && (
          <span className="ml-2 flex items-center gap-1.5">
            {Array.from({ length: lastFilterStage + 1 }).map((_, s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMode({ kind: "replay", stage: s })}
                className="h-9 min-w-9 rounded-full px-3"
                style={mode.stage === s ? { background: K.ink, color: K.card } : { border: `1.5px solid ${K.ink}` }}
              >
                {s === 0 ? "fonte" : s}
              </button>
            ))}
            {mode.stage < lastFilterStage && (
              <button type="button" onClick={() => setMode({ kind: "replay", stage: mode.stage + 1 })} className="ml-2 underline underline-offset-4">
                próximo passo →
              </button>
            )}
          </span>
        )}
        {mode.kind === "foco" && (
          <button type="button" onClick={() => setMode({ kind: "destino" })} className="underline underline-offset-4">
            ← todos os registros
          </button>
        )}
        {mode.kind === "replay" && mode.stage > 0 && mode.stage <= steps.length && (
          <span className="basis-full pt-2 font-sans text-[18px]" style={{ color: K.ink2 }}>
            Passo {mode.stage} · {steps[mode.stage - 1].summary}
          </span>
        )}
      </div>

      <div ref={ref} className="relative mt-12" style={{ height: layout.height + 40 }}>
        {mode.kind !== "foco" && (
          <p className="absolute font-mono text-[15px] tracking-[0.12em] uppercase" style={{ top: layout.section, left: 0, color: K.red }}>
            {mode.kind === "replay" && mode.stage === 0 ? "" : "Ficaram pelo caminho"}
          </p>
        )}
        {layout.labels.map((label) => {
          const resultNo = label.key.startsWith("r-") ? Number(label.key.slice(2)) : null;
          const content = (
            <>
              <span className="block font-display text-[30px] leading-[1.05]" style={{ color: label.tone === "red" ? K.red : label.tone === "blue" ? K.blue : K.ink }}>
                {label.title}
              </span>
              <span className="mt-1 block font-mono text-[14.5px]" style={{ color: K.ink2 }}>
                {label.subtitle}
              </span>
            </>
          );
          return resultNo !== null ? (
            <button
              key={label.key}
              type="button"
              onClick={() => setMode({ kind: "foco", resultNo })}
              className="group absolute text-left transition-all duration-700 motion-reduce:transition-none"
              style={{ left: label.x, top: label.y, width: label.w + 40 }}
            >
              {content}
              <span className="block font-sans text-[15px] underline-offset-4 group-hover:underline" style={{ color: K.blue }}>
                investigar →
              </span>
            </button>
          ) : (
            <div key={label.key} className="absolute transition-all duration-700 motion-reduce:transition-none" style={{ left: label.x, top: label.y, width: label.w + 40 }}>
              {content}
            </div>
          );
        })}

        {records.map((rec, index) => {
          const p = layout.positions.get(rec.id);
          if (!p) return null;
          const neutral = p.tone === "neutral";
          const excludedRec = rec.fate.kind === "excluded" && !neutral;
          const faint = p.tone === "faint";
          const fill = faint ? "rgba(28,35,32,.18)" : p.tone === "blue" ? K.blue : excludedRec ? "transparent" : K.ink;
          const border = faint ? "transparent" : excludedRec ? K.red : !rec.counted && !neutral ? K.ink : fill;
          return (
            <button
              key={rec.id}
              type="button"
              aria-label={`Registro ${rec.row.values.id ?? rec.row.line_number}`}
              onClick={() => setOpenRow(rec.id)}
              onMouseEnter={() => setHover(rec)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(rec)}
              onBlur={() => setHover(null)}
              className="absolute top-0 left-0 rounded-[2px] transition-[transform,width,height,background-color] motion-reduce:transition-none duration-700 ease-[cubic-bezier(.22,.61,.36,1)] hover:scale-125 focus-visible:scale-125"
              style={{
                transform: `translate(${p.x}px, ${p.y}px)`,
                width: p.size,
                height: p.size,
                background: !rec.counted && !excludedRec && !faint && !neutral ? "transparent" : fill,
                border: `${excludedRec && !faint ? 2 : 1.5}px ${!rec.counted && !excludedRec && !neutral ? "dashed" : "solid"} ${border}`,
                transitionDelay: `${(index % 40) * 6}ms`,
              }}
            >
              {p.size >= 40 && (
                <span className="numerals font-mono text-[11px]" style={{ color: excludedRec ? K.red : "#fff" }}>
                  {rec.counted ? rec.row.values.quantidade : "∅"}
                </span>
              )}
            </button>
          );
        })}

        {hover && (
          <div className="pointer-events-none fixed right-8 bottom-8 z-30 w-[340px] p-5 shadow-[0_1px_0_rgba(0,0,0,.08)]" style={{ background: K.card, border: `1.5px solid ${K.ink}` }}>
            <p className="font-mono text-[14px] tracking-[0.1em] uppercase" style={{ color: hover.fate.kind === "excluded" ? K.red : K.ink3 }}>
              {hover.fate.kind === "excluded" ? `excluído no passo ${hover.fate.step}` : `contribuiu · ${groupKeyOf(data.columns, data.results.find((r) => hover.fate.kind === "result" && r.result_no === hover.fate.resultNo)!)}`}
            </p>
            <p className="mt-1 font-display text-[34px] leading-none">{hover.row.values.id}</p>
            <p className="mt-2 font-mono text-[15px]" style={{ color: K.ink2 }}>
              {Object.entries(hover.row.values)
                .filter(([k]) => k !== "id")
                .map(([k, v]) => `${k} ${v ?? "∅"}`)
                .join(" · ")}
            </p>
            {hover.fate.kind === "excluded" && <p className="mt-2 text-[16px] leading-snug">{hover.fate.explanation}</p>}
          </div>
        )}
      </div>

      {openRow !== null && <IndexCard runId={data.run.id} rowId={openRow} onClose={() => setOpenRow(null)} onOpen={setOpenRow} />}
    </main>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-10 rounded-full px-5 tracking-wide" style={active ? { background: K.ink, color: K.card } : { border: `1.5px solid ${K.ink}` }}>
      {children}
    </button>
  );
}

function IndexCard({ runId, rowId, onClose, onOpen }: { runId: string; rowId: number; onClose: () => void; onOpen: (id: number) => void }) {
  const journey = useJourney(runId, rowId, 1);
  const data = journey.data?.data;
  const path = data?.paths[0];
  const excluded = path?.outcome?.status === "excluded";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Ficha do registro">
      <button type="button" className="absolute inset-0" style={{ background: "rgba(28,35,32,.35)" }} onClick={onClose} aria-label="Fechar" />
      <article className="rise-in relative max-h-[86vh] w-full max-w-[720px] overflow-y-auto p-10" style={{ background: K.card, color: K.ink, boxShadow: "0 30px 60px -30px rgba(0,0,0,.45)" }}>
        <div className="flex items-start justify-between gap-6 border-b pb-4" style={{ borderColor: K.rule }}>
          <p className="font-mono text-[15px] tracking-[0.12em] uppercase" style={{ color: K.ink3 }}>
            Ficha · {data ? `${data.row.alias} · linha ${data.row.line_number} · versão ${data.row.version_number}` : "…"}
          </p>
          <button type="button" onClick={onClose} className="font-mono text-[15px] underline underline-offset-4">
            fechar
          </button>
        </div>
        {!data ? (
          <p className="mt-8 text-[18px]">Lendo a linhagem…</p>
        ) : (
          <>
            <div className="relative mt-6">
              <p className="font-display text-[84px] leading-none">{data.row.values.id ?? data.row.row_number}</p>
              {path?.outcome && (
                <span
                  className="absolute top-2 right-0 rotate-[-6deg] border-[3px] px-4 py-1.5 font-mono text-[18px] font-medium tracking-[0.14em] uppercase"
                  style={{ borderColor: excluded ? K.red : K.blue, color: excluded ? K.red : K.blue }}
                >
                  {excluded ? `excluído · passo ${(path.outcome as { step_position: number }).step_position}` : `contribuiu · linha ${(path.outcome as { result_no: number }).result_no}`}
                </span>
              )}
              {!path && <span className="absolute top-2 right-0 rotate-[-6deg] border-[3px] px-4 py-1.5 font-mono text-[18px] tracking-[0.14em] uppercase" style={{ borderColor: K.red, color: K.red }}>não relacionado</span>}
            </div>
            <p className="mt-6 font-display text-[28px] leading-[1.2]">{data.summary}</p>
            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-1.5 font-mono text-[17px]">
              {Object.entries(data.row.values).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt style={{ color: K.ink3 }}>{k}</dt>
                  <dd>{v ?? <span style={{ color: K.red }}>vazio</span>}</dd>
                </div>
              ))}
            </dl>
            {path && (
              <ol className="mt-8 border-t pt-2" style={{ borderColor: K.rule }}>
                {path.timeline.map((t) => (
                  <li key={t.position} className="grid grid-cols-[40px_1fr] gap-4 py-3" style={{ opacity: t.status === "not_reached" ? 0.35 : 1 }}>
                    <span className="font-display text-[30px] leading-none" style={{ color: t.status === "excluded" ? K.red : K.ink }}>
                      {t.position}
                    </span>
                    <span className="text-[17px] leading-snug">
                      <span className="font-mono text-[14px] tracking-[0.1em] uppercase" style={{ color: t.status === "excluded" ? K.red : K.ink3 }}>
                        {t.title}
                      </span>
                      {t.explanation && t.status !== "not_reached" && <span className="block">{t.explanation}</span>}
                      {t.partner && (
                        <button type="button" onClick={() => onOpen(t.partner!.row.id)} className="block underline underline-offset-4">
                          com {t.partner.alias} {t.partner.row.values.id} · {t.partner.row.values.nome}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {data.references && <p className="mt-6 text-[18px] leading-relaxed">{data.references.explanation}</p>}
          </>
        )}
      </article>
    </div>
  );
}
