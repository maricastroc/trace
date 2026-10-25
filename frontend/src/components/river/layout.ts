import type { RiverModel, RiverResult } from "./model";

export type Orientation = "h" | "v";

export type BandGeo = {
  key: string;
  kind: "result" | "drop" | "neutral" | "channel";
  result?: RiverResult;
  dropStep?: number;
  tops: number[];
  heights: number[];
};

export type Box = { x: number; y: number; w: number; h?: number };

export type RiverLayout = {
  orientation: Orientation;
  width: number;
  height: number;
  scale: number;
  gates: number[];
  bands: BandGeo[];
  stepBoxes: Record<number, Box>;
  poolAlong: Record<number, number>;
  poolBoxes: Record<number, Box>;
  poolEnd: number;
  resultBoxes: Record<string, Box & { anchor: number }>;
  fanTargets: Record<string, { along: number; cross: number }>;
  sourceBox: Box;
  tributary: null | {
    step: number;
    node: { along: number; cross: number };
    entry: { along: number; cross: number };
    width: number;
    unreferencedWidth: number;
    labelBox: Box;
    endAlong: number;
  };
  emptyResultsBox: Box;
  point: (along: number, cross: number) => string;
  xy: (along: number, cross: number) => { x: number; y: number };
};

const CHAR = 0.52;

function lines(text: string, width: number, font: number) {
  return Math.max(1, Math.ceil((text.length * font * CHAR) / Math.max(width, 40)));
}

