import type { Relationship } from "@/lib/types";
import type { MapColumn, MapModel, MapTable } from "./graph";

export const CARD_W = 360;
export const COL_GAP = 170;
export const ROW_GAP = 64;
export const FIELD_H = 46;
export const MORE_H = 38;
export const LIST_PAD_TOP = 6;
export const LIST_PAD_BOTTOM = 10;
export const HEAD_H = { detail: 104, overview: 176 } as const;

export type Lod = keyof typeof HEAD_H;
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Curve = { p0: Point; c1: Point; c2: Point; p1: Point };

export type SheetView = {
  columns: MapColumn[];
  hidden: number;
  showMore: boolean;
  showLess: boolean;
};

export const ALL_FIELDS_LIMIT = { total: 24, perTable: 8 } as const;

export function showsAllFields(tables: MapTable[]) {
  const total = tables.reduce((sum, t) => sum + t.columns.length, 0);
  return total <= ALL_FIELDS_LIMIT.total && tables.every((t) => t.columns.length <= ALL_FIELDS_LIMIT.perTable);
}

export function showsVolumeRuler(tables: MapTable[], spread = 100) {
  if (tables.length < 2) return false;
  const rows = tables.map((t) => Math.max(1, t.rows));
  return Math.max(...rows) / Math.min(...rows) >= spread;
}

export function sheetView(table: MapTable, lod: Lod, expanded: boolean, allFields = false): SheetView {
  if (allFields && (lod === "detail" || expanded)) return { columns: table.columns, hidden: 0, showMore: false, showLess: false };
  if (expanded) return { columns: table.columns, hidden: 0, showMore: false, showLess: true };
  if (lod === "overview") return { columns: [], hidden: table.columns.length, showMore: false, showLess: false };
  const columns = table.columns.filter((c) => c.relevant);
  const hidden = table.columns.length - columns.length;
  return { columns, hidden, showMore: hidden > 0, showLess: false };
}

export function sheetHeight(view: SheetView, lod: Lod) {
  const buttons = (view.showMore ? 1 : 0) + (view.showLess ? 1 : 0);
  if (view.columns.length === 0 && buttons === 0) return HEAD_H[lod];
  return HEAD_H[lod] + LIST_PAD_TOP + view.columns.length * FIELD_H + buttons * MORE_H + LIST_PAD_BOTTOM;
}

export function fieldCenter(view: SheetView, lod: Lod, column: string) {
  const index = view.columns.findIndex((c) => c.key === column);
  if (index < 0) return null;
  return HEAD_H[lod] + LIST_PAD_TOP + index * FIELD_H + FIELD_H / 2;
}

export const MAX_STACK_HEIGHT = 640;

export type MapLayout = { positions: Record<string, Point>; allFields: boolean };

function columnsByDepth(model: MapModel) {
  const edges = model.relations.filter((r) => r.from.dataset_key !== r.to.dataset_key);
  const memo = new Map<string, number>();
  const depth = (table: string, stack: Set<string>): number => {
    const known = memo.get(table);
    if (known !== undefined) return known;
    if (stack.has(table)) return 0;
    stack.add(table);
    let d = 0;
    for (const r of edges) if (r.from.dataset_key === table) d = Math.max(d, 1 + depth(r.to.dataset_key, stack));
    stack.delete(table);
    memo.set(table, d);
    return d;
  };
  const columns: MapTable[][] = [];
  for (const table of model.tables) (columns[depth(table.key, new Set())] ??= []).push(table);
  for (const column of columns) column?.sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
  return columns;
}

function stackHeight(column: MapTable[], allFields: boolean) {
  return column.reduce((sum, table) => sum + sheetHeight(sheetView(table, "detail", false, allFields), "detail"), 0) + ROW_GAP * (column.length - 1);
}

export function computeLayout(model: MapModel): MapLayout {
  const columns = columnsByDepth(model);
  const allFields = showsAllFields(model.tables) && columns.every((column) => !column || stackHeight(column, true) <= MAX_STACK_HEIGHT);
  const positions: Record<string, Point> = {};
  let x = 0;
  columns.forEach((column, index) => {
    if (!column) return;
    let y = 0;
    for (const table of column) {
      positions[table.key] = { x, y };
      y += sheetHeight(sheetView(table, "detail", false, allFields), "detail") + ROW_GAP;
    }
    if (column.length === 1) positions[column[0].key].y += index % 2 === 1 ? -56 : 24;
    x += CARD_W + COL_GAP;
  });
  return { positions, allFields };
}

