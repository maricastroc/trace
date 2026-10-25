"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatCount, formatMeasure, plural } from "@/lib/format";
import { centerLine, fallCenterLine, fallPath, layoutRiver, ribbonPath, type BandGeo, type Orientation, type RiverLayout } from "./layout";
import type { RiverModel } from "./model";

export type RecordTrace =
  | { kind: "result"; key: string; from: number }
  | { kind: "drop"; step: number; from: number }
  | { kind: "unreferenced"; step: number };

type Props = {
  model: RiverModel;
  compact: boolean;
  selectedKey: string | null;
  activePool: number | null;
  record: RecordTrace | null;
  onSelect: (key: string | null) => void;
  onPool: (step: number) => void;
  onUnreferenced: (step: number) => void;
  onRelationship: (id: string) => void;
  onSource: (alias: string) => void;
  onAnchor?: (x: number | null) => void;
  onOrientation?: (orientation: Orientation) => void;
};

const INK = "#111110";
const DROP = "#d8cfbd";
const DROP_ACTIVE = "#b9aa8c";
const PLUM = "#8a3f5c";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function River(props: Props) {
  const [ref, width] = useWidth();
  const orientation: Orientation = width > 0 && width < 760 ? "v" : "h";
  const { onOrientation } = props;
  useEffect(() => {
    if (width > 0) onOrientation?.(orientation);
  }, [orientation, width, onOrientation]);

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && <RiverCanvas {...props} width={width} orientation={orientation} />}
    </div>
  );
}

