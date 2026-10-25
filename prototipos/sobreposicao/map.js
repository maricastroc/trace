(function () {
  "use strict";
  const { h, s, icon, Panel, recordTable, toast, announce, tip, untip } = UI;
  const T = window.Trace;
  const fmt = T.fmt;
  const CARD_W = 360, COL_GAP = 170, ROW_GAP = 64, GROUP_GAP = 150, GROUP_PAD = 34, GROUP_HEAD = 54;
  const LOD_NAMES = { overview: "visão geral", detail: "detalhe" };
  const typeName = { identifier: "identificador", text: "texto", date: "data", number: "número" };

  let root, stage, world, linksSvg, regionsEl, panel, statusEl, pathsCard, listEl, zoomUi, focusBar, rulerSvg;
  let sheets, marks, labels, linkGroups, fieldEls, groupCards, layout, boxes;
  let cam, lod, focusTable, collapsed, sel, mode, problems, panelStack, tracerRaf, currentPath, drag, lodTimer, rulerRect, layoutKind, layoutCompact;

  function resetState() {
    sheets = {}; marks = {}; labels = {}; linkGroups = {}; fieldEls = {}; groupCards = {}; layout = {}; boxes = {};
    cam = { s: 1, tx: 0, ty: 0 }; lod = "detail"; layoutKind = null; layoutCompact = false; focusTable = null; collapsed = new Set(); sel = null; mode = "structure"; problems = false;
    panelStack = []; tracerRaf = null; currentPath = null; drag = null; lodTimer = null;
  }

  const stateWord = (st) => T.relStatusWord(st);
  const visibleRels = () => T.relationships;

  function issuesOf(table, col) {
    const p = T.profiles[table][col.key];
    const out = [];
    if (col.role === "key" && p.dupValues) out.push({ kind: "dup", text: `${fmt(p.dupValues)} ids repetidos` });
    if (col.type === "identifier" && p.shortRows) out.push({ kind: "short", text: `${fmt(p.shortRows)} valores curtos` });
    if (col.type === "identifier" && p.variantRows) out.push({ kind: "short", text: `${fmt(p.variantRows)} com caixa ou espaço diferente` });
    if (col.role === "fk" && p.nulls) out.push({ kind: "null", text: `${fmt(p.nulls)} vazios` });
    return out;
  }
  const tableIssues = (t) => T.schema[t].columns.flatMap((c) => issuesOf(t, c));

  function typeIcon(col) {
    if (col.role === "key") return icon("key", 20);
    if (col.role === "fk") return icon("link", 20);
    if (col.type === "date") return icon("date", 20);
    if (col.type === "number") return icon("number", 20);
    return icon("text", 20);
  }

  function miniViz(table, col, W = 124, H = 26) {
    const p = T.profiles[table][col.key];
    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    const bar = (x, w, op = 0.8, fill = "var(--ink)", y = 8, hh = 10) => svg.append(s("rect", { x, y, width: Math.max(0.8, w), height: hh, fill, opacity: op, rx: 1 }));
    if (col.type === "date" && p.months) {
      const max = Math.max(...p.months.map((m) => m[1]));
      const bw = W / p.months.length;
      p.months.forEach(([m, c], i) => { const bh = Math.max(1.5, (c / max) * (H - 2)); svg.append(s("rect", { x: i * bw, y: H - bh, width: Math.max(0.9, bw - 0.8), height: bh, fill: m.startsWith("2025") ? "var(--a-deep)" : "var(--ink-3)", opacity: m.startsWith("2025") ? 0.9 : 0.6 })); });
      return svg;
    }
    if (col.type === "number") {
      if (p.values) { const tot = p.values.reduce((a, [, c]) => a + c, 0); let x = 0; p.values.forEach(([, c], i) => { const w = (c / tot) * W; bar(x, w - 1, i % 2 ? 0.85 : 0.45); x += w; }); }
      else { bar(0, W, 0.25, "var(--ink-3)", 12, 3); svg.append(s("circle", { cx: 2, cy: 13.5, r: 3, fill: "var(--ink)" }), s("circle", { cx: W - 3, cy: 13.5, r: 3, fill: "var(--ink)" })); }
      return svg;
    }
    if (col.role === "key") {
      bar(0, W, 0.85);
      if (p.dupValues) svg.append(s("rect", { x: 3.5, y: 4.5, width: W - 4, height: 10, fill: "none", stroke: "var(--b)", "stroke-width": 1.6 }));
      return svg;
    }
    if (col.type === "identifier" && (p.shortRows || p.variantRows || (col.role === "fk" && p.nulls))) {
      const odd = (p.shortRows || 0) + (p.variantRows || 0);
      const ow = odd ? Math.max(10, (odd / p.rows) * W) : 0;
      const nw = p.nulls ? Math.max(6, (p.nulls / p.rows) * W) : 0;
      bar(0, W - ow - nw - 2, 0.55, "var(--ink-3)");
      if (ow) {
        const pid = "mv-ht-" + table + "-" + col.key;
        svg.append(s("defs", null, s("pattern", { id: pid, width: 3.5, height: 3.5, patternUnits: "userSpaceOnUse" }, s("rect", { width: 3.5, height: 3.5, fill: "var(--ab-wash)" }), s("circle", { cx: 1.75, cy: 1.75, r: 1, fill: "var(--ab)" }))));
        svg.append(s("rect", { x: W - ow - nw, y: 5, width: ow, height: 16, fill: `url(#${pid})` }));
      }
      if (nw) svg.append(s("rect", { x: W - nw, y: 8, width: nw, height: 10, fill: "none", stroke: "var(--ink-3)", "stroke-dasharray": "2 2" }));
      return svg;
    }
    if (p.top) { let x = 0; p.top.forEach(([, c], i) => { const w = (c / p.nonNull) * W; bar(x, w - 1, i % 2 ? 0.32 : 0.7); x += w; }); return svg; }
    for (let i = 0; i < 14; i++) bar(i * 9, 5 + ((i * 7) % 3), 0.4, "var(--ink-3)", 12, 3);
    return svg;
  }

  function linkTargets(table, col) {
    return T.relationships.filter((r) => r.from === table && r.fromCol === col.key && r.status !== "rejected").map((r) => r.to);
  }

  function cardNote(table, col) {
    const iss = issuesOf(table, col);
    if (iss.length) return h("small", { class: iss[0].kind === "short" ? "pos" : iss[0].kind === "null" ? "" : "warn" }, iss[0].text);
    const sc = T.schema[table];
    if (sc.validity && sc.validity.includes(col.key)) return h("small", { class: T.ws.validityConfirmed ? "" : "pos" }, `${sc.validity[0] === col.key ? "início" : "fim"} da vigência${T.ws.validityConfirmed ? "" : "?"}`);
    if (col.role === "key") return h("small", null, "chave");
    const to = linkTargets(table, col);
    if (to.length) return h("small", { class: to.length > 1 ? "pos" : "" }, to.length > 1 ? `liga a ${to.join(" ou ")}?` : `liga a ${to[0]}`);
    return h("small", null, typeName[col.type]);
  }

  function relevantCol(t, col) {
    if (col.role === "key" || col.role === "fk") return true;
    if (issuesOf(t, col).length) return true;
    const sc = T.schema[t];
    return !!(sc.validity && sc.validity.includes(col.key));
  }

  function fieldNote(table, col) {
    const p = T.profiles[table][col.key];
    const iss = issuesOf(table, col);
    if (iss.length) return h("small", { class: iss[0].kind === "short" ? "pos" : iss[0].kind === "null" ? "" : "warn" }, iss.map((i) => i.text).join(" · "));
    if (col.role === "key") return h("small", null, `chave · ${fmt(p.distinct)} valores únicos`);
    if (col.type === "date") return h("small", null, `${p.min ? p.min.slice(0, 4) : "·"}–${p.max ? p.max.slice(0, 4) : "·"}${p.nulls ? ` · ${fmt(p.nulls)} vazios` : ""}`);
    if (col.type === "number") return h("small", null, p.values ? `valores ${p.values.map((v) => v[0]).join(", ")}` : `de ${fmt(p.minN)} a ${fmt(p.maxN)}`);
    if (col.role === "fk") return h("small", null, `liga a outra tabela · ${fmt(p.distinct)} valores`);
    if (p.top && p.distinct <= 5) return h("small", null, p.top.map(([v, c]) => `${fmt(c)} ${v}`).join(" · "));
    return h("small", null, `${typeName[col.type]} · ${fmt(p.distinct)} valores`);
  }

  function fieldVisible(t, col) {
    if (focusTable === t || (sel && sel.table === t)) return true;
    if (lod === "overview") return false;
    return relevantCol(t, col);
  }

  function makeSheet(t, inWorld) {
    const sc = T.schema[t];
    const rows = T.tables[t].length;
    const expanded = inWorld && (focusTable === t || (sel && sel.table === t));
    const art = h("article", { class: `sheet lod-${inWorld ? lod : "detail"} ${expanded ? "expanded" : ""}`, "data-table": t, "aria-label": `Tabela ${t}, ${fmt(rows)} linhas` });
    if (inWorld) {
      const L = layout[t];
      Object.assign(art.style, { left: L.x + "px", top: L.y + "px", width: CARD_W + "px" });
      const depth = Math.max(1, Math.min(5, Math.round(Math.log10(rows))));
      for (let i = depth; i >= 1; i--) art.append(h("div", { class: "stack", "aria-hidden": "true", style: { transform: `translate(${i * 5}px, ${i * 5}px)`, opacity: String(1 - i * 0.11) } }));
    }
    const iss = tableIssues(t);
    const head = h("div", { class: "sheet-head" },
      h("button", { type: "button", class: "sheet-title", onclick: () => openTable(t) }, h("span", { class: "name" }, t)),
      h("div", { class: "sheet-dims" }, h("b", null, fmt(rows)), h("span", null, "linhas")));
    if (inWorld && lod === "overview" && iss.length) head.append(h("div", { class: "sheet-issues" }, ...iss.slice(0, 2).map((i) => h("span", { class: `tagx ${i.kind === "dup" ? "rep" : i.kind === "short" ? "pos" : ""}` }, i.text))));
    art.append(head);
    const ul = h("ul", { class: "fields" });
    let hidden = 0;
    for (const col of sc.columns) {
      if (inWorld ? !fieldVisible(t, col) : !relevantCol(t, col)) { hidden++; continue; }
      const ci = issuesOf(t, col);
      const btn = h("button", { type: "button", class: `field ${col.role === "key" ? "key" : ""} ${ci.length ? "has-issue" : ""}`, "data-col": col.key, onclick: () => openField(t, col.key) },
        h("span", { class: "ft", title: typeName[col.type] }, typeIcon(col)),
        h("span", { class: "fn" }, h("b", null, col.key), cardNote(t, col)));
      const li = h("li", { "data-col": col.key, class: sc.validity && sc.validity.includes(col.key) ? `in-vig ${T.ws.validityConfirmed ? "on" : ""}` : "" }, btn);
      ul.append(li);
      if (inWorld) fieldEls[`${t}.${col.key}`] = { li, btn };
    }
    if (hidden && (inWorld ? lod !== "overview" : true)) ul.append(h("li", { class: "more-li" }, h("button", { type: "button", class: "more-fields", onclick: () => (inWorld ? setFocus(t, true) : openTable(t)) }, `+ ${hidden} ${hidden === 1 ? "campo" : "campos"}`)));
    if (expanded && inWorld) ul.append(h("li", { class: "more-li" }, h("button", { type: "button", class: "more-fields", onclick: () => { if (focusTable === t) setFocus(null); else clearSel(); } }, "mostrar só os campos principais")));
    if (ul.childElementCount) art.append(ul);
    art.addEventListener("dblclick", (e) => { if (e.target.closest("button")) return; setFocus(t, true); });
    return art;
  }

  function editGrain(t, btn) {
    const sc = T.schema[t];
    const input = h("input", { type: "text", value: sc.grain, "aria-label": `O que uma linha de ${t} representa` });
    btn.replaceChildren(input);
    input.focus(); input.select();
    const done = (save) => {
      if (save && input.value.trim()) sc.grain = input.value.trim();
      btn.replaceChildren(sc.grain, h("span", { "aria-hidden": "true" }, "✎"));
      if (save) toast(`${t}: “${sc.grain}”`);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); btn.focus(); } if (e.key === "Escape") { e.stopPropagation(); done(false); btn.focus(); } });
    input.addEventListener("blur", () => done(true), { once: true });
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  function estHeight(t) {
    const sc = T.schema[t];
    const n = sc.columns.filter((c) => relevantCol(t, c)).length;
    return 104 + 14 + n * 46 + (n < sc.columns.length ? 38 : 0) + 10;
  }

  function computeLayout(compact = false) {
    const tables = Object.keys(T.schema);
    const groups = T.groups ? T.groups.map((g) => ({ id: g.id, label: g.label, tables: tables.filter((t) => T.schema[t].group === g.id) })) : [{ id: "all", label: null, tables }];
    const edges = T.relationships.filter((r) => r.from !== r.to && !r.ev.coincidence);
    const groupOf = (t) => (T.groups ? T.schema[t].group : "all");
    const depthMemo = {};
    const gDepth = (gid, stack = new Set()) => {
      if (depthMemo[gid] !== undefined) return depthMemo[gid];
      if (stack.has(gid)) return 0;
      stack.add(gid);
      let d = 0;
      for (const r of edges) if (groupOf(r.from) === gid && groupOf(r.to) !== gid) d = Math.max(d, 1 + gDepth(groupOf(r.to), stack));
      stack.delete(gid);
      return (depthMemo[gid] = d);
    };
    const buildGl = (cmp) => {
    const gl = {};
    for (const g of groups) {
      const set = new Set(g.tables);
      const memo = {};
      const depth = (t, stack = new Set()) => {
        if (memo[t] !== undefined) return memo[t];
        if (stack.has(t)) return 0;
        stack.add(t);
        let d = 0;
        for (const r of edges) if (r.from === t && set.has(r.to)) d = Math.max(d, 1 + depth(r.to, stack));
        stack.delete(t);
        return (memo[t] = d);
      };
      const cols = [];
      for (const t of g.tables) { const d = depth(t); (cols[d] = cols[d] || []).push(t); }
      const local = {};
      let x = 0, maxH = 0;
      cols.forEach((col, ci) => {
        if (!col) return;
        col.sort((a, b) => T.tables[b].length - T.tables[a].length);
        let y = 0;
        for (const t of col) { local[t] = { x, y }; y += estHeight(t) + ROW_GAP; }
        maxH = Math.max(maxH, y - ROW_GAP);
        x += CARD_W + COL_GAP;
      });
      if (!T.groups) {
        cols.forEach((col, ci) => { if (col && col.length === 1) local[col[0]].y += ci % 2 === 1 ? -56 : 24; });
      }
      gl[g.id] = { local, w: x - COL_GAP, h: maxH, depth: T.groups ? gDepth(g.id) : 0, g };
    }
    return gl;
    };
    let gl = buildGl(compact);
    const byDepth = {};
    for (const id of Object.keys(gl)) (byDepth[gl[id].depth] = byDepth[gl[id].depth] || []).push(id);
    const pad = T.groups ? GROUP_PAD : 0, head = T.groups ? GROUP_HEAD : 0;
    const arrange = (kind) => {
      const out = {}, gboxes = {};
      const place = (id, gx, gy, mirror) => {
        const G = gl[id];
        for (const [t, p] of Object.entries(G.local)) out[t] = { x: gx + pad + (mirror ? G.w - p.x - CARD_W : p.x), y: gy + head + p.y };
        gboxes[id] = { x: gx, y: gy, w: G.w + pad * 2, h: G.h + head + pad, label: G.g.label, tables: G.g.tables };
        return gboxes[id];
      };
      const hubs = byDepth[0] || [];
      const others = Object.keys(gl).filter((id) => !hubs.includes(id)).sort((a, b) => gl[b].w * gl[b].h - gl[a].w * gl[a].h);
      if (kind === "wings") {
        const hub = hubs[0];
        const right = others[0], left = others[1], below = others.slice(2);
        const lb = place(left, 0, 0, false);
        const hx = lb.w + GROUP_GAP;
        const hb = place(hub, hx, Math.max(0, (lb.h - (gl[hub].h + head + pad)) / 2), false);
        place(right, hx + hb.w + GROUP_GAP, 0, true);
        let by = Math.max(hb.y + hb.h, lb.h) + GROUP_GAP;
        for (const id of below) { const b = place(id, hx, by, false); by += b.h + GROUP_GAP; }
      } else if (kind.startsWith("rows")) {
        const mask = Number(kind.slice(4));
        const top = [hubs[0]], bottom = [];
        others.forEach((id, i) => ((mask >> i) & 1 ? top : bottom).push(id));
        let tx = 0, th = 0;
        top.forEach((id, i) => { const b = place(id, tx, 0, i > 0); tx += b.w + GROUP_GAP; th = Math.max(th, b.h); });
        let bx = 0;
        for (const id of bottom) { const b = place(id, bx, th + GROUP_GAP, false); bx += b.w + GROUP_GAP; }
      } else {
        let gx = 0;
        Object.keys(byDepth).sort((a, b) => a - b).forEach((d) => {
          let gy = 0, colW = 0;
          for (const id of byDepth[d].sort((a, b) => gl[b].h - gl[a].h)) { const b = place(id, gx, gy, false); gy += b.h + GROUP_GAP; colW = Math.max(colW, b.w); }
          gx += colW + GROUP_GAP + 40;
        });
      }
      let w = 0, hh = 0;
      for (const [t, p] of Object.entries(out)) { w = Math.max(w, p.x + CARD_W); hh = Math.max(hh, p.y + estHeight(t)); }
      return { out, gboxes, w, h: hh };
    };
    const hubsN = (byDepth[0] || []).length, othersN = Object.keys(gl).length - hubsN;
    let cmpScore = compact;
    if (!layoutKind) {
      const kinds = ["columns"];
      if (T.groups && hubsN === 1 && othersN >= 2) {
        kinds.push("wings");
        for (let m = 0; m < 1 << Math.min(othersN, 6); m++) kinds.push("rows" + m);
      }
      const big = Object.keys(T.schema).length > 6;
      cmpScore = big;
      const keep = gl;
      gl = buildGl(big);
      const vw = Math.max(320, (stage && stage.clientWidth) || 1400) - 48, vh = Math.max(320, (stage && stage.clientHeight) || 760) - 190;
      const cands = kinds.map((k) => {
        const a = arrange(k);
        a.kind = k;
        a.fit = Math.min(vw / a.w, vh / a.h);
        a.len = 0;
        for (const r of edges) {
          const p = a.out[r.from], q = a.out[r.to];
          if (p && q) a.len += Math.hypot(p.x - q.x, p.y - q.y);
        }
        return a;
      });
      const topFit = Math.max(...cands.map((a) => a.fit));
      layoutKind = cands.filter((a) => a.fit >= topFit * 0.97).sort((a, b) => a.len - b.len)[0].kind;
      gl = keep;
      cmpScore = compact;
    }
    const best = arrange(layoutKind);
    layoutCompact = compact;
    const out = best.out, gboxes = best.gboxes;
    layout = out;
    boxes = T.groups ? gboxes : {};
  }

  const nodeOf = (t) => { const g = T.groups ? T.schema[t].group : null; return g && collapsed.has(g) ? "g:" + g : t; };
  const nodeEl = (n) => (n.startsWith("g:") ? groupCards[n.slice(2)] : sheets[n]);
  const rectOf = (el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

  function portOf(t, col, side) {
    const n = nodeOf(t);
    const el = nodeEl(n);
    const x = el.offsetLeft + (side === "right" ? el.offsetWidth : 0);
    const f = n === t && fieldEls[`${t}.${col}`];
    if (!f) return { x, y: el.offsetTop + Math.min(64, el.offsetHeight / 2) };
    let y = f.li.offsetHeight / 2;
    for (let q = f.li; q && q !== el; q = q.offsetParent) y += q.offsetTop;
    return { x, y: el.offsetTop + y };
  }

  function routeBetween(p0, p1, dir, avoid) {
    const mx = (p0.x + p1.x) / 2;
    const straight = `M${p0.x},${p0.y} C${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
    const lo = Math.min(p0.x, p1.x) + 10, hi = Math.max(p0.x, p1.x) - 10;
    const hitRects = avoid.filter((r) => r.x < hi && r.x + r.w > lo);
    const samples = [];
    for (let i = 1; i < 20; i++) { const t = i / 20, u = 1 - t; samples.push({ x: u * u * u * p0.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * p0.y + 3 * u * t * t * p1.y + t * t * t * p1.y }); }
    const blocked = hitRects.filter((r) => samples.some((q) => q.x > r.x - 8 && q.x < r.x + r.w + 8 && q.y > r.y - 8 && q.y < r.y + r.h + 8));
    if (!blocked.length) return straight;
    const bottom = Math.max(...blocked.map((r) => r.y + r.h)), top = Math.min(...blocked.map((r) => r.y));
    const avg = (p0.y + p1.y) / 2;
    const below = bottom + 80 - avg, above = avg - (top - 80);
    const target = below <= above ? (bottom + 56 - 0.25 * avg) / 0.75 : (top - 56 - 0.25 * avg) / 0.75;
    return `M${p0.x},${p0.y} C${p0.x + dir * 160},${target} ${p1.x - dir * 160},${target} ${p1.x},${p1.y}`;
  }

  function geometry(r) {
    const n0 = nodeOf(r.from), n1 = nodeOf(r.to);
    const e0 = nodeEl(n0), e1 = nodeEl(n1);
    const avoid = Object.entries(sheets).filter(([t]) => nodeOf(t) === t && t !== r.from && t !== r.to).map(([, el]) => rectOf(el)).concat(Object.entries(groupCards).filter(([g]) => "g:" + g !== n0 && "g:" + g !== n1).map(([, el]) => rectOf(el)));
    if (n0 === n1) {
      const p0 = portOf(r.from, r.fromCol, "right"), p1 = portOf(r.to, r.toCol, "right");
      const bulge = 120;
      return { p0, p1, d: `M${p0.x},${p0.y} C${p0.x + bulge},${p0.y} ${p1.x + bulge},${p1.y} ${p1.x},${p1.y}`, dir: 1, loop: true };
    }
    const c0 = e0.offsetLeft + e0.offsetWidth / 2, c1 = e1.offsetLeft + e1.offsetWidth / 2;
    if (Math.abs(c0 - c1) < CARD_W * 0.8) {
      const p0 = portOf(r.from, r.fromCol, "right"), p1 = portOf(r.to, r.toCol, "right");
      return { p0, p1, d: `M${p0.x},${p0.y} C${p0.x + 150},${p0.y} ${p1.x + 150},${p1.y} ${p1.x},${p1.y}`, dir: 1, loop: true };
    }
    const fromSide = c0 > c1 ? "left" : "right";
    const toSide = c0 > c1 ? "right" : "left";
    const p0 = portOf(r.from, r.fromCol, fromSide), p1 = portOf(r.to, r.toCol, toSide);
    const incoming = T.relationships.filter((x) => nodeOf(x.to) === n1 && x.toCol === r.toCol && x.to === r.to);
    if (incoming.length > 1) p1.y += (incoming.indexOf(r) - (incoming.length - 1) / 2) * 12;
    const dir = fromSide === "left" ? -1 : 1;
    return { p0, p1, d: routeBetween(p0, p1, dir, avoid), dir };
  }

  function relClass(r) { return r.status; }

  function drawLinks() {
    linksSvg.replaceChildren();
    for (const id of Object.keys(marks)) { marks[id].remove(); delete marks[id]; }
    linkGroups = {};
    const agg = new Map();
    for (const r of visibleRels()) {
      const n0 = nodeOf(r.from), n1 = nodeOf(r.to);
      if (n0.startsWith("g:") || n1.startsWith("g:")) {
        if (n0 === n1) continue;
        const key = [n0, n1].sort().join("|");
        if (!agg.has(key)) agg.set(key, []);
        agg.get(key).push(r);
        continue;
      }
      const g = geometry(r);
      const grp = s("g", { class: `lk-g ${relClass(r)} ${r.competitors.length ? "contested" : ""}`, "data-rel": r.id });
      const under = s("path", { class: "lk-under", d: g.d });
      const path = s("path", { class: `lk ${relClass(r)}`, d: g.d });
      const ghost = r.status === "caveat" ? s("path", { class: "lk-ghost", d: g.d }) : null;
      const hit = s("path", { class: "lk-hit", d: g.d });
      const f = g.loop ? 1 : g.dir;
      const foot = s("path", { class: "lk-foot", d: `M${g.p0.x + f * 22},${g.p0.y} L${g.p0.x},${g.p0.y - 9} M${g.p0.x + f * 22},${g.p0.y} L${g.p0.x},${g.p0.y} M${g.p0.x + f * 22},${g.p0.y} L${g.p0.x},${g.p0.y + 9}` });
      const f1 = g.loop ? 1 : -g.dir;
      const one = s("path", { class: "lk-one", d: `M${g.p1.x + f1 * 13},${g.p1.y - 8} L${g.p1.x + f1 * 13},${g.p1.y + 8}` });
      grp.append(under, ghost, path, foot, one, s("circle", { class: "port", cx: g.p0.x, cy: g.p0.y, r: 4.5 }), s("circle", { class: "port", cx: g.p1.x, cy: g.p1.y, r: 4.5 }), hit);
      hit.addEventListener("click", (e) => { e.stopPropagation(); selectRel(r.id); });
      hit.addEventListener("mouseenter", (e) => { grp.classList.add("hover"); tipRel(r, e.clientX, e.clientY); });
      hit.addEventListener("mousemove", (e) => tipRel(r, e.clientX, e.clientY));
      hit.addEventListener("mouseleave", () => { grp.classList.remove("hover"); untip(); });
      linksSvg.append(grp);
      linkGroups[r.id] = { grp, path };
    }
    const taken = [];
    for (const r of visibleRels()) {
      const lg = linkGroups[r.id];
      if (!lg) continue;
      const L = lg.path.getTotalLength();
      let pt = null;
      for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
        const q = lg.path.getPointAtLength(L * f);
        if (taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) > 60)) { pt = q; break; }
      }
      pt = pt || lg.path.getPointAtLength(L / 2);
      taken.push(pt);
      placeMark(r, pt);
    }
    for (const [key, rels] of agg) {
      const [a, b] = key.split("|");
      const ea = nodeEl(a), eb = nodeEl(b);
      const ca = ea.offsetLeft + ea.offsetWidth / 2, cb = eb.offsetLeft + eb.offsetWidth / 2;
      const left = ca < cb ? ea : eb, right = ca < cb ? eb : ea;
      const p0 = { x: left.offsetLeft + left.offsetWidth, y: left.offsetTop + 64 }, p1 = { x: right.offsetLeft, y: right.offsetTop + 64 };
      const d = `M${p0.x},${p0.y} C${(p0.x + p1.x) / 2},${p0.y} ${(p0.x + p1.x) / 2},${p1.y} ${p1.x},${p1.y}`;
      const allConfirmed = rels.every((r) => T.usable(r));
      const grp = s("g", { class: `lk-g agg ${allConfirmed ? "confirmed" : "suggested"}` });
      const path = s("path", { class: `lk ${allConfirmed ? "confirmed" : "suggested"}`, d });
      grp.append(path, s("circle", { class: "port", cx: p0.x, cy: p0.y, r: 4.5 }), s("circle", { class: "port", cx: p1.x, cy: p1.y, r: 4.5 }));
      linksSvg.append(grp);
      const mid = path.getPointAtLength(path.getTotalLength() / 2);
      const bubble = h("button", { type: "button", class: "agg-bubble", style: { left: mid.x + "px", top: mid.y + "px" }, onclick: () => { [a, b].forEach((n) => n.startsWith("g:") && collapsed.delete(n.slice(2))); renderAll(); announce("Grupo expandido."); } }, `${rels.length} ${rels.length === 1 ? "relação" : "relações"}`);
      const id = "agg:" + key;
      marks[id] = bubble;
      world.append(bubble);
    }
    applySelectionClasses();
    if (mode === "paths" && currentPath) highlightPath(currentPath);
  }

  function relSummary(r) {
    const e = r.ev;
    if (e.coincidence) return { short: `só ${fmt(e.fromDistinct)} valores na origem: coincidência provável`, warn: true };
    if (!e.toUnique) return { short: `${fmt(e.toDupIds.length)} ids repetidos no destino`, warn: true };
    if (r.competitors.some((id) => T.relationships.find((x) => x.id === id).status === "suggested") && r.status === "suggested") return { short: "há outro destino possível", warn: true };
    return { short: "destino único", warn: false };
  }

  function tipRel(r, x, y) {
    const sm = relSummary(r);
    tip(x, y, h("div", null, h("div", { class: "mono" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`), h("div", null, `cobertura ${T.pct(r.ev.ratio)} · ${sm.short}`), h("div", { style: { marginTop: "4px", fontWeight: 600 } }, `${stateWord(r.status)} · clique para ver a evidência`)));
  }

  function markSvg(r) {
    const C = 2 * Math.PI * 12;
    const ratio = r.ev.ratio;
    const sm = relSummary(r);
    const svg = s("svg", { viewBox: "0 0 44 44", "aria-hidden": "true" });
    svg.append(s("circle", { class: "flash", cx: 22, cy: 22, r: 16 }));
    svg.append(s("circle", { class: "bgc", cx: 22, cy: 22, r: 16 }), s("circle", { class: "trk", cx: 22, cy: 22, r: 12 }));
    if (ratio < 1) svg.append(s("circle", { class: "miss", cx: 22, cy: 22, r: 12, "stroke-dasharray": `${Math.max(2, (1 - ratio) * C)} ${C}`, transform: `rotate(${-90 + ratio * 360} 22 22)` }));
    svg.append(s("circle", { class: "arc", cx: 22, cy: 22, r: 12, "stroke-dasharray": `${ratio * C - (ratio < 1 ? 1.5 : 0)} ${C}`, transform: "rotate(-90 22 22)" }));
    const cross = "M22 1v5M22 38v5M1 22h5M38 22h5";
    svg.append(s("path", { class: "xa", d: cross }), s("path", { class: "xb", d: cross }));
    const contested = r.competitors.length && r.status === "suggested";
    const glyph = r.status === "rejected" ? "×" : contested ? "?" : sm.warn && r.status === "suggested" ? "!" : r.status === "confirmed" || r.status === "caveat" ? "✓" : "";
    if (glyph) svg.append(s("text", { x: 22, y: 26.5, "text-anchor": "middle", class: `q ${glyph === "!" ? "warn" : ""}` }, glyph));
    return svg;
  }

  function cardLine(r) {
    const e = r.ev;
    if (e.coincidence) return { text: "coincidência provável", sub: `só ${fmt(e.fromDistinct)} valores na origem`, warn: true };
    if (!e.toUnique) return { text: "N:1 não comprovada", sub: `${fmt(e.toDupIds.length)} ids repetidos`, warn: true };
    return { text: "N:1 · destino único", sub: null, warn: false };
  }

  function placeMark(r, pt) {
    const sm = relSummary(r);
    const m = h("button", { type: "button", class: `mark ${r.status === "confirmed" || r.status === "caveat" ? "confirmed" : r.status} ${sm.warn && r.status === "suggested" ? "attn" : ""} ${sel && sel.kind === "rel" && sel.id === r.id ? "sel" : ""}`, "data-rel": r.id });
    m.addEventListener("click", (e) => { e.stopPropagation(); untip(); selectRel(r.id); });
    m.addEventListener("mouseenter", (e) => { linkGroups[r.id]?.grp.classList.add("hover"); tipRel(r, e.clientX, e.clientY); });
    m.addEventListener("mousemove", (e) => tipRel(r, e.clientX, e.clientY));
    m.addEventListener("mouseleave", () => { linkGroups[r.id]?.grp.classList.remove("hover"); untip(); });
    m.addEventListener("focus", () => { linkGroups[r.id]?.grp.classList.add("hover"); const b = m.getBoundingClientRect(); tipRel(r, b.right, b.bottom); });
    m.addEventListener("blur", () => { linkGroups[r.id]?.grp.classList.remove("hover"); untip(); });
    m.append(markSvg(r));
    m.style.left = pt.x + "px"; m.style.top = pt.y + "px";
    m.setAttribute("aria-label", `Relação ${r.from}.${r.fromCol} para ${r.to}.${r.toCol}: ${stateWord(r.status)}, cobertura ${T.pct(r.ev.ratio)}, ${sm.short}. Abrir evidência.`);
    world.append(m);
    marks[r.id] = m;
  }

  function drawRegions() {
    regionsEl.replaceChildren();
    for (const id of Object.keys(groupCards)) delete groupCards[id];
    if (!T.groups) return;
    for (const g of T.groups) {
      const members = Object.keys(T.schema).filter((t) => T.schema[t].group === g.id);
      if (collapsed.has(g.id)) {
        const b = boxes[g.id];
        const rows = members.reduce((a, t) => a + T.tables[t].length, 0);
        const iss = members.reduce((a, t) => a + tableIssues(t).length, 0);
        const card = h("button", { type: "button", class: "group-card", style: { left: b.x + "px", top: b.y + "px", width: Math.min(b.w, 440) + "px" }, onclick: () => { collapsed.delete(g.id); renderAll(); announce(`Grupo ${g.label} expandido.`); } },
          h("span", { class: "gl" }, "grupo recolhido"), h("b", null, g.label), h("span", { class: "gt" }, members.join(" · ")),
          h("span", { class: "gd" }, `${members.length} ${members.length === 1 ? "tabela" : "tabelas"} · ${fmt(rows)} linhas${iss ? ` · ${iss} ${iss === 1 ? "ponto" : "pontos"} de atenção` : ""}`), h("span", { class: "gx" }, "expandir ↗"));
        world.append(card);
        groupCards[g.id] = card;
        continue;
      }
      const els = members.map((t) => sheets[t]).filter(Boolean);
      if (!els.length) continue;
      const xs = els.map((e) => e.offsetLeft), ys = els.map((e) => e.offsetTop);
      const x0 = Math.min(...xs) - GROUP_PAD, y0 = Math.min(...ys) - GROUP_HEAD;
      const x1 = Math.max(...els.map((e) => e.offsetLeft + e.offsetWidth)) + GROUP_PAD + 12, y1 = Math.max(...els.map((e) => e.offsetTop + e.offsetHeight)) + GROUP_PAD;
      const reg = h("div", { class: "region", style: { left: x0 + "px", top: y0 + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" } },
        h("div", { class: "region-head" }, h("span", { class: "rl" }, g.label), h("span", { class: "rn" }, `${members.length} ${members.length === 1 ? "tabela" : "tabelas"}`),
          h("button", { type: "button", class: "region-btn", onclick: (e) => { e.stopPropagation(); collapsed.add(g.id); if (focusTable && T.schema[focusTable].group === g.id) focusTable = null; renderAll(); announce(`Grupo ${g.label} recolhido.`); } }, "recolher")));
      regionsEl.append(reg);
    }
  }

  function drawRuler() {
    rulerSvg.replaceChildren();
    rulerRect = null;
    if (T.groups) { rulerSvg.style.display = "none"; return; }
    rulerSvg.style.display = "";
    const els = Object.values(sheets);
    let bottom = Math.max(...els.map((e) => e.offsetTop + e.offsetHeight)) + 64;
    linksSvg.querySelectorAll("path.lk").forEach((p) => { const b = p.getBBox(); bottom = Math.max(bottom, b.y + b.height + 30); });
    Object.values(labels).forEach((l) => { if (l.style.top) bottom = Math.max(bottom, parseFloat(l.style.top) + 50); });
    const left = Math.min(...els.map((e) => e.offsetLeft)), right = Math.max(...els.map((e) => e.offsetLeft + e.offsetWidth));
    rulerSvg.style.top = bottom + "px"; rulerSvg.style.left = left + "px";
    const W = right - left;
    rulerSvg.setAttribute("viewBox", `0 -18 ${W} 80`); rulerSvg.style.width = W + "px";
    rulerRect = { x: left, y: bottom - 20, w: W, h: 90 };
    const x = (n) => 120 + (Math.log10(n) / 5) * (W - 160);
    rulerSvg.append(s("text", { x: 0, y: 24 }, "linhas"), s("text", { x: 0, y: 40 }, "por tabela"), s("line", { x1: x(1), x2: x(100000), y1: 20, y2: 20, "stroke-width": 1 }));
    [1, 10, 100, 1000, 10000, 100000].forEach((n) => {
      rulerSvg.append(s("line", { x1: x(n), x2: x(n), y1: 14, y2: 26, "stroke-width": 1 }), s("text", { x: x(n), y: 46, "text-anchor": "middle" }, fmt(n)));
      if (n < 100000) for (let k = 2; k < 10; k++) rulerSvg.append(s("line", { x1: x(n * k), x2: x(n * k), y1: 17, y2: 23, "stroke-width": 0.8, opacity: 0.6 }));
    });
    for (const t of Object.keys(T.schema)) {
      const n = T.tables[t].length;
      const g = s("g", { "data-table": t });
      g.append(s("path", { class: "tm", d: `M${x(n)},18 l-7,-12 h14 z`, stroke: "none" }), s("text", { class: "tm-lbl", x: x(n), y: 0, "text-anchor": "middle" }, `${t} ${fmt(n)}`));
      rulerSvg.append(g);
      sheets[t].addEventListener("mouseenter", () => g.classList.add("on"));
      sheets[t].addEventListener("mouseleave", () => g.classList.remove("on"));
    }
  }

  function renderAll() {
    for (const el of Object.values(sheets)) el.remove();
    for (const el of Object.values(groupCards)) el.remove();
    sheets = {}; fieldEls = {};
    stage.dataset.lod = lod;
    for (const t of Object.keys(T.schema)) {
      if (nodeOf(t) !== t) continue;
      sheets[t] = makeSheet(t, true);
      world.append(sheets[t]);
    }
    drawRegions();
    drawLinks();
    renderStatus();
  }

  function renderStatus() {
    const rels = T.relationships;
    const st = rels.map((r) => r.status);
    const c = st.filter((x) => x === "confirmed" || x === "caveat").length;
    const sug = rels.filter((r) => r.status === "suggested");
    const attn = sug.filter((r) => relSummary(r).warn).length;
    statusEl.replaceChildren(
      h("p", { class: "eyebrow ab" }, `Mapa · ${Object.keys(T.schema).length} tabelas`),
      h("h1", null, sug.length ? `${sug.length} ${sug.length === 1 ? "relação aguarda" : "relações aguardam"} sua decisão` : "Todas as relações decididas"),
      h("p", null, `${c} de ${st.length} confirmadas${attn ? ` · ${attn} ${attn === 1 ? "precisa" : "precisam"} de atenção` : ""}. Clique numa conexão para ver a evidência e decidir.`));
    App.updateNavCount();
  }

  function applySelectionClasses() {
    const rel = sel && sel.kind === "rel" ? T.relationships.find((r) => r.id === sel.id) : null;
    const nbrs = new Set();
    if (focusTable) { nbrs.add(focusTable); for (const r of T.relationships) { if (r.status === "rejected") continue; if (r.from === focusTable) nbrs.add(r.to); if (r.to === focusTable) nbrs.add(r.from); } }
    for (const r of T.relationships) {
      const g = linkGroups[r.id];
      if (!g) continue;
      const on = rel ? r.id === rel.id : focusTable ? r.from === focusTable || r.to === focusTable : true;
      g.grp.classList.toggle("sel", !!rel && r.id === rel.id);
      g.grp.classList.toggle("dim", !on);
      marks[r.id]?.classList.toggle("sel", !!rel && r.id === rel.id);
      if (marks[r.id]) marks[r.id].classList.toggle("faded", !on);
    }
    for (const t of Object.keys(sheets)) {
      const involved = rel ? rel.from === t || rel.to === t : focusTable ? nbrs.has(t) : true;
      sheets[t].classList.toggle("dim", !involved);
      sheets[t].classList.toggle("lift", !!(rel && involved) || focusTable === t);
      sheets[t].classList.toggle("focus", focusTable === t);
    }
    Object.values(fieldEls).forEach(({ btn }) => btn.classList.remove("reg"));
    if (rel) { fieldEls[`${rel.from}.${rel.fromCol}`]?.btn.classList.add("reg"); fieldEls[`${rel.to}.${rel.toCol}`]?.btn.classList.add("reg"); }
    if (sel && sel.kind === "field") fieldEls[`${sel.table}.${sel.col}`]?.btn.classList.add("reg");
    focusBar.hidden = !focusTable;
    stage.classList.toggle("focusing", !!focusTable);
    if (focusTable) focusBar.replaceChildren(h("span", null, "Destacando ", h("b", { class: "mono" }, focusTable), ` e ${nbrs.size - 1} ${nbrs.size - 1 === 1 ? "vizinha" : "vizinhas"}`), h("button", { type: "button", class: "btn quiet", onclick: () => setFocus(null) }, "Limpar destaque"));
  }

  function setFocus(t, zoom) {
    focusTable = t;
    if (t && T.groups && collapsed.has(T.schema[t].group)) collapsed.delete(T.schema[t].group);
    renderAll();
    if (t && zoom) {
      const ids = new Set([t]);
      for (const r of T.relationships) { if (r.status === "rejected") continue; if (r.from === t) ids.add(r.to); if (r.to === t) ids.add(r.from); }
      focusOn([...ids].filter((x) => sheets[x]).map((x) => rectOf(sheets[x])), true);
    }
    setTrail();
  }

  function stageSize() { return { W: stage.clientWidth, H: stage.clientHeight }; }
  function visibleW() { return stage.clientWidth - (panel && panel.isOpen && root.clientWidth >= 980 ? panel.el.offsetWidth : 0); }
  function lodFor(sc) { return sc < 0.5 ? "overview" : "detail"; }

  function applyCam(animate) {
    world.classList.toggle("still", !animate);
    world.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`;
    const want = lodFor(cam.s);
    if (want !== lod) {
      clearTimeout(lodTimer);
      lodTimer = setTimeout(() => { if (lodFor(cam.s) !== lod) { setLod(lodFor(cam.s)); announce(`Nível de detalhe: ${LOD_NAMES[lod]}.`); } }, animate ? 380 : 140);
    }
    zoomUi.querySelector(".zl").textContent = `${Math.round(cam.s * 100)}% · ${LOD_NAMES[lodFor(cam.s)]}`;
  }

  function setLod(next) {
    lod = next;
    renderAll();
  }

  function contentBox(all) {
    const rects = Object.values(sheets).map(rectOf).concat(Object.values(groupCards).map(rectOf));
    for (const reg of regionsEl.children) rects.push(rectOf(reg));
    for (const m of Object.values(marks)) rects.push({ x: m.offsetLeft - 22, y: m.offsetTop - 22, w: 44, h: 44 });
    if (all && rulerRect) rects.push(rulerRect);
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
    return { x: x0 - 40, y: y0 - 30, w: x1 - x0 + 120, h: y1 - y0 + 50 };
  }

  function fitAll(animate = true, all = false) {
    if (stage.classList.contains("compact")) return;
    const { W, H } = stageSize();
    const top = Math.max(118, statusEl.offsetTop + statusEl.offsetHeight + 18), bottom = 64, left = mode === "paths" ? 430 : 24;
    const b = contentBox(all);
    const sc = Math.min((W - left - 24) / b.w, (H - top - bottom) / b.h, 1.1);
    cam = { s: sc, tx: left + (W - left - 24 - b.w * sc) / 2 - b.x * sc, ty: top + (H - top - bottom - b.h * sc) / 2 - b.y * sc };
    applyCam(animate);
  }

  function focusOn(rects, animate) {
    rects = rects.filter((r) => r && isFinite(r.x) && isFinite(r.w));
    if (!rects.length || stage.classList.contains("compact")) return;
    const x0 = Math.min(...rects.map((r) => r.x)) - 60, y0 = Math.min(...rects.map((r) => r.y)) - 70;
    const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 200, y1 = Math.max(...rects.map((r) => r.y + r.h)) + 70;
    const W = visibleW(), H = stage.clientHeight;
    const fitS = Math.min((W - 40) / (x1 - x0), (H - 40) / (y1 - y0));
    let sc = cam.s;
    if (fitS < sc) sc = Math.max(Math.min(fitS, sc), Math.min(0.62, cam.s));
    if (fitS > sc && sc < 0.5) sc = Math.min(fitS, 0.9);
    cam = { s: sc, tx: (W - (x1 - x0) * sc) / 2 - x0 * sc, ty: (H - (y1 - y0) * sc) / 2 - y0 * sc };
    applyCam(animate);
  }

  function zoomAt(factor, cx, cy, animate) {
    const ns = Math.max(0.22, Math.min(1.6, cam.s * factor));
    cam.tx = cx - (cx - cam.tx) * (ns / cam.s);
    cam.ty = cy - (cy - cam.ty) * (ns / cam.s);
    cam.s = ns;
    applyCam(animate);
  }

  function setTrail() {
    const items = [{ label: "Mapa", go: () => clearSel() }];
    if (sel && sel.kind === "rel") { const r = T.relationships.find((x) => x.id === sel.id); items.push({ label: `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}` }); }
    else if (sel && sel.kind === "table") items.push({ label: sel.table });
    else if (sel && sel.kind === "field") items.push({ label: sel.table, go: () => openTable(sel.table) }, { label: `${sel.table}.${sel.col}` });
    else if (sel && sel.kind === "paths") items.push({ label: "caminhos" });
    else if (focusTable) items.push({ label: `vizinhança de ${focusTable}` });
    if (sel && sel.record) items.push({ label: sel.record });
    App.setTrail(items);
  }

  function clearSel() {
    const hadTable = sel && sel.table;
    sel = null;
    panelStack.length = 0;
    panel.close();
    if (hadTable) renderAll(); else applySelectionClasses();
    setTrail();
  }

  function pushPanel(entry) { panelStack.push(entry); renderPanelTop(); }
  function renderPanelTop() {
    const top = panelStack[panelStack.length - 1];
    const back = panelStack.length > 1 ? { label: panelStack[panelStack.length - 2].title, go: () => { panelStack.pop(); renderPanelTop(); } } : null;
    const prevTable = sel && sel.table;
    sel = Object.assign({}, top.sel);
    panel.open({ eyebrow: top.eyebrow, eyebrowClass: top.eyebrowClass || "", title: top.title, sub: top.sub, body: top.body(), back });
    if ((sel.table || prevTable) && sel.table !== prevTable) renderAll(); else applySelectionClasses();
    setTrail();
    const r = sel.kind === "rel" ? T.relationships.find((x) => x.id === sel.id) : null;
    const tables = r ? [r.from, r.to] : sel.table ? [sel.table] : [];
    const rects = tables.map((t) => nodeEl(nodeOf(t))).filter(Boolean).map(rectOf);
    if (r && marks[r.id]) rects.push({ x: marks[r.id].offsetLeft - 40, y: marks[r.id].offsetTop - 40, w: 220, h: 80 });
    requestAnimationFrame(() => focusOn(rects, true));
  }

  function checks(r) {
    const e = r.ev;
    const out = [];
    const cov = e.ratio;
    out.push({ key: "cov", state: cov >= 0.98 ? "ok" : cov >= 0.9 ? "warn" : "fail", title: "Cobertura", text: `${T.pct(cov)} das linhas de ${r.from} com ${r.fromCol} preenchido encontram o mesmo valor em ${r.to}.${r.toCol} (${fmt(e.matchedRows)} de ${fmt(e.rows - e.nullRows)}).`, rows: () => T.tables[r.from].filter((x) => x[r.fromCol] != null && !e.unmatched.includes(x)), table: r.from });
    out.push({ key: "uniq", state: e.toUnique ? "ok" : "fail", title: "Unicidade do destino", text: e.toUnique ? `${r.to}.${r.toCol} é única: ${fmt(e.toDistinct)} valores, nenhum repetido.` : `${r.to}.${r.toCol} não é única: ${fmt(e.toDupIds.length)} valores aparecem mais de uma vez (${fmt(e.toDupRows)} linhas).`, rows: e.toUnique ? null : () => T.tables[r.to].filter((x) => e.toDupIds.includes(x[r.toCol])), table: r.to, extra: "dup" });
    out.push({ key: "card", state: e.toUnique ? "ok" : "fail", title: "Cardinalidade", text: e.toUnique ? `Esperada N:1, observada N:1: cada ${T.schema[r.from].singular} aponta para no máximo um ${T.schema[r.to].singular}.` : `Esperada N:1. Observada N:N em ${fmt(e.toDupIds.length)} valores: a cardinalidade N:1 não está comprovada.` });
    out.push({ key: "join", state: e.extraJoinRows ? "fail" : "ok", title: "Efeito numa junção", text: e.extraJoinRows ? `Ligar as tabelas transforma ${fmt(e.matchedRows)} linhas em ${fmt(e.joinedRows)}: ${fmt(e.extraJoinRows)} linhas de ${r.from} apareceriam mais de uma vez.` : `Nenhuma linha se multiplica: ${fmt(e.matchedRows)} linhas continuam ${fmt(e.matchedRows)}.` });
    if (e.noneRows || e.nullRows) out.push({ key: "none", state: "warn", title: "Sem par e vazios", text: `${fmt(e.noneRows)} linhas de ${fmt(e.noneDistinct)} valores sem nenhum correspondente${e.nullRows ? `; ${fmt(e.nullRows)} linhas com ${r.fromCol} vazio` : ""}.`, rows: () => e.none.concat(e.nulls), table: r.from });
    if (e.nearRows) out.push({ key: "near", state: "hyp", title: "Hipótese, não aplicada", text: `${fmt(e.nearRows)} linhas de ${fmt(e.nearDistinct)} valores casariam se ${Object.keys(e.nearKinds).join(" e ")} fossem ignorados. Nenhum identificador foi normalizado.`, rows: () => e.near, table: r.from, extra: "near" });
    if (e.unreferenced.length) out.push({ key: "unref", state: "info", title: "Nunca citados", text: `${fmt(e.unreferenced.length)} valores de ${r.to} não aparecem em ${r.from}. Não é erro: só não foram citados.`, rows: () => e.unreferencedRows, table: r.to });
    if (e.coincidence) out.push({ key: "coinc", state: "fail", title: "Sinal fraco", text: `${r.fromCol} tem só ${fmt(e.fromDistinct)} valores diferentes, e ${r.to}.${r.toCol} tem ${fmt(e.toDistinct)}. Valores pequenos casam com quase qualquer id: a cobertura não prova a relação.` });
    if (!e.nameHint) out.push({ key: "name", state: "warn", title: "Nome da coluna", text: `O nome ${r.fromCol} não sugere ${r.to}. Isso não decide nada sozinho, mas pesa contra.` });
    for (const cid of r.competitors) {
      const c = T.relationships.find((x) => x.id === cid);
      out.push({ key: "comp-" + cid, state: "hyp", title: "Destino concorrente", text: `${r.from}.${r.fromCol} também casa com ${c.to}.${c.toCol}: cobertura ${T.pct(c.ev.ratio)}, destino ${c.ev.toUnique ? "único" : "com repetidos"}${c.ev.nameHint ? ", nome compatível" : ""}. Só uma pode valer.`, go: () => selectRel(cid) });
    }
    return out;
  }

  function columnsFor(table, extra, r) {
    const sc = T.schema[table];
    const cols = sc.columns.map((c) => ({ key: c.key, label: c.key, mono: c.type !== "text", align: c.type === "number" ? "r" : "", render: c.type === "date" ? (row) => T.dateBR(row[c.key]) : null, get: c.type === "number" ? (row) => (row[c.key] === null ? null : Number(row[c.key])) : null }));
    if (extra === "near" && r) {
      const pairs = new Map(r.ev.nearPairs.map(([v, c, k]) => [v, { c, k }]));
      cols.push({ key: "_cand", label: "candidato", mono: true, get: (row) => pairs.get(row[r.fromCol])?.c || "", render: (row) => { const p = pairs.get(row[r.fromCol]); return p ? h("span", { class: "tagx pos" }, `${p.c} · ${p.k}`) : "·"; } });
    }
    if (extra === "dup" && table === "beneficiarios") cols.push({ key: "_att", label: "atend.", align: "r", get: (row) => (T.attByBen.get(row.id) || []).length });
    if (table === "beneficiarios" && !extra) cols.push({ key: "_att", label: "atend.", align: "r", get: (row) => (T.attByBen.get(row.id) || []).length });
    return cols;
  }

  function relBody(r) {
    const e = r.ev;
    const sm = relSummary(r);
    const wrap = [];
    const summaryText = e.coincidence ? `${T.pct(e.ratio)} das linhas encontram par, mas ${r.fromCol} tem só ${fmt(e.fromDistinct)} valores diferentes: valores pequenos casam com quase qualquer id, então a cobertura não prova a relação.`
      : !e.toUnique ? `${T.pct(e.ratio)} das linhas encontram par, mas ${r.to}.${r.toCol} tem ${fmt(e.toDupIds.length)} ids repetidos: ligar as tabelas multiplicaria ${fmt(e.extraJoinRows)} linhas.`
      : `${T.pct(e.ratio)} das linhas encontram par e o destino é único: a evidência sustenta N:1.${e.noneRows ? ` ${fmt(e.noneRows)} linhas ficam sem par.` : ""}`;
    const comp = r.competitors.map((id) => T.relationships.find((x) => x.id === id)).filter((c) => c && c.status === "suggested");
    wrap.push(h("div", { class: "rel-top" },
      h("div", { class: "statusline" }, h("span", { class: `state-pill ${r.status}` }, stateWord(r.status)), h("span", { class: "rel-role" }, r.role)),
      h("p", { class: `rel-summary ${sm.warn ? "warn" : ""}` }, summaryText),
      h("ul", { class: "rel-facts", "aria-label": "Resumo da evidência" },
        h("li", null, h("b", null, T.pct(e.ratio)), " cobertura"),
        h("li", { class: e.toUnique ? "" : "bad" }, h("b", null, e.toUnique ? "único" : fmt(e.toDupIds.length)), e.toUnique ? " destino" : " ids repetidos"),
        h("li", { class: e.toUnique && !e.coincidence ? "" : "bad" }, h("b", null, e.toUnique && !e.coincidence ? "N:1" : "N:1?"), e.toUnique && !e.coincidence ? " comprovada" : " não comprovada")),
      comp.length && r.status === "suggested" ? h("p", { class: "rel-comp" }, `Esta coluna também casa com ${comp.map((c) => `${c.to}.${c.toCol}`).join(", ")}. Só uma pode valer. `, ...comp.map((c) => h("button", { type: "button", class: "btn link", onclick: () => selectRel(c.id) }, `Ver ${c.to}`))) : null));
    wrap.push(decisionSection(r));

    const more = (title, meta, open, ...content) => {
      const d = h("details", { class: "ev-more" }, h("summary", null, h("span", { class: "em-t" }, title), meta ? h("span", { class: "em-m" }, meta) : null), h("div", { class: "em-body" }, ...content));
      if (open) d.open = true;
      return d;
    };
    const items = checks(r);
    const list = h("div", { class: "ck-list" });
    const recHost = h("div", { class: "ck-records" });
    const choose = (it, btn) => {
      list.querySelectorAll(".ck").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      recHost.replaceChildren(h("p", { class: "eyebrow", style: { margin: "0 0 10px" } }, it.title), recordTable({ rows: it.rows(), columns: columnsFor(it.table, it.extra, r), searchPlaceholder: `Buscar em ${it.table}`, onRow: (row) => openRecord(it.table, row), ariaLabel: it.title, pageSize: 40 }));
    };
    const glyph = { ok: "✓", warn: "!", fail: "✕", hyp: "?", info: "·" };
    const stateLabel = { ok: "ok", warn: "atenção", fail: "falha", hyp: "hipótese", info: "informação" };
    const hypBtns = [];
    items.forEach((it) => {
      const clickable = !!(it.rows || it.go);
      const btn = h(clickable ? "button" : "div", { type: clickable ? "button" : null, class: `ck ${it.state} ${clickable ? "click" : ""}`, "aria-pressed": clickable ? "false" : null },
        h("span", { class: "cg", "aria-label": stateLabel[it.state] }, glyph[it.state]), h("span", { class: "ct" }, h("b", null, it.title), h("span", null, it.text)), clickable ? h("span", { class: "chev", "aria-hidden": "true" }, it.go ? "↗" : "›") : null);
      if (it.go) btn.addEventListener("click", it.go);
      else if (it.rows) btn.addEventListener("click", () => choose(it, btn));
      if (it.state === "hyp") hypBtns.push(btn); else list.append(btn);
    });
    const fails = items.filter((it) => it.state === "fail").length, warns = items.filter((it) => it.state === "warn").length;
    wrap.push(more("Evidência completa", `${items.length - hypBtns.length} verificações${fails ? ` · ${fails} ${fails === 1 ? "falha" : "falhas"}` : ""}${warns ? ` · ${warns} ${warns === 1 ? "atenção" : "atenções"}` : ""}`, false, h("p", { class: "small-note" }, "Clique numa verificação para ver os registros."), list, recHost));
    wrap.push(more("Valores de chave sobrepostos", `${fmt(e.matchedDistinct)} nos dois`, false, overprint(r)));
    if (e.joinEffect.length) {
      const rows = e.joinEffect.map((x) => ({ ...x, nome: (T.tables[r.to].find((y) => y[r.toCol] === x.key) || {}).nome || "" }));
      wrap.push(more("O que se multiplica numa junção", `+${fmt(e.extraJoinRows)} linhas`, false,
        h("p", { class: "small-note" }, `Cada linha de ${r.from} que aponta para um id repetido vira uma linha por cópia do id. Somas e contagens de linhas que atravessem a relação ficariam infladas por estas ${fmt(e.extraJoinRows)} linhas.`),
        recordTable({ rows, search: rows.length > 12, pageSize: 12, columns: [{ key: "key", label: "id", mono: true }, { key: "nome", label: "nome" }, { key: "toRows", label: "cópias", align: "r" }, { key: "fromRows", label: r.from, align: "r" }, { key: "after", label: "após ligar", align: "r", render: (x) => h("b", null, `${fmt(x.after)} (+${fmt(x.after - x.fromRows)})`) }] })));
    }
    if (hypBtns.length) wrap.push(more("Hipóteses, não aplicadas", `${hypBtns.length}`, false, h("p", { class: "small-note" }, "Nenhum identificador foi alterado. São pistas para você decidir."), h("div", { class: "ck-list" }, ...hypBtns)));
    const next = h("div", { class: "links-list" });
    if (r.from === "atendimentos" && r.to === "beneficiarios") next.append(h("button", { type: "button", class: "link-card", onclick: () => App.go("comparacao", {}) }, h("span", { class: "lt" }, "Comparar os dois lados"), h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "ld" }, "cadastro × atendidos: quem está só de um lado e por quê")));
    if (["atendimentos", "beneficiarios"].includes(r.from) && r.to === "cozinhas") next.append(h("button", { type: "button", class: "link-card", onclick: () => App.go("pergunta", { reset: true, kitchen: T.ws.focusKitchen, year: 2025, source: r.from === "atendimentos" ? "atendimento" : "cadastro", reading: r.from === "atendimentos" ? "served" : null }) }, h("span", { class: "lt" }, "Perguntar a partir desta relação"), h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "ld" }, `Beneficiários da ${T.kitchen[T.ws.focusKitchen].nome} em 2025`)));
    next.append(h("button", { type: "button", class: "link-card", onclick: () => setFocus(r.from, true) }, h("span", { class: "lt" }, `Destacar a vizinhança de ${r.from}`), h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "ld" }, "esmaece o resto do mapa")));
    wrap.push(more("Daqui você pode", null, false, next));
    return wrap;
  }

  function decisionSection(r) {
    const e = r.ev;
    const sec = h("section", { class: "decision", "aria-label": "Sua decisão" });
    const extra = h("div", { class: "dec-extra" });
    const render = () => {
      sec.replaceChildren();
      if (r.status !== "suggested") {
        const d = r.decision || {};
        const desc = r.status === "confirmed" ? "Confirmada como N:1. A evidência sustenta a cardinalidade."
          : r.status === "caveat" ? `Confirmada com ressalva: N:1 esperada, não comprovada (${fmt(e.toDupIds.length)} ids repetidos). ${d.policy === "block" ? "Perguntas que atravessarem a relação só contam valores distintos; somas e contagens de linhas ficam bloqueadas." : "Perguntas que atravessarem a relação mostram quantas linhas foram multiplicadas."}`
          : d.auto ? `Rejeitada porque você confirmou a concorrente ${T.relationships.find((x) => x.id === d.auto)?.to}.${T.relationships.find((x) => x.id === d.auto)?.toCol}.` : "Rejeitada. Não será usada em perguntas nem comparações.";
        sec.append(h("div", { class: `dec-record ${r.status}` }, h("p", { class: "eyebrow" }, `sua decisão · ${d.at || "agora"} · arquivos versão 1`), h("p", null, desc),
          h("div", { class: "panel-actions" }, h("button", { type: "button", class: "btn", onclick: () => undoDecision(r) }, "Desfazer decisão"))));
        return;
      }
      const blocked = !e.toUnique || e.coincidence;
      const canCaveat = !e.toUnique && !e.coincidence;
      const actions = h("div", { class: "panel-actions" });
      if (!blocked) actions.append(h("button", { type: "button", class: "btn ab", onclick: () => decide(r, "confirmed") }, "Confirmar como N:1"));
      if (canCaveat) actions.append(h("button", { type: "button", class: "btn ab", "aria-expanded": "false", onclick: (ev) => { const open = ev.currentTarget.getAttribute("aria-expanded") === "true"; ev.currentTarget.setAttribute("aria-expanded", String(!open)); extra.replaceChildren(...(open ? [] : [caveatForm(r)])); if (!open) extra.querySelector("input")?.focus(); } }, "Confirmar com ressalva…"));
      actions.append(h("button", { type: "button", class: "btn", "aria-expanded": "false", onclick: (ev) => { const open = ev.currentTarget.getAttribute("aria-expanded") === "true"; ev.currentTarget.setAttribute("aria-expanded", String(!open)); extra.replaceChildren(...(open ? [] : [fixBox(r)])); } }, "Corrigir colunas"), h("button", { type: "button", class: "btn quiet", onclick: () => decide(r, "rejected") }, "Rejeitar"));
      if (blocked) sec.append(h("p", { class: "dec-block" }, h("b", null, "Não dá para confirmar como N:1. "), e.coincidence ? "A origem tem poucos valores e casaria com qualquer id pequeno." : `${r.to}.${r.toCol} tem ${fmt(e.toDupIds.length)} ids repetidos.`, canCaveat ? " Você pode confirmar com ressalva, corrigir as colunas ou rejeitar." : " Você pode corrigir as colunas ou rejeitar."));
      const comp = r.competitors.map((id) => T.relationships.find((x) => x.id === id)).filter((c) => c.status === "suggested");
      sec.append(actions);
      if (comp.length && !blocked) sec.append(h("p", { class: "small-note" }, `Confirmar rejeita a concorrente ${comp.map((c) => `${c.to}.${c.toCol}`).join(", ")}. Dá para desfazer.`));
      sec.append(extra);
    };
    render();
    return sec;
  }

  function caveatForm(r) {
    const e = r.ev;
    const opt = (val, title, text) => h("label", { class: "pol" }, h("input", { type: "radio", name: "pol-" + r.id, value: val, checked: val === "block" ? true : null }), h("span", null, h("b", null, title), h("span", null, text)));
    const form = h("div", { class: "caveat" },
      h("p", null, "A relação passa a valer, registrada como ", h("b", null, "N:1 esperada, não comprovada"), `. Os ${fmt(e.toDupIds.length)} ids repetidos continuam visíveis. O que acontece com perguntas que atravessarem a relação?`),
      opt("block", "Bloquear o que multiplica", "contagens de valores distintos funcionam; somas e contagens de linhas ficam bloqueadas até os ids serem corrigidos."),
      opt("warn", "Permitir e mostrar a multiplicação", `as respostas são calculadas e mostram quantas linhas foram duplicadas (até ${fmt(e.extraJoinRows)}).`),
      h("div", { class: "panel-actions" }, h("button", { type: "button", class: "btn ab", onclick: () => decide(r, "caveat", form.querySelector("input:checked").value) }, "Confirmar com ressalva")));
    return form;
  }

  function stamp() { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

  function decide(r, status, policy) {
    const snapshot = T.relationships.map((x) => ({ x, status: x.status, decision: x.decision }));
    r.status = status;
    r.decision = { kind: status, policy: policy || null, at: stamp() };
    const autoRejected = [];
    if (status === "confirmed" || status === "caveat") for (const cid of r.competitors) { const c = T.relationships.find((x) => x.id === cid); if (c.status === "suggested") { c.status = "rejected"; c.decision = { kind: "rejected", auto: r.id, at: stamp() }; autoRejected.push(c); } }
    r._undo = snapshot;
    renderAll();
    const m = marks[r.id];
    if (m && status !== "rejected") { m.classList.remove("stamp"); void m.offsetWidth; m.classList.add("stamp"); }
    const msg = status === "confirmed" ? "Relação confirmada como N:1" : status === "caveat" ? `Relação confirmada com ressalva · ${policy === "block" ? "bloqueia o que multiplica" : "mostra a multiplicação"}` : "Relação rejeitada";
    announce(msg + (autoRejected.length ? `. ${autoRejected.length} concorrente rejeitada.` : "."));
    toast(msg + (autoRejected.length ? ` · concorrente rejeitada` : ""), "Desfazer", () => undoDecision(r));
    if (panel.isOpen && sel && sel.kind === "rel") renderPanelTop();
    if (mode === "paths") renderPaths();
  }

  function undoDecision(r) {
    if (r._undo) { for (const sn of r._undo) { sn.x.status = sn.status; sn.x.decision = sn.decision; } r._undo = null; }
    else { r.status = "suggested"; r.decision = null; }
    renderAll();
    announce("Decisão desfeita.");
    toast("Decisão desfeita");
    if (panel.isOpen && sel && sel.kind === "rel") renderPanelTop();
  }

  function overprint(r) {
    const e = r.ev;
    const fromOnly = e.nearDistinct + e.noneDistinct, toOnly = e.unreferenced.length, both = e.matchedDistinct;
    const W = 620, H = 168;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${fmt(e.fromDistinct)} valores em ${r.from}.${r.fromCol}, ${fmt(e.toDistinct)} em ${r.to}.${r.toCol}; ${fmt(both)} nos dois, ${fmt(fromOnly)} só na origem, ${fmt(toOnly)} só no destino.` });
    svg.append(s("defs", null, s("pattern", { id: "op-ht-" + r.id, width: 4, height: 4, patternUnits: "userSpaceOnUse" }, s("rect", { width: 4, height: 4, fill: "var(--a-wash)" }), s("circle", { cx: 2, cy: 2, r: 1.1, fill: "#1f4fd6" }))));
    const x0 = 4, L = fromOnly ? 104 : 0, R = toOnly ? 132 : 0, M = W - 8 - L - R;
    const bx = x0 + L, yA = 30, yB = 46, hh = 52;
    const mono = (sz, w, fill) => `font: ${w} ${sz}px var(--f-mono); fill: ${fill}`;
    svg.append(s("text", { x: x0, y: 18, style: mono(12, 600, "var(--a-deep)") }, `${r.from}.${r.fromCol} · ${fmt(e.fromDistinct)} valores`));
    svg.append(s("text", { x: W - 4, y: H - 4, "text-anchor": "end", style: mono(12, 600, "var(--b-deep)") }, `${r.to}.${r.toCol} · ${fmt(e.toDistinct)} valores`));
    if (fromOnly) {
      const wn = (e.nearDistinct / fromOnly) * L;
      svg.append(s("rect", { x: x0, y: yA, width: wn, height: hh, fill: `url(#op-ht-${r.id})` }), s("rect", { x: x0 + wn, y: yA, width: L - wn, height: hh, fill: "var(--a)" }));
      svg.append(s("text", { x: x0, y: yA + hh + 18, style: mono(12.5, 600, "var(--ink)") }, `${fmt(e.nearDistinct)} possíveis`), s("text", { x: x0, y: yA + hh + 34, style: mono(11.5, 500, "var(--ink-3)") }, `${fmt(e.noneDistinct)} sem par`));
    }
    svg.append(s("rect", { x: bx, y: yA, width: M, height: hh, fill: "var(--a)" }), s("rect", { x: bx, y: yB, width: M + R, height: hh, fill: "var(--b)", style: "mix-blend-mode: multiply" }));
    const brk = bx + M * 0.32;
    if (fromOnly || toOnly) svg.append(s("path", { d: `M${brk},${yA - 4} l-9,${hh + 24} M${brk + 9},${yA - 4} l-9,${hh + 24}`, stroke: "var(--sheet)", "stroke-width": 4 }));
    const cx = bx + M * 0.66;
    svg.append(s("text", { x: cx, y: yB + 22, "text-anchor": "middle", style: mono(18, 700, "#fff") }, fmt(both)), s("text", { x: cx, y: yB + 36, "text-anchor": "middle", style: mono(11.5, 500, "#fff") }, "nos dois"));
    if (toOnly) svg.append(s("text", { x: bx + M + R / 2, y: yB + hh / 2 + 10, "text-anchor": "middle", style: mono(15, 700, "#fff") }, fmt(toOnly)), s("text", { x: bx + M + R / 2, y: yA + 10, "text-anchor": "middle", style: mono(11, 500, "var(--ink-3)") }, "nunca citados"));
    if (!fromOnly && !toOnly) svg.append(s("text", { x: x0, y: yB + hh + 22, style: mono(12.5, 500, "var(--ink-2)") }, "nenhuma sobra dos dois lados"));
    if (fromOnly || toOnly) svg.append(s("text", { x: brk - 4, y: yB + hh + 22, "text-anchor": "middle", style: mono(10.5, 500, "var(--ink-3)") }, "escala comprimida"));
    return svg;
  }

  function fixBox(r) {
    const fromCols = T.schema[r.from].columns.filter((c) => c.type === "identifier").map((c) => c.key);
    const fSel = h("select", { "aria-label": "Coluna de origem" }, ...fromCols.map((c) => h("option", { value: c, selected: c === r.fromCol ? true : null }, `${r.from}.${c}`)));
    const tSel = h("select", { "aria-label": "Coluna de destino" });
    for (const t of Object.keys(T.schema)) for (const c of T.schema[t].columns.filter((c) => c.type === "identifier")) tSel.append(h("option", { value: `${t}.${c.key}`, selected: t === r.to && c.key === r.toCol ? true : null }, `${t}.${c.key}`));
    const res = h("div", { class: "fix-res" });
    const apply = h("button", { type: "button", class: "btn primary", disabled: true }, "Usar estas colunas");
    const calc = () => {
      const [tt, tc] = tSel.value.split(".");
      if (tt === r.from && tc === fSel.value) { res.replaceChildren("Escolha uma coluna de outra tabela ou outra coluna."); apply.disabled = true; return; }
      const ev = T.evidence(r.from, fSel.value, tt, tc);
      const same = fSel.value === r.fromCol && tt === r.to && tc === r.toCol;
      const line = (state, text) => h("div", { class: `ck mini ${state}` }, h("span", { class: "cg" }, { ok: "✓", warn: "!", fail: "✕" }[state]), h("span", { class: "ct" }, text));
      res.replaceChildren(
        line(ev.ratio >= 0.98 ? "ok" : ev.ratio >= 0.9 ? "warn" : "fail", `cobertura ${T.pct(ev.ratio)} (${fmt(ev.matchedDistinct)} de ${fmt(ev.fromDistinct)} valores)`),
        line(ev.toUnique ? "ok" : "fail", ev.toUnique ? "destino único" : `${fmt(ev.toDupIds.length)} ids repetidos no destino`),
        line(ev.coincidence ? "fail" : ev.fromDistinct / Math.max(1, ev.toDistinct) < 0.02 ? "warn" : "ok", ev.coincidence ? `só ${fmt(ev.fromDistinct)} valores na origem: coincidência provável` : `${fmt(ev.fromDistinct)} valores na origem, ${fmt(ev.toDistinct)} no destino`),
        line(ev.nameHint ? "ok" : "warn", ev.nameHint ? "nome compatível" : `o nome ${fSel.value} não sugere ${tt}`));
      apply.disabled = same || ev.ratio === 0;
      apply.onclick = () => {
        const prev = { fromCol: r.fromCol, to: r.to, toCol: r.toCol, ev: r.ev, status: r.status, decision: r.decision };
        Object.assign(r, { fromCol: fSel.value, to: tt, toCol: tc, ev, status: "suggested", decision: null });
        renderAll(); renderPanelTop();
        toast(`Colunas corrigidas: ${r.from}.${r.fromCol} → ${r.to}.${r.toCol}. Continua sugerida até você decidir.`, "Desfazer", () => { Object.assign(r, prev); renderAll(); renderPanelTop(); });
      };
    };
    fSel.addEventListener("change", calc);
    tSel.addEventListener("change", calc);
    calc();
    return h("div", { class: "fix-box" }, h("div", { class: "fix-row" }, fSel, h("span", null, "→"), tSel), res, h("div", null, apply), h("p", { class: "small-note" }, "A evidência é recalculada nos dados antes de você salvar. Corrigir não confirma: a relação volta a ser sugestão."));
  }

  function selectRel(id) {
    if (mode === "paths") setMode("structure");
    const r = T.relationships.find((x) => x.id === id);
    if (T.groups) { [r.from, r.to].forEach((t) => collapsed.delete(T.schema[t].group)); }
    if (focusTable && focusTable !== r.from && focusTable !== r.to) focusTable = null;
    panelStack.length = 0;
    pushPanel({ eyebrow: `Relação ${stateWord(r.status)}${r.status === "suggested" ? " pelo Trace" : ""}`, eyebrowClass: "ab", title: `${r.from} → ${r.to}`, sub: `${r.from}.${r.fromCol} = ${r.to}.${r.toCol}`, body: () => relBody(r), sel: { kind: "rel", id } });
  }

  function openTable(t, opts = {}) {
    if (mode === "paths") setMode("structure");
    const sc = T.schema[t];
    focusTable = t;
    panelStack.length = 0;
    pushPanel({ eyebrow: `Tabela · ${sc.file} · versão 1`, title: t, sub: `${fmt(T.tables[t].length)} linhas · ${sc.columns.length} campos · ${sc.grain}`, body: () => tableBody(t, opts), sel: { kind: "table", table: t } });
    renderAll();
  }

  function tableBody(t, opts) {
    const sc = T.schema[t];
    const out = [];
    if (sc.validity) {
      const box = h("div", { class: "vig-box" });
      const render = () => box.replaceChildren(
        h("p", { class: "eyebrow ab" }, T.ws.validityConfirmed ? "Vigência confirmada" : "Vigência sugerida"),
        h("p", null, h("b", { class: "mono" }, sc.validity[0]), " e ", h("b", { class: "mono" }, sc.validity[1]), T.ws.validityConfirmed ? " definem quando cada beneficiário esteve ativo. Perguntas sobre períodos oferecem leituras como “ativos em 2025”." : " parecem marcar início e fim de cada cadastro. Confirmar permite perguntar quem estava ativo num período."),
        h("div", null, h("button", { type: "button", class: T.ws.validityConfirmed ? "btn" : "btn ab", onclick: () => { T.ws.validityConfirmed = !T.ws.validityConfirmed; renderAll(); render(); toast(T.ws.validityConfirmed ? "Vigência confirmada em beneficiarios" : "Vigência voltou a ser sugestão", "Desfazer", () => { T.ws.validityConfirmed = !T.ws.validityConfirmed; renderAll(); render(); }); } }, T.ws.validityConfirmed ? "Desfazer" : "Usar como vigência")));
      render();
      out.push(box);
      if (opts.focusValidity) setTimeout(() => box.querySelector("button")?.focus(), 350);
    }
    const grainBtn = h("button", { type: "button", class: "grain", title: "O que uma linha representa. Clique para editar." }, sc.grain, h("span", { "aria-hidden": "true" }, "✎"));
    grainBtn.addEventListener("click", (e) => { e.stopPropagation(); editGrain(t, grainBtn); });
    out.unshift(h("p", { class: "grain-line" }, h("span", { class: "eyebrow" }, "cada linha representa"), grainBtn));
    out.push(h("section", null, h("h3", null, "Campos"), h("div", { class: "field-grid" }, ...sc.columns.map((c) => h("button", { type: "button", class: "fcard", onclick: () => openField(t, c.key) }, h("b", null, c.key), fieldNote(t, c), miniViz(t, c, 150, 26))))));
    const rels = T.relationships.filter((r) => r.from === t || r.to === t);
    out.push(h("section", null, h("h3", null, `Relações · ${rels.length}`), h("div", { class: "links-list" }, ...rels.map((r) => h("button", { type: "button", class: "link-card", onclick: () => selectRel(r.id) }, h("span", { class: "lt" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`), h("span", { class: `state-pill ${r.status}` }, stateWord(r.status)), h("span", { class: "ld" }, `cobertura ${T.pct(r.ev.ratio)} · ${cardLine(r).text}${cardLine(r).sub ? " · " + cardLine(r).sub : ""}`))))));
    out.push(h("section", null, h("h3", null, "Registros"), recordTable({ rows: T.tables[t], columns: columnsFor(t), searchPlaceholder: `Buscar em ${fmt(T.tables[t].length)} linhas`, onRow: (row) => openRecord(t, row), ariaLabel: `Registros de ${t}`, pageSize: 50, maxHeight: "460px" })));
    return out;
  }

  function openField(t, key) {
    if (mode === "paths") setMode("structure");
    const col = T.schema[t].columns.find((c) => c.key === key);
    const p = T.profiles[t][key];
    panelStack.length = 0;
    pushPanel({ eyebrow: `Campo · ${t}`, title: key, sub: `${typeName[col.type]} · ${fmt(p.nonNull)} valores · ${fmt(p.distinct)} diferentes${p.nulls ? ` · ${fmt(p.nulls)} vazios` : ""}`, body: () => fieldBody(t, col), sel: { kind: "field", table: t, col: key } });
  }

  function fieldBody(t, col) {
    const p = T.profiles[t][col.key];
    const out = [];
    const typeSel = h("select", { "aria-label": "Tipo do campo", class: "type-sel" }, ...Object.entries(typeName).map(([k, v]) => h("option", { value: k, selected: k === col.type ? true : null }, v)));
    typeSel.addEventListener("change", () => toast(`Protótipo: o tipo de ${t}.${col.key} passaria a ${typeName[typeSel.value]} e as perguntas seriam recalculadas.`, "Desfazer", () => { typeSel.value = col.type; }));
    out.push(h("section", null, h("h3", null, "Tipo"), h("div", { class: "statusline" }, typeSel, h("span", { class: "small-note" }, "inferido na importação; corrigir muda como o Trace compara os valores"))));
    out.push(h("section", { class: "prof-big" }, h("h3", null, "Perfil"), bigProfile(t, col, p)));
    const iss = [];
    if (col.role === "key" && p.dupValues) iss.push({ t: `${fmt(p.dupValues)} ids aparecem mais de uma vez (${fmt(p.dupExtraRows)} linhas a mais)`, rows: T.tables[t].filter((r) => p.dupList.includes(r[col.key])) });
    if (col.type === "identifier" && p.shortRows) iss.push({ t: `${fmt(p.shortRows)} valores têm menos de ${p.modalLength} dígitos (${fmt(p.shortValues)} ids diferentes)`, rows: T.tables[t].filter((r) => r[col.key] && r[col.key].length < p.modalLength && /^\d+$/.test(r[col.key])) });
    if (col.type === "identifier" && p.variantRows) iss.push({ t: `${fmt(p.variantRows)} valores com caixa ou espaços diferentes do padrão`, rows: T.tables[t].filter((r) => r[col.key] && (r[col.key] !== r[col.key].trim() || /[a-z]/.test(r[col.key]))) });
    if (col.role === "fk" && p.nulls) iss.push({ t: `${fmt(p.nulls)} linhas sem valor`, rows: T.tables[t].filter((r) => r[col.key] == null) });
    if (iss.length) out.push(h("section", null, h("h3", null, "Pontos de atenção"), ...iss.map((x) => h("div", { style: { display: "grid", gap: "10px", marginBottom: "16px" } }, h("p", { style: { margin: 0, fontWeight: 600 } }, x.t), recordTable({ rows: x.rows, columns: columnsFor(t), onRow: (row) => openRecord(t, row), pageSize: 20 })))));
    const used = T.relationships.filter((r) => (r.from === t && r.fromCol === col.key) || (r.to === t && r.toCol === col.key));
    if (used.length) out.push(h("section", null, h("h3", null, "Usado em"), h("div", { class: "links-list" }, ...used.map((r) => h("button", { type: "button", class: "link-card", onclick: () => selectRel(r.id) }, h("span", { class: "lt" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`), h("span", { class: `state-pill ${r.status}` }, stateWord(r.status)))))));
    if (col.note) out.push(h("p", { class: "small-note" }, `Observação: ${col.note}.`));
    return out;
  }

  function bigProfile(t, col, p) {
    const W = 620, H = 150;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (col.type === "date" && p.months) {
      const max = Math.max(...p.months.map((m) => m[1]));
      const bw = (W - 40) / p.months.length;
      svg.setAttribute("aria-label", `Distribuição mensal de ${col.key}`);
      p.months.forEach(([m, c], i) => {
        const bh = (c / max) * (H - 40);
        const r = s("rect", { x: 20 + i * bw, y: H - 24 - bh, width: Math.max(1, bw - 1.5), height: bh, fill: m.startsWith("2025") ? "var(--a)" : "var(--ink-3)", opacity: m.startsWith("2025") ? 1 : 0.55 });
        r.append(s("title", null, `${m}: ${fmt(c)}`));
        svg.append(r);
        if (m.endsWith("-01")) svg.append(s("text", { x: 20 + i * bw, y: H - 8, style: "font: 500 12px var(--f-mono); fill: var(--ink-3)" }, m.slice(0, 4)));
      });
      return svg;
    }
    const rows = (p.top || p.values || []).slice(0, 8);
    if (rows.length) {
      const max = Math.max(...rows.map((x) => x[1]));
      const lh = 20;
      svg.setAttribute("viewBox", `0 0 ${W} ${rows.length * lh + 10}`);
      svg.setAttribute("aria-label", `Valores mais frequentes de ${col.key}`);
      rows.forEach(([v, c], i) => {
        const label = col.key === "cozinha_id" && T.kitchen[v] ? `${v} ${T.kitchen[v].nome.replace("Cozinha ", "")}` : String(v);
        svg.append(s("text", { x: 0, y: i * lh + 14, style: "font: 500 12.5px var(--f-mono); fill: var(--ink)" }, label));
        svg.append(s("rect", { x: 210, y: i * lh + 4, width: (c / max) * (W - 300), height: lh - 6, fill: "var(--ink)", opacity: 0.7 }));
        svg.append(s("text", { x: 216 + (c / max) * (W - 300), y: i * lh + 14, style: "font: 500 12px var(--f-mono); fill: var(--ink-3)" }, fmt(c)));
      });
      return svg;
    }
    svg.setAttribute("viewBox", `0 0 ${W} 70`);
    svg.setAttribute("aria-label", `${fmt(p.distinct)} valores diferentes em ${fmt(p.nonNull)} linhas`);
    svg.append(s("rect", { x: 0, y: 18, width: W, height: 16, fill: "var(--ink)", opacity: 0.8 }));
    if (p.dupValues) svg.append(s("rect", { x: 5, y: 13, width: W - 5, height: 16, fill: "none", stroke: "var(--b)", "stroke-width": 1.6 }));
    svg.append(s("text", { x: 0, y: 58, style: "font: 500 12.5px var(--f-mono); fill: var(--ink-2)" }, `${fmt(p.distinct)} valores diferentes em ${fmt(p.nonNull)} linhas${p.dupValues ? ` · ${fmt(p.dupValues)} repetidos` : " · todos únicos"}`));
    return svg;
  }

  function openRecord(t, row) {
    const title = `${T.schema[t].singular} ${row.id}`;
    pushPanel({ eyebrow: `Registro · ${T.schema[t].file} · linha ${row._line}`, title: row.nome || title, sub: `${t}.id = ${row.id}`, body: () => recordBody(t, row), sel: Object.assign({}, sel, { record: title }) });
  }

  function recordBody(t, row) {
    const sc = T.schema[t];
    const out = [h("dl", { class: "kv" }, ...sc.columns.flatMap((c) => [h("dt", null, c.key), h("dd", null, c.type === "date" ? T.dateBR(row[c.key]) : row[c.key] ?? "·")]))];
    const linked = h("div", { class: "links-list" });
    for (const r of T.relationships.filter((x) => x.from === t && x.status !== "rejected")) {
      const v = row[r.fromCol];
      const target = v == null ? null : T.tables[r.to].filter((x) => x[r.toCol] === v);
      const near = v == null ? null : r.ev.nearPairs.find((p) => p[0] === v);
      const head = `${r.fromCol} = ${v ?? "vazio"} → ${r.to}`;
      if (target && target.length) linked.append(h("button", { type: "button", class: "link-card", onclick: () => openRecord(r.to, target[0]) }, h("span", { class: "lt" }, head), target.length > 1 ? h("span", { class: "tagx rep" }, `${target.length} cópias`) : h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "ld" }, `${target[0].nome || target[0].id}${r.status === "suggested" ? " · relação ainda sugerida" : ""}`)));
      else if (near) linked.append(h("div", { class: "link-card" }, h("span", { class: "lt" }, head), h("span", { class: "tagx pos" }, "possível"), h("span", { class: "ld" }, `sem par exato; ${near[1]} existe (${near[2]}). Não aplicado.`)));
      else linked.append(h("div", { class: "link-card" }, h("span", { class: "lt" }, head), h("span", { class: "tagx out" }, v == null ? "vazio" : "sem par")));
    }
    for (const r of T.relationships.filter((x) => x.to === t && x.from !== t && x.status !== "rejected")) {
      const n = T.tables[r.from].reduce((a, x) => a + (x[r.fromCol] === row[r.toCol] ? 1 : 0), 0);
      linked.append(h("div", { class: "link-card" }, h("span", { class: "lt" }, `${fmt(n)} ${r.from} apontam para cá`), h("span", null, ""), h("span", { class: "ld" }, `${r.from}.${r.fromCol} = ${row[r.toCol]}${r.status === "suggested" ? " · relação ainda sugerida" : ""}`)));
    }
    if (t === "beneficiarios") {
      const dupN = T.tables.beneficiarios.filter((x) => x.id === row.id).length;
      if (dupN > 1) linked.prepend(h("div", { class: "link-card" }, h("span", { class: "lt" }, `id ${row.id} aparece ${dupN} vezes no cadastro`), h("span", { class: "tagx rep" }, "repetido"), h("span", { class: "ld" }, `numa junção, cada atendimento desta pessoa contaria ${dupN} vezes`)));
    }
    out.push(h("section", null, h("h3", null, "Ligações"), linked));
    if (t === "beneficiarios") {
      const att = T.attByBen.get(row.id) || [];
      out.push(h("section", null, h("h3", null, `${att.length} atendimentos em 2025`), att.length ? recordTable({ rows: att, columns: columnsFor("atendimentos"), search: false, pageSize: 12, onRow: (a) => openRecord("atendimentos", a) }) : h("p", { class: "small-note" }, "Nenhum atendimento com este id exato.")));
    }
    return out;
  }

  function setMode(m) {
    mode = m;
    stage.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    pathsCard.hidden = m !== "paths";
    statusEl.hidden = m === "paths";
    if (m === "paths") { panelStack.length = 0; panel.close(); sel = { kind: "paths" }; focusTable = null; renderPaths(); }
    else { stopTracer(); currentPath = null; if (sel && sel.kind === "paths") sel = null; applySelectionClasses(); }
    setTrail();
    fitAll();
  }

  const pathState = { from: "atendimentos", to: "cozinhas", pick: 0 };
  function renderPaths() {
    const tbls = Object.keys(T.schema);
    if (!tbls.includes(pathState.from)) pathState.from = tbls[0];
    if (!tbls.includes(pathState.to)) pathState.to = tbls[1];
    const mk = (val, label, key) => { const sel0 = h("select", { "aria-label": label }, ...tbls.map((t) => h("option", { value: t, selected: t === val ? true : null }, t))); sel0.addEventListener("change", () => { pathState[key] = sel0.value; pathState.pick = 0; renderPaths(); }); return sel0; };
    const ps = pathState.from === pathState.to ? [] : T.paths(pathState.from, pathState.to);
    const kids = [h("p", { class: "eyebrow ab", style: { margin: 0 } }, "Caminhos"), h("h2", null, "Como uma tabela chega a outra"), h("div", { class: "paths-q" }, "De", mk(pathState.from, "Tabela de partida", "from"), "para", mk(pathState.to, "Tabela de chegada", "to"))];
    if (!ps.length) kids.push(h("p", { class: "small-note" }, pathState.from === pathState.to ? "Escolha duas tabelas diferentes." : "Nenhum caminho com as relações atuais."));
    ps.forEach((p, i) => {
      let node = pathState.from;
      const route = [h("span", null, node)];
      for (const r of p) { node = r.from === node ? r.to : r.from; route.push(h("i", null, " → "), h("span", null, node)); }
      const unconf = p.filter((r) => !T.usable(r));
      const b = h("button", { type: "button", class: "path-opt", "aria-pressed": String(i === pathState.pick) },
        h("span", { class: "route" }, ...route), h("span", { class: "role" }, `${p.length === 1 ? "direto" : `via ${p.length - 1} ${p.length === 2 ? "tabela" : "tabelas"}`} · ${p.map((r) => r.role).join(" → ")}`),
        unconf.length ? h("span", { class: "tagx pos", style: { justifySelf: "start" } }, `${unconf.length} ${unconf.length === 1 ? "relação ainda não confirmada" : "relações ainda não confirmadas"}`) : null,
        p.some((r) => r.ev.coincidence) ? h("span", { class: "tagx out", style: { justifySelf: "start" } }, "passa por uma coincidência provável") : null);
      b.addEventListener("click", () => { pathState.pick = i; renderPaths(); });
      kids.push(b);
    });
    const pair = new Set([pathState.from, pathState.to]);
    if (ps.length > 1 && pair.has("atendimentos") && pair.has("cozinhas")) {
      const d = T.pathDisagreement();
      kids.push(h("div", { class: "path-insight" }, h("span", null, "Os caminhos levam a cozinhas diferentes em ", h("b", null, fmt(d.differ)), " atendimentos, de ", h("b", null, fmt(d.people)), " pessoas."), h("span", { class: "small-note" }, "“Atendimentos por cozinha” muda conforme o caminho. Por isso a pergunta pede o papel."), h("button", { type: "button", class: "btn link", style: { justifySelf: "start" }, onclick: openDisagreement }, "Ver os registros →")));
    }
    pathsCard.replaceChildren(...kids);
    highlightPath(ps[pathState.pick] || null);
  }

  function openDisagreement() {
    const rows = T.tables.atendimentos.filter((a) => { const b = T.benById.get(a.beneficiario_id); return b && b.cozinha_id && b.cozinha_id !== a.cozinha_id; });
    const kn = (id) => (T.kitchen[id] ? T.kitchen[id].nome.replace("Cozinha ", "") : id);
    panelStack.length = 0;
    pushPanel({ eyebrow: "Caminhos · atendimentos → cozinhas", eyebrowClass: "ab", title: `${fmt(rows.length)} atendimentos em que os caminhos discordam`, sub: "cozinha do atendimento ≠ cozinha de referência do beneficiário", sel: { kind: "paths" },
      body: () => [h("p", { class: "small-note" }, "Mesma pessoa, cozinhas diferentes: quem foi atendido fora da cozinha em que está cadastrado. Nenhum dos caminhos está errado; eles respondem perguntas diferentes."),
        recordTable({ rows, columns: [{ key: "id", label: "atendimento", mono: true }, { key: "data", label: "data", mono: true, render: (r) => T.dateBR(r.data) }, { key: "beneficiario_id", label: "beneficiário", mono: true }, { key: "cozinha_id", label: "no atendimento", get: (r) => kn(r.cozinha_id) }, { key: "_ref", label: "de referência", get: (r) => kn(T.benById.get(r.beneficiario_id).cozinha_id) }], onRow: (r) => openRecord("atendimentos", r), pageSize: 40 })] });
  }

  function stopTracer() { if (tracerRaf) cancelAnimationFrame(tracerRaf); tracerRaf = null; linksSvg.querySelectorAll(".tracer, .tracer-halo").forEach((e) => e.remove()); }
  function highlightPath(p) {
    currentPath = p;
    stopTracer();
    const ids = new Set((p || []).map((r) => r.id));
    for (const r of T.relationships) { const g = linkGroups[r.id]; if (!g) continue; g.grp.classList.toggle("dim", !!p && !ids.has(r.id)); g.grp.classList.toggle("sel", ids.has(r.id)); marks[r.id]?.classList.toggle("faded", !!p && !ids.has(r.id)); labels[r.id]?.classList.toggle("faded", !!p && !ids.has(r.id)); }
    const inPath = new Set([pathState.from]);
    if (p) { let n = pathState.from; for (const r of p) { n = r.from === n ? r.to : r.from; inPath.add(n); } }
    for (const t of Object.keys(sheets)) { sheets[t].classList.toggle("dim", !!p && !inPath.has(t)); sheets[t].classList.remove("lift"); }
    if (!p || UI.reduced()) return;
    const segs = [];
    let node = pathState.from;
    for (const r of p) { const lg = linkGroups[r.id]; if (!lg) return; const forward = r.from === node; segs.push({ path: lg.path, len: lg.path.getTotalLength(), forward }); node = forward ? r.to : r.from; }
    const total = segs.reduce((a, x) => a + x.len, 0);
    const dot = s("circle", { class: "tracer", r: 6 }), halo = s("circle", { class: "tracer-halo", r: 15 });
    linksSvg.append(halo, dot);
    const t0 = performance.now();
    const step = () => {
      let d = ((performance.now() - t0) * 0.35) % (total + 220);
      if (d > total) { dot.setAttribute("opacity", "0"); halo.setAttribute("opacity", "0"); }
      else {
        dot.setAttribute("opacity", "1"); halo.setAttribute("opacity", "0.18");
        for (const sg of segs) { if (d <= sg.len) { const pt = sg.path.getPointAtLength(sg.forward ? d : sg.len - d); dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y); halo.setAttribute("cx", pt.x); halo.setAttribute("cy", pt.y); break; } d -= sg.len; }
      }
      tracerRaf = requestAnimationFrame(step);
    };
    tracerRaf = requestAnimationFrame(step);
  }

  function buildList() {
    listEl.replaceChildren(h("p", { class: "eyebrow ab", style: { margin: 0 } }, `Mapa · ${Object.keys(T.schema).length} tabelas`), h("h1", null, "Tabelas e relações"));
    const groups = T.groups ? T.groups.map((g) => ({ label: g.label, tables: Object.keys(T.schema).filter((t) => T.schema[t].group === g.id) })) : [{ label: null, tables: ["atendimentos", "beneficiarios", "cozinhas"].filter((t) => T.schema[t]) }];
    for (const g of groups) {
      if (g.label) listEl.append(h("h2", { class: "list-group" }, g.label));
      for (const t of g.tables) {
        listEl.append(makeSheet(t, false));
        for (const r of T.relationships.filter((x) => x.from === t)) {
          const e = r.ev, cl = cardLine(r);
          listEl.append(h("button", { type: "button", class: "rel-card", onclick: () => selectRel(r.id) },
            h("span", { class: "lt" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`),
            h("span", { class: "cov-bar", "aria-hidden": "true" }, h("span", { style: { width: e.ratio * 100 + "%", background: "var(--ab)" } }), h("span", { class: "ht-ab", style: { width: Math.max(e.nearRows ? 2 : 0, (e.nearRows / e.rows) * 100) + "%" } }), h("span", { style: { width: Math.max(e.noneRows ? 1 : 0, (e.noneRows / e.rows) * 100) + "%", background: "var(--b)" } })),
            h("span", { class: "statusline" }, h("b", { class: "mono" }, T.pct(e.ratio)), h("span", { class: `state-pill ${r.status}` }, stateWord(r.status)), h("span", { class: cl.warn ? "tagx rep" : "tagx" }, cl.text))));
        }
      }
    }
  }

  function init(el) {
    resetState();
    root = el;
    stage = h("div", { class: "map-stage", tabindex: "0", "aria-label": "Mapa. Ctrl e roda do mouse aproximam; arraste para mover; mais e menos aproximam; zero ajusta à tela." });
    stage.append(h("div", { class: "map-grid", "aria-hidden": "true" }));
    world = h("div", { class: "map-world" });
    regionsEl = h("div", { class: "regions" });
    linksSvg = s("svg", { class: "map-links", "aria-hidden": "true" });
    rulerSvg = s("svg", { class: "ruler", "aria-hidden": "true" });
    world.append(regionsEl, linksSvg, rulerSvg);
    stage.append(world);
    statusEl = h("div", { class: "map-ov map-status", "aria-live": "polite" });
    pathsCard = h("div", { class: "map-ov paths-card", hidden: true });
    focusBar = h("div", { class: "map-ov focus-bar", hidden: true, role: "status" });
    const tools = h("div", { class: "map-ov map-tools" },
      h("div", { class: "seg", role: "group", "aria-label": "Modo do mapa" },
        h("button", { type: "button", "data-mode": "structure", "aria-pressed": "true", onclick: () => setMode("structure") }, "Estrutura"),
        h("button", { type: "button", "data-mode": "paths", "aria-pressed": "false", onclick: () => setMode("paths") }, "Caminhos")),
      h("button", { type: "button", class: "chip", "aria-pressed": "false", onclick: (e) => { problems = !problems; e.currentTarget.setAttribute("aria-pressed", String(problems)); stage.classList.toggle("problems", problems); announce(problems ? "Mostrando só campos com pontos de atenção." : "Mostrando todos os campos."); } }, "Pontos de atenção ", h("b", null, fmt(Object.keys(T.schema).reduce((a, t) => a + tableIssues(t).length, 0)))),
      T.groups ? h("button", { type: "button", class: "chip", "aria-pressed": "false", onclick: (e) => { const all = collapsed.size === T.groups.length; collapsed = all ? new Set() : new Set(T.groups.map((g) => g.id)); focusTable = null; e.currentTarget.setAttribute("aria-pressed", String(!all)); renderAll(); fitAll(); announce(all ? "Grupos expandidos." : "Grupos recolhidos."); } }, "Recolher grupos") : null);
    zoomUi = h("div", { class: "map-ov zoom-ui" },
      h("button", { type: "button", class: "icon-btn", "aria-label": "Afastar", onclick: () => zoomAt(1 / 1.25, stage.clientWidth / 2, stage.clientHeight / 2, true) }, "−"),
      h("span", { class: "zl", "aria-live": "polite" }, ""),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Aproximar", onclick: () => zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2, true) }, "+"),
      h("button", { type: "button", class: "btn quiet", title: "Mostrar todas as tabelas", onclick: () => fitAll(true, true) }, "Ajustar"));
    const legend = h("div", { class: "map-ov map-legend", "aria-label": "Legenda" },
      h("span", null, h("i", { class: "lg-dot" }), "sugerida"), h("span", null, h("i", { class: "lg-line" }), "confirmada"), h("span", null, h("i", { class: "lg-cav" }), "com ressalva"), h("span", null, h("i", { class: "lg-rej" }), "rejeitada"),
      h("span", null, h("i", { class: "lg-ring" }), "anel: cobertura"), h("span", null, h("i", { class: "lg-attn" }, "!"), "atenção"));
    stage.append(statusEl, pathsCard, focusBar, tools, zoomUi, legend);
    listEl = h("div", { class: "map-list" });
    stage.append(listEl);
    el.append(stage);
    panel = new Panel(el, { onClose: () => { const hadTable = sel && sel.table; if (sel && sel.kind !== "paths") sel = null; panelStack.length = 0; if (hadTable) renderAll(); else applySelectionClasses(); setTrail(); } });
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, select, .sheet, .mark, .lk-hit, .group-card, .map-ov")) return;
      drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty, moved: false };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("grabbing");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      cam.tx = drag.tx + dx; cam.ty = drag.ty + dy;
      applyCam(false);
    });
    stage.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      stage.classList.remove("grabbing");
      if (!moved && panel.isOpen && !e.target.closest(".map-ov")) clearSel();
      else if (!moved && focusTable && !e.target.closest(".map-ov")) setFocus(null);
    });
    stage.addEventListener("wheel", (e) => {
      if (stage.classList.contains("compact")) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0045), e.clientX - rect.left, e.clientY - rect.top, false);
      else { cam.tx -= e.deltaX; cam.ty -= e.deltaY; applyCam(false); }
    }, { passive: false });
    stage.addEventListener("keydown", (e) => {
      if (e.target !== stage) return;
      const c = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
      if (e.key === "+" || e.key === "=") { zoomAt(1.2, c.x, c.y, true); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { zoomAt(1 / 1.2, c.x, c.y, true); e.preventDefault(); }
      else if (e.key === "0") { fitAll(true, true); e.preventDefault(); }
      else if (e.key.startsWith("Arrow")) { const d = 80; if (e.key === "ArrowLeft") cam.tx += d; if (e.key === "ArrowRight") cam.tx -= d; if (e.key === "ArrowUp") cam.ty += d; if (e.key === "ArrowDown") cam.ty -= d; applyCam(true); e.preventDefault(); }
    });
    const ro = new ResizeObserver(() => { const compact = root.clientWidth < 980; if (compact !== stage.classList.contains("compact")) { stage.classList.toggle("compact", compact); } });
    ro.observe(el);
    stage.classList.toggle("compact", root.clientWidth < 980);
    computeLayout();
    buildList();
    lod = "detail";
    renderAll();
    const ready = () => { renderAll(); fitAll(false); const l2 = lodFor(cam.s); if (l2 !== lod) { setLod(l2); fitAll(false); } };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(ready);
    ready();
  }

  function show(params, changed) {
    setTrail();
    if (params.select) selectRel(params.select);
    else if (params.table) openTable(params.table);
    else if (params.mode) setMode(params.mode);
    else if (changed) requestAnimationFrame(() => { renderAll(); if (!panel.isOpen) fitAll(false); });
  }

  App.register("mapa", {
    init, show, hide: () => stopTracer(),
    escape: () => { if (panel.isOpen) { if (panelStack.length > 1) { panelStack.pop(); renderPanelTop(); } else clearSel(); } else if (mode === "paths") setMode("structure"); else if (focusTable) setFocus(null); },
  });
})();
