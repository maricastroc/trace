import type { ComparisonExplanation, ComparisonSummary } from "@/lib/types";
import { proofOf } from "./reconciliation";
import type { Side } from "./spec";

export type Stage = 1 | 2 | 3 | 4;

export type GroupKey = "shared" | "rule" | ComparisonExplanation;

export type Cell = { side: Side; group: GroupKey; k: number; fill: number };

export type Point = { x: number; y: number };

export type Frame = { x: number; w: number };

export type Tray = { side: Side; group: ComparisonExplanation; count: number; cells: number; x: number; cols: number; width: number };

export type Shelf = { key: "a" | "possible" | "b"; x: number; end: number };

export type Scene = {
  unit: number;
  rows: number;
  width: number;
  height: number;
  gridBottom: number;
  trayY: number;
  cells: Cell[];
  positions: Record<Stage, Point[]>;
  frames: Record<Stage, { a: Frame; b: Frame }>;
  matched: { x: number; cols: number; restCols: number };
  trays: Tray[];
  shelves: Shelf[];
  stage1: { a: Frame; b: Frame };
};

export type Room = { a?: number; b?: number };

export const P = 11;
export const C = 9;
export const Y0 = 100;
const MAX_ROWS = 24;
const MIN_ROWS = 6;
const MARGIN = 40;
const MIN_WIDTH = 760;
const CELL_BUDGET = 1250;
const TRAY_ROWS = 7;
const TRAY_MIN = 150;
const GAP = 40;
const SHELF_GAP = 64;
const PANE_GAP = 88;

const ORDER: ComparisonExplanation[] = ["excluded_in_other", "outside_other_period", "possible_match", "ambiguous_match", "variant_of_matched", "absent"];

export const SHELF_ORDER: { key: Shelf["key"]; groups: { side: Side; group: ComparisonExplanation }[] }[] = [
  { key: "a", groups: ORDER.filter((e) => proofOf(e) === "proven").map((group) => ({ side: "a" as const, group })) },
  {
    key: "possible",
    groups: [
      ...ORDER.filter((e) => proofOf(e) === "possible").map((group) => ({ side: "a" as const, group })),
      ...ORDER.filter((e) => proofOf(e) === "possible").map((group) => ({ side: "b" as const, group })),
    ],
  },
  { key: "b", groups: ORDER.filter((e) => proofOf(e) === "proven").map((group) => ({ side: "b" as const, group })) },
];

type Counts = Pick<ComparisonSummary, "a" | "b" | "shared" | "shared_by_rule" | "only_a" | "only_b" | "explanations">;

export function unitFor(summary: Pick<ComparisonSummary, "a" | "b">) {
  return Math.max(1, Math.ceil(Math.max(summary.a.distinct, summary.b.distinct) / CELL_BUDGET));
}

function cellsOf(side: Side, group: GroupKey, count: number, unit: number): Cell[] {
  const n = Math.ceil(count / unit);
  return Array.from({ length: n }, (_, k) => ({ side, group, k, fill: k === n - 1 ? (count - k * unit) / unit : 1 }));
}

function shuffled(length: number, seed: number) {
  const order = Array.from({ length }, (_, i) => i);
  let state = seed >>> 0 || 1;
  for (let i = length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function countOf(summary: Counts, side: Side, group: GroupKey) {
  if (group === "shared") return summary.shared;
  if (group === "rule") return summary.shared_by_rule;
  return (side === "a" ? summary.explanations.only_a : summary.explanations.only_b)[group] ?? 0;
}

const LABEL_MAX = 34;

export function clip(text: string, max = LABEL_MAX) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function tabText(side: Side, label: string, rows: number, sources: boolean) {
  return `${side.toUpperCase()} · ${clip(label)} · identidades${sources ? ` de ${rows.toLocaleString("pt-BR")} linhas` : ""}`;
}

export function tabWidth(distinct: number, text: string) {
  return distinct.toLocaleString("pt-BR").length * 19 + 10 + text.length * 8.6;
}

export function rowsFor(cellsPerSide: number) {
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.ceil(Math.sqrt(cellsPerSide / 2))));
}

function shift(points: Point[], dx: number) {
  return points.map((point) => ({ x: point.x + dx, y: point.y }));
}