function RiverCanvas({
  model,
  compact,
  selectedKey,
  activePool,
  record,
  onSelect,
  onPool,
  onUnreferenced,
  onRelationship,
  onSource,
  onAnchor,
  width,
  orientation,
}: Props & { width: number; orientation: Orientation }) {
  const L = useMemo(() => layoutRiver(model, width, orientation, compact && orientation === "h"), [model, width, orientation, compact]);
  const executed = model.state === "succeeded";
  const stages = Math.max(model.lastStage, 1);
  const dimmed = selectedKey !== null || activePool !== null || record !== null;
  const resultBands = L.bands.filter((b) => b.kind === "result");
  const selectedBand = selectedKey ? L.bands.find((b) => b.key === selectedKey) : undefined;
  const recordBandKey = record?.kind === "result" ? record.key : null;

  useEffect(() => {
    if (!onAnchor) return;
    if (activePool !== null && L.poolBoxes[activePool]) onAnchor(L.poolBoxes[activePool].x + 30);
    else if (selectedKey && L.resultBoxes[selectedKey]) onAnchor(L.resultBoxes[selectedKey].anchor);
    else onAnchor(null);
  }, [L, activePool, selectedKey, onAnchor]);

  const bandOpacity = (band: BandGeo) => {
    if (band.kind === "drop") {
      if (activePool !== null) return band.dropStep === activePool ? 1 : 0.35;
      if (record?.kind === "drop") return band.dropStep === record.step ? 1 : 0.35;
      return selectedKey ? 0.55 : 1;
    }
    if (band.kind === "neutral") return selectedKey ? 0.35 : 1;
    if (selectedKey) return band.key === selectedKey ? 1 : 0.1;
    if (recordBandKey) return band.key === recordBandKey ? 1 : 0.14;
    if (activePool !== null || record) return 0.3;
    return 1;
  };

  const paths = (band: BandGeo) => {
    const out: string[] = [];
    for (let s = 0; s < stages; s++) {
      const h1 = band.heights[s];
      const h2 = band.heights[s + 1];
      if (h1 <= 0) continue;
      if (band.kind === "drop" && h2 <= 0 && band.dropStep === s + 1) {
        out.push(fallPath(L, L.gates[s], band.tops[s], h1, L.poolAlong[s + 1]));
        continue;
      }
      if (band.kind === "neutral" && h2 <= 0) {
        const targets = resultBands.filter((r) => r.heights[s + 1] > 0);
        const total = targets.reduce((acc, r) => acc + r.heights[s + 1], 0) || 1;
        let offset = band.tops[s];
        for (const target of targets) {
          const slice = (h1 * target.heights[s + 1]) / total;
          out.push(ribbonPath(L, L.gates[s], offset, slice, L.gates[s + 1], target.tops[s + 1], target.heights[s + 1]));
          offset += slice;
        }
        continue;
      }
      if (h2 <= 0) continue;
      out.push(ribbonPath(L, L.gates[s], band.tops[s], h1, L.gates[s + 1], band.tops[s + 1], h2));
    }
    if (band.kind === "result" && L.fanTargets[band.key]) {
      const h = band.heights[stages];
      const t = L.fanTargets[band.key];
      if (h > 0) out.push(ribbonPath(L, L.gates[stages], band.tops[stages], h, t.along, t.cross, h));
    }
    if (band.kind === "channel") {
      const h = band.heights[stages];
      const end = L.orientation === "h" ? L.gates[stages] + 60 : L.gates[stages] + 30;
      out.push(ribbonPath(L, L.gates[stages], band.tops[stages], h, end, band.tops[stages], h));
    }
    return out;
  };

  const gateSpan = (s: number) => {
    const tops = L.bands.map((b) => b.tops[s]).filter((v) => Number.isFinite(v));
    const bottoms = L.bands.map((b) => b.tops[s] + b.heights[s]).filter((v) => Number.isFinite(v));
    return { from: Math.min(...tops) - 14, to: Math.max(...bottoms) + 14 };
  };

  const relatedOverlay = () => {
    if (!selectedBand?.result) return null;
    const result = selectedBand.result;
    return Object.entries(result.related).map(([stepText, count]) => {
      const step = Number(stepText);
      const band = L.bands.find((b) => b.dropStep === step);
      if (!band || count <= 0) return null;
      const h = count * L.scale;
      const from = Math.min(model.groupFromStage, step - 1);
      const parts: string[] = [];
      for (let s = from; s < step - 1; s++) parts.push(ribbonPath(L, L.gates[s], band.tops[s], h, L.gates[s + 1], band.tops[s + 1], h));
      parts.push(fallPath(L, L.gates[step - 1], band.tops[step - 1], h, L.poolAlong[step]));
      return (
        <g key={`rel-${step}`} className="rise-in">
          {parts.map((d, i) => (
            <path key={i} d={d} fill={result.color.fill} fillOpacity={0.92} />
          ))}
        </g>
      );
    });
  };

  const recordLine = () => {
    if (!record) return null;
    if (record.kind === "unreferenced") return null;
    if (record.kind === "result") {
      const band = L.bands.find((b) => b.key === record.key);
      if (!band) return null;
      const segments: string[] = [];
      for (let s = record.from; s < stages; s++) {
        if (band.heights[s] <= 0 || band.heights[s + 1] <= 0) continue;
        segments.push(centerLine(L, L.gates[s], band.tops[s] + band.heights[s] / 2, L.gates[s + 1], band.tops[s + 1] + band.heights[s + 1] / 2));
      }
      const t = L.fanTargets[band.key];
      if (t) segments.push(centerLine(L, L.gates[stages], band.tops[stages] + band.heights[stages] / 2, t.along, t.cross + band.heights[stages] / 2));
      return segments.map((d, i) => <path key={i} d={d} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" className="trace-draw" pathLength={1} style={{ animationDelay: `${i * 120}ms` }} />);
    }
    const band = L.bands.find((b) => b.dropStep === record.step);
    if (!band) return null;
    const segments: string[] = [];
    for (let s = record.from; s < record.step - 1; s++) {
      segments.push(centerLine(L, L.gates[s], band.tops[s] + band.heights[s] / 2, L.gates[s + 1], band.tops[s + 1] + band.heights[s + 1] / 2));
    }
    segments.push(fallCenterLine(L, L.gates[record.step - 1], band.tops[record.step - 1], band.heights[record.step - 1], L.poolAlong[record.step]));
    return segments.map((d, i) => <path key={i} d={d} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" className="trace-draw" pathLength={1} style={{ animationDelay: `${i * 120}ms` }} />);
  };

  const tributaryPaths = () => {
    const t = L.tributary;
    if (!t) return null;
    const step = model.steps.find((s) => s.position === t.step);
    const pending = !executed;
    const P = L.point;
    const midCross = (t.node.cross + t.entry.cross) / 2;
    const d = `M ${P(t.node.along, t.node.cross)} C ${P(t.entry.along, t.node.cross)}, ${P(t.entry.along, midCross)}, ${P(t.entry.along, t.entry.cross)}`;
    const highlight = record?.kind === "result" && record.from > 0;
    return (
      <g>
        <path
          d={d}
          fill="none"
          stroke={highlight ? INK : INK}
          strokeOpacity={highlight ? 0.75 : pending ? 0.25 : dimmed ? 0.12 : 0.24}
          strokeWidth={t.width}
          strokeDasharray={pending && step?.lookup?.status !== "confirmed" ? "6 6" : undefined}
          strokeLinecap="butt"
        />
        <circle {...circleAt(L, t.node.along, t.node.cross)} r={6} fill={INK} />
      </g>
    );
  };

  const onResultKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-result]");
    const next = buttons?.[Math.max(0, Math.min((buttons?.length ?? 1) - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  };

  const failedStep = model.failure?.step ?? null;
  const running = model.state === "queued" || model.state === "running";

  return (
    <div className="relative" style={{ height: L.height }}>
      <svg width={L.width} height={L.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
        {L.gates.map((g, s) => {
          const span = gateSpan(s);
          const a = L.xy(g, span.from);
          const b = L.xy(g, Math.max(span.to, executed ? L.poolEnd : span.to));
          const failed = failedStep !== null && s === failedStep;
          return <line key={`gate-${s}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={failed ? "#b4321f" : INK} strokeOpacity={failed ? 0.9 : 0.12} strokeWidth={failed ? 2 : 1} strokeDasharray={failed ? undefined : "2 6"} />;
        })}

        {tributaryPaths()}

        {L.bands.map((band) => {
          const ds = paths(band);
          if (band.kind === "channel") {
            return (
              <g key={band.key}>
                {ds.map((d, i) => (
                  <path key={i} d={d} fill={INK} fillOpacity={running ? 0.07 : 0.035} stroke={INK} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="5 6" className={running ? "river-pending" : undefined} />
                ))}
              </g>
            );
          }
          const fill = band.kind === "result" ? band.result!.color.fill : band.kind === "neutral" ? "#8f8778" : band.dropStep === activePool ? DROP_ACTIVE : DROP;
          return (
            <g
              key={band.key}
              className="transition-opacity duration-500 motion-reduce:transition-none"
              style={{ opacity: bandOpacity(band), cursor: band.kind === "result" || band.kind === "drop" ? "pointer" : undefined }}
              onClick={() => (band.kind === "result" ? onSelect(band.key === selectedKey ? null : band.key) : band.kind === "drop" ? onPool(band.dropStep!) : undefined)}
            >
              {ds.map((d, i) => (
                <path key={i} d={d} fill={fill} />
              ))}
            </g>
          );
        })}

        {relatedOverlay()}
        <g key={record ? JSON.stringify(record) : "none"}>{recordLine()}</g>

      </svg>

      <button
        type="button"
        onClick={() => onSource(model.source.alias)}
        className="group absolute text-left"
        style={L.orientation === "h" ? { left: L.sourceBox.x, top: L.sourceBox.y, width: L.sourceBox.w, textAlign: "right" } : { left: L.sourceBox.x, top: L.sourceBox.y, width: L.sourceBox.w }}
      >
        <span className="numerals block text-[40px] leading-none font-bold tracking-[-0.02em]" style={{ fontStretch: "76%" }}>
          {formatCount(model.source.rows)}
        </span>
        <span className="mt-1 block text-[15px] leading-snug text-ink-2 group-hover:underline">registros de {model.source.name.toLowerCase()}</span>
      </button>

      {model.steps.map((step) => {
        const box = L.stepBoxes[step.position];
        if (!box) return null;
        const failed = failedStep === step.position;
        return (
          <div key={`step-${step.position}`} className="absolute" style={{ left: box.x, top: box.y, width: box.w }}>
            <p className="flex items-center gap-2 text-[15px] leading-tight font-bold" style={{ fontStretch: "82%" }}>
              <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[12.5px]" style={{ background: failed ? "#b4321f" : INK, color: "#f3efe6" }}>
                {step.position}
              </span>
              {step.title}
            </p>
            {!compact || orientation === "v" ? (
              <>
                <p className="mt-1.5 text-[16px] leading-[1.42] text-ink">{step.headline}</p>
                <StepDetail text={step.detail} />
              </>
            ) : (
              <p className="sr-only">{step.headline}</p>
            )}
          </div>
        );
      })}

      {L.tributary && (() => {
        const t = L.tributary;
        const step = model.steps.find((s) => s.position === t.step);
        const lookup = step?.lookup;
        if (!lookup) return null;
        const confirmed = lookup.status === "confirmed";
        return (
          <div className="absolute flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ left: t.labelBox.x, top: t.labelBox.y, width: t.labelBox.w }}>
            <button type="button" onClick={() => lookup.relationshipId && onRelationship(lookup.relationshipId)} className="text-left text-[15px] leading-tight font-semibold hover:underline">
              + {lookup.rows === null ? "" : formatCount(lookup.rows)} registros de {lookup.name.toLowerCase()}
            </button>
            {!confirmed && (
              <button
                type="button"
                onClick={() => lookup.relationshipId && onRelationship(lookup.relationshipId)}
                className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
                style={{ background: "#f6e8c6", color: "#7a5300" }}
              >
                {lookup.status === "rejected" ? "relacionamento rejeitado" : "relacionamento sugerido · examinar"}
              </button>
            )}
            {executed && lookup.unreferenced > 0 && (
              <button type="button" onClick={() => onUnreferenced(t.step)} className="text-left text-[14px] leading-tight hover:underline" style={{ color: PLUM }}>
                {plural(lookup.unreferenced, "sem par em", "sem par em")} {model.source.name.toLowerCase()}
              </button>
            )}
          </div>
        );
      })()}

      {executed &&
        model.steps
          .filter((s) => s.excluded > 0 && L.poolBoxes[s.position])
          .map((step) => {
            const box = L.poolBoxes[step.position];
            const active = activePool === step.position;
            const related = selectedBand?.result?.related[step.position];
            return (
              <button
                key={`pool-${step.position}`}
                type="button"
                onClick={() => onPool(step.position)}
                aria-pressed={active}
                aria-label={`${formatCount(step.excluded)} registros saíram no passo ${step.position}: ${step.drops.map((d) => `${d.count} ${d.label}`).join("; ")}`}
                className={`group absolute rounded-[3px] text-left transition-opacity duration-300 ${dimmed && !active && !related ? "opacity-60" : ""}`}
                style={{ left: box.x - 6, top: box.y - 4, width: box.w, padding: "4px 6px", background: active ? "rgba(17,17,16,.06)" : undefined }}
              >
                <span className="flex items-baseline gap-2">
                  <span className="numerals leading-none font-bold" style={{ fontSize: compact && orientation === "h" ? 26 : 40, fontStretch: "76%", color: "#4f473a" }}>
                    −{formatCount(step.excluded)}
                  </span>
                  <span className="text-[14px] text-ink-2">registros</span>
                </span>
                {step.drops.map((drop) => (
                  <span key={drop.code} className="mt-0.5 block leading-snug text-ink group-hover:underline" style={{ fontSize: compact && orientation === "h" ? 14 : 16 }}>
                    <span className="numerals font-semibold">{formatCount(drop.count)}</span> {drop.label}
                  </span>
                ))}
                {related ? (
                  <span className="mt-0.5 block text-[15px] font-semibold" style={{ color: selectedBand!.result!.color.text }}>
                    {formatCount(related)} de {selectedBand!.result!.label}
                  </span>
                ) : null}
              </button>
            );
          })}

      {executed ? (
        <div role="group" aria-label="Resultados">
          {resultBands.map((band, index) => {
            const result = band.result!;
            const box = L.resultBoxes[band.key];
            if (!box) return null;
            const active = selectedKey === band.key;
            const faded = dimmed && !active && recordBandKey !== band.key;
            const small = compact && orientation === "h";
            return (
              <button
                key={band.key}
                type="button"
                data-result
                aria-pressed={active}
                onClick={() => onSelect(active ? null : band.key)}
                onKeyDown={(event) => onResultKey(event, index)}
                className="absolute flex items-center gap-3 rounded-[3px] text-left transition-opacity duration-300"
                style={{ left: box.x - 8, top: box.y, width: box.w + 8, height: box.h, padding: "0 8px", opacity: faded ? 0.38 : 1, background: active ? result.color.soft : undefined }}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block leading-[1.12] font-semibold ${small ? "truncate" : ""}`} style={{ fontSize: small ? 16 : 19 }} title={result.label}>
                    {result.label}
                  </span>
                  <span className="block text-ink-2" style={{ fontSize: small ? 13 : 15 }}>
                    {plural(result.records, "registro", "registros")}
                  </span>
                </span>
                <span className="text-right">
                  <span className="numerals block leading-none font-bold tracking-[-0.02em]" style={{ fontSize: small ? 30 : 48, fontStretch: "74%", color: result.color.text }}>
                    {result.sum === null ? "—" : formatMeasure(result.sum)}
                  </span>
                  {!small && model.measure && <span className="block text-[13px] text-ink-2">{model.measure.caption}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="absolute" style={{ left: L.emptyResultsBox.x, top: L.emptyResultsBox.y, width: L.emptyResultsBox.w }}>
          <p className="text-[17px] leading-snug font-semibold">{running ? "Executando no Laravel…" : model.state === "failed" ? "A execução falhou" : "Os resultados aparecem aqui"}</p>
          <p className="mt-1 text-[15px] leading-snug text-ink-2">
            {running
              ? "As faixas ganham largura quando o motor terminar de registrar a linhagem."
              : model.state === "failed"
                ? `${model.failure?.step ? `Parou no passo ${model.failure.step}: ` : ""}${model.failure?.message ?? ""} Nada desta execução foi gravado.`
                : "Depois da execução, cada faixa terá a largura exata do número de registros."}
          </p>
        </div>
      )}
    </div>
  );
}

function StepDetail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-mono text-[12.5px] text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink">
        {open ? "ocultar regra técnica" : "regra técnica"}
      </button>
      {open && <p className="mt-1 font-mono text-[12.5px] leading-snug text-ink-2">{text}</p>}
    </div>
  );
}

function circleAt(L: RiverLayout, along: number, cross: number) {
  const { x, y } = L.xy(along, cross);
  return { cx: x, cy: y };
}