export function curvePath({ p0, c1, c2, p1 }: Curve) {
  return `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`;
}

export function pointOnCurve({ p0, c1, c2, p1 }: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

export function routeBetween(p0: Point, p1: Point, dir: number, avoid: Rect[]): Curve {
  const mx = (p0.x + p1.x) / 2;
  const straight: Curve = { p0, c1: { x: mx, y: p0.y }, c2: { x: mx, y: p1.y }, p1 };
  const lo = Math.min(p0.x, p1.x) + 10;
  const hi = Math.max(p0.x, p1.x) - 10;
  const candidates = avoid.filter((r) => r.x < hi && r.x + r.w > lo);
  const samples = Array.from({ length: 19 }, (_, i) => pointOnCurve(straight, (i + 1) / 20));
  const blocked = candidates.filter((r) => samples.some((q) => q.x > r.x - 8 && q.x < r.x + r.w + 8 && q.y > r.y - 8 && q.y < r.y + r.h + 8));
  if (!blocked.length) return straight;
  const bottom = Math.max(...blocked.map((r) => r.y + r.h));
  const top = Math.min(...blocked.map((r) => r.y));
  const average = (p0.y + p1.y) / 2;
  const below = bottom + 80 - average;
  const above = average - (top - 80);
  const target = below <= above ? (bottom + 56 - 0.25 * average) / 0.75 : (top - 56 - 0.25 * average) / 0.75;
  return { p0, c1: { x: p0.x + dir * 160, y: target }, c2: { x: p1.x - dir * 160, y: target }, p1 };
}

export type SheetGeometry = { rect: Rect; view: SheetView; lod: Lod };

function port(sheet: SheetGeometry, column: string, side: "left" | "right"): Point {
  const x = sheet.rect.x + (side === "right" ? sheet.rect.w : 0);
  const center = fieldCenter(sheet.view, sheet.lod, column);
  return { x, y: sheet.rect.y + (center ?? Math.min(64, sheet.rect.h / 2)) };
}

export type LinkGeometry = { curve: Curve; dir: 1 | -1; loop: boolean };

export function linkGeometry(relation: Relationship, sheets: Record<string, SheetGeometry>, relations: Relationship[]): LinkGeometry | null {
  const a = sheets[relation.from.dataset_key];
  const b = sheets[relation.to.dataset_key];
  if (!a || !b) return null;
  const avoid = Object.entries(sheets)
    .filter(([key]) => key !== relation.from.dataset_key && key !== relation.to.dataset_key)
    .map(([, sheet]) => sheet.rect);

  const c0 = a.rect.x + a.rect.w / 2;
  const c1 = b.rect.x + b.rect.w / 2;
  if (a === b || Math.abs(c0 - c1) < CARD_W * 0.8) {
    const p0 = port(a, relation.from.column, "right");
    const p1 = port(b, relation.to.column, "right");
    const bulge = a === b ? 120 : 150;
    return { curve: { p0, c1: { x: p0.x + bulge, y: p0.y }, c2: { x: p1.x + bulge, y: p1.y }, p1 }, dir: 1, loop: true };
  }

  const fromSide = c0 > c1 ? "left" : "right";
  const toSide = c0 > c1 ? "right" : "left";
  const p0 = port(a, relation.from.column, fromSide);
  const p1 = port(b, relation.to.column, toSide);
  const incoming = relations.filter((x) => x.to.dataset_key === relation.to.dataset_key && x.to.column === relation.to.column);
  if (incoming.length > 1) p1.y += (incoming.indexOf(relation) - (incoming.length - 1) / 2) * 12;
  const dir = fromSide === "left" ? -1 : 1;
  return { curve: routeBetween(p0, p1, dir, avoid), dir, loop: false };
}

export function placeMarks(links: { id: string; curve: Curve }[], spacing = 60): Record<string, Point> {
  const taken: Point[] = [];
  const marks: Record<string, Point> = {};
  for (const link of links) {
    let chosen: Point | null = null;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
      const q = pointOnCurve(link.curve, t);
      if (taken.every((p) => Math.hypot(p.x - q.x, p.y - q.y) > spacing)) {
        chosen = q;
        break;
      }
    }
    chosen ??= pointOnCurve(link.curve, 0.5);
    taken.push(chosen);
    marks[link.id] = chosen;
  }
  return marks;
}