export function layoutRiver(model: RiverModel, width: number, orientation: Orientation, compact: boolean): RiverLayout {
  const point = orientation === "h" ? (a: number, c: number) => `${a.toFixed(1)} ${c.toFixed(1)}` : (a: number, c: number) => `${c.toFixed(1)} ${a.toFixed(1)}`;
  const xy = orientation === "h" ? (a: number, c: number) => ({ x: a, y: c }) : (a: number, c: number) => ({ x: c, y: a });
  const stages = Math.max(model.lastStage, 1);
  const executed = model.state === "succeeded";
  const steps = model.steps.filter((s) => s.position <= model.lastStage);
  const aggregate = model.steps.find((s) => s.type === "aggregate") ?? null;

  const bands: BandGeo[] = [];
  const records: number[][] = [];

  if (!executed) {
    bands.push({ key: "channel", kind: "channel", tops: [], heights: [] });
    records.push(Array.from({ length: stages + 1 }, () => model.source.rows ?? 1));
  } else {
    const joinStage = model.joinStage ?? 0;
    if (model.multiplied && model.baseContributors) {
      bands.push({ key: "neutral", kind: "neutral", tops: [], heights: [] });
      records.push(Array.from({ length: stages + 1 }, (_, s) => (s < joinStage ? model.baseContributors! : 0)));
    }
    for (const result of model.results) {
      bands.push({ key: result.key, kind: "result", result, tops: [], heights: [] });
      records.push(Array.from({ length: stages + 1 }, (_, s) => (model.multiplied && s < joinStage ? 0 : s === 0 ? result.base : (result.trace[s] ?? 0))));
    }
    for (const step of [...steps].reverse()) {
      if (!step.excluded) continue;
      bands.push({ key: `d-${step.position}`, kind: "drop", dropStep: step.position, tops: [], heights: [] });
      records.push(Array.from({ length: stages + 1 }, (_, s) => (s < step.position ? step.excluded : 0)));
    }
  }

  const stackRecords = Array.from({ length: stages + 1 }, (_, s) => records.reduce((acc, r) => acc + r[s], 0));
  const maxStack = Math.max(...stackRecords, model.source.rows ?? 1, 1);
  const gap = 4;
  const groupGap = 10;

  let height = 0;
  let gates: number[] = [];
  let scale = 1;
  let center = 0;
  const stepBoxes: Record<number, Box> = {};
  const poolAlong: Record<number, number> = {};
  const poolBoxes: Record<number, Box> = {};
  const resultBoxes: Record<string, Box & { anchor: number }> = {};
  const fanTargets: Record<string, { along: number; cross: number }> = {};
  let sourceBox: Box;
  let poolEnd = 0;
  let tributary: RiverLayout["tributary"] = null;
  let emptyResultsBox: Box;

  const stack = (crossCenter: number) => {
    for (let s = 0; s <= stages; s++) {
      const visible = bands.map((b, i) => ({ b, i })).filter(({ i }) => records[i][s] > 0);
      const hasDrop = visible.some(({ b }) => b.kind === "drop");
      const hasOther = visible.some(({ b }) => b.kind !== "drop");
      const total = visible.reduce((acc, { i }) => acc + records[i][s] * scale, 0) + gap * Math.max(visible.length - 1, 0) + (hasDrop && hasOther ? groupGap : 0);
      let cursor = crossCenter - total / 2;
      bands.forEach((band, i) => {
        const prev = bands[i - 1];
        if (band.kind === "drop" && prev && prev.kind !== "drop" && records[i][s] > 0 && hasOther) cursor += groupGap;
        band.tops[s] = cursor;
        band.heights[s] = records[i][s] * scale;
        if (records[i][s] > 0) cursor += records[i][s] * scale + gap;
      });
    }
  };

  const resultBands = bands.filter((b) => b.kind === "result");

  if (orientation === "h") {
    const narrow = width < 1180;
    const sourceW = compact || narrow ? 112 : 150;
    const resultsW = compact ? 250 : narrow ? 262 : 300;
    const fanW = compact ? 64 : narrow ? 72 : 104;
    const a0 = sourceW;
    const fanEnd = width - resultsW;
    const aLast = Math.max(fanEnd - fanW, a0 + 120);
    gates = Array.from({ length: stages + 1 }, (_, s) => a0 + ((aLast - a0) * s) / stages);
    const segL = (aLast - a0) / stages;
    const labelW = segL - 22;
    const aggW = width - aLast - 20;

    const headlineH = (text: string, w: number) => 32 + lines(text, w, 16) * 23 + 34;
    const labelsLane = compact
      ? 36
      : Math.max(
          ...steps.map((s) => headlineH(s.headline, labelW)),
          aggregate ? headlineH(aggregate.headline, aggW) : 0,
          60,
        );
    const tribLane = model.joinStage !== null && model.joinStage <= model.lastStage ? (compact ? 40 : 78) : 0;
    const riverTop = labelsLane + tribLane + 16;
    const riverH = compact ? 160 : 262;
    scale = riverH / maxStack;
    center = riverTop + riverH / 2;
    stack(center);

    const stackBottom = Math.max(...bands.flatMap((b) => b.tops.map((t, s) => t + b.heights[s])), center + riverH / 2);
    poolEnd = stackBottom + (compact ? 22 : 46);
    const poolW = Math.max(segL - 12, 150);
    const poolTextH = (step: (typeof steps)[number]) =>
      (compact ? 30 : 46) + step.drops.reduce((acc, d) => acc + lines(`${d.count} ${d.label}`, poolW, compact ? 14 : 16) * (compact ? 18 : 22), 0);
    const poolLane = Math.max(0, ...steps.filter((s) => s.excluded > 0).map(poolTextH));

    for (const step of steps) {
      const p = step.position;
      stepBoxes[p] = { x: gates[p - 1] + 12, y: 0, w: labelW };
      const h = step.excluded * scale;
      poolAlong[p] = (gates[p - 1] + gates[p]) / 2 - h / 2;
      poolBoxes[p] = { x: Math.max(poolAlong[p], gates[p - 1] + 6), y: poolEnd + 10, w: poolW };
    }
    if (aggregate) stepBoxes[aggregate.position] = { x: aLast + 12, y: 0, w: aggW };

    const slotH = compact ? 50 : 90;
    const count = resultBands.length;
    const slotTop = center - (count * slotH) / 2;
    resultBands.forEach((band, i) => {
      const slotCenter = slotTop + slotH * (i + 0.5);
      const h = band.heights[stages];
      fanTargets[band.key] = { along: fanEnd, cross: slotCenter - h / 2 };
      resultBoxes[band.key] = { x: fanEnd + 14, y: slotTop + slotH * i, w: resultsW - 22, h: slotH, anchor: fanEnd + resultsW / 2 };
    });

    sourceBox = { x: 0, y: center - 30, w: sourceW - 22 };
    emptyResultsBox = { x: fanEnd - 40, y: center - 50, w: resultsW + 20 };

    if (tribLane > 0 && model.joinStage !== null) {
      const j = model.joinStage;
      const step = model.steps.find((s) => s.position === j)!;
      const rows = step.lookup?.rows ?? 0;
      const unref = executed ? step.lookup?.unreferenced ?? 0 : 0;
      const firstTop = Math.min(...bands.map((b) => b.tops[j - 1]));
      tributary = {
        step: j,
        node: { along: gates[j - 1] + 26, cross: labelsLane + (compact ? 26 : 54) },
        entry: { along: gates[j] - 4, cross: firstTop },
        width: Math.max(3, (executed ? rows - unref - (step.lookup?.nullKey ?? 0) : rows) * scale),
        unreferencedWidth: unref > 0 ? Math.max(2.5, unref * scale) : 0,
        labelBox: { x: gates[j - 1] + 18, y: labelsLane + (compact ? 0 : 4), w: Math.max(segL * 2, 300) },
        endAlong: gates[j] + 18,
      };
    }

    const resultsBottom = slotTop + count * slotH;
    height = Math.max(poolEnd + 10 + poolLane, resultsBottom + 10, center + riverH / 2 + 40);
  } else {
    const left = 16;
    const riverCross = Math.min(width * 0.4, 220);
    const colX = left + riverCross + 20;
    const colW = Math.max(width - colX - 12, 120);
    scale = riverCross / maxStack;
    center = left + riverCross / 2;
    const font = 16;
    const charLines = (text: string, w: number, size: number) => Math.max(1, Math.ceil((text.length * size * 0.56) / Math.max(w, 40)));

    sourceBox = { x: left, y: 0, w: width - 32 };
    const a0 = 76;
    gates = [a0];
    for (const step of steps) {
      const labelH = 30 + charLines(step.headline, colW, font) * 23 + 30;
      const tribH = step.lookup
        ? 14 + charLines(`+ ${step.lookup.rows ?? ""} registros de ${step.lookup.name}`, colW - 18, 15) * 21 + (executed && step.lookup.unreferenced > 0 ? charLines(`${step.lookup.unreferenced} sem par em ${model.source.name}`, colW - 18, 14) * 20 : 0) + (step.lookup.status !== "confirmed" && !executed ? 30 : 0)
        : 0;
      const fallH = step.excluded * scale;
      const poolH = step.excluded > 0 ? 44 + step.drops.reduce((acc, d) => acc + charLines(`${d.count} ${d.label}`, colW, 16) * 23, 0) : 0;
      const start = gates[gates.length - 1];
      stepBoxes[step.position] = { x: colX, y: start + 8, w: colW };
      const fallAlong = start + 8 + labelH + tribH + 10;
      poolAlong[step.position] = fallAlong;
      poolBoxes[step.position] = { x: colX, y: fallAlong + Math.max(fallH, 0) + 8, w: colW };
      gates.push(start + Math.max(labelH + tribH + 26 + fallH + poolH + 24, 120));
    }
    poolEnd = colX - 8;
    stack(center);

    const aLast = gates[gates.length - 1];
    if (aggregate) stepBoxes[aggregate.position] = { x: colX, y: aLast + 10, w: colW };
    const aggH = aggregate ? 30 + charLines(aggregate.headline, colW, font) * 23 + 30 : 0;
    const rowsTop = aLast + aggH + 40;
    const rowH = 96;
    let lane = left;
    const laneEnd = left + resultBands.reduce((acc, b) => acc + b.heights[stages] + 6, 0);
    const textX = Math.min(laneEnd + 14, width * 0.42);
    resultBands.forEach((band, i) => {
      const along = rowsTop + i * rowH + 26;
      fanTargets[band.key] = { along, cross: lane };
      resultBoxes[band.key] = { x: textX, y: rowsTop + i * rowH, w: width - textX - 12, h: rowH - 8, anchor: textX + 40 };
      lane += band.heights[stages] + 6;
    });
    emptyResultsBox = { x: left, y: rowsTop, w: width - 32 };

    if (model.joinStage !== null && model.joinStage <= model.lastStage) {
      const j = model.joinStage;
      const step = model.steps.find((s) => s.position === j)!;
      const rows = step.lookup?.rows ?? 0;
      const unref = executed ? step.lookup?.unreferenced ?? 0 : 0;
      const labelH = 30 + charLines(step.headline, colW, font) * 23 + 30;
      const rowAlong = gates[j - 1] + 8 + labelH + 6;
      const rightEdge = Math.max(...bands.map((b) => b.tops[j - 1] + b.heights[j - 1]));
      tributary = {
        step: j,
        node: { along: rowAlong + 18, cross: colX + 6 },
        entry: { along: gates[j] - 6, cross: rightEdge },
        width: Math.max(3, (executed ? rows - unref - (step.lookup?.nullKey ?? 0) : rows) * scale),
        unreferencedWidth: 0,
        labelBox: { x: colX + 18, y: rowAlong + 4, w: colW - 18 },
        endAlong: rowAlong + 18,
      };
    }

    height = rowsTop + Math.max(resultBands.length, 1) * rowH + 24;
  }

  return {
    orientation,
    width,
    height,
    scale,
    gates,
    bands,
    stepBoxes,
    poolAlong,
    poolBoxes,
    poolEnd,
    resultBoxes,
    fanTargets,
    sourceBox: sourceBox!,
    tributary,
    emptyResultsBox: emptyResultsBox!,
    point,
    xy,
  };
}