export function buildScene(summary: Counts, room: Room = {}): Scene {
  const unit = unitFor(summary);
  const cells: Cell[] = [];
  for (const side of ["a", "b"] as const) {
    cells.push(...cellsOf(side, "shared", summary.shared, unit), ...cellsOf(side, "rule", summary.shared_by_rule, unit));
    for (const group of ORDER) cells.push(...cellsOf(side, group, countOf(summary, side, group), unit));
  }

  const indices = (side: Side, test: (cell: Cell) => boolean) => cells.flatMap((cell, i) => (cell.side === side && test(cell) ? [i] : []));
  const matched = (cell: Cell) => cell.group === "shared" || cell.group === "rule";
  const aAll = indices("a", () => true);
  const bAll = indices("b", () => true);
  const rows = rowsFor(Math.max(aAll.length, bAll.length));
  const gridBottom = Y0 + rows * P;
  const aCols = Math.ceil(aAll.length / rows);
  const bCols = Math.ceil(bAll.length / rows);
  const b1x = Math.max(aCols * P + PANE_GAP, (room.a ?? 0) + 24);
  const grid = (x0: number, k: number): Point => ({ x: x0 + Math.floor(k / rows) * P, y: Y0 + (k % rows) * P });

  const s1: Point[] = new Array(cells.length);
  shuffled(aAll.length, summary.a.distinct * 31 + summary.only_a).forEach((slot, j) => (s1[aAll[j]] = grid(0, slot)));
  shuffled(bAll.length, summary.b.distinct * 17 + summary.only_b).forEach((slot, j) => (s1[bAll[j]] = grid(b1x, slot)));
  const extent1 = Math.max(b1x + bCols * P, b1x + (room.b ?? 0));

  const aMatched = indices("a", matched);
  const bMatched = indices("b", matched);
  const aRest = indices("a", (cell) => !matched(cell));
  const bRest = indices("b", (cell) => !matched(cell));
  const matchedCols = Math.ceil(aMatched.length / rows);
  const aRestCols = Math.ceil(aRest.length / rows);
  const bRestCols = Math.ceil(bRest.length / rows);
  const trayY = matchedCols === 0 ? Y0 + 108 : gridBottom + 122;
  const x0 = aRestCols * P + (matchedCols === 0 && aRestCols > 0 && bRestCols > 0 ? 3 * P : 0);
  const s2: Point[] = new Array(cells.length);
  aMatched.forEach((i, k) => (s2[i] = grid(x0, k)));
  bMatched.forEach((i, k) => (s2[i] = grid(x0, k)));
  aRest.forEach((i, j) => (s2[i] = { x: x0 - (1 + Math.floor(j / rows)) * P - (matchedCols === 0 && bRestCols > 0 ? 3 * P : 0), y: Y0 + (j % rows) * P }));
  bRest.forEach((i, j) => (s2[i] = grid(x0, matchedCols * rows + j)));
  const blockEnd = x0 + (matchedCols + bRestCols) * P;
  const later = {
    a: { x: x0 - aRestCols * P - (matchedCols === 0 && bRestCols > 0 ? 3 * P : 0), w: aRestCols * P + matchedCols * P + (matchedCols === 0 && bRestCols > 0 ? 3 * P : 0) },
    b: { x: x0, w: (matchedCols + bRestCols) * P },
  };

  const trays: Tray[] = [];
  const shelves: Shelf[] = [];
  let x = 0;
  let trayRows = 0;
  for (const shelf of SHELF_ORDER) {
    const live = shelf.groups.filter(({ side, group }) => countOf(summary, side, group) > 0);
    if (live.length === 0) continue;
    const start = x;
    for (const { side, group } of live) {
      const count = countOf(summary, side, group);
      const n = Math.ceil(count / unit);
      const cols = Math.max(3, Math.ceil(n / Math.min(rows, Math.max(TRAY_ROWS, Math.ceil(Math.sqrt(n / 3))))));
      const width = Math.max(cols * P, TRAY_MIN);
      trayRows = Math.max(trayRows, Math.ceil(n / cols));
      trays.push({ side, group, count, cells: n, x, cols, width });
      x += width + GAP;
    }
    shelves.push({ key: shelf.key, x: start, end: x - GAP });
    x += SHELF_GAP - GAP;
  }
  const trayExtent = trays.length ? x - SHELF_GAP : 0;

  const content2 = Math.max(blockEnd, room.a ?? 0, room.b ?? 0);
  const width = Math.max(MIN_WIDTH, extent1 + 2 * MARGIN, content2 + 2 * MARGIN, trayExtent + 2 * MARGIN);
  const offset1 = Math.round((width - extent1) / 2);
  const offset2 = Math.round((width - blockEnd) / 2);
  const offsetTrays = Math.round((width - trayExtent) / 2);

  const p1 = shift(s1, offset1);
  const p2 = shift(s2, offset2);
  for (const tray of trays) tray.x += offsetTrays;
  for (const shelf of shelves) {
    shelf.x += offsetTrays;
    shelf.end += offsetTrays;
  }
  const p3: Point[] = p2.slice();
  for (const tray of trays) {
    indices(tray.side, (cell) => cell.group === tray.group).forEach((i, j) => (p3[i] = { x: tray.x + (j % tray.cols) * P, y: trayY + Math.floor(j / tray.cols) * P }));
  }

  const stage1 = { a: { x: offset1, w: aCols * P }, b: { x: b1x + offset1, w: bCols * P } };
  const frames2 = { a: { x: later.a.x + offset2, w: later.a.w }, b: { x: later.b.x + offset2, w: later.b.w } };
  const frames3 = { a: { x: x0 + offset2, w: matchedCols * P }, b: { x: x0 + offset2, w: matchedCols * P } };
  const height = trays.length ? Math.max(gridBottom + 84, trayY + trayRows * P + 28) : gridBottom + 84;

  return {
    unit,
    rows,
    width,
    height,
    gridBottom,
    trayY,
    cells,
    positions: { 1: p1, 2: p2, 3: p3, 4: p3 },
    frames: { 1: stage1, 2: frames2, 3: frames3, 4: frames3 },
    matched: { x: x0 + offset2, cols: matchedCols, restCols: bRestCols },
    trays,
    shelves,
    stage1,
  };
}

export function cellsIn(scene: Scene, side: Side, group: GroupKey) {
  return scene.cells.filter((cell) => cell.side === side && cell.group === group).length;
}
