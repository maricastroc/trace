"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/format";
import type { ComparisonSummary } from "@/lib/types";
import { C, P, tabText, tabWidth, Y0, type Frame, type GroupKey, type Scene, type Stage } from "../model/overprint";
import { explanationText, proofOf, type Labels } from "../model/reconciliation";
import type { Side } from "../model/spec";
import { groupKey, targetFromGroup, targetKey, type Target } from "../model/targets";

type Props = {
  scene: Scene;
  stage: Stage;
  focus: Set<string> | null;
  labels: Labels;
  summary: ComparisonSummary;
  openKey: string | null;
  onFocus: (focus: Set<string> | null) => void;
  onOpen: (target: Target) => void;
  onStage: (stage: Stage) => void;
};

type Colors = Record<"a" | "b" | "aDeep" | "bDeep" | "aWash" | "bWash" | "ab" | "ink" | "ink3" | "sheet", string>;

type Anim = {
  scene: Scene;
  stage: Stage;
  x: Float32Array;
  y: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  alpha: Float32Array;
  fa: Float32Array;
  delay: Float32Array;
  styleFrom: Uint8Array;
  styleTo: Uint8Array;
  t0: number;
  dur: number;
  frameFrom: { a: Frame; b: Frame };
  frameTo: { a: Frame; b: Frame };
};

const POSSIBLE = new Set<GroupKey>(["possible_match", "ambiguous_match", "variant_of_matched"]);
const STAGE_MAX = 4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    a: read("--a", "#5b8cff"),
    b: read("--b", "#ff4fa3"),
    aDeep: read("--a-deep", "#1f4fd6"),
    bDeep: read("--b-deep", "#b8135f"),
    aWash: read("--a-wash", "#e1e9ff"),
    bWash: read("--b-wash", "#ffe1ef"),
    ab: read("--ab", "#5b2ba3"),
    ink: read("--ink", "#121419"),
    ink3: read("--ink-3", "#5c636f"),
    sheet: read("--sheet", "#fcfcfd"),
  };
}

function reduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function styleOf(group: GroupKey, stage: Stage) {
  return stage >= 3 && POSSIBLE.has(group) ? 1 : 0;
}

function cellKey(scene: Scene, i: number) {
  const cell = scene.cells[i];
  return `${cell.side}:${cell.group}:${cell.k}`;
}

function startFrom(previous: Anim | null, scene: Scene, stage: Stage): Pick<Anim, "x" | "y" | "alpha" | "styleFrom"> {
  const n = scene.cells.length;
  const target = scene.positions[stage];
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const alpha = new Float32Array(n);
  const styleFrom = new Uint8Array(n);
  const old = new Map<string, number>();
  if (previous) previous.scene.cells.forEach((_, i) => old.set(cellKey(previous.scene, i), i));
  scene.cells.forEach((cell, i) => {
    const same = previous && previous.scene === scene ? i : (old.get(cellKey(scene, i)) ?? (cell.group === "rule" ? old.get(`${cell.side}:possible_match:${cell.k}`) : undefined));
    if (previous && same !== undefined) {
      x[i] = previous.x[same];
      y[i] = previous.y[same];
      alpha[i] = previous.alpha[same];
      styleFrom[i] = previous.styleTo[same];
    } else {
      x[i] = target[i].x;
      y[i] = target[i].y;
      alpha[i] = previous ? 0 : 1;
      styleFrom[i] = styleOf(cell.group, stage);
    }
  });
  return { x, y, alpha, styleFrom };
}