export function ribbonPath(L: RiverLayout, a1: number, c1: number, h1: number, a2: number, c2: number, h2: number) {
  const am = (a1 + a2) / 2;
  const P = L.point;
  return `M ${P(a1, c1)} C ${P(am, c1)}, ${P(am, c2)}, ${P(a2, c2)} L ${P(a2, c2 + h2)} C ${P(am, c2 + h2)}, ${P(am, c1 + h1)}, ${P(a1, c1 + h1)} Z`;
}

export function fallPath(L: RiverLayout, a1: number, c: number, h: number, aPool: number) {
  const P = L.point;
  const r = 14;
  const end = L.poolEnd;
  return `M ${P(a1, c)} L ${P(aPool - r, c)} Q ${P(aPool + h, c)} ${P(aPool + h, c + h + r)} L ${P(aPool + h, end)} L ${P(aPool, end)} L ${P(aPool, c + h + r)} Q ${P(aPool, c + h)} ${P(aPool - r, c + h)} L ${P(a1, c + h)} Z`;
}

export function centerLine(L: RiverLayout, a1: number, c1: number, a2: number, c2: number) {
  const am = (a1 + a2) / 2;
  const P = L.point;
  return `M ${P(a1, c1)} C ${P(am, c1)}, ${P(am, c2)}, ${P(a2, c2)}`;
}

export function fallCenterLine(L: RiverLayout, a1: number, c: number, h: number, aPool: number) {
  const P = L.point;
  const mid = aPool + h / 2;
  return `M ${P(a1, c + h / 2)} L ${P(mid - 14, c + h / 2)} Q ${P(mid, c + h / 2)} ${P(mid, c + h / 2 + 14)} L ${P(mid, L.poolEnd)}`;
}
