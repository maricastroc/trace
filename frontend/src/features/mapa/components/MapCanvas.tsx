"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatPercent, plural } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { CARDINALITY_SHORT, cardinalityEnds, relationLabel } from "../model/evidence";
import { findPaths, needsAttention, neighborsOf, pathTables, standingOf, type MapModel } from "../model/graph";
import {
  boundsOf,
  CARD_W,
  computeLayout,
  curvePath,
  fitInto,
  frameCamera,
  freeArea,
  linkGeometry,
  lodFor,
  paddedBounds,
  placeMarks,
  COMFORT_SCALE,
  pointOnCurve,
  sheetHeight,
  sheetView,
  showsVolumeRuler,
  zoomAround,
  type Area,
  type Camera,
  type Curve,
  type Lod,
  type Point,
  type Rect,
  type SheetGeometry,
} from "../model/layout";
import { FocusBar, MapLegend, MapStatus, MapTools, PathsCard, ZoomControls, type MapMode, type PathState } from "./CanvasOverlays";
import { MarkArt } from "./RelationMark";
import { TableSheet } from "./TableSheet";

export type Selection = { kind: "rel"; id: string } | { kind: "table"; key: string } | { kind: "field"; key: string; column: string } | null;

const LOD_NAMES: Record<Lod, string> = { overview: "visão geral", detail: "detalhe" };
const STATE_WORDS: Record<string, string> = { suggested: "sugerida", confirmed: "confirmada", caveat: "confirmada com ressalva", rejected: "rejeitada", review: "precisa ser reavaliada" };

type Props = {
  model: MapModel;
  selection: Selection;
  focusTable: string | null;
  panelOpen: boolean;
  discovering: boolean;
  onDiscover: () => void;
  onImport: () => void;
  onSelectRelation: (id: string) => void;
  onOpenTable: (key: string) => void;
  onOpenField: (key: string, column: string) => void;
  onFocusTable: (key: string | null) => void;
  onBackground: () => void;
  onClearAll: () => void;
};

function panelWidth() {
  return window.innerWidth <= 900 ? window.innerWidth : Math.min(600, Math.max(420, window.innerWidth * 0.4));
}

