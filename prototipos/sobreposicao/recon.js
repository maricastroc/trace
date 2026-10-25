(function () {
  "use strict";
  const { h, s, toast, announce, tip, untip, Panel, recordTable } = UI;
  const T = window.Trace;
  const fmt = T.fmt;

  const SW = 1360, SH = 540, P = 11, C = 9, ROWS = 24;
  const Y0 = 62, X0 = 420, A1X = 40, B1X = 700, TRAY_Y = 448, DUP_Y = Y0 + ROWS * P + 40;
  const COL = { a: "#5b8cff", b: "#ff4fa3", aDeep: "#1f4fd6", bDeep: "#b8135f", ab: "#5b2ba3", ink: "#121419", ink3: "#5c636f", aWash: "#e1e9ff", bWash: "#ffe1ef" };
  const A_ONLY = ["before", "after", "noService", "hypA"];
  const B_ONLY = ["hypB", "noReg"];
  const SHELVES = [
    { key: "aProven", label: "comprovado · só em A", cats: ["before", "after", "noService"] },
    { key: "possible", label: "possível · não conta como par", cats: ["hypA", "hypB"] },
    { key: "bProven", label: "comprovado · só em B", cats: ["noReg"] },
  ];
  const GAP = 40, SHELF_GAP = 64, TRAY_MAX_ROWS = 7, BLOCK_TARGET = 1250;
  const STEP_LABELS = ["Fontes", "Alinhar", "Classificar", "Fechar a conta"];

  let root, rcEl, stageEl, sceneEl, canvas, ctx, ov, panel, footEl, listEl, stepsEl, verEl, titleEl, cmpSeg, srcEl, unitEl, answerEl;
  let R, R1, R2, cells, byCat, U, trayX, trayCols, shelfX, pairOrder;
  let st, ver, scale, dpr, raf, tmo, animT0, animDur, focusCats, selCell, flashCell, showDiv, autoplay, playedOnce, patA, patB, ovEls, openCatKey, cmp, frameFrom, frameTo;

  function resetState() {
    cells = []; byCat = {}; trayX = {}; trayCols = {}; shelfX = {}; ovEls = {};
    st = 1; ver = 1; scale = 1; dpr = 1; raf = null; tmo = null; animT0 = 0; animDur = 0;
    focusCats = null; selCell = null; flashCell = null; showDiv = false; autoplay = null; playedOnce = false; openCatKey = null;
    frameFrom = null; frameTo = null;
    cmp = T.ws.id === "rede" ? "active" : "all";
  }

  const RR = () => (ver === 2 ? R2 : R1);
  const yearOf = () => R1.year;

  function build() {
    const opts = cmp === "active" ? { aFilter: "activeYear" } : {};
    R1 = T.reconcile(opts);
    R2 = T.reconcile(Object.assign({ acceptZeros: true }, opts));
    U = Math.max(1, Math.ceil(Math.max(R1.aDistinct, R1.bDistinct) / BLOCK_TARGET));
    cells = [];
    const pairIdx = new Map(R1.pairs.map((p, i) => [p.a, i]));
    pairOrder = { a: (it) => pairIdx.get(it.id), b: (it) => pairIdx.get(it.pair) };
    const base = () => ({ x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, d: 0, sf: 0, stt: 0, mix: 1, alpha: 1, fa: 1, ta: 1 });
    const push = (side, cat, items) => {
      const n = Math.ceil(items.length / U);
      for (let i = 0; i < n; i++) cells.push(Object.assign(base(), { side, cat, k: i, items: items.slice(i * U, (i + 1) * U) }));
    };
    const both = R1.both.slice().sort();
    push("a", "both", both.map((id) => ({ id, row: R1.firstRow.get(id) })));
    push("b", "both", both.map((id) => ({ id, att: R1.bMap.get(id) })));
    for (const c of A_ONLY) {
      let items = R1.cat[c].items.slice();
      items.sort(c === "hypA" ? (x, y) => pairOrder.a(x) - pairOrder.a(y) : (x, y) => x.id.localeCompare(y.id));
      push("a", c, items);
    }
    for (const c of B_ONLY) {
      let items = R1.cat[c].items.slice();
      items.sort(c === "hypB" ? (x, y) => pairOrder.b(x) - pairOrder.b(y) : (x, y) => x.id.localeCompare(y.id));
      push("b", c, items);
    }
    push("a", "dupRow", R1.dupRows.map((row) => ({ id: row.id, row })));
    byCat = {};
    for (const c of cells) (byCat[c.cat + ":" + c.side] = byCat[c.cat + ":" + c.side] || []).push(c);
    const fileOrder = (c) => (c.items[0].row ? c.items[0].row._line : 0);
    const aCells = cells.filter((c) => c.side === "a" && c.cat !== "dupRow");
    const bCells = cells.filter((c) => c.side === "b");
    (U === 1 ? aCells.sort((x, y) => fileOrder(x) - fileOrder(y)) : aCells).forEach((c, i) => (c.fileIdx = i));
    (U === 1 ? bCells.sort((x, y) => x.items[0].id.localeCompare(y.items[0].id)) : bCells).forEach((c, i) => (c.fileIdx = i));
    const div = new Set(R1.divergent.map((d) => d.id));
    cells.forEach((c) => { c.div = c.cat === "both" && c.items.some((it) => div.has(it.id)); });
    computeTrays();
  }

  function computeTrays() {
    trayX = {}; trayCols = {}; shelfX = {};
    let x = A1X;
    for (const sh of SHELVES) {
      const live = sh.cats.filter((c) => catCells(c, ver).length > 0);
      if (!live.length) continue;
      shelfX[sh.key] = x;
      for (const c of live) {
        const n = catCells(c, ver).length;
        trayCols[c] = Math.max(3, Math.ceil(n / TRAY_MAX_ROWS));
        trayX[c] = x;
        x += Math.max(trayCols[c] * P, 118) + GAP;
      }
      shelfX[sh.key + "End"] = x - GAP;
      x += SHELF_GAP - GAP;
    }
  }

  const sideOf = (cat) => (B_ONLY.includes(cat) ? "b" : "a");
  const isMatched = (c, v) => c.cat === "both" || (v === 2 && (c.cat === "hypA" || c.cat === "hypB"));
  const catCells = (cat, v) => (byCat[cat + ":" + sideOf(cat)] || []).filter((c) => !isMatched(c, v));
  const grid = (ox, k) => ({ x: ox + Math.floor(k / ROWS) * P, y: Y0 + (k % ROWS) * P });
  const nBothCells = () => (byCat["both:a"] || []).length;
  const nHypCells = () => (byCat["hypA:a"] || []).length;

  function matchedIndex(c) {
    if (c.cat === "both") return c.k;
    return nBothCells() + c.k;
  }

  function layoutFor(stage, v) {
    const pos = new Map();
    const dupTarget = (c) => {
      const id = c.items[0].id;
      const t = cells.find((x) => x.side === "a" && x.cat !== "dupRow" && x.items.some((it) => it.id === id));
      return t;
    };
    if (stage === 1) {
      for (const c of cells) {
        if (c.cat === "dupRow") { pos.set(c, { x: A1X + (c.k % 40) * P + 3, y: DUP_Y + Math.floor(c.k / 40) * P - 3, a: 1 }); continue; }
        const ox = c.side === "a" ? A1X : B1X;
        pos.set(c, Object.assign(grid(ox, c.fileIdx), { a: 1 }));
      }
      return pos;
    }
    const aRest = cells.filter((c) => c.side === "a" && c.cat !== "dupRow" && !isMatched(c, v));
    const bRest = cells.filter((c) => c.side === "b" && !isMatched(c, v));
    if (U === 1) { aRest.sort((x, y) => x.items[0].id.localeCompare(y.items[0].id)); bRest.sort((x, y) => x.items[0].id.localeCompare(y.items[0].id)); }
    const nMatched = nBothCells() + (v === 2 ? nHypCells() : 0);
    for (const c of cells) if (c.cat !== "dupRow" && isMatched(c, v)) pos.set(c, Object.assign(grid(X0, matchedIndex(c)), { a: 1 }));
    if (stage === 2) {
      aRest.forEach((c, j) => pos.set(c, { x: X0 - (1 + Math.floor(j / ROWS)) * P, y: Y0 + (j % ROWS) * P, a: 1 }));
      bRest.forEach((c, j) => pos.set(c, Object.assign(grid(X0, nMatched + j), { a: 1 })));
    } else {
      for (const cat of [...A_ONLY, ...B_ONLY]) {
        catCells(cat, v).forEach((c, j) => pos.set(c, { x: trayX[cat] + (j % trayCols[cat]) * P, y: TRAY_Y + Math.floor(j / trayCols[cat]) * P, a: 1 }));
      }
    }
    for (const c of cells) if (c.cat === "dupRow") { const t = dupTarget(c); const p = t ? pos.get(t) : { x: A1X, y: Y0 }; pos.set(c, { x: p.x, y: p.y, a: 0 }); }
    return pos;
  }

  function styleOf(c, stage, v) {
    if (c.cat === "dupRow") return 2;
    if (stage < 3 || isMatched(c, v)) return 0;
    if (c.cat === "hypA" || c.cat === "hypB") return 1;
    return 0;
  }

  function frames(stage, v) {
    const aN = cells.filter((c) => c.side === "a" && c.cat !== "dupRow").length, bN = cells.filter((c) => c.side === "b").length;
    if (stage === 1) return { a: { x: A1X, w: Math.ceil(aN / ROWS) * P }, b: { x: B1X, w: Math.ceil(bN / ROWS) * P } };
    const n = nBothCells() + (v === 2 ? nHypCells() : 0);
    const aRest = aN - n, bRest = bN - n;
    const aCols = Math.ceil(aRest / ROWS);
    return { a: { x: X0 - aCols * P, w: (aCols + Math.ceil(n / ROWS)) * P }, b: { x: X0, w: Math.ceil((n + bRest) / ROWS) * P } };
  }

  function goTo(stage, v = ver, opts = {}) {
    if (v !== ver) { ver = v; computeTrays(); }
    const pos = layoutFor(stage, v);
    const fromFrames = currentFrames();
    const instant = opts.instant || UI.reduced();
    const xs = [...pos.values()].map((p) => p.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const trayOrder = [...A_ONLY, ...B_ONLY];
    for (const c of cells) {
      const p = pos.get(c);
      c.fx = c.x; c.fy = c.y; c.tx = p.x; c.ty = p.y; c.fa = c.alpha; c.ta = p.a;
      c.sf = c.stt; c.stt = styleOf(c, stage, v);
      const moved = c.fx !== c.tx || c.fy !== c.ty;
      if (c.cat === "dupRow") c.d = stage === 1 ? 300 : 0;
      else if (stage === 2 && st === 1) c.d = ((c.tx - minX) / Math.max(1, maxX - minX)) * 420 + (c.side === "b" ? 120 : 0);
      else if (stage === 3) c.d = moved ? 120 + Math.max(0, trayOrder.indexOf(c.cat)) * 80 + (c.ty - Y0) * 0.3 : 0;
      else c.d = moved ? Math.random() * 160 : 0;
    }
    frameFrom = fromFrames;
    frameTo = frames(stage, v);
    const prev = st;
    st = stage;
    R = RR();
    animDur = instant ? 0 : 950;
    animT0 = performance.now();
    if (instant) for (const c of cells) { c.x = c.tx; c.y = c.ty; c.sf = c.stt; c.alpha = c.ta; c.mix = 1; }
    kick();
    renderOverlay();
    renderFoot(prev !== stage);
    renderSteps();
    renderList();
    setTrail();
  }
  function currentFrames() {
    if (!frameTo) return frames(st, ver);
    const p = progress(performance.now(), 0);
    if (p >= 1) return frameTo;
    const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * p, w: a.w + (b.w - a.w) * p });
    return { a: lerp(frameFrom.a, frameTo.a), b: lerp(frameFrom.b, frameTo.b) };
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function progress(now, delay) { if (!animDur) return 1; return Math.max(0, Math.min(1, (now - animT0 - delay) / animDur)); }

  function kick() { if (raf) return; raf = requestAnimationFrame(tick); tmo = setTimeout(tick, 80); }
  function tick() { cancelAnimationFrame(raf); clearTimeout(tmo); raf = null; tmo = null; loop(); }
  function loop() {
    const now = performance.now();
    let busy = false;
    for (const c of cells) {
      const p = progress(now, c.d);
      if (p < 1) busy = true;
      const e = ease(p);
      c.x = c.fx + (c.tx - c.fx) * e;
      c.y = c.fy + (c.ty - c.fy) * e;
      c.alpha = c.fa + (c.ta - c.fa) * e;
      c.mix = p;
    }
    draw(now);
    if (busy || flashCell) kick();
  }

  function makePattern(dot, wash) {
    const pc = document.createElement("canvas");
    pc.width = pc.height = Math.round(4 * dpr * scale) || 4;
    const g = pc.getContext("2d");
    const u = pc.width / 4;
    g.fillStyle = wash; g.fillRect(0, 0, pc.width, pc.height);
    g.fillStyle = dot; g.beginPath(); g.arc(2 * u, 2 * u, 1.15 * u, 0, Math.PI * 2); g.fill();
    const pat = ctx.createPattern(pc, "repeat");
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / (dpr * scale), 1 / (dpr * scale)));
    return pat;
  }

  function inFocus(c) {
    const f = focusCats;
    if (!f) return true;
    return f.has(c.cat + ":" + c.side) || (f.has("both") && isMatched(c, ver)) || (f.has("div") && c.div);
  }

  function draw(now = performance.now()) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    const fr = currentFrames();
    drawFrame(fr.a, "rgba(91,140,255,0.07)", "a");
    ctx.globalCompositeOperation = "multiply";
    drawFrame(fr.b, "rgba(255,79,163,0.07)", "b");
    ctx.globalCompositeOperation = "source-over";
    if (st >= 3) drawShelves();
    for (const pass of ["a", "b"]) {
      ctx.globalCompositeOperation = pass === "b" ? "multiply" : "source-over";
      for (const c of cells) {
        if (c.side !== pass || c.alpha <= 0.01) continue;
        ctx.globalAlpha = (inFocus(c) ? 1 : 0.13) * c.alpha;
        paintCell(c);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (st >= 3 && ver === 1) drawArcs();
    if (showDiv) for (const c of cells) if (c.div && c.side === "a") { ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.4; ctx.strokeRect(c.x - 1, c.y - 1, C + 2, C + 2); }
    if (selCell) outline(selCell, COL.ink, 2);
    if (flashCell) {
      const t = (now - flashCell.t0) / 900;
      if (t > 1) flashCell = null;
      else { ctx.globalAlpha = 1 - t; ctx.strokeStyle = COL.ab; ctx.lineWidth = 2; const r = 6 + t * 16; ctx.strokeRect(flashCell.c.x + C / 2 - r, flashCell.c.y + C / 2 - r, r * 2, r * 2); ctx.globalAlpha = 1; }
    }
  }
  function outline(c, color, w) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.strokeRect(c.x - 1.5, c.y - 1.5, C + 3, C + 3);
    const twin = partnerOf(c);
    if (twin) ctx.strokeRect(twin.x - 1.5, twin.y - 1.5, C + 3, C + 3);
  }
  function partnerOf(c) {
    if (c.cat === "both") return (byCat[`both:${c.side === "a" ? "b" : "a"}`] || [])[c.k];
    if (c.cat === "hypA") return (byCat["hypB:b"] || [])[c.k];
    if (c.cat === "hypB") return (byCat["hypA:a"] || [])[c.k];
    return null;
  }
  function drawFrame(f, fill, side) {
    const x = f.x - 6, y = Y0 - 6, w = f.w + 10, hgt = ROWS * P + 10;
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, hgt);
    ctx.strokeStyle = "rgba(18,20,25,0.28)"; ctx.lineWidth = 0.8; ctx.strokeRect(x, y, w, hgt);
    ctx.strokeStyle = COL.ink3; ctx.lineWidth = 1;
    const m = 10, o = 5;
    ctx.beginPath();
    const corners = side === "a" ? [[x, y, -1, -1], [x, y + hgt, -1, 1]] : [[x + w, y, 1, -1], [x + w, y + hgt, 1, 1]];
    for (const [cx, cy, dx, dy] of corners) { ctx.moveTo(cx + dx * o, cy); ctx.lineTo(cx + dx * (o + m), cy); ctx.moveTo(cx, cy + dy * o); ctx.lineTo(cx, cy + dy * (o + m)); }
    ctx.stroke();
  }
  function drawShelves() {
    if (shelfX.possible === undefined) return;
    const x0 = shelfX.possible - 14, x1 = shelfX.possibleEnd + 14;
    ctx.strokeStyle = COL.ab; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.7;
    ctx.strokeRect(x0, TRAY_Y - 112, x1 - x0, SH - (TRAY_Y - 112) - 4);
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  function paintCell(c) {
    const fill = c.side === "a" ? COL.a : COL.b;
    const mix = c.mix === undefined ? 1 : c.mix;
    const from = c.sf, to = c.stt;
    const draw1 = (style, alpha) => {
      if (alpha <= 0) return;
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * alpha;
      if (style === 1) {
        ctx.fillStyle = c.side === "a" ? patA : patB;
        ctx.fillRect(c.x, c.y, C, C);
        ctx.strokeStyle = fill; ctx.lineWidth = 0.8; ctx.strokeRect(c.x + 0.4, c.y + 0.4, C - 0.8, C - 0.8);
      } else if (style === 2) {
        ctx.fillStyle = "#fff"; ctx.fillRect(c.x, c.y, C, C);
        ctx.strokeStyle = COL.b; ctx.lineWidth = 1.2; ctx.strokeRect(c.x + 0.6, c.y + 0.6, C - 1.2, C - 1.2);
        ctx.fillStyle = fill; ctx.fillRect(c.x - 3, c.y + 3, C, C);
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(c.x, c.y, C, C);
        if (U > 1 && c.items.length < U) { ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(c.x, c.y, C, C * (1 - c.items.length / U)); }
      }
      ctx.globalAlpha = ga;
    };
    if (from === to || mix >= 1) draw1(to, 1);
    else { draw1(from, 1 - mix); draw1(to, mix); }
  }
  function drawArcs() {
    const f = focusCats;
    const hot = f && (f.has("hypA:a") || f.has("hypB:b"));
    ctx.strokeStyle = COL.ab;
    ctx.lineWidth = hot ? 1.3 : 0.9;
    ctx.globalAlpha = hot ? 0.95 : f ? 0.15 : 0.55;
    ctx.setLineDash([2, 2.5]);
    const A = byCat["hypA:a"] || [], B = byCat["hypB:b"] || [];
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      const a = A[i], b = B[i];
      const x1 = a.x + C / 2, y1 = a.y + C, x2 = b.x + C / 2, y2 = b.y + C;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 34, x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function resize() {
    const compact = root.clientWidth < 900;
    rcEl.classList.toggle("compact", compact);
    const w = stageEl.clientWidth;
    let hh = stageEl.clientHeight;
    if (!w) return;
    if (compact) {
      const want = Math.round(SH * Math.min(w / SW, 1.25)) + 8;
      if (Math.abs(stageEl.offsetHeight - want) > 1) stageEl.style.height = want + "px";
      hh = want;
    } else if (stageEl.style.height) { stageEl.style.height = ""; hh = stageEl.clientHeight; }
    if (!w || !hh) return;
    scale = Math.min(w / SW, hh / SH, 1.25);
    dpr = window.devicePixelRatio || 1;
    const offX = Math.max(0, (w - SW * scale) / 2), offY = Math.max(0, (hh - SH * scale) / 2);
    sceneEl.style.left = offX + "px"; sceneEl.style.top = offY + "px";
    canvas.width = Math.round(SW * scale * dpr); canvas.height = Math.round(SH * scale * dpr);
    canvas.style.width = SW * scale + "px"; canvas.style.height = SH * scale + "px";
    ov.style.width = SW + "px"; ov.style.height = SH + "px"; ov.style.transform = `scale(${scale})`;
    patA = makePattern(COL.aDeep, COL.aWash);
    patB = makePattern(COL.bDeep, COL.bWash);
    draw();
  }

  const spec = (cat) => R1.cat[cat];
  const idsOf = (cat, rr = RR()) => (cat === "both" ? rr.matched : rr.cat[cat].items.length);
  const proofWord = (cat) => (spec(cat).proof === "possible" ? "possível" : "comprovado");

  function renderOverlay() {
    const fr = frames(st, ver);
    const rr = RR();
    const nMatchedCells = nBothCells() + (ver === 2 ? nHypCells() : 0);
    if (!ovEls.aTab) {
      ovEls.aTab = h("div", { class: "ptab a" });
      ovEls.bTab = h("div", { class: "ptab b" });
      ovEls.m = h("div", { class: "mlabel" });
      ovEls.dup = h("button", { type: "button", class: "dup-lbl", onclick: () => openCat("dupRow") });
      ovEls.div = h("div", { class: "div-tag" });
      ovEls.unit = h("div", { class: "unit-cap" });
      ov.append(ovEls.aTab, ovEls.bTab, ovEls.m, ovEls.dup, ovEls.div, ovEls.unit);
      for (const sh of SHELVES) { ovEls["s_" + sh.key] = h("div", { class: `shelf-cap ${sh.key === "possible" ? "hyp" : ""}` }, sh.label); ov.append(ovEls["s_" + sh.key]); }
      for (const cat of [...A_ONLY, ...B_ONLY]) {
        const side = sideOf(cat);
        const b = h("button", { type: "button", class: `tray ${side}`, "data-cat": cat });
        b.addEventListener("mouseenter", () => setFocus(new Set([cat + ":" + side])));
        b.addEventListener("mouseleave", () => setFocus(null));
        b.addEventListener("focus", () => setFocus(new Set([cat + ":" + side])));
        b.addEventListener("blur", () => setFocus(null));
        b.addEventListener("click", () => openCat(cat));
        ovEls["t_" + cat] = b;
        ov.append(b);
      }
    }
    ovEls.aTab.replaceChildren(h("b", null, fmt(rr.aDistinct)), h("span", null, `A · cadastro · ids${st === 1 ? ` de ${fmt(rr.aCount)} linhas` : ""}`));
    ovEls.bTab.replaceChildren(h("b", null, fmt(rr.bDistinct)), h("span", null, `B · atendidos em ${yearOf()} · ids${st === 1 ? ` de ${fmt(rr.bRows)} atendimentos` : ""}`));
    ovEls.aTab.style.left = fr.a.x - 6 + "px"; ovEls.aTab.style.top = Y0 - 50 + "px";
    if (st === 1) { ovEls.bTab.style.left = fr.b.x - 6 + "px"; ovEls.bTab.style.transform = "none"; }
    else { ovEls.bTab.style.left = fr.b.x + fr.b.w + 4 + "px"; ovEls.bTab.style.transform = "translateX(-100%)"; }
    ovEls.bTab.style.top = Y0 - 50 + "px";
    ovEls.m.replaceChildren(h("b", null, fmt(rr.matched)), h("span", null, ver === 2 ? `ids nos dois · ${fmt(rr.matchedViaRule.length)} pela regra` : "ids nos dois"));
    ovEls.m.style.left = X0 + (Math.ceil(nMatchedCells / ROWS) * P) / 2 + "px";
    ovEls.m.style.top = Y0 + (ROWS * P) / 2 + "px";
    ovEls.m.style.transform = "translate(-50%, -50%)";
    ovEls.m.style.opacity = st >= 2 ? 1 : 0;
    ovEls.dup.replaceChildren(h("b", null, `${fmt(rr.dupRows.length)} linhas repetidas`), h("span", null, " repetem um id já contado · viram 1 id cada"));
    ovEls.dup.style.left = A1X + "px";
    ovEls.dup.style.top = DUP_Y + Math.ceil(cells.filter((c) => c.cat === "dupRow").length / 40) * P + 6 + "px";
    ovEls.dup.classList.toggle("gone", st !== 1 || !rr.dupRows.length);
    ovEls.div.replaceChildren(h("span", null, `${fmt(R1.divergent.length)} ids com cozinha diferente`));
    ovEls.div.style.left = X0 + Math.ceil(nMatchedCells / ROWS) * P + 18 + "px";
    ovEls.div.style.top = Y0 + 8 + "px";
    ovEls.div.style.opacity = showDiv && st >= 2 ? 1 : 0;
    ovEls.unit.textContent = U > 1 ? `cada quadrado = até ${fmt(U)} ids · contagens exatas nos textos` : "cada quadrado = 1 id";
    ovEls.unit.style.left = SW - 16 + "px";
    ovEls.unit.style.top = SH - 22 + "px";
    for (const sh of SHELVES) {
      const el = ovEls["s_" + sh.key];
      const on = st >= 3 && shelfX[sh.key] !== undefined;
      el.classList.toggle("gone", !on);
      if (on) { el.style.left = shelfX[sh.key] - (sh.key === "possible" ? 8 : 0) + "px"; el.style.top = TRAY_Y - 108 + "px"; el.style.width = shelfX[sh.key + "End"] - shelfX[sh.key] + (sh.key === "possible" ? 16 : 0) + "px"; }
    }
    for (const cat of [...A_ONLY, ...B_ONLY]) {
      const b = ovEls["t_" + cat];
      const n = idsOf(cat);
      const sp = spec(cat);
      const live = trayX[cat] !== undefined && n > 0;
      b.classList.toggle("gone", st < 3 || !live);
      if (!live) continue;
      b.style.left = trayX[cat] + "px";
      b.style.top = TRAY_Y - 58 + "px";
      b.style.width = Math.max(trayCols[cat] * P, 70) + "px";
      b.style.height = "52px";
      b.setAttribute("aria-pressed", String(!!(panel && panel.isOpen && openCatKey === cat)));
      b.setAttribute("aria-label", `${fmt(n)} ids, ${sp.title}, ${proofWord(cat)}. Abrir registros.`);
      b.replaceChildren(h("b", null, (sp.side === "a" ? "−" : "+") + fmt(n)));
    }
  }

  function setFocus(set) { focusCats = set; draw(); }

  function renderSteps() {
    stepsEl.replaceChildren(...STEP_LABELS.map((l, i) => h("button", { type: "button", "aria-current": st === i + 1 ? "step" : null, class: st > i + 1 ? "done" : "", onclick: () => { stopAuto(); goTo(i + 1); } }, h("i", null, String(i + 1)), h("span", null, l))),
      h("button", { type: "button", class: "play", "aria-label": "Reproduzir os quatro passos", title: "Reproduzir os quatro passos", onclick: () => play(true) }, s("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }, s("path", { d: "M3 2l9 5-9 5z", fill: "currentColor" }))));
    verEl.className = `ver-chip ${ver === 2 ? "v2" : ""}`;
    verEl.textContent = ver === 2 ? "versão 2 · regra aceita" : "versão 1";
  }

  function focusBtn(content, focus, onClick, cls = "") {
    const b = h("button", { type: "button", class: cls }, ...[].concat(content));
    b.addEventListener("mouseenter", () => setFocus(focus));
    b.addEventListener("mouseleave", () => setFocus(null));
    b.addEventListener("focus", () => setFocus(focus));
    b.addEventListener("blur", () => setFocus(null));
    b.addEventListener("click", onClick);
    return b;
  }

  const F = {
    both: () => new Set(["both"]),
    aOnly: () => new Set(A_ONLY.map((c) => c + ":a")),
    bOnly: () => new Set(B_ONLY.map((c) => c + ":b")),
    hyp: () => new Set(["hypA:a", "hypB:b"]),
    allA: () => new Set(["both", ...A_ONLY.map((c) => c + ":a")]),
    allB: () => new Set(["both", ...B_ONLY.map((c) => c + ":b")]),
  };

  function srcCard(side, title, rows) {
    return h("div", { class: `src-card ${side}` }, h("p", { class: "sc-t" }, h("i"), title), h("dl", null, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
  }

  function renderAnswer() {
    if (!answerEl) return;
    const rr = RR();
    const aOnly = rr.aOnlyCount, bOnly = rr.bOnlyCount, hyp = rr.cat.hypA.items.length;
    const same = rr.netDiff === rr.unmatched;
    const sentence = [
      same ? `Aqui a diferença coincide com as sobras, porque só um lado tem ids sem par.` : `Os totais diferem em ${fmt(Math.abs(rr.netDiff))} ids, mas ${fmt(rr.unmatched)} não aparecem nos dois lados: os ${fmt(bOnly)} só nos atendimentos compensam, no total, parte dos ${fmt(aOnly)} só no cadastro. São pessoas diferentes.`,
      ver === 2 ? ` Com a regra aceita (versão 2), ${fmt(rr.matchedViaRule.length)} pares contam como nos dois.` : hyp ? ` ${fmt(hyp)} de cada lado têm um possível par por zeros à esquerda: hipótese, ainda sem par.` : "",
    ].join("");
    answerEl.replaceChildren(
      h("div", { class: "ra-n" }, h("b", null, fmt(Math.abs(rr.netDiff))), h("span", null, "ids de diferença nos totais"), h("small", null, `${fmt(rr.aDistinct)} − ${fmt(rr.bDistinct)}`)),
      focusBtn([h("b", null, fmt(rr.unmatched)), h("span", null, "ids sem par exato"), h("small", null, `${fmt(aOnly)} só no cadastro + ${fmt(bOnly)} só nos atendimentos`)], new Set([...F.aOnly(), ...F.bOnly()]), () => { stopAuto(); goTo(3); }, "ra-n u"),
      h("div", { class: "ra-x" }, h("p", null, sentence), h("p", { class: "ra-unit" }, `Contado em ids distintos. O cadastro tem ${fmt(rr.aCount)} linhas = ${fmt(rr.aDistinct)} ids${rr.dupRows.length ? ` (${fmt(rr.dupRows.length)} linhas repetidas)` : ""}; os atendimentos, ${fmt(rr.bRows)} linhas = ${fmt(rr.bDistinct)} ids.`)));
  }

  function catList() {
    const rr = RR();
    const item = (cat) => {
      const sp = spec(cat);
      const n = idsOf(cat);
      return focusBtn([h("b", null, (sp.side === "a" ? "−" : "+") + fmt(n)), h("span", { class: "ci-t" }, sp.title), h("span", { class: "ci-s" }, sp.sub)], new Set([cat + ":" + sp.side]), () => openCat(cat), `cat-i ${sp.side} ${sp.proof === "possible" ? "hyp" : ""}`);
    };
    const live = (cats) => cats.filter((c) => idsOf(c) > 0);
    const groups = [];
    const aP = live(["before", "after", "noService"]);
    if (aP.length) groups.push(h("section", { class: "cat-g" }, h("h3", null, "Comprovado · só no cadastro"), ...aP.map(item)));
    if (ver === 1 && live(["hypA", "hypB"]).length) groups.push(h("section", { class: "cat-g hyp" }, h("h3", null, "Possível · não conta como par"), ...live(["hypA", "hypB"]).map(item)));
    if (ver === 2) groups.push(h("section", { class: "cat-g hyp" }, h("h3", null, "Regra aceita · versão 2"), focusBtn([h("b", null, fmt(rr.matchedViaRule.length)), h("span", { class: "ci-t" }, "pares pela regra dos zeros"), h("span", { class: "ci-s" }, "agora contam como nos dois")], F.both(), () => openCat("hypA"), "cat-i ab")));
    const bP = live(["noReg"]);
    if (bP.length) groups.push(h("section", { class: "cat-g" }, h("h3", null, "Comprovado · só nos atendimentos"), ...bP.map(item)));
    return h("div", { class: "cat-groups" }, ...groups);
  }

  function rulesDetails() {
    const rr = RR();
    const li = (n, label, count, note) => h("li", null, h("i", null, n), h("span", null, label), h("b", null, count), note ? h("small", null, note) : null);
    return h("details", { class: "ev-more" }, h("summary", null, h("span", { class: "em-t" }, "Como cada id é classificado"), h("span", { class: "em-m" }, "4 regras, nesta ordem")),
      h("div", { class: "em-body" },
        h("p", { class: "small-note" }, "Cada id recebe a primeira regra que se aplica, então nenhum id aparece em duas causas."),
        h("ol", { class: "rule-list" },
          li("1", "nos dois pela chave exata", fmt(rr.matched)),
          cmp === "active" ? li("2", "fora do período de B", "—", "não se aplica: A já foi filtrado pela vigência") : li("2", "fora do período de B", fmt(rr.cat.before.items.length + rr.cat.after.items.length)),
          li("3", ver === 2 ? "zeros à esquerda · regra aceita" : "possível por zeros à esquerda", fmt(ver === 2 ? rr.matchedViaRule.length * 2 : rr.cat.hypA.items.length + rr.cat.hypB.items.length), ver === 2 ? "contam como nos dois" : "hipótese: não conta como par"),
          li("4", "sem par", fmt(rr.cat.noService.items.length + rr.cat.noReg.items.length))),
        h("div", { class: "rc-tools" },
          h("button", { type: "button", class: "chip", "aria-pressed": String(showDiv), onclick: () => { showDiv = !showDiv; renderOverlay(); draw(); if (showDiv) openCat("div"); } }, "cozinha diferente nos dois ", h("b", null, fmt(R1.divergent.length))),
          h("button", { type: "button", class: "btn quiet", onclick: () => App.go("mapa", { select: "r1" }) }, "Abrir a relação no mapa"))));
  }

  function renderFoot(changed) {
    const rr = RR();
    const y = yearOf();
    const kids = [];
    const next = (label, stage) => h("button", { type: "button", class: "btn primary", onclick: () => { stopAuto(); goTo(stage); } }, label);
    const head = (n, title) => h("p", { class: "side-k" }, h("i", null, String(n)), title);
    if (st === 1) {
      const ex = rr.aExcluded;
      kids.push(head(1, "Fontes"),
        srcCard("a", "A · cadastro", [
          ["arquivo", "beneficiarios.csv · versão 1"],
          ["filtro", cmp === "active" ? `ativos em algum momento de ${y} · exclui ${fmt(ex.before.length)} desligados antes e ${fmt(ex.after.length)} cadastrados depois` : "nenhum · todas as linhas"],
          ["unidade", h("b", null, `${fmt(rr.aCount)} linhas → ${fmt(rr.aDistinct)} ids`)],
        ]),
        srcCard("b", "B · atendidos", [
          ["arquivo", "atendimentos.csv · versão 1"],
          ["filtro", `data em ${y}`],
          ["unidade", h("b", null, `${fmt(rr.bRows)} linhas → ${fmt(rr.bDistinct)} ids`)],
        ]),
        h("p", { class: "step-note" }, "Linhas repetidas de um mesmo id contam uma vez."),
        next("Alinhar pela chave →", 2),
        h("div", { class: "src-card key" }, h("p", { class: "sc-t" }, "Como se compara"), h("dl", null,
          h("dt", null, "chave"), h("dd", { class: "mono" }, "id = beneficiario_id"),
          h("dt", null, "regra"), h("dd", null, "igualdade exata; normalizações viram hipóteses"),
          h("dt", null, "período"), h("dd", null, `01/01/${y} a 31/12/${y}`))));
    }
    if (st === 2) {
      kids.push(head(2, "Alinhar pela chave"),
        h("p", { class: "step-note" }, h("b", null, `${fmt(rr.matched)} ids estão nos dois`), ` pela chave exata (violeta).`),
        h("p", { class: "step-note" }, `Sobram ${fmt(rr.aOnlyCount)} só no cadastro, à esquerda, e ${fmt(rr.bOnlyCount)} só nos atendimentos, à direita.`),
        next("Ver o que explica as sobras →", 3));
    }
    if (st === 3) {
      kids.push(head(3, "O que explica as sobras"), h("p", { class: "step-note" }, "Selecione uma causa para destacá-la e ver critério, chave e registros."), catList(), next("Fechar a conta →", 4), rulesDetails());
    }
    if (st === 4) {
      const aOnly = rr.aOnlyCount, bOnly = rr.bOnlyCount;
      const parts = (keys) => { const p = keys.map((k) => rr.cat[k].items.length).filter((n) => n > 0); return p.length > 1 ? p.map(fmt).join(" + ") : null; };
      const row = (op, n, label, sub, focus, cat, cls) => focusBtn([h("span", { class: "lg-op" }, op), h("b", null, fmt(n)), h("span", { class: "lg-l" }, label, sub ? h("small", null, sub) : null)], focus, () => openCat(cat), `lg-row ${cls || ""}`);
      const ledger = h("div", { class: "ledger" + (changed && !UI.reduced() ? " building" : ""), role: "group", "aria-label": `${fmt(rr.aDistinct)} menos ${fmt(aOnly)} mais ${fmt(bOnly)} igual a ${fmt(rr.bDistinct)} ids` },
        row("", rr.aDistinct, "ids no cadastro", null, F.allA(), "allA"),
        row("−", aOnly, "só no cadastro", parts(A_ONLY), F.aOnly(), "aOnly", "a"),
        row("+", bOnly, "só nos atendimentos", parts(B_ONLY), F.bOnly(), "bOnly", "b"),
        row("=", rr.bDistinct, "ids nos atendimentos", null, F.allB(), "allB", "tot"));
      const ok = (cond, text) => h("li", { class: cond ? "ok" : "bad" }, h("i", { "aria-hidden": "true" }, cond ? "✓" : "✕"), text);
      const list = [
        [rr.matched + aOnly === rr.aDistinct, `${fmt(rr.matched)} nos dois + ${fmt(aOnly)} só no cadastro = ${fmt(rr.aDistinct)} ids`],
        [rr.matched + bOnly === rr.bDistinct, `${fmt(rr.matched)} nos dois + ${fmt(bOnly)} só nos atendimentos = ${fmt(rr.bDistinct)} ids`],
        [rr.closesRows, `${fmt(rr.aCount)} linhas − ${fmt(rr.dupRows.length)} repetidas = ${fmt(rr.aDistinct)} ids no cadastro`],
        [true, `${fmt(rr.bRows)} atendimentos → ${fmt(rr.bDistinct)} ids distintos`],
      ];
      const okN = list.filter((x) => x[0]).length;
      const checks = h("details", { class: "ev-more" }, h("summary", null, h("span", { class: "em-t" }, "Verificações da conta"), h("span", { class: "em-m" }, `${okN} de ${list.length} conferem`)), h("div", { class: "em-body" }, h("ul", { class: "checks" }, ...list.map(([c, t]) => ok(c, t)))));
      kids.push(head(4, "Fechar a conta"), ledger, checks, rulesDetails());
      if (changed && !UI.reduced()) { const ps = [...ledger.children]; ps.forEach((p, i) => setTimeout(() => { p.style.opacity = 1; p.style.transform = "none"; }, 120 + i * 110)); setTimeout(() => ledger.classList.remove("building"), 120 + ps.length * 110 + 400); }
    }
    footEl.replaceChildren(...kids);
    renderAnswer();
  }

  function renderList() {
    listEl.replaceChildren();
    if (true) return;
    listEl.replaceChildren(...[...A_ONLY, ...B_ONLY].filter((c) => idsOf(c) > 0 && !(ver === 2 && (c === "hypA" || c === "hypB"))).map((cat) => {
      const sp = spec(cat);
      return h("button", { type: "button", onclick: () => openCat(cat) }, h("b", { style: { color: sp.side === "a" ? "var(--a-deep)" : "var(--b-deep)" } }, (sp.side === "a" ? "−" : "+") + fmt(idsOf(cat))), h("span", null, sp.title), h("small", null, `${proofWord(cat)} · ${sp.side === "a" ? "só em A" : "só em B"} · ids`));
    }));
  }

  const kcol = (id) => (id && T.kitchen[id] ? T.kitchen[id].nome.replace("Cozinha ", "") : "sem cozinha");
  const RULE_TEXT = {
    2: (y) => `Fora do período de B: o cadastro diz que a pessoa não estava ativa em ${y}, então não poderia aparecer nos atendimentos de ${y}.`,
    3: () => "Possível correspondência: o id não existe do outro lado, mas o mesmo número sem zeros à esquerda existe, e é o único candidato nos dois sentidos. É hipótese: não conta como par.",
    4: () => "Sem par: nenhum id igual do outro lado, nem igual depois de tirar zeros à esquerda.",
  };

  function section(title, ...kids) { return h("section", { class: "cat-sec" }, h("h3", null, title), ...kids); }
  function aRowsTable(rows, extraCols = [], title) {
    return recordTable({ rows, pageSize: 30, maxHeight: "380px", ariaLabel: title, onRow: (r) => selectFor(r.id, "a"), onHover: (r) => flashFor(r && r.id, "a"),
      columns: [{ key: "_line", label: "linha", align: "r", mono: true }, { key: "id", label: "id", mono: true }, { key: "nome", label: "nome" }, { key: "cozinha_id", label: "cozinha", get: (r) => kcol(r.cozinha_id) },
        { key: "data_cadastro", label: "cadastro", mono: true, render: (r) => T.dateBR(r.data_cadastro) }, { key: "data_desligamento", label: "desligamento", mono: true, render: (r) => T.dateBR(r.data_desligamento) }, ...extraCols] });
  }
  function bRowsTable(items, title) {
    const rows = items.flatMap((it) => it.att);
    return recordTable({ rows, pageSize: 30, maxHeight: "380px", ariaLabel: title, onRow: (a) => selectFor(a.beneficiario_id, "b"), onHover: (a) => flashFor(a && a.beneficiario_id, "b"),
      columns: [{ key: "_line", label: "linha", align: "r", mono: true }, { key: "id", label: "atendimento", mono: true }, { key: "data", label: "data", mono: true, render: (a) => T.dateBR(a.data) }, { key: "beneficiario_id", label: "beneficiario_id", mono: true }, { key: "cozinha_id", label: "cozinha", get: (a) => kcol(a.cozinha_id) }] });
  }
  function cellFor(id, side) { return cells.find((c) => c.side === side && c.cat !== "dupRow" && c.items.some((it) => it.id === id)); }
  function selectFor(id, side) { selCell = cellFor(id, side) || null; draw(); }
  function flashFor(id, side) { if (!id) return; const c = cellFor(id, side); if (c) { flashCell = { c, t0: performance.now() }; kick(); } }

  function keySection(extra) {
    return section("Chave usada", h("p", { class: "mono key-l" }, "beneficiarios.id = atendimentos.beneficiario_id"), h("p", { class: "small-note" }, `Comparação exata. Normalização testada só para hipóteses: zeros à esquerda.${extra ? " " + extra : ""}`));
  }

  function openCat(cat) {
    stopAuto();
    openCatKey = cat;
    const rr = RR();
    const y = yearOf();
    const back = { label: "Voltar à visão geral", go: () => panel.close() };
    focusCats = { aOnly: F.aOnly(), bOnly: F.bOnly(), allA: F.allA(), allB: F.allB(), both: F.both(), div: new Set(["div"]), hypA: F.hyp(), hypB: F.hyp(), dupRow: new Set(["dupRow:a"]) }[cat] || new Set([cat + ":" + sideOf(cat)]);
    let eyebrow, title, sub, body;
    if (["before", "after", "noService", "noReg"].includes(cat)) {
      const sp = spec(cat);
      const items = rr.cat[cat].items;
      const isA = sp.side === "a";
      eyebrow = `${isA ? "Só em A · cadastro" : "Só em B · atendimentos"} · regra ${sp.rule} de 4`;
      title = `${fmt(items.length)} ids · ${sp.title}`;
      sub = sp.sub;
      const attN = isA ? 0 : items.reduce((a, it) => a + it.att.length, 0);
      body = [
        h("div", { class: "statusline" }, h("span", { class: "proof proven" }, h("i"), "comprovado pelos dados"), h("span", { class: "mono small" }, `entra na conta como ${isA ? "−" : "+"}${fmt(items.length)} ids`)),
        section("Por que está aqui", h("div", { class: "rule-box" }, h("b", null, `Regra ${sp.rule} de 4`), h("span", null, RULE_TEXT[sp.rule](y)), h("span", { class: "mono crit" }, `critério: ${sp.criterion}`))),
        section("Contagem", h("dl", { class: "kv" }, h("dt", null, "ids"), h("dd", null, fmt(items.length)), h("dt", null, isA ? "linhas do cadastro" : "atendimentos"), h("dd", null, fmt(isA ? items.length : attN)), isA ? null : h("dt", null, "unidade da conta"), isA ? null : h("dd", null, "ids distintos, não atendimentos"))),
        keySection(),
        section("Correspondências alternativas", h("p", { class: "small-note" }, sp.rule === 2 ? "A regra 2 vem antes da 3: mesmo que existisse candidato por zeros, a ausência já está explicada pelo período." : "Nenhum candidato: não há id igual depois de tirar zeros à esquerda.")),
        section("Registros originais", isA ? aRowsTable(items.map((it) => it.row), cat === "noService" ? [{ key: "_n", label: `atend. ${y}`, align: "r", get: () => 0 }] : [], title) : bRowsTable(items, title)),
      ];
    } else if (cat === "hypA" || cat === "hypB") {
      const accepted = ver === 2;
      eyebrow = accepted ? "Nos dois · pela regra aceita · versão 2" : "Ambíguos · regra 3 de 4";
      title = `${fmt(R1.pairs.length)} pares possíveis`;
      sub = "o mesmo número, com e sem zeros à esquerda";
      body = [
        h("div", { class: "statusline" }, h("span", { class: `proof ${accepted ? "proven" : "possible"}` }, h("i"), accepted ? "par pela regra aceita" : "possível · hipótese"), h("span", { class: "mono small" }, accepted ? "agora contam em nos dois" : `seguem na conta como −${fmt(R1.pairs.length)} em A e +${fmt(R1.pairs.length)} em B`)),
        section("Por que está aqui", h("div", { class: "rule-box" }, h("b", null, "Regra 3 de 4"), h("span", null, RULE_TEXT[3]()), h("span", { class: "mono crit" }, `critério A: ${spec("hypA").criterion}`), h("span", { class: "mono crit" }, `critério B: ${spec("hypB").criterion}`))),
        keySection("Nenhum id foi alterado: a regra é uma decisão sua, registrada como versão."),
        ...pairsBody(),
      ];
    } else if (cat === "aOnly" || cat === "bOnly") {
      const list = cat === "aOnly" ? A_ONLY : B_ONLY;
      eyebrow = cat === "aOnly" ? "Só em A · cadastro" : "Só em B · atendimentos";
      title = `${fmt(cat === "aOnly" ? rr.aOnlyCount : rr.bOnlyCount)} ids ${cat === "aOnly" ? "sem par exato em B" : "sem par exato em A"}`;
      sub = "Decomposição exclusiva, na ordem das regras";
      body = [h("div", { class: "links-list" }, ...list.filter((c) => rr.cat[c].items.length).map((c) => h("button", { type: "button", class: "link-card", onclick: () => openCat(c) }, h("span", { class: "lt" }, `${fmt(rr.cat[c].items.length)} ids · ${spec(c).title}`), h("span", { class: `proof ${spec(c).proof === "possible" ? "possible" : "proven"}` }, h("i"), proofWord(c)), h("span", { class: "ld" }, `regra ${spec(c).rule} · ${spec(c).sub}`)))),
        h("p", { class: "small-note" }, `Soma: ${list.map((c) => rr.cat[c].items.length).filter(Boolean).map(fmt).join(" + ")} = ${fmt(cat === "aOnly" ? rr.aOnlyCount : rr.bOnlyCount)} ids. Nenhum id aparece em duas causas.`)];
    } else if (cat === "dupRow") {
      eyebrow = "Fontes · A · ponte de unidade";
      title = `${fmt(rr.dupRows.length)} linhas repetidas`;
      sub = "não são causa de diferença: são a conversão de linhas em ids";
      body = [h("div", { class: "rule-box" }, h("b", null, "Linhas → ids"), h("span", null, `O mesmo id aparece em mais de uma linha do cadastro. A comparação conta ids: a primeira linha representa o id e as outras não entram na conta. ${fmt(rr.aCount)} linhas − ${fmt(rr.dupRows.length)} = ${fmt(rr.aDistinct)} ids.`)),
        section("Registros originais", aRowsTable(rr.dupRows, [{ key: "_f", label: "primeira linha", align: "r", get: (r) => rr.firstRow.get(r.id)._line }], title))];
    } else if (cat === "div") {
      eyebrow = "Nos dois · mesma chave, valor diferente";
      title = `${fmt(R1.divergent.length)} ids com cozinha diferente`;
      sub = `${fmt(R1.divergent.filter((d) => d.onlyElsewhere).length)} só em outra cozinha · ${fmt(R1.divergent.filter((d) => !d.onlyElsewhere).length)} em mais de uma`;
      body = [h("p", { class: "small-note" }, "Estão nos dois conjuntos, então não mudam a conta. A cozinha do cadastro e a do atendimento discordam: é o que muda “beneficiários por cozinha” conforme o caminho."),
        recordTable({ rows: R1.divergent, pageSize: 30, maxHeight: "420px", onRow: (d) => selectFor(d.id, "a"), onHover: (d) => flashFor(d && d.id, "a"), columns: [
          { key: "id", label: "id", mono: true }, { key: "ref", label: "no cadastro", get: (d) => kcol(d.ref) }, { key: "_k", label: "nos atendimentos", get: (d) => d.kitchens.map(kcol).join(", ") }, { key: "_o", label: "", get: (d) => (d.onlyElsewhere ? "só em outra" : "em mais de uma"), render: (d) => h("span", { class: "tagx" }, d.onlyElsewhere ? "só em outra" : "em mais de uma") }] })];
    } else if (cat === "both") {
      eyebrow = "Nos dois";
      title = `${fmt(rr.matched)} ids nos dois`;
      sub = ver === 2 ? `${fmt(R1.both.length)} pela chave exata · ${fmt(rr.matchedViaRule.length)} pela regra aceita` : "pela chave exata";
      const rows = R1.both.map((id) => R1.firstRow.get(id));
      body = [keySection(), section("Registros de A que casaram", aRowsTable(rows, [{ key: "_n", label: `atend. ${y}`, align: "r", get: (r) => (R1.bMap.get(r.id) || []).length }], title))];
    } else if (cat === "allA" || cat === "allB") {
      const isA = cat === "allA";
      eyebrow = isA ? "A · cadastro" : `B · atendidos em ${y}`;
      title = isA ? `${fmt(rr.aDistinct)} ids em A` : `${fmt(rr.bDistinct)} ids em B`;
      sub = isA ? `de ${fmt(rr.aCount)} linhas · ${fmt(rr.dupRows.length)} repetidas` : `de ${fmt(rr.bRows)} atendimentos`;
      const where = new Map();
      for (const c of [...A_ONLY, ...B_ONLY]) for (const it of rr.cat[c].items) where.set((sideOf(c)) + it.id, spec(c).title);
      if (isA) body = [section("Todos os ids de A", aRowsTable([...rr.firstRow.values()], [{ key: "_c", label: "na comparação", get: (r) => where.get("a" + r.id) || "nos dois" }], title))];
      else body = [section("Todos os ids de B", recordTable({ rows: [...R1.bMap.entries()].map(([id, att]) => ({ id, att })), pageSize: 30, maxHeight: "420px", onRow: (r) => selectFor(r.id, "b"), onHover: (r) => flashFor(r && r.id, "b"), columns: [{ key: "id", label: "beneficiario_id", mono: true }, { key: "_n", label: "atendimentos", align: "r", get: (r) => r.att.length }, { key: "_c", label: "na comparação", get: (r) => where.get("b" + r.id) || "nos dois" }] }))];
    }
    panel.open({ eyebrow, eyebrowClass: ["noReg", "bOnly", "allB", "hypB"].includes(cat) ? "b" : ["div", "hypA", "both"].includes(cat) ? "ab" : "a", title, sub, body, back });
    renderOverlay();
    draw();
    setTrail();
  }

  function pairsBody() {
    const rows = R1.pairs.slice();
    const kitchens = new Map();
    for (const p of rows) { const k = T.benById.get(p.a)?.cozinha_id || null; kitchens.set(k, (kitchens.get(k) || 0) + 1); }
    const top = [...kitchens.entries()].sort((a, b) => b[1] - a[1])[0];
    const concentrated = top && top[1] / rows.length >= 0.8;
    const rr2 = R2;
    const acceptBox = h("div", { class: "accept" });
    if (ver === 1) acceptBox.append(
      h("p", null, h("b", null, concentrated ? `${fmt(top[1])} de ${fmt(rows.length)} pares vêm de ${top[0] ? T.kitchen[top[0]].nome : "cadastros sem cozinha"}.` : `${fmt(rows.length)} pares em ${kitchens.size} cozinhas.`), concentrated ? " O padrão sugere que os atendimentos de lá gravam o id sem zeros à esquerda." : ""),
      h("p", { class: "mono" }, "regra: ignorar zeros à esquerda em atendimentos.beneficiario_id"),
      h("p", { class: "small-note" }, `Aceitar cria a versão 2 desta comparação: ${fmt(rr2.aDistinct)} − ${fmt(rr2.aOnlyCount)} + ${fmt(rr2.bOnlyCount)} = ${fmt(rr2.bDistinct)}. A versão 1 continua disponível, e cada par feito pela regra fica marcado na linhagem. No protótipo, a versão é simulada.`),
      h("div", { class: "panel-actions" }, h("button", { type: "button", class: "btn ab", onclick: () => accept(true) }, "Aceitar a regra"), h("button", { type: "button", class: "btn quiet", onclick: () => toast("Os pares continuam como hipótese. Nada mudou na conta.") }, "Manter como hipótese")));
    else acceptBox.append(h("p", null, h("b", null, "Regra aceita na versão 2."), ` Os pares contam como correspondência pela regra: ${fmt(rr2.matched)} nos dois, ${fmt(rr2.aOnlyCount)} só em A, ${fmt(rr2.bOnlyCount)} só em B. O total de cada lado não mudou.`), h("div", { class: "panel-actions" }, h("button", { type: "button", class: "btn", onclick: () => accept(false) }, "Voltar à versão 1")));
    const shown = rows.slice(0, 60);
    const tb = h("tbody");
    for (const p of shown) {
      const a = T.benById.get(p.a);
      const att = R1.bMap.get(p.b);
      const ks = [...new Set(att.map((x) => x.cozinha_id))];
      const same = ks.length === 1 && ks[0] === a.cozinha_id;
      const tr = h("tr", { tabindex: "0" },
        h("td", null, h("div", { class: "idv a" }, p.a), h("div", null, a.nome), h("div", { class: "pt-sub" }, `${kcol(a.cozinha_id)} · linha ${a._line}`)),
        h("td", { class: "lk" }, ver === 2 ? "═" : "◌ ↔ ◌"),
        h("td", null, h("div", { class: "idv b" }, p.b), h("div", null, `${att.length} atendimentos`), h("div", { class: "pt-sub" }, `${ks.map(kcol).join(", ")} · ${T.dateBR(att.map((x) => x.data).sort()[0])} a ${T.dateBR(att.map((x) => x.data).sort().at(-1))}`)),
        h("td", null, h("div", { class: "ev-chips" }, h("span", null, "mesmo número sem zeros"), same ? h("span", null, "mesma cozinha") : null, h("span", null, "único candidato"))));
      const hover = () => flashFor(p.a, "a");
      tr.addEventListener("mouseenter", hover);
      tr.addEventListener("focus", hover);
      tr.addEventListener("click", () => selectFor(p.a, "a"));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") selectFor(p.a, "a"); });
      tb.append(tr);
    }
    return [acceptBox, section(`Pares possíveis${rows.length > shown.length ? ` · ${fmt(shown.length)} de ${fmt(rows.length)}` : ""}`, h("div", { class: "rt-wrap", style: { padding: "0 12px" } }, h("table", { class: "pairs-t" }, h("thead", null, h("tr", null, h("th", null, "cadastro (A)"), h("th", null, ""), h("th", null, "atendimentos (B)"), h("th", null, "evidências"))), tb)))];
  }

  function accept(on) {
    selCell = null;
    goTo(st < 3 ? 3 : st, on ? 2 : 1);
    announce(on ? `Regra aceita. ${fmt(R1.pairs.length)} pares passam a contar como correspondência. Versão 2.` : "De volta à versão 1. Os pares voltam a ser hipótese.");
    toast(on ? "Regra aceita · versão 2 da comparação" : "Versão 1 restaurada", on ? "Desfazer" : null, on ? () => accept(false) : null);
    if (panel.isOpen) openCat("hypA");
  }

  function cellAt(sx, sy) { return cells.filter((c) => c.alpha > 0.5 && sx >= c.x - 1 && sx <= c.x + C + 1 && sy >= c.y - 1 && sy <= c.y + C + 1); }
  function classWord(c) {
    if (c.cat === "dupRow") return "linha repetida · vira 1 id";
    if (isMatched(c, ver)) return ver === 2 && c.cat !== "both" ? "nos dois · pela regra aceita" : "nos dois";
    if (st >= 3) return `${spec(c.cat).title} · ${proofWord(c.cat)}`;
    if (st === 1) return c.side === "a" ? "id do cadastro" : "id nos atendimentos";
    return c.cat === "hypA" || c.cat === "hypB" ? "sem par exato · tem candidato" : "sem par pela chave";
  }
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const hits = cellAt((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    canvas.classList.toggle("hot", hits.length > 0);
    if (!hits.length) { untip(); return; }
    const c = hits.find((x) => x.side === "a") || hits[0];
    const lines = [];
    if (U > 1) lines.push(h("div", { class: "mono" }, `bloco de ${fmt(c.items.length)} ids`), h("div", null, `${c.items[0].id} … ${c.items.at(-1).id}`));
    else if (c.side === "a") lines.push(h("div", { class: "mono" }, `${c.items[0].id} · ${c.items[0].row.nome}`), h("div", null, `cadastro ${T.dateBR(c.items[0].row.data_cadastro)}${c.items[0].row.data_desligamento ? ` · desligado em ${T.dateBR(c.items[0].row.data_desligamento)}` : ""}`));
    else lines.push(h("div", { class: "mono" }, `B: ${c.items[0].id} · ${c.items[0].att.length} atendimentos`));
    lines.push(h("div", { style: { marginTop: "4px", fontWeight: 600 } }, classWord(c)));
    if (c.div && st >= 2) lines.push(h("div", null, U > 1 ? "inclui ids atendidos fora da cozinha de referência" : "atendido fora da cozinha de referência"));
    tip(e.clientX, e.clientY, h("div", null, ...lines));
  }
  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    const hits = cellAt((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    if (!hits.length) { if (panel.isOpen) panel.close(); return; }
    const c = hits.find((x) => x.side === "a") || hits[0];
    selCell = c;
    if (c.cat === "dupRow") { openCat("dupRow"); return; }
    if (st < 2) { draw(); return; }
    if (st === 2) { openCat(isMatched(c, ver) ? "both" : c.side === "a" ? "aOnly" : "bOnly"); selCell = c; draw(); return; }
    openCat(isMatched(c, ver) ? (c.div && showDiv ? "div" : "both") : c.cat);
    selCell = c;
    draw();
  }

  function stopAuto() { if (autoplay) { autoplay.forEach(clearTimeout); autoplay = null; } }
  function play(fromStart) {
    stopAuto();
    if (UI.reduced()) { goTo(4, ver, { instant: true }); return; }
    if (fromStart) { goTo(1, ver, { instant: true }); panel.close(); }
    autoplay = [setTimeout(() => goTo(2), 1400), setTimeout(() => goTo(3), 3400), setTimeout(() => { goTo(4); autoplay = null; }, 5400)];
  }

  function setTrail() {
    const items = [{ label: "Mapa", go: () => App.go("mapa", {}) }, { label: "atendimentos → beneficiarios", go: () => App.go("mapa", { select: "r1" }) }, { label: `Comparação: ${cmp === "active" ? "ativos" : "cadastro inteiro"} × atendidos em ${yearOf()}`, go: openCatKey ? () => panel.close() : null }];
    if (panel && panel.isOpen && openCatKey) items.push({ label: { allA: "ids em A", allB: "ids em B", aOnly: "só em A", bOnly: "só em B", div: "cozinha diferente", both: "nos dois", dupRow: "linhas repetidas", hypA: "pares possíveis", hypB: "pares possíveis" }[openCatKey] || spec(openCatKey)?.title || openCatKey });
    App.setTrail(items);
  }

  function renderHead() {
    const rr = RR();
    titleEl.textContent = `Por que ${fmt(rr.aCount)} ${cmp === "active" ? `ativos em ${yearOf()}` : "no cadastro"} e ${fmt(rr.bDistinct)} atendidos?`;
    cmpSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === cmp)));
    srcEl.replaceChildren(
      h("span", { class: "src a" }, h("i"), h("b", null, "A · cadastro"), h("span", null, cmp === "active" ? `ativos em ${yearOf()}` : "todas as linhas")),
      h("span", { class: "src b" }, h("i"), h("b", null, `B · atendidos em ${yearOf()}`)),
      h("span", { class: "src m" }, h("i"), h("b", null, "nos dois")));
    renderAnswer();
  }

  function setComparison(next, opts = {}) {
    if (next === cmp && !opts.force) return;
    cmp = next;
    if (panel && panel.isOpen) panel.close();
    ver = 1; selCell = null; focusCats = null; showDiv = false;
    for (const k of Object.keys(ovEls)) ovEls[k].remove();
    ovEls = {};
    build();
    renderHead();
    for (const c of cells) { c.x = 0; c.y = 0; c.alpha = 1; }
    frameTo = null;
    goTo(opts.stage || 2, 1, { instant: true });
    if (!opts.silent) announce(cmp === "active" ? `Comparando ativos em ${yearOf()} com atendidos.` : "Comparando o cadastro inteiro com atendidos.");
  }

  function init(el) {
    root = el;
    resetState();
    build();
    rcEl = h("div", { class: "rc" });
    stepsEl = h("div", { class: "steps", role: "group", "aria-label": "Passos da comparação" });
    verEl = h("span", { class: "ver-chip" });
    titleEl = h("h1");
    cmpSeg = h("div", { class: "seg small cmp-seg", role: "group", "aria-label": "O que comparar" },
      h("button", { type: "button", "data-c": "all", onclick: () => setComparison("all") }, "Cadastro inteiro"),
      h("button", { type: "button", "data-c": "active", onclick: () => setComparison("active") }, `Ativos em ${R1.year}`));
    srcEl = h("div", { class: "rc-sources", "aria-label": "Legenda de cores" });
    answerEl = h("section", { class: "rc-answer", "aria-live": "polite", "aria-label": "Resposta" });
    rcEl.append(h("header", { class: "rc-head" },
      h("div", null, h("p", { class: "eyebrow ab", style: { margin: 0 } }, "Comparação · ", verEl, " ", cmpSeg), titleEl),
      h("div", { class: "rc-nav" }, stepsEl, srcEl)), answerEl);
    stageEl = h("div", { class: "rc-stage", tabindex: "0", "aria-label": "Visualização da comparação. Setas mudam o passo. Os mesmos números estão no texto abaixo." });
    sceneEl = h("div", { class: "rc-scene" });
    canvas = h("canvas", { class: "rc-canvas", role: "img", "aria-label": "Cada quadrado é um id. Azul: cadastro. Rosa: atendimentos. Violeta: nos dois. Pontilhado: possível. Contorno rosa deslocado: linha repetida." });
    ctx = canvas.getContext("2d");
    ov = h("div", { class: "rc-ov" });
    sceneEl.append(canvas, ov);
    stageEl.append(sceneEl);
    footEl = h("aside", { class: "rc-side", "aria-label": "Passo atual" });
    listEl = h("div", { class: "rc-list" });
    rcEl.append(h("div", { class: "rc-body" }, stageEl, footEl), listEl);
    el.append(rcEl);
    panel = new Panel(el, { onClose: () => { openCatKey = null; focusCats = null; selCell = null; renderOverlay(); draw(); setTrail(); } });
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => { untip(); canvas.classList.remove("hot"); });
    canvas.addEventListener("click", onClick);
    stageEl.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" && st < 4) { stopAuto(); goTo(st + 1); } if (e.key === "ArrowLeft" && st > 1) { stopAuto(); goTo(st - 1); } });
    new ResizeObserver(() => resize()).observe(stageEl);
    window.addEventListener("resize", () => { if (!root.hidden) resize(); });
    renderHead();
    resize();
    goTo(2, 1, { instant: true });
  }

  function show(params) {
    if (params && params.comparison && (params.comparison === "all" || params.comparison === "active") && params.comparison !== cmp) setComparison(params.comparison, { silent: true });
    setTrail();
    let done = false;
    const go = () => { if (done) return; done = true; resize(); };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  }

  if (/[?&]debug\b/.test(location.search)) window.__rc = { goTo: (a, v) => { stopAuto(); goTo(a, v || ver, { instant: true }); draw(); }, openCat: (c) => { openCat(c); draw(); }, accept: (on) => { accept(on); for (const c of cells) { c.x = c.tx; c.y = c.ty; c.mix = 1; c.sf = c.stt; c.alpha = c.ta; } animDur = 0; draw(); }, cmp: (c) => setComparison(c, { silent: true, stage: 1 }), state: () => ({ st, ver, cmp, U, cells: cells.length, panel: panel.isOpen }) };

  App.register("comparacao", { init, show, hide: () => { stopAuto(); untip(); }, escape: () => { if (panel.isOpen) panel.close(); } });
})();