export function boundsOf(rects: Rect[]): Rect | null {
  const valid = rects.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.w));
  if (!valid.length) return null;
  const x0 = Math.min(...valid.map((r) => r.x));
  const y0 = Math.min(...valid.map((r) => r.y));
  const x1 = Math.max(...valid.map((r) => r.x + r.w));
  const y1 = Math.max(...valid.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type Camera = { s: number; tx: number; ty: number };

export const MIN_SCALE = 0.22;
export const MAX_SCALE = 1.6;

export function lodFor(scale: number): Lod {
  return scale < 0.5 ? "overview" : "detail";
}


export type Area = { x: number; y: number; w: number; h: number };

export function toScreen(rect: Rect, camera: Camera): Rect {
  return { x: rect.x * camera.s + camera.tx, y: rect.y * camera.s + camera.ty, w: rect.w * camera.s, h: rect.h * camera.s };
}

function insideArea(area: Area, rect: Rect) {
  return rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h;
}

function panInto(camera: Camera, bounds: Rect, area: Area): Camera | null {
  const r = toScreen(bounds, camera);
  if (r.w > area.w || r.h > area.h) return null;
  const dx = r.x < area.x ? area.x - r.x : r.x + r.w > area.x + area.w ? area.x + area.w - (r.x + r.w) : 0;
  const dy = r.y < area.y ? area.y - r.y : r.y + r.h > area.y + area.h ? area.y + area.h - (r.y + r.h) : 0;
  return { s: camera.s, tx: camera.tx + dx, ty: camera.ty + dy };
}

export function fitInto(bounds: Rect, area: Area, maxScale: number): Camera {
  const s = clampScale(Math.min(maxScale, area.w / Math.max(1, bounds.w), area.h / Math.max(1, bounds.h)));
  return { s, tx: area.x + (area.w - bounds.w * s) / 2 - bounds.x * s, ty: area.y + (area.h - bounds.h * s) / 2 - bounds.y * s };
}

export const COMFORT_SCALE = 0.8;

function anchorAt(bounds: Rect, area: Area, s: number): Camera {
  const fitsX = bounds.w * s <= area.w;
  const fitsY = bounds.h * s <= area.h;
  return {
    s,
    tx: fitsX ? area.x + (area.w - bounds.w * s) / 2 - bounds.x * s : area.x - bounds.x * s,
    ty: fitsY ? area.y + (area.h - bounds.h * s) / 2 - bounds.y * s : area.y - bounds.y * s,
  };
}

export function frameCamera(current: Camera, primary: Rect[], context: Rect[], area: Area, comfort = COMFORT_SCALE): Camera | null {
  const target = boundsOf(primary);
  if (!target || area.w <= 0 || area.h <= 0) return null;
  if (insideArea(area, toScreen(target, current))) return null;
  const floor = Math.min(comfort, current.s);
  const wide = context.length ? boundsOf([...primary, ...context]) : null;
  if (wide) {
    const panned = panInto(current, wide, area);
    if (panned) return panned;
    const fitted = fitInto(wide, area, current.s);
    if (fitted.s >= floor) return fitted;
  }
  const panned = panInto(current, target, area);
  if (panned) return panned;
  const fitted = fitInto(target, area, current.s);
  if (fitted.s >= floor) return fitted;
  return anchorAt(target, area, floor);
}

export function paddedBounds(bounds: Rect): Rect {
  return { x: bounds.x - 24, y: bounds.y - 30, w: bounds.w + 72, h: bounds.h + 50 };
}

export function freeArea(stage: { w: number; h: number }, obstacle: Rect | null, reserved: { top: number; bottom: number; right: number }): Area {
  const full: Area = { x: 24, y: reserved.top, w: stage.w - 48 - reserved.right, h: stage.h - reserved.top - reserved.bottom };
  if (!obstacle) return full;
  const beside: Area = { x: obstacle.x + obstacle.w + 24, y: full.y, w: stage.w - reserved.right - 24 - (obstacle.x + obstacle.w + 24), h: full.h };
  const below: Area = { x: full.x, y: obstacle.y + obstacle.h + 16, w: full.w, h: stage.h - reserved.bottom - (obstacle.y + obstacle.h + 16) };
  return beside.w >= 480 || beside.w * beside.h >= below.w * below.h ? beside : below;
}

export function clampScale(s: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

export function zoomAround(camera: Camera, factor: number, cx: number, cy: number): Camera {
  const s = clampScale(camera.s * factor);
  return { s, tx: cx - (cx - camera.tx) * (s / camera.s), ty: cy - (cy - camera.ty) * (s / camera.s) };
}