function curveLength(curve: Curve) {
  let length = 0;
  let previous = curve.p0;
  for (let i = 1; i <= 24; i++) {
    const point = pointOnCurve(curve, i / 24);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function endPath(point: Point, outward: number, end: "one" | "many") {
  if (end === "many") {
    const tip = point.x + outward * 22;
    return `M${tip},${point.y} L${point.x},${point.y - 9} M${tip},${point.y} L${point.x},${point.y} M${tip},${point.y} L${point.x},${point.y + 9}`;
  }
  const x = point.x + outward * 13;
  return `M${x},${point.y - 8} L${x},${point.y + 8}`;
}

function relationAria(r: Relationship) {
  const extra = needsAttention(r) ? `${plural(r.evidence.to.duplicate_values, "id repetido", "ids repetidos")} no destino` : "destino único";
  return `Relação ${relationLabel(r)}: ${STATE_WORDS[standingOf(r)]}, cobertura ${formatPercent(r.evidence.match.match_ratio)}, ${extra}. Abrir evidência.`;
}

export function MapCanvas({ model, selection, focusTable, panelOpen, discovering, onDiscover, onImport, onSelectRelation, onOpenTable, onOpenField, onFocusTable, onBackground, onClearAll }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const cam = useRef<Camera>({ s: 1, tx: 0, ty: 0 });
  const lodTimer = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const fitPasses = useRef(0);
  const lastFocus = useRef("");
  const previousStatus = useRef(new Map<string, string>());
  const reduced = useReducedMotion();

  const [lod, setLod] = useState<Lod>("detail");
  const [zoomLabel, setZoomLabel] = useState("100% · detalhe");
  const [mode, setMode] = useState<MapMode>("structure");
  const [problems, setProblems] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null);
  const [stamps, setStamps] = useState<Set<string>>(new Set());

  const { positions, allFields } = useMemo(() => computeLayout(model), [model]);
  const rulerOn = useMemo(() => showsVolumeRuler(model.tables), [model.tables]);
  const [pathState, setPathState] = useState<PathState>(() => {
    const ordered = [...model.tables].sort((a, b) => (positions[b.key]?.x ?? 0) - (positions[a.key]?.x ?? 0) || b.rows - a.rows);
    return { from: ordered[0]?.key ?? "", to: ordered[ordered.length - 1]?.key ?? "", pick: 0 };
  });

  const selectedTable = selection && selection.kind !== "rel" ? selection.key : null;
  const relation = selection?.kind === "rel" ? (model.relations.find((r) => r.id === selection.id) ?? null) : null;
  const activePath = mode === "paths" ? (findPaths(pathState.from, pathState.to, model.relations)[pathState.pick] ?? null) : null;
  const pathIds = new Set(activePath?.map((r) => r.id) ?? []);
  const pathNodes = new Set(activePath ? pathTables(pathState.from, activePath) : []);
  const neighbours = focusTable ? neighborsOf(focusTable, model.relations) : null;

  const sheets = useMemo(() => {
    const out: Record<string, SheetGeometry> = {};
    for (const table of model.tables) {
      const position = positions[table.key];
      if (!position) continue;
      const view = sheetView(table, lod, focusTable === table.key || selectedTable === table.key, allFields);
      out[table.key] = { rect: { x: position.x, y: position.y, w: CARD_W, h: sheetHeight(view, lod) }, view, lod };
    }
    return out;
  }, [model, positions, lod, focusTable, selectedTable, allFields]);

  const links = useMemo(
    () =>
      model.relations.flatMap((r) => {
        const geometry = linkGeometry(r, sheets, model.relations);
        return geometry ? [{ relation: r, ...geometry }] : [];
      }),
    [model, sheets],
  );

  const marks = useMemo(() => placeMarks(links.map((l) => ({ id: l.relation.id, curve: l.curve }))), [links]);

  const ruler = useMemo(() => {
    const rects = Object.values(sheets).map((s) => s.rect);
    const bounds = boundsOf(rects);
    if (!bounds || !rulerOn) return null;
    let bottom = bounds.y + bounds.h + 64;
    for (const link of links) for (let i = 0; i <= 10; i++) bottom = Math.max(bottom, pointOnCurve(link.curve, i / 10).y + 30);
    const width = Math.max(400, bounds.w);
    const x = (n: number) => 120 + (Math.log10(Math.max(1, n)) / 5) * (width - 160);
    const rows: Record<string, number> = {};
    let previous = -Infinity;
    let row = 0;
    for (const table of [...model.tables].sort((a, b) => a.rows - b.rows)) {
      row = x(table.rows) - previous < 150 ? (row + 1) % 2 : 0;
      rows[table.key] = row;
      previous = x(table.rows);
    }
    return { left: bounds.x, top: bottom, width, x, rows, rect: { x: bounds.x, y: bottom - 38, w: width, h: 108 } };
  }, [sheets, links, model.tables, rulerOn]);

  const applyCam = useCallback(
    (animate: boolean) => {
      const world = worldRef.current;
      if (!world) return;
      const camera = cam.current;
      world.classList.toggle("still", !animate || reduced);
      world.style.transform = `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.s})`;
      const want = lodFor(camera.s);
      setZoomLabel(`${Math.round(camera.s * 100)}% · ${LOD_NAMES[want]}`);
      window.clearTimeout(lodTimer.current);
      lodTimer.current = window.setTimeout(() => setLod(want), animate ? 380 : 140);
    },
    [reduced],
  );

  const contentRects = useCallback(
    (all: boolean): Rect[] => {
      const rects = Object.values(sheets).map((s) => s.rect);
      for (const point of Object.values(marks)) rects.push({ x: point.x - 22, y: point.y - 22, w: 44, h: 44 });
      if (all && ruler) rects.push(ruler.rect);
      return rects;
    },
    [sheets, marks, ruler],
  );

  const visibleArea = useCallback((): Area | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const panel = panelOpen && w >= 980 ? panelWidth() : 0;
    const status = statusRef.current;
    const statusBottom = status && !status.hidden && !panelOpen ? status.offsetTop + status.offsetHeight + 12 : 0;
    const card = mode === "paths" ? cardRef.current : null;
    const obstacle = card ? { x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight } : null;
    return freeArea({ w, h }, obstacle, { top: Math.max(84, statusBottom), bottom: 72, right: panel });
  }, [panelOpen, mode]);

  const fitAll = useCallback(
    (animate: boolean, all = true) => {
      const bounds = boundsOf(contentRects(all));
      const area = visibleArea();
      if (!bounds || !area) return;
      cam.current = fitInto(paddedBounds(bounds), area, 1.2);
      applyCam(animate);
    },
    [contentRects, visibleArea, applyCam],
  );

  const tableRects = useCallback((keys: string[]) => keys.map((key) => sheets[key]?.rect).filter((r): r is Rect => Boolean(r)), [sheets]);
  const markRect = useCallback((id: string): Rect[] => {
    const point = marks[id];
    return point ? [{ x: point.x - 26, y: point.y - 26, w: 52, h: 52 }] : [];
  }, [marks]);

  const selectionTargets = useCallback(() => {
    const anchor = relation ? null : (selectedTable ?? focusTable);
    const primary = relation ? [...tableRects([relation.from.dataset_key, relation.to.dataset_key]), ...markRect(relation.id)] : anchor ? tableRects([anchor]) : [];
    const ends = relation ? [relation.from.dataset_key, relation.to.dataset_key] : anchor ? [anchor] : [];
    const around = new Set(ends.flatMap((key) => [...neighborsOf(key, model.relations)]));
    return { primary, context: tableRects([...around].filter((t) => !ends.includes(t))) };
  }, [relation, selectedTable, focusTable, tableRects, markRect, model.relations]);

  useLayoutEffect(() => {
    if (fitPasses.current >= 2) return;
    fitPasses.current += 1;
    fitAll(false);
    const area = visibleArea();
    const { primary, context } = selectionTargets();
    if (area && primary.length && cam.current.s < COMFORT_SCALE) {
      const framed = frameCamera({ ...cam.current, s: COMFORT_SCALE }, primary, context, area);
      if (framed) {
        cam.current = framed;
        applyCam(false);
      }
    }
    if (lodFor(cam.current.s) === lod) fitPasses.current = 2;
  }, [fitAll, lod, visibleArea, selectionTargets, applyCam]);

  const layoutKey = JSON.stringify(positions);
  const fittedLayout = useRef(layoutKey);
  useEffect(() => {
    if (fittedLayout.current === layoutKey) return;
    fittedLayout.current = layoutKey;
    fitAll(true);
  }, [layoutKey, fitAll]);

  const fittedMode = useRef<MapMode>(mode);
  useEffect(() => {
    if (fittedMode.current === mode) return;
    fittedMode.current = mode;
    fitAll(true);
  }, [mode, fitAll]);

  const selectionKey = selection ? JSON.stringify(selection) : "";
  useEffect(() => {
    const key = `${selectionKey}|${focusTable ?? ""}`;
    if (key === lastFocus.current) return;
    lastFocus.current = key;
    const area = visibleArea();
    if (!area || (!selection && !focusTable)) return;
    const { primary, context } = selectionTargets();
    const next = frameCamera(cam.current, primary, context, area);
    if (!next) return;
    cam.current = next;
    applyCam(true);
  }, [selectionKey, selection, focusTable, visibleArea, selectionTargets, applyCam]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest(".map-ov")) return;
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      cam.current =
        event.ctrlKey || event.metaKey
          ? zoomAround(cam.current, Math.exp(-event.deltaY * 0.0045), event.clientX - box.left, event.clientY - box.top)
          : { ...cam.current, tx: cam.current.tx - event.deltaX, ty: cam.current.ty - event.deltaY };
      applyCam(false);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyCam]);

  useEffect(() => () => window.clearTimeout(lodTimer.current), []);

  useEffect(() => {
    const confirmedNow = model.relations.filter((r) => r.status === "confirmed" && previousStatus.current.has(r.id) && previousStatus.current.get(r.id) !== "confirmed").map((r) => r.id);
    previousStatus.current = new Map(model.relations.map((r) => [r.id, r.status]));
    if (!confirmedNow.length || reduced) return;
    const start = window.setTimeout(() => setStamps(new Set(confirmedNow)), 0);
    const end = window.setTimeout(() => setStamps(new Set()), 900);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [model.relations, reduced]);

  const pathKey = activePath?.map((r) => r.id).join("|") ?? "";
  const lastPath = useRef("");
  useEffect(() => {
    if (pathKey === lastPath.current) return;
    lastPath.current = pathKey;
    const area = visibleArea();
    if (!pathKey || !area) return;
    const ids = pathKey.split("|");
    const tables = links.filter((l) => ids.includes(l.relation.id)).flatMap((l) => [l.relation.from.dataset_key, l.relation.to.dataset_key]);
    const next = frameCamera(cam.current, [...tableRects(tables), ...ids.flatMap(markRect)], [], area);
    if (!next) return;
    cam.current = next;
    applyCam(true);
  }, [pathKey, links, visibleArea, tableRects, markRect, applyCam]);

  useEffect(() => {
    if (!pathKey || reduced) return;
    const segments: { curve: Curve; length: number; forward: boolean }[] = [];
    let node = pathState.from;
    for (const id of pathKey.split("|")) {
      const link = links.find((l) => l.relation.id === id);
      if (!link) return;
      const forward = link.relation.from.dataset_key === node;
      segments.push({ curve: link.curve, length: curveLength(link.curve), forward });
      node = forward ? link.relation.to.dataset_key : link.relation.from.dataset_key;
    }
    const total = segments.reduce((sum, s) => sum + s.length, 0);
    const started = performance.now();
    let frame = 0;
    const step = () => {
      const dot = dotRef.current;
      const halo = haloRef.current;
      if (dot && halo) {
        let d = ((performance.now() - started) * 0.35) % (total + 220);
        const visible = d <= total;
        dot.setAttribute("opacity", visible ? "1" : "0");
        halo.setAttribute("opacity", visible ? "0.18" : "0");
        for (const segment of segments) {
          if (d <= segment.length) {
            const t = segment.length ? d / segment.length : 0;
            const point = pointOnCurve(segment.curve, segment.forward ? t : 1 - t);
            for (const circle of [dot, halo]) {
              circle.setAttribute("cx", String(point.x));
              circle.setAttribute("cy", String(point.y));
            }
            break;
          }
          d -= segment.length;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [pathKey, pathState.from, links, reduced]);

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    cam.current = zoomAround(cam.current, factor, stage.clientWidth / 2, stage.clientHeight / 2);
    applyCam(true);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, a, input, select, .sheet, .mark, .lk-hit, .map-ov")) return;
    drag.current = { x: event.clientX, y: event.clientY, tx: cam.current.tx, ty: cam.current.ty, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("grabbing");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
    cam.current = { ...cam.current, tx: current.tx + dx, ty: current.ty + dy };
    applyCam(false);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    event.currentTarget.classList.remove("grabbing");
    if (!current.moved) onBackground();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = 80;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (event.key === "+" || event.key === "=") zoomBy(1.2);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / 1.2);
    else if (event.key === "0") fitAll(true);
    else if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      cam.current = { ...cam.current, tx: cam.current.tx + dx, ty: cam.current.ty + dy };
      applyCam(true);
    } else return;
    event.preventDefault();
  };

  const changeMode = (next: MapMode) => {
    setMode(next);
    if (next === "paths") onClearAll();
  };

  const problemCount = model.tables.reduce((sum, t) => sum + t.columns.reduce((n, c) => n + c.issues.length, 0), 0);
  const routeOrder = new Map(activePath ? pathTables(pathState.from, activePath).map((key, index) => [key, index + 1]) : []);
  const routeForward = new Map<string, boolean>();
  if (activePath) {
    let node = pathState.from;
    for (const r of activePath) {
      const forward = r.from.dataset_key === node;
      routeForward.set(r.id, forward);
      node = forward ? r.to.dataset_key : r.from.dataset_key;
    }
  }
  const tipRelation = tip ? model.relations.find((r) => r.id === tip.id) : null;

  return (
    <div
      ref={stageRef}
      className={`map-stage ${problems && problemCount > 0 ? "problems" : ""} ${focusTable ? "focusing" : ""} ${activePath ? "routing" : ""}`}
      tabIndex={0}
      aria-label="Mapa das tabelas. Mais e menos aproximam, zero ajusta à tela, setas movem. Ctrl e roda do mouse aproximam; arraste para mover."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="map-grid" aria-hidden />
      <div ref={worldRef} className="map-world">
        <svg className="map-links" aria-hidden>
          {links.map(({ relation: r, curve, dir, loop }) => {
            const d = curvePath(curve);
            const on = activePath ? pathIds.has(r.id) : relation ? r.id === relation.id : focusTable ? r.from.dataset_key === focusTable || r.to.dataset_key === focusTable : true;
            const selected = activePath ? pathIds.has(r.id) : relation?.id === r.id;
            const ends = cardinalityEnds(r.evidence.cardinality);
            return (
              <g key={r.id} className={`lk-g ${r.status} ${standingOf(r)} ${on ? "" : "dim"} ${selected ? "sel" : ""} ${hover === r.id ? "hover" : ""}`}>
                <path className="lk-under" d={d} />
                {(standingOf(r) === "caveat" || standingOf(r) === "review") && <path className="lk-ghost" d={d} />}
                <path className={`lk ${r.status}`} d={d} />
                <path className="lk-end" d={endPath(curve.p0, loop ? 1 : dir, ends.from)} />
                <path className="lk-end" d={endPath(curve.p1, loop ? 1 : -dir, ends.to)} />
                <circle className="port" cx={curve.p0.x} cy={curve.p0.y} r="4.5" />
                <circle className="port" cx={curve.p1.x} cy={curve.p1.y} r="4.5" />
                {routeForward.has(r.id) &&
                  [0.3, 0.7].map((t) => {
                    const forward = routeForward.get(r.id);
                    const at = forward ? t : 1 - t;
                    const p = pointOnCurve(curve, at);
                    const q = pointOnCurve(curve, forward ? at + 0.01 : at - 0.01);
                    const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
                    return <path key={t} className="route-chev" d="M-7,-6 L3,0 L-7,6" transform={`translate(${p.x} ${p.y}) rotate(${angle})`} />;
                  })}
                <path
                  className="lk-hit"
                  d={d}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTip(null);
                    onSelectRelation(r.id);
                  }}
                  onMouseEnter={(event) => {
                    setHover(r.id);
                    setTip({ x: event.clientX, y: event.clientY, id: r.id });
                  }}
                  onMouseMove={(event) => setTip({ x: event.clientX, y: event.clientY, id: r.id })}
                  onMouseLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                />
              </g>
            );
          })}
          {activePath && !reduced && (
            <>
              <circle ref={haloRef} className="tracer-halo" r="15" opacity="0" />
              <circle ref={dotRef} className="tracer" r="6" opacity="0" />
            </>
          )}
        </svg>

        {model.tables.map((table) => {
          const geometry = sheets[table.key];
          if (!geometry) return null;
          const involved = activePath ? pathNodes.has(table.key) : relation ? relation.from.dataset_key === table.key || relation.to.dataset_key === table.key : neighbours ? neighbours.has(table.key) : true;
          const lift = !activePath && ((relation !== null && involved) || focusTable === table.key);
          const highlighted = new Set<string>();
          if (relation?.from.dataset_key === table.key) highlighted.add(relation.from.column);
          if (relation?.to.dataset_key === table.key) highlighted.add(relation.to.column);
          if (selection?.kind === "field" && selection.key === table.key) highlighted.add(selection.column);
          const expanded = focusTable === table.key || selectedTable === table.key;
          return (
            <TableSheet
              key={table.key}
              table={table}
              view={geometry.view}
              lod={lod}
              relations={model.relations}
              highlighted={highlighted}
              stackDepth={Math.max(1, Math.min(5, Math.round(Math.log10(Math.max(1, table.rows)))))}
              badge={routeOrder.get(table.key)}
              className={`${involved ? "" : "dim"} ${lift ? "lift" : ""} ${focusTable === table.key ? "focus" : ""} ${expanded ? "expanded" : ""}`}
              style={{ left: geometry.rect.x, top: geometry.rect.y }}
              onOpenTable={onOpenTable}
              onOpenField={onOpenField}
              onExpand={(key) => onFocusTable(key)}
              onCollapse={(key) => (focusTable === key ? onFocusTable(null) : onBackground())}
            />
          );
        })}

        {links.map(({ relation: r }) => {
          const point = marks[r.id];
          if (!point) return null;
          const on = activePath ? pathIds.has(r.id) : relation ? r.id === relation.id : focusTable ? r.from.dataset_key === focusTable || r.to.dataset_key === focusTable : true;
          const attention = needsAttention(r);
          return (
            <button
              key={r.id}
              type="button"
              className={`mark ${r.status} ${standingOf(r)} ${attention ? "attn" : ""} ${relation?.id === r.id ? "sel" : ""} ${on ? "" : "faded"} ${stamps.has(r.id) ? "stamp" : ""}`}
              style={{ left: point.x, top: point.y }}
              aria-label={relationAria(r)}
              onClick={(event) => {
                event.stopPropagation();
                setTip(null);
                onSelectRelation(r.id);
              }}
              onMouseEnter={(event) => {
                setHover(r.id);
                setTip({ x: event.clientX, y: event.clientY, id: r.id });
              }}
              onMouseLeave={() => {
                setHover(null);
                setTip(null);
              }}
              onFocus={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setHover(r.id);
                setTip({ x: box.right, y: box.bottom, id: r.id });
              }}
              onBlur={() => {
                setHover(null);
                setTip(null);
              }}
            >
              <MarkArt relation={r} all={model.relations} />
            </button>
          );
        })}

        {ruler && (
          <svg className="ruler" aria-hidden style={{ left: ruler.left, top: ruler.top, width: ruler.width }} viewBox={`0 -36 ${ruler.width} 98`}>
            <text x="0" y="24">
              linhas
            </text>
            <text x="0" y="40">
              por tabela
            </text>
            <line x1={ruler.x(1)} x2={ruler.x(100000)} y1="20" y2="20" strokeWidth="1" />
            {[1, 10, 100, 1000, 10000, 100000].map((n) => (
              <g key={n}>
                <line x1={ruler.x(n)} x2={ruler.x(n)} y1="14" y2="26" strokeWidth="1" />
                <text x={ruler.x(n)} y="46" textAnchor="middle">
                  {n.toLocaleString("pt-BR")}
                </text>
              </g>
            ))}
            {model.tables.map((table) => (
              <g key={table.key} className={relation && (relation.from.dataset_key === table.key || relation.to.dataset_key === table.key) ? "on" : ""}>
                <path className="tm" d={`M${ruler.x(table.rows)},18 l-7,-12 h14 z`} stroke="none" />
                <text className="tm-lbl" x={ruler.x(table.rows)} y={ruler.rows[table.key] ? -16 : 0} textAnchor="middle">
                  {table.key} {table.rows.toLocaleString("pt-BR")}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>

      <MapStatus ref={statusRef} model={model} hidden={mode === "paths"} discovering={discovering} onDiscover={onDiscover} onImport={onImport} />
      {mode === "paths" && <PathsCard ref={cardRef} model={model} state={pathState} onChange={setPathState} />}
      <MapTools
        mode={mode}
        onMode={changeMode}
        problems={problems}
        problemCount={problemCount}
        onProblems={() => setProblems((value) => !value)}
      />
      <ZoomControls label={zoomLabel} onZoomIn={() => zoomBy(1.25)} onZoomOut={() => zoomBy(1 / 1.25)} onFit={() => fitAll(true)} />
      {focusTable && neighbours ? <FocusBar table={focusTable} neighbours={neighbours.size - 1} onClear={() => onFocusTable(null)} /> : <MapLegend />}

      {tip && tipRelation && (
        <div className="map-tip" role="presentation" style={{ left: Math.min(tip.x + 14, window.innerWidth - 312), top: tip.y + 16 }}>
          <div className="mono">{relationLabel(tipRelation)}</div>
          <div>
            cobertura {formatPercent(tipRelation.evidence.match.match_ratio)} ·{" "}
            {needsAttention(tipRelation) ? `${plural(tipRelation.evidence.to.duplicate_values, "id repetido", "ids repetidos")} no destino` : "destino único"} ·{" "}
            {CARDINALITY_SHORT[tipRelation.evidence.cardinality]}
          </div>
          <div className="mt-1 font-semibold">{STATE_WORDS[standingOf(tipRelation)]} · clique para ver a evidência</div>
        </div>
      )}
    </div>
  );
}