function paintScene(
  element: HTMLCanvasElement | null,
  state: Anim | null,
  palette: Colors | null,
  view: { scale: number; dpr: number },
  f: Set<string> | null,
  patterns: { a: CanvasPattern | string; b: CanvasPattern | string } | null,
): boolean {
  const ctx = element?.getContext("2d");
  if (!element || !state || !palette || !ctx) return false;
  const { scale, dpr } = view;
  const now = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, element.width, element.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  const progress = (delay: number) => (state.dur === 0 ? 1 : Math.max(0, Math.min(1, (now - state.t0 - delay) / state.dur)));
  const p = ease(progress(0));
  const lerp = (a: Frame, b: Frame): Frame => ({ x: a.x + (b.x - a.x) * p, w: a.w + (b.w - a.w) * p });
  const frame = (f: Frame, fill: string, side: Side) => {
    if (f.w <= 0) return;
    const x = f.x - 6;
    const y = Y0 - 6;
    const w = f.w + 10;
    const h = state.scene.rows * P + 10;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(18,20,25,0.28)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = palette.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const corners: [number, number, number, number][] =
      side === "a"
        ? [
            [x, y, -1, -1],
            [x, y + h, -1, 1],
          ]
        : [
            [x + w, y, 1, -1],
            [x + w, y + h, 1, 1],
          ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.moveTo(cx + dx * 5, cy);
      ctx.lineTo(cx + dx * 15, cy);
      ctx.moveTo(cx, cy + dy * 5);
      ctx.lineTo(cx, cy + dy * 15);
    }
    ctx.stroke();
  };
  frame(lerp(state.frameFrom.a, state.frameTo.a), "rgba(91,140,255,0.07)", "a");
  ctx.globalCompositeOperation = "multiply";
  frame(lerp(state.frameFrom.b, state.frameTo.b), "rgba(255,79,163,0.07)", "b");
  ctx.globalCompositeOperation = "source-over";

  const possible = state.scene.shelves.find((shelf) => shelf.key === "possible");
  if (state.stage >= 3 && possible) {
    ctx.strokeStyle = palette.ab;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(possible.x - 14, state.scene.trayY - 112, possible.end - possible.x + 28, state.scene.height - (state.scene.trayY - 112) - 4);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  let busy = false;
  const cells = state.scene.cells;
  const unit = state.scene.unit;
  for (const pass of ["a", "b"] as const) {
    ctx.globalCompositeOperation = pass === "b" ? "multiply" : "source-over";
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.side !== pass) continue;
      const t = progress(state.delay[i]);
      if (t < 1) busy = true;
      const e = ease(t);
      const x = state.fx[i] + (state.tx[i] - state.fx[i]) * e;
      const y = state.fy[i] + (state.ty[i] - state.fy[i]) * e;
      const a = state.fa[i] + (1 - state.fa[i]) * e;
      state.x[i] = x;
      state.y[i] = y;
      state.alpha[i] = a;
      if (a <= 0.01) continue;
      const base = (f && !f.has(groupKey(cell.side, cell.group)) ? 0.13 : 1) * a;
      const fill = pass === "a" ? palette.a : palette.b;
      const paint = (style: number, weight: number) => {
        if (weight <= 0) return;
        ctx.globalAlpha = base * weight;
        if (style === 1) {
          ctx.fillStyle = patterns?.[pass] ?? fill;
          ctx.fillRect(x, y, C, C);
          ctx.strokeStyle = fill;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 0.4, y + 0.4, C - 0.8, C - 0.8);
        } else {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, C, C);
          if (unit > 1 && cell.fill < 1) {
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillRect(x, y, C, C * (1 - cell.fill));
          }
        }
      };
      const from = state.styleFrom[i];
      const to = state.styleTo[i];
      if (from === to || t >= 1) paint(to, 1);
      else {
        paint(from, 1 - t);
        paint(to, t);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  const scene = state.scene;
  if (state.stage === 2 && scene.matched.cols === 0 && scene.frames[2].a.w > 0 && scene.matched.restCols > 0) {
    const gap = scene.matched.x - 1.5 * P - 1;
    ctx.globalAlpha = p;
    ctx.strokeStyle = palette.ink3;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gap, Y0 - 10);
    ctx.lineTo(gap, scene.gridBottom + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  if (state.stage >= 3) {
    const left = cells.flatMap((cell, i) => (cell.side === "a" && cell.group === "possible_match" ? [i] : []));
    const right = cells.flatMap((cell, i) => (cell.side === "b" && cell.group === "possible_match" ? [i] : []));
    const hot = f !== null && (f.has("a:possible_match") || f.has("b:possible_match"));
    ctx.strokeStyle = palette.ab;
    ctx.lineWidth = hot ? 1.3 : 0.9;
    ctx.globalAlpha = hot ? 0.95 : f ? 0.15 : 0.55;
    ctx.setLineDash([2, 2.5]);
    for (let k = 0; k < Math.min(left.length, right.length); k++) {
      const x1 = state.x[left[k]] + C / 2;
      const y1 = state.y[left[k]] + C;
      const x2 = state.x[right[k]] + C / 2;
      const y2 = state.y[right[k]] + C;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 34, x2, y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  return busy || p < 1;
}

export function Overprint({ scene, stage, focus, labels, summary, openKey, onFocus, onOpen, onStage }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const anim = useRef<Anim | null>(null);
  const focusRef = useRef<Set<string> | null>(null);
  const raf = useRef<number | null>(null);
  const colors = useRef<Colors | null>(null);
  const patterns = useRef<{ a: CanvasPattern | string; b: CanvasPattern | string } | null>(null);
  const view = useRef({ scale: 0.6, dpr: 1 });
  const [size, setSize] = useState<{ scale: number; width: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const kick = useCallback(() => {
    if (raf.current !== null) return;
    const tick = () => {
      const busy = paintScene(canvas.current, anim.current, colors.current, view.current, focusRef.current, patterns.current);
      raf.current = busy ? requestAnimationFrame(tick) : null;
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      if (!width) return;
      const scale = Math.min(width / scene.width, 1.25);
      setSize((current) => (current && current.scale === scale && current.width === width ? current : { scale, width }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scene.width]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !size) return;
    const dpr = window.devicePixelRatio || 1;
    view.current = { scale: size.scale, dpr };
    element.width = Math.round(scene.width * size.scale * dpr);
    element.height = Math.round(scene.height * size.scale * dpr);
    colors.current = readColors();
    const ctx = element.getContext("2d");
    if (ctx && colors.current) {
      const make = (dot: string, wash: string) => {
        const tile = document.createElement("canvas");
        tile.width = tile.height = Math.max(4, Math.round(4 * dpr * size.scale));
        const g = tile.getContext("2d");
        if (!g) return dot;
        const u = tile.width / 4;
        g.fillStyle = wash;
        g.fillRect(0, 0, tile.width, tile.height);
        g.fillStyle = dot;
        g.beginPath();
        g.arc(2 * u, 2 * u, 1.15 * u, 0, Math.PI * 2);
        g.fill();
        const pattern = ctx.createPattern(tile, "repeat");
        if (!pattern) return dot;
        pattern.setTransform(new DOMMatrix().scale(1 / (dpr * size.scale), 1 / (dpr * size.scale)));
        return pattern;
      };
      patterns.current = { a: make(colors.current.aDeep, colors.current.aWash), b: make(colors.current.bDeep, colors.current.bWash) };
    }
    kick();
  }, [size, scene.width, scene.height, kick]);

  useEffect(() => {
    const previous = anim.current;
    const n = scene.cells.length;
    const start = startFrom(previous, scene, stage);
    const target = scene.positions[stage];
    const tx = new Float32Array(n);
    const ty = new Float32Array(n);
    const delay = new Float32Array(n);
    const styleTo = new Uint8Array(n);
    const instant = reduced() || !previous;
    const xs = target.map((point) => point.x);
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    scene.cells.forEach((cell, i) => {
      tx[i] = target[i].x;
      ty[i] = target[i].y;
      styleTo[i] = styleOf(cell.group, stage);
      const moved = start.x[i] !== tx[i] || start.y[i] !== ty[i];
      if (!moved) delay[i] = 0;
      else if (stage === 2 && previous?.stage === 1) delay[i] = ((tx[i] - minX) / Math.max(1, maxX - minX)) * 220 + (cell.side === "b" ? 60 : 0);
      else if (stage >= 3) delay[i] = 60 + ((ty[i] - Y0) / Math.max(1, scene.height - Y0)) * 160 + (cell.side === "b" ? 40 : 0);
      else delay[i] = (i * 7919) % 90;
    });
    const currentFrames = previous ? previous.frameTo : scene.frames[stage];
    anim.current = {
      scene,
      stage,
      x: start.x,
      y: start.y,
      fx: Float32Array.from(start.x),
      fy: Float32Array.from(start.y),
      tx,
      ty,
      alpha: start.alpha,
      fa: Float32Array.from(start.alpha),
      delay,
      styleFrom: start.styleFrom,
      styleTo,
      t0: performance.now(),
      dur: instant ? 0 : 640,
      frameFrom: currentFrames,
      frameTo: scene.frames[stage],
    };
    kick();
  }, [scene, stage, kick]);

  useEffect(() => {
    focusRef.current = focus;
    kick();
  }, [focus, kick]);

  const hit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = anim.current;
    if (!state) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const { scale } = view.current;
    const sx = (event.clientX - rect.left) / scale;
    const sy = (event.clientY - rect.top) / scale;
    let found: number | null = null;
    for (let i = 0; i < state.scene.cells.length; i++) {
      if (state.alpha[i] < 0.5) continue;
      if (sx >= state.x[i] - 1 && sx <= state.x[i] + C + 1 && sy >= state.y[i] - 1 && sy <= state.y[i] + C + 1) {
        found = i;
        if (state.scene.cells[i].side === "a") break;
      }
    }
    return found === null ? null : { index: found, cell: state.scene.cells[found], rect };
  };

  const describe = (side: Side, group: GroupKey) => {
    if (group === "shared") return "nos dois · mesma identidade pela chave exata";
    if (group === "rule") return "nos dois · pela regra aceita";
    if (stage === 1) return side === "a" ? `identidade em ${labels.a}` : `identidade em ${labels.b}`;
    if (stage === 2) return POSSIBLE.has(group) ? "sem par exato · tem candidato" : "sem par pela chave";
    return `${explanationText(group, side, labels).title} · ${proofOf(group) === "possible" ? "possível" : "comprovado"}`;
  };

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const found = hit(event);
    event.currentTarget.classList.toggle("hot", found !== null);
    if (!found || !wrap.current) {
      setTip(null);
      return;
    }
    const box = wrap.current.getBoundingClientRect();
    const unit = scene.unit;
    const size = unit === 1 ? "1 identidade" : `bloco de até ${formatCount(unit)} identidades`;
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, lines: [size, describe(found.cell.side, found.cell.group), "Clique para abrir"] });
  };

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const found = hit(event);
    if (!found) return;
    const { side, group } = found.cell;
    if (stage === 1) onOpen({ kind: "side", side });
    else if (stage === 2) onOpen(group === "shared" || group === "rule" ? { kind: "shared" } : { kind: "only", side });
    else onOpen(targetFromGroup(side, group, summary));
  };

  const scale = size?.scale ?? 0.6;
  const frames = scene.frames[stage];
  const matched = summary.shared + summary.shared_by_rule;
  const stage1 = stage === 1;
  const text = (side: Side) => tabText(side, labels[side], summary[side].rows, stage1);
  const width = (side: Side) => tabWidth(summary[side].distinct, text(side));
  const fit = (left: number, side: Side) => Math.max(8, Math.min(left, scene.width - width(side) - 8));
  const tabLeft = (side: Side) => fit(side === "a" || stage1 ? frames[side].x - 6 : frames.b.x + frames.b.w + 4 - width("b"), side);
  const stacked = tabLeft("a") + width("a") + 16 > tabLeft("b");
  const stackLeft = Math.max(8, Math.min(Math.min(frames.a.x, frames.b.x) - 24, scene.width - Math.max(width("a"), width("b")) - 8));
  const sideTab = (side: Side) => (
    <div
      key={side}
      className={`ptab ${side}`}
      title={`${side.toUpperCase()} · ${labels[side]}`}
      style={{ left: stacked ? stackLeft : tabLeft(side), top: side === "a" && stacked ? Y0 - 88 : Y0 - 46 }}
    >
      <b>{formatCount(summary[side].distinct)}</b>
      <span>{text(side)}</span>
    </div>
  );
  const inside = scene.matched.cols >= 4;
  const zero = matched === 0 && scene.frames[2].a.w > 0 && scene.matched.restCols > 0;

  const units = (side: Side) => {
    const counts = summary[side];
    const f = scene.stage1[side];
    const items: { key: string; text: string; sub: string; target: Target }[] = [];
    if (counts.repeated_rows > 0)
      items.push({
        key: "rep",
        text: `${formatCount(counts.repeated_rows)} ${counts.repeated_rows === 1 ? "linha repetida" : "linhas repetidas"}`,
        sub: "repetem uma identidade já contada",
        target: { kind: "repeated", side },
      });
    if (counts.empty_rows > 0)
      items.push({ key: "empty", text: `${formatCount(counts.empty_rows)} sem identificador`, sub: "ficam fora da comparação", target: { kind: "empty", side } });
    return items.map((item, i) => (
      <button
        key={`${side}-${item.key}`}
        type="button"
        className={`dup-lbl ${side} ${stage1 ? "" : "gone"}`}
        tabIndex={stage1 ? 0 : -1}
        aria-hidden={!stage1}
        style={{ left: f.x, top: scene.gridBottom + 18 + i * 28 }}
        onClick={() => onOpen(item.target)}
      >
        <b>{item.text}</b>
        <span>{item.sub}</span>
      </button>
    ));
  };

  const shelfTitle = (key: "a" | "possible" | "b") => (key === "a" ? "comprovado · só em A" : key === "b" ? "comprovado · só em B" : "possível · não conta como par");

  return (
    <figure className="rc-viz">
      <div
        ref={wrap}
        className="rc-stage"
        tabIndex={0}
        role="group"
        aria-label="Visualização da comparação. As setas mudam o passo. Os mesmos números estão no texto ao lado."
        style={{ height: scene.height * scale }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" && stage < STAGE_MAX) {
            event.preventDefault();
            onStage((stage + 1) as Stage);
          }
          if (event.key === "ArrowLeft" && stage > 1) {
            event.preventDefault();
            onStage((stage - 1) as Stage);
          }
        }}
      >
        <div className="rc-scene" style={{ width: scene.width * scale, height: scene.height * scale }}>
          <canvas
            ref={canvas}
            className="rc-canvas"
            role="img"
            aria-label={`Cada quadrado é ${scene.unit === 1 ? "uma identidade" : `um bloco de até ${formatCount(scene.unit)} identidades`}. Azul: ${labels.a}. Rosa: ${labels.b}. Violeta, a sobreposição: ${formatCount(matched)} nos dois. Pontilhado: possível.`}
            style={{ width: scene.width * scale, height: scene.height * scale }}
            onMouseMove={onMove}
            onMouseLeave={(event) => {
              event.currentTarget.classList.remove("hot");
              setTip(null);
            }}
            onClick={onClick}
          />
          <div className="rc-ov" style={{ width: scene.width, height: scene.height, transform: `scale(${scale})` }}>
            {sideTab("a")}
            {sideTab("b")}
            <div
              className={`mlabel ${inside ? "" : "out"}`}
              style={
                inside
                  ? { left: scene.matched.x + (scene.matched.cols * P) / 2, top: Y0 + (scene.rows * P) / 2, opacity: !stage1 && matched > 0 ? 1 : 0 }
                  : { left: scene.matched.x + (scene.matched.cols + scene.matched.restCols) * P + 16, top: Y0 + (scene.rows * P) / 2, opacity: !stage1 && matched > 0 ? 1 : 0 }
              }
              aria-hidden
            >
              <b>{formatCount(matched)}</b>
              <span>{summary.shared_by_rule > 0 ? `nos dois · ${formatCount(summary.shared_by_rule)} pela regra` : "nos dois"}</span>
            </div>
            <div className={`zero-tag ${zero && stage === 2 ? "" : "gone"}`} style={{ left: scene.matched.x - 1.5 * P, top: scene.gridBottom + 14 }} aria-hidden>
              nenhuma identidade nos dois
            </div>
            {units("a")}
            {units("b")}
            {scene.shelves.map((shelf) => (
              <div
                key={shelf.key}
                className={`shelf-cap ${shelf.key === "possible" ? "hyp" : ""} ${stage >= 3 ? "" : "gone"}`}
                style={{ left: shelf.x - (shelf.key === "possible" ? 8 : 0), top: scene.trayY - 108, width: shelf.end - shelf.x + (shelf.key === "possible" ? 16 : 0) }}
                aria-hidden
              >
                {shelfTitle(shelf.key)}
              </div>
            ))}
            {scene.trays.map((tray) => {
              const target = targetFromGroup(tray.side, tray.group, summary);
              const text = explanationText(tray.group, tray.side, labels);
              const live = stage >= 3;
              return (
                <button
                  key={`${tray.side}-${tray.group}`}
                  type="button"
                  className={`tray ${tray.side} ${live ? "" : "gone"}`}
                  tabIndex={live ? 0 : -1}
                  aria-hidden={!live}
                  aria-pressed={openKey === targetKey(target)}
                  aria-label={`${formatCount(tray.count)} identidades, ${text.title}, ${proofOf(tray.group) === "possible" ? "possível" : "comprovado"}. Abrir.`}
                  title={text.title}
                  style={{ left: tray.x, top: scene.trayY - 58, width: Math.max(tray.cols * P, 70), height: 52 }}
                  onMouseEnter={() => onFocus(new Set([groupKey(tray.side, tray.group)]))}
                  onMouseLeave={() => onFocus(null)}
                  onFocus={() => onFocus(new Set([groupKey(tray.side, tray.group)]))}
                  onBlur={() => onFocus(null)}
                  onClick={() => onOpen(target)}
                >
                  <b>{formatCount(tray.count)}</b>
                </button>
              );
            })}
          </div>
        </div>
        {tip && (
          <div className="rc-tip" role="presentation" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            {tip.lines.map((line, i) => (
              <div key={i} className={i === 0 ? "mono" : i === 1 ? "strong" : "faint"}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
      <figcaption className="rc-unit">
        {scene.unit === 1 ? "Cada quadrado é 1 identidade." : `Cada quadrado é um bloco de até ${formatCount(scene.unit)} identidades; as contagens exatas estão nos textos.`} Azul:{" "}
        {labels.a}. Rosa: {labels.b}. Violeta: nos dois.
      </figcaption>
    </figure>
  );
}
