(function () {
  "use strict";
  const { h, s, toast, announce, tip, untip, recordTable, countTo } = UI;
  const T = window.Trace;
  const fmt = T.fmt;

  const READ_TEXT = { null: "estavam cadastrados em", started: "começaram em", activeAny: "estavam ativos em algum momento de", activeEnd: "estavam ativos em 31/12 de" };
  const READ_KEYS = ["started", "activeAny", "activeEnd"];
  const READ_SPEC = { started: "começou no período", activeAny: "ativo em algum momento do período", activeEnd: "ativo no último dia do período" };
  const READ_SHORT = { started: "Começaram em", activeAny: "Estiveram ativos em algum momento de", activeEnd: "Estavam ativos em 31/12 de" };
  const READ_DESC = { started: "entraram no cadastro durante o ano", activeAny: "estiveram cadastrados em qualquer dia do ano", activeEnd: "continuavam cadastrados no último dia do ano" };
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const LINES_AUTO = 320, LINES_MAX = 1500, BARS_TOP = 15;
  const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const plural = (why, n) => (n > 1 ? why.replace(/^(desligado|cadastrado)\b/, "$1s") : why);
  const rel = (id) => T.relationships.find((r) => r.id === id);
  const clean = (r) => r.ev.toUnique && !r.ev.coincidence;

  let root, q, res, els = {}, pop = null, preview = null, focusId = null, tableFilter = "all", showTicks = false, lastTicket = {};
  let benIdx, memo, Y0, Y1, T0, T1, vizPref, allView, barsAll, drillMonth;
  let howOpen, critOpen, decOpen, vizDetails, invOpen, invTab;

  function resetState() {
    els = {}; pop = null; preview = null; focusId = null; tableFilter = "all"; showTicks = false; lastTicket = {};
    vizPref = "auto"; allView = "bars"; barsAll = false; drillMonth = null;
    resetView();
    benIdx = new Map();
    for (const b of T.tables.beneficiarios) { if (!benIdx.has(b.id)) benIdx.set(b.id, []); benIdx.get(b.id).push(b); }
    memo = { year: {}, joined: {} };
    Y0 = Math.min(...T.tables.beneficiarios.map((b) => +b.data_cadastro.slice(0, 4)));
    Y1 = 2026;
    T0 = Date.UTC(Y0, 0, 1); T1 = Date.UTC(Y1, 1, 1);
  }
  function resetView() { howOpen = false; critOpen = false; decOpen = false; vizDetails = false; invOpen = false; invTab = "steps"; }

  const defaults = () => ({ source: "cadastro", measure: "distinct", kitchen: T.ws.focusKitchen, reading: null, year: 2025, path: "event", traced: false, origin: "esperança 2025" });
  const kName = (id) => (id === "all" ? "todas as cozinhas" : T.kitchen[id] ? T.kitchen[id].nome : "sem cozinha");
  const kShort = (id) => kName(id).replace("Cozinha ", "");
  const kSub = (k) => {
    const mun = k.municipio || (T.tables.municipios && (T.tables.municipios.find((m) => m.id === k.municipio_id) || {}).nome) || "";
    return `${mun}${k.status === "inativa" ? " · inativa hoje" : ""}`;
  };
  const unitWord = () => (q.measure === "distinct" ? "beneficiários diferentes" : q.source === "cadastro" ? "linhas do cadastro" : "atendimentos");
  const unitShort = () => (q.measure === "distinct" ? "beneficiários" : q.source === "cadastro" ? "linhas" : "atendimentos");

  function yearRowsOf(y) {
    if (!memo.year[y]) memo.year[y] = T.tables.atendimentos.filter((a) => a.data.startsWith(String(y)));
    return memo.year[y];
  }
  function joinedOf(y) {
    if (!memo.joined[y]) {
      const joined = [];
      let unmatched = 0;
      for (const a of yearRowsOf(y)) { const l = benIdx.get(a.beneficiario_id); if (!l) { unmatched++; continue; } for (const b of l) joined.push({ att: a, ben: b, mult: l.length }); }
      memo.joined[y] = { joined, unmatched };
    }
    return memo.joined[y];
  }

  function indexBase(r) {
    r.vigMap = new Map(r.vig.map((x) => [x.row, x]));
    r.idCount = new Map();
    r.firstRow = new Map();
    for (const b of r.base) { r.idCount.set(b.id, (r.idCount.get(b.id) || 0) + 1); if (!r.firstRow.has(b.id)) r.firstRow.set(b.id, b); }
  }

  function compute(qq) {
    const r = { q: qq, steps: [], notes: [], value: null, pending: false, groups: null };
    if (qq.source === "cadastro") {
      const all = T.tables.beneficiarios;
      const base = qq.kitchen === "all" ? all : all.filter((b) => b.cozinha_id === qq.kitchen);
      r.base = base;
      r.steps.push({ key: "file", label: "beneficiarios.csv · versão 1", n: all.length });
      if (qq.kitchen !== "all") r.steps.push({ key: "kitchen", label: `cozinha de referência é ${kName(qq.kitchen)}`, n: base.length, outs: [{ why: "outras cozinhas ou sem cozinha", n: all.length - base.length }] });
      const v = T.vigencia(base, qq.year);
      r.vig = v;
      r.candidates = READ_KEYS.map((k) => { const inc = v.filter((x) => x[k]); return { key: k, rows: inc.length, distinct: new Set(inc.map((x) => x.row.id)).size }; });
      if (!qq.reading) { r.pending = true; return finishCad(r, qq); }
      const R = T.readings[qq.reading];
      const inc = v.filter((x) => x[qq.reading]);
      const outs = {};
      v.filter((x) => !x[qq.reading]).forEach((x) => { const w = x[R.why]; outs[w] = (outs[w] || 0) + 1; });
      r.steps.push({ key: "reading", label: `${R.long} ${qq.year}`, n: inc.length, outs: Object.entries(outs).map(([why, n]) => ({ why, n })) });
      const distinct = new Set(inc.map((x) => x.row.id)).size;
      if (qq.measure === "distinct") r.steps.push({ key: "measure", label: "contar beneficiários diferentes", n: distinct, rep: inc.length - distinct });
      else r.steps.push({ key: "measure", label: "contar linhas do cadastro", n: inc.length });
      r.value = qq.measure === "distinct" ? distinct : inc.length;
      r.inc = new Set(inc.map((x) => x.row));
      if (inc.length !== distinct) r.notes.push({ kind: "rep", text: qq.measure === "distinct" ? `${fmt(inc.length)} linhas no cadastro: ${fmt(inc.length - distinct)} ids aparecem mais de uma vez e contam uma vez cada.` : `${fmt(inc.length - distinct)} ids aparecem mais de uma vez: contando linhas, essas pessoas contam em dobro.` });
      if (qq.kitchen === "all") {
        const by = new Map();
        for (const x of inc) { const k = x.row.cozinha_id; if (!by.has(k)) by.set(k, []); by.get(k).push(x.row); }
        r.groups = T.tables.cozinhas.map((k) => { const g = by.get(k.id) || []; return { k, n: qq.measure === "distinct" ? new Set(g.map((b) => b.id)).size : g.length }; });
        const none = by.get(null) || [];
        if (none.length) r.noKitchen = qq.measure === "distinct" ? new Set(none.map((b) => b.id)).size : none.length;
      }
      return finishCad(r, qq);
    }
    r.steps.push({ key: "file", label: "atendimentos.csv · versão 1", n: T.tables.atendimentos.length });
    if (qq.year !== 2025) {
      r.insufficient = { title: `Os atendimentos só cobrem 2025`, text: `atendimentos.csv tem registros de 01/01/2025 a 31/12/2025. Não dá para dizer quem foi atendido em ${qq.year}.` };
      return r;
    }
    const yearRows = yearRowsOf(qq.year);
    r.steps.push({ key: "year", label: `atendimentos de ${qq.year}`, n: yearRows.length, outs: [{ why: "fora do ano", n: T.tables.atendimentos.length - yearRows.length }] });
    let rows;
    if (qq.path === "event") {
      const src = qq.kitchen === "all" ? yearRows : yearRows.filter((a) => a.cozinha_id === qq.kitchen);
      rows = src.map((a) => ({ att: a, ben: (benIdx.get(a.beneficiario_id) || [])[0] || null, mult: 1 }));
      if (qq.kitchen !== "all") r.steps.push({ key: "kitchen", label: `cozinha do atendimento é ${kName(qq.kitchen)}`, n: rows.length, outs: [{ why: "outras cozinhas", n: yearRows.length - rows.length }] });
      const otherRef = new Set(rows.filter((x) => !x.ben || x.ben.cozinha_id !== x.att.cozinha_id).map((x) => x.att.beneficiario_id));
      r.notes.push({ kind: "lim", text: `Conta onde o atendimento aconteceu.${qq.kitchen !== "all" && otherRef.size ? ` ${fmt(otherRef.size)} destas pessoas estão cadastradas em outra cozinha ou não têm cadastro.` : ""}` });
    } else {
      const { joined, unmatched } = joinedOf(qq.year);
      const plus = joined.length - (yearRows.length - unmatched);
      r.steps.push({ key: "join", label: "ligar a beneficiarios pela chave", n: joined.length, outs: [{ why: "sem cadastro com esse id", n: unmatched }], plus });
      rows = qq.kitchen === "all" ? joined : joined.filter((x) => x.ben.cozinha_id === qq.kitchen);
      if (qq.kitchen !== "all") r.steps.push({ key: "kitchen", label: `cozinha de referência é ${kName(qq.kitchen)}`, n: rows.length, outs: [{ why: "beneficiários de outras cozinhas ou sem cozinha", n: joined.length - rows.length }] });
      const extra = rows.filter((x) => x.mult > 1).length - new Set(rows.filter((x) => x.mult > 1).map((x) => x.att.id)).size;
      r.extraRows = extra;
      r.notes.push({ kind: "lim", text: `Conta pela cozinha de referência do beneficiário. ${fmt(unmatched)} atendimentos sem cadastro com o mesmo id ficam de fora.` });
      const r1 = rel("r1");
      const policy = r1.status === "caveat" && r1.decision ? r1.decision.policy : null;
      if (qq.measure === "rows" && policy === "block" && extra > 0) {
        r.blocked = { rel: r1, extra, text: `Você confirmou ${r1.from}.${r1.fromCol} → ${r1.to}.${r1.toCol} com ressalva e escolheu bloquear o que multiplica. Contar atendimentos por este caminho duplicaria ${fmt(extra)} linhas.` };
      } else if (qq.measure === "rows" && extra > 0) {
        r.notes.push({ kind: "warn", text: policy === "warn" ? `Sua decisão permite a multiplicação: ${fmt(extra)} atendimentos entram duas vezes porque o id do beneficiário se repete no cadastro. O número inclui essas cópias.` : `${fmt(extra)} atendimentos entram duas vezes porque o id do beneficiário se repete no cadastro. A relação ainda não foi decidida.` });
      }
      if (qq.measure === "distinct") {
        const split = new Set();
        const seenK = new Map();
        for (const x of rows) { if (x.mult < 2) continue; const k = seenK.get(x.att.beneficiario_id); if (k === undefined) seenK.set(x.att.beneficiario_id, x.ben.cozinha_id); else if (k !== x.ben.cozinha_id) split.add(x.att.beneficiario_id); }
        if (split.size) r.notes.push({ kind: "rep", text: `${fmt(split.size)} ids repetidos têm cópias em cozinhas diferentes; cada cozinha conta a pessoa uma vez.` });
      }
    }
    if (r.blocked) { r.value = null; r.attRows = rows; return r; }
    const distinct = new Set(rows.map((x) => x.att.beneficiario_id)).size;
    if (qq.measure === "distinct") r.steps.push({ key: "measure", label: "contar beneficiários diferentes", n: distinct, rep: rows.length - distinct, repText: "atendimentos da mesma pessoa contam uma vez" });
    else r.steps.push({ key: "measure", label: "contar atendimentos", n: rows.length });
    r.value = qq.measure === "distinct" ? distinct : rows.length;
    r.attRows = rows;
    if (qq.kitchen === "all") {
      const keyOf = (x) => (qq.path === "event" ? x.att.cozinha_id : x.ben.cozinha_id);
      const by = new Map();
      for (const x of rows) { const k = keyOf(x); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
      r.groups = T.tables.cozinhas.map((k) => { const g = by.get(k.id) || []; return { k, n: qq.measure === "distinct" ? new Set(g.map((x) => x.att.beneficiario_id)).size : g.length }; });
      const none = by.get(null) || [];
      if (none.length) r.noKitchen = qq.measure === "distinct" ? new Set(none.map((x) => x.att.beneficiario_id)).size : none.length;
      const sum = r.groups.reduce((a, g) => a + g.n, 0);
      if (sum !== r.value) r.notes.push({ kind: "gran", text: `Somando as cozinhas dá ${fmt(sum)}; o total é ${fmt(r.value)}.${qq.measure === "distinct" && sum > r.value ? ` Pessoas atendidas em mais de uma cozinha aparecem em cada uma.` : ""}${r.noKitchen ? ` ${fmt(r.noKitchen)} ficam sem cozinha e entram só no total.` : ""} O total é calculado, não somado.` });
    }
    return r;
  }
  function finishCad(r, qq) {
    indexBase(r);
    r.notes.push({ kind: "lim", text: "“Cozinha” é a cozinha de referência atual do cadastro. O arquivo não registra mudanças de cozinha." });
    if (qq.kitchen === "all" && r.groups) {
      const sum = r.groups.reduce((a, g) => a + g.n, 0);
      if (sum !== r.value) r.notes.push({ kind: "gran", text: `Somando as cozinhas dá ${fmt(sum)}; o total é ${fmt(r.value)}.${r.noKitchen ? ` ${fmt(r.noKitchen)} cadastros sem cozinha_id entram só no total.` : ""}` });
    }
    return r;
  }

  function triple(rr) { return rr.candidates.map((c) => (rr.q.measure === "distinct" ? c.distinct : c.rows)); }

  function neededRels(qq) {
    if (qq.source === "cadastro") return ["r3"];
    return qq.path === "event" ? ["r2"] : ["r1", "r3"];
  }
  function blockersOf(qq) {
    const list = neededRels(qq).map(rel).filter((r) => !T.usable(r)).map((r) => ({ kind: "rel", r }));
    if (qq.source === "cadastro" && !T.ws.validityConfirmed) list.unshift({ kind: "validity" });
    return list;
  }
  const isTraced = () => q.traced && !res.pending && !res.insufficient && !res.blocked && !blockersOf(q).length;

  function tok(name, text, opts = {}) {
    const b = h("button", { type: "button", class: `tok ${opts.pending ? "pending" : ""}`, "data-tok": name, "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `${text}. Alterar ${opts.what || name}` }, text);
    b.addEventListener("click", (e) => { e.stopPropagation(); openPop(name, b); });
    return b;
  }

  function sentenceNodes() {
    const kAll = q.kitchen === "all";
    if (q.source === "cadastro") {
      return [q.measure === "distinct" ? "Quantos " : "Quantas ", tok("measure", q.measure === "distinct" ? "beneficiários diferentes" : "linhas", { what: "o que contar" }), " do ", tok("source", "cadastro", { what: "a fonte" }),
        kAll ? [", ", tok("kitchen", "por cozinha", { what: "a cozinha" }), ","] : [" da ", tok("kitchen", kName(q.kitchen), { what: "a cozinha" })], " ",
        tok("reading", READ_TEXT[q.reading], { pending: !q.reading, what: "a leitura do período" }), " ", tok("year", String(q.year), { what: "o ano" }), "?"];
    }
    return ["Quantos ", tok("measure", q.measure === "distinct" ? "beneficiários diferentes" : "atendimentos", { what: "o que contar" }), " aparecem no ", tok("source", "registro de atendimentos", { what: "a fonte" }),
      kAll ? [", ", tok("kitchen", "por cozinha", { what: "a cozinha" })] : [" da ", tok("kitchen", kName(q.kitchen), { what: "a cozinha" })], ", ",
      tok("path", q.path === "event" ? "pela cozinha do atendimento" : "pela cozinha de referência", { what: "o caminho até cozinhas" }), ", em ", tok("year", String(q.year), { what: "o ano" }), "?"];
  }

  function plainSentence() { return h("div", null, ...sentenceNodes()).textContent; }

  function optionsFor(name) {
    const with_ = (patch) => compute(Object.assign({}, q, patch));
    const num = (rr) => (rr.insufficient ? { na: "sem dados" } : rr.blocked ? { na: "bloqueada" } : rr.pending ? { trip: triple(rr) } : { n: rr.value });
    if (name === "measure") return [
      { v: "distinct", l: "beneficiários diferentes", s: "cada id conta uma vez", r: num(with_({ measure: "distinct" })) },
      { v: "rows", l: q.source === "cadastro" ? "linhas do cadastro" : "atendimentos", s: q.source === "cadastro" ? "cada linha conta, mesmo repetida" : "cada atendimento conta", r: num(with_({ measure: "rows" })) }];
    if (name === "source") return [
      { v: "cadastro", l: "cadastro", s: `beneficiarios.csv · ${fmt(T.tables.beneficiarios.length)} linhas`, r: num(with_({ source: "cadastro", reading: q.source === "cadastro" ? q.reading : null })) },
      { v: "atendimento", l: "registro de atendimentos", s: `atendimentos.csv · ${fmt(T.tables.atendimentos.length)} linhas`, r: num(with_({ source: "atendimento" })) }];
    if (name === "kitchen") return [
      { v: "all", l: "todas, por cozinha", s: "agrupa e mostra o total calculado", r: num(with_({ kitchen: "all" })) },
      ...T.tables.cozinhas.map((k) => ({ v: k.id, l: k.nome, s: kSub(k), r: num(with_({ kitchen: k.id })) }))];
    if (name === "reading") return READ_KEYS.map((k) => ({ v: k, l: `${READ_SHORT[k]} ${q.year}`, s: READ_DESC[k], r: num(with_({ reading: k })) }));
    if (name === "path") return [
      { v: "event", l: "pela cozinha do atendimento", s: "atendimentos.cozinha_id → cozinhas", r: num(with_({ path: "event" })) },
      { v: "reference", l: "pela cozinha de referência", s: "atendimentos → beneficiarios → cozinhas", r: num(with_({ path: "reference" })) }];
    if (name === "year") {
      const ys = [];
      for (let y = Y0; y <= Y1; y++) ys.push(y);
      return ys.map((y) => ({ v: y, l: String(y), s: q.source === "atendimento" && y !== 2025 ? "atendimentos não cobrem este ano" : y === Y1 ? "arquivo vai até janeiro" : "", r: num(with_({ year: y })) }));
    }
    return [];
  }

  function openPop(name, anchor) {
    closePop();
    const titles = { measure: "O que contar", source: "De onde", kitchen: "Qual cozinha", reading: "Qual leitura do período", path: "Por qual caminho até cozinhas", year: "Qual ano" };
    const opts = optionsFor(name);
    const cur = q[name];
    const ul = h("ul", { role: "listbox", "aria-label": titles[name] });
    const items = [];
    opts.forEach((o) => {
      const right = o.r.na ? h("span", { class: "on na" }, o.r.na) : o.r.trip ? h("span", { class: "on" }, o.r.trip.map(fmt).join(" · "), h("small", null, "uma por leitura")) : h("span", { class: "on" }, fmt(o.r.n));
      const b = h("button", { type: "button", role: "option", "aria-selected": String(o.v === cur) }, h("span", { class: "ol" }, o.l), o.s ? h("span", { class: "os" }, o.s) : null, right);
      b._label = `${o.l} ${o.s || ""}`.toLowerCase();
      b.addEventListener("click", () => { closePop(); setQ({ [name]: o.v }, name); setTimeout(() => root.querySelector(`[data-tok="${name}"]`)?.focus(), 30); });
      if (name === "reading") { b.addEventListener("mouseenter", () => setPreview(o.v)); b.addEventListener("mouseleave", () => setPreview(null)); b.addEventListener("focus", () => setPreview(o.v)); }
      items.push(b);
      ul.append(h("li", null, b));
    });
    const kids = [h("h4", null, titles[name])];
    let filter = null;
    if (opts.length > 12) {
      filter = h("input", { type: "search", class: "pop-filter", placeholder: `Filtrar ${opts.length} opções`, "aria-label": `Filtrar ${titles[name].toLowerCase()}` });
      filter.addEventListener("input", () => { const t = filter.value.trim().toLowerCase(); items.forEach((b) => (b.parentElement.hidden = t && !b._label.includes(t))); });
      kids.push(filter);
    }
    pop = h("div", { class: "pop" }, ...kids, ul);
    pop._anchor = anchor;
    root.append(pop);
    const ra = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    pop.style.left = Math.max(0, Math.min(ra.left - rr.left, rr.width - 440)) + "px";
    pop.style.top = ra.bottom - rr.top + root.scrollTop + 10 + "px";
    anchor.setAttribute("aria-expanded", "true");
    const visible = () => items.filter((b) => !b.parentElement.hidden);
    (filter || items.find((b) => b.getAttribute("aria-selected") === "true") || items[0]).focus();
    const sel = items.find((b) => b.getAttribute("aria-selected") === "true");
    if (sel && filter) sel.scrollIntoView({ block: "nearest" });
    pop.addEventListener("keydown", (e) => {
      const v = visible();
      const i = v.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (v[Math.min(v.length - 1, i + 1)] || v[0])?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0 && filter) filter.focus(); else v[Math.max(0, i - 1)]?.focus(); }
      if (e.key === "Enter" && document.activeElement === filter && v.length) { e.preventDefault(); v[0].click(); }
      if (e.key === "Escape") { e.stopPropagation(); closePop(); anchor.focus(); }
      if (e.key === "Tab") { closePop(); }
    });
  }
  function closePop() {
    if (!pop) return;
    pop._anchor?.setAttribute("aria-expanded", "false");
    pop.remove();
    pop = null;
    if (preview) setPreview(null);
  }

  function setQ(patch, changed) {
    const before = q.reading;
    Object.assign(q, patch);
    if (patch.source === "atendimento") q.reading = "served";
    if (patch.source === "cadastro" && !READ_KEYS.includes(q.reading)) q.reading = null;
    if (changed && changed !== "reading") focusId = null;
    if (changed === "kitchen" || changed === "source" || changed === "year" || changed === "reading") drillMonth = null;
    render();
    if (changed === "reading" && !before && q.reading) root.querySelector('[data-tok="reading"]')?.classList.add("inked");
    announce(res.value !== null ? `${fmt(res.value)} ${unitWord()}. ${plainSentence()}` : plainSentence());
  }

  function setPreview(k) {
    preview = k;
    paintViz();
    paintAnswerNumber();
  }

  function render() {
    res = compute(q);
    els.sentence.replaceChildren(...sentenceNodes());
    const len = plainSentence().length;
    els.sentence.classList.toggle("long", len > 92 && len <= 130);
    els.sentence.classList.toggle("xlong", len > 130);
    renderHow();
    renderClar();
    renderAnswer();
    renderViz();
    renderRelated();
    renderInv();
    setTrail();
  }

  function renderHow() {
    els.howBtn.setAttribute("aria-expanded", String(howOpen));
    els.how.hidden = !howOpen;
    els.how.replaceChildren("Montada a partir da busca ", h("q", null, q.origin), ": “esperança” é um valor de cozinhas.nome e “2025” é um período. Sem IA. Cada parte sublinhada pode ser trocada; pelo teclado, Tab chega a cada parte e Enter abre as opções.");
  }

  function glyph(k) {
    const svg = s("svg", { width: 64, height: 34, viewBox: "0 0 76 40", "aria-hidden": "true" });
    svg.append(s("rect", { x: 24, y: 2, width: 28, height: 36, fill: "var(--a-wash)" }), s("line", { x1: 24, x2: 24, y1: 2, y2: 38, stroke: "var(--a)", "stroke-width": 1 }), s("line", { x1: 52, x2: 52, y1: 2, y2: 38, stroke: "var(--a)", "stroke-width": 1 }));
    const lines = { started: [[30, 70, true], [6, 44, false], [56, 74, false]], activeAny: [[6, 34, true], [30, 70, true], [4, 18, false]], activeEnd: [[6, 70, true], [10, 40, false], [56, 74, false]] }[k];
    lines.forEach(([a, b, inn], i) => svg.append(s("line", { x1: a, x2: b, y1: 10 + i * 10, y2: 10 + i * 10, stroke: inn ? "var(--a-deep)" : "var(--ink-3)", "stroke-width": 3, "stroke-linecap": "round", opacity: inn ? 1 : 0.4 })));
    if (k === "started") svg.append(s("circle", { cx: 30, cy: 10, r: 3, fill: "var(--ab)" }));
    if (k === "activeEnd") svg.append(s("line", { x1: 52, x2: 52, y1: 0, y2: 40, stroke: "var(--ab)", "stroke-width": 2, "stroke-dasharray": "3 2" }));
    return svg;
  }

  function diffText(k) {
    const v = res.vig;
    if (k === "activeAny") return `Em relação a “começaram”, inclui ${fmt(v.filter((x) => x.activeAny && !x.started).length)} linhas de quem já estava antes de ${q.year}.`;
    if (k === "activeEnd") return `Em relação a “algum momento”, deixa de fora ${fmt(v.filter((x) => x.activeAny && !x.activeEnd).length)} linhas de quem saiu durante ${q.year}.`;
    return `Deixa de fora ${fmt(v.filter((x) => x.activeAny && !x.started).length)} linhas de quem já estava cadastrado antes.`;
  }

  function renderClar() {
    const show = q.source === "cadastro" && !q.reading;
    if (!show) {
      if (els.clar.childElementCount && !els.clar.classList.contains("leaving")) {
        els.clar.classList.add("leaving");
        setTimeout(() => { els.clar.replaceChildren(); els.clar.classList.remove("leaving"); els.clar.hidden = true; }, UI.reduced() ? 0 : 320);
      } else if (!els.clar.childElementCount) els.clar.hidden = true;
      return;
    }
    els.clar.hidden = false;
    els.clar.classList.remove("leaving");
    const counts = triple(res);
    const critBtn = h("button", { type: "button", class: "btn link clar-crit-btn", "aria-expanded": String(critOpen), onclick: () => { critOpen = !critOpen; renderClar(); els.clar.querySelector(".clar-crit-btn")?.focus(); } }, critOpen ? "Ocultar critérios" : "Ver critérios exatos");
    els.clar.replaceChildren(
      h("h2", { id: "clarT" }, "O que você quer dizer com ", h("q", null, `cadastrados em ${q.year}`), "?"),
      h("p", { class: "clar-sub" }, "São três leituras válidas, com resultados diferentes. O Trace não escolhe por você."),
      h("ul", { class: "clar-list", "aria-labelledby": "clarT" }, ...READ_KEYS.map((k, i) => {
        const R = T.readings[k];
        const btn = h("button", { type: "button", class: "clar-opt", "data-k": k, "aria-describedby": critOpen ? `crit-${k}` : null },
          h("span", { class: "co-num" }, h("b", null, fmt(counts[i])), h("small", null, unitShort())),
          h("span", { class: "co-body" }, h("span", { class: "co-t" }, `${READ_SHORT[k]} ${q.year}`), h("span", { class: "co-d" }, READ_DESC[k])),
          h("span", { class: "co-g" }, glyph(k)),
          h("span", { class: "co-go", "aria-hidden": "true" }, "Escolher →"));
        btn.addEventListener("click", () => {
          preview = null;
          setQ({ reading: k }, "reading");
          setTimeout(() => document.getElementById("qAnswer")?.focus({ preventScroll: false }), UI.reduced() ? 0 : 340);
        });
        return h("li", { class: "clar-row" }, btn,
          critOpen ? h("div", { class: "co-crit", id: `crit-${k}` },
            h("p", null, h("b", null, "entra "), R.inc(q.year).replace(/^entra /, "")),
            h("p", null, h("b", null, "fica de fora "), R.exc(q.year).replace(/^fica de fora /, "")),
            h("p", { class: "co-diff" }, diffText(k))) : null);
      })),
      critBtn);
  }

  function needsList(items) {
    const box = h("div", { class: "needs" });
    for (const it of items) {
      if (it.kind === "validity") {
        const sc = T.schema.beneficiarios;
        box.append(h("div", { class: "need" },
          h("p", null, h("b", null, "Vigência de beneficiarios"), h("span", { class: "nd-why" }, `As três leituras tratam ${sc.validity[0]} e ${sc.validity[1]} como início e fim do cadastro. Isso ainda é uma sugestão.`)),
          h("div", { class: "q-actions" },
            h("button", { type: "button", class: "btn ab", onclick: () => { T.ws.validityConfirmed = true; render(); toast("Vigência confirmada em beneficiarios", "Desfazer", () => { T.ws.validityConfirmed = false; render(); }); } }, "Confirmar vigência"),
            h("button", { type: "button", class: "btn quiet", onclick: () => App.go("mapa", { table: "beneficiarios" }) }, "Ver no mapa"))));
        continue;
      }
      const r = it.r;
      const ok = r.status === "suggested" && clean(r);
      const summary = r.status === "rejected" ? "Você rejeitou esta relação; a pergunta não pode atravessá-la."
        : ok ? `Cobertura ${T.pct(r.ev.ratio)} e destino único: a evidência sustenta N:1.`
        : `${fmt(r.ev.toDupIds.length)} ids repetidos no destino: a evidência contradiz N:1. Decida no mapa, onde dá para ver o que multiplica.`;
      box.append(h("div", { class: `need ${ok ? "" : "hard"}` },
        h("p", null, h("b", { class: "mono" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`), h("span", { class: "nd-why" }, summary)),
        h("div", { class: "q-actions" },
          ok ? h("button", { type: "button", class: "btn ab", onclick: () => confirmHere(r) }, "Confirmar relação") : null,
          h("button", { type: "button", class: ok ? "btn quiet" : "btn ab", onclick: () => App.go("mapa", { select: r.id }) }, ok ? "Ver evidência" : "Decidir no mapa"))));
    }
    return box;
  }

  function stampNow() { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  function confirmHere(r) {
    const snap = { status: r.status, decision: r.decision };
    r.status = "confirmed";
    r.decision = { kind: "confirmed", policy: null, at: stampNow(), from: "pergunta" };
    App.updateNavCount();
    render();
    toast(`Relação confirmada como N:1 · ${r.from}.${r.fromCol}`, "Desfazer", () => { r.status = snap.status; r.decision = snap.decision; App.updateNavCount(); render(); });
  }

  function openInv(tab, filter) {
    invOpen = true;
    if (tab) invTab = tab;
    if (filter) tableFilter = filter;
    renderAnswer();
    renderInv();
    els.inv.scrollIntoView({ behavior: UI.reduced() ? "auto" : "smooth", block: "start" });
    setTimeout(() => els.inv.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }), UI.reduced() ? 0 : 350);
  }
  function closeInv() { invOpen = false; renderAnswer(); renderInv(); document.querySelector("#qAnswer .inv-toggle")?.focus(); }

  function renderAnswer() {
    const box = els.answer;
    box.hidden = res.pending;
    if (res.pending) { box.replaceChildren(); return; }
    if (res.insufficient) {
      box.replaceChildren(h("div", { class: "insuff" }, h("h2", null, res.insufficient.title), h("p", null, res.insufficient.text),
        h("div", { class: "q-actions" }, h("button", { type: "button", class: "btn primary", onclick: () => setQ({ year: 2025 }, "year") }, "Usar 2025"), h("button", { type: "button", class: "btn", onclick: () => setQ({ source: "cadastro" }, "source") }, "Perguntar ao cadastro"))));
      return;
    }
    if (res.blocked) {
      box.replaceChildren(h("div", { class: "insuff warn" }, h("h2", null, "Esta contagem multiplicaria linhas"), h("p", null, res.blocked.text),
        h("div", { class: "q-actions" }, h("button", { type: "button", class: "btn primary", onclick: () => setQ({ measure: "distinct" }, "measure") }, "Contar beneficiários diferentes"),
          h("button", { type: "button", class: "btn", onclick: () => App.go("mapa", { select: res.blocked.rel.id }) }, "Rever a decisão"))));
      return;
    }
    const blockers = blockersOf(q);
    const traced = isTraced();
    const readingLabel = q.source === "cadastro" ? `${READ_SHORT[q.reading].toLowerCase()} ${q.year}` : `atendidos em ${q.year}, ${q.path === "event" ? "pela cozinha do atendimento" : "pela cozinha de referência"}`;
    const main = h("div", { class: "ans-main" },
      h("p", { class: "answer-n", id: "answerN" }),
      h("div", { class: "ans-text" },
        h("p", { class: "answer-unit" }, unitWord()),
        h("p", { class: "ans-reading" }, readingLabel, h("span", { class: "sep" }, " · "), q.kitchen === "all" ? "todas as cozinhas" : kName(q.kitchen)),
        q.source === "cadastro" ? h("button", { type: "button", class: "btn link", onclick: (e) => openPop("reading", root.querySelector('[data-tok="reading"]') || e.currentTarget) }, "Trocar leitura") : null));
    const status = h("p", { class: "ans-status" },
      h("span", { class: `ans-chip ${traced ? "traced" : ""}` }, traced ? "rastreio demonstrativo" : "prévia"), " ",
      traced ? "Passos e registros calculados no navegador sobre dados sintéticos; nada foi executado pelo backend." : "Calculada agora no navegador, com dados sintéticos. Não é um resultado validado pelo backend.");
    const side = h("div", { class: "ans-side" }, status);
    if (blockers.length) {
      const decId = "qDecisions";
      side.append(h("p", { class: "ans-pend" }, h("span", { class: "pend-dot", "aria-hidden": "true" }), `Para rastrear este resultado, ${blockers.length === 1 ? "falta 1 decisão" : `faltam ${blockers.length} decisões`}. `,
        h("button", { type: "button", class: "btn link dec-toggle", "aria-expanded": String(decOpen), "aria-controls": decId, onclick: () => { decOpen = !decOpen; renderAnswer(); document.querySelector("#qAnswer .dec-toggle")?.focus(); } }, decOpen ? "Ocultar" : "Resolver")));
      if (decOpen) { const nl = needsList(blockers); nl.id = decId; side.append(nl); }
    }
    for (const n of res.notes.filter((x) => x.kind === "warn")) side.append(h("p", { class: "ans-warn" }, n.text));
    side.append(h("div", { class: "q-actions" },
      h("button", { type: "button", class: "btn primary inv-toggle", "aria-controls": "qInv", "aria-expanded": String(invOpen), onclick: () => (invOpen ? closeInv() : openInv()) }, invOpen ? "Recolher investigação" : "Investigar a resposta")));
    box.replaceChildren(h("h2", { class: "sr" }, "Resposta"), main, side);
    paintAnswerNumber();
  }

  function paintAnswerNumber() {
    const n = document.getElementById("answerN");
    if (!n) return;
    const previewing = !!(preview && q.source === "cadastro" && preview !== q.reading);
    const shown = res.pending ? null : previewing ? compute(Object.assign({}, q, { reading: preview })).value : res.value;
    n.classList.toggle("previewing", previewing);
    n.classList.toggle("wide", shown !== null && shown >= 10000);
    n.classList.toggle("mid", shown !== null && shown >= 1000 && shown < 10000);
    if (shown === null) { n.textContent = "—"; n.dataset.value = ""; return; }
    if (!n.dataset.value) n.dataset.value = String(shown);
    countTo(n, shown);
    n.setAttribute("aria-label", `${fmt(shown)} ${unitWord()}`);
  }

  function trace() {
    const first = !q.traced;
    q.traced = true;
    invOpen = true;
    invTab = "steps";
    renderAnswer();
    renderInv();
    if (first) {
      const steps = [...els.inv.querySelectorAll(".lq-step")];
      steps.forEach((x) => x.classList.add("hidden-step"));
      steps.forEach((x, i) => setTimeout(() => x.classList.remove("hidden-step"), UI.reduced() ? 0 : 180 + i * 200));
      announce(`Rastreio demonstrativo. ${res.steps.length} passos até ${fmt(res.value)}.`);
    }
  }

  function ladder() {
    const st = res.steps;
    let scaleBase = st[0].n;
    const kids = [];
    st.forEach((x, i) => {
      const rescale = i > 0 && i < st.length - 1 && x.n / scaleBase < 0.25;
      const outs = (x.outs || []).filter((o) => o.n > 0);
      const b = h("button", { type: "button", class: "lq-step", "aria-pressed": String(tableFilter === "step:" + x.key) },
        h("span", { class: "lb" }, x.label), h("span", { class: "nb" }, fmt(x.n)),
        h("span", { class: "br", style: { width: Math.max(1.5, Math.min(100, (x.n / scaleBase) * 100)) + "%" } }),
        ...outs.map((o) => h("span", { class: "out" }, `− ${fmt(o.n)} ${plural(o.why, o.n)}`)),
        x.plus ? h("span", { class: "out rep" }, `+ ${fmt(x.plus)} linhas a mais por ids repetidos no cadastro`) : null,
        x.rep ? h("span", { class: "out rep" }, `${fmt(x.rep)} ${x.repText || "linhas repetidas contam uma vez"}`) : null);
      b.addEventListener("click", () => { tableFilter = tableFilter === "step:" + x.key ? "all" : "step:" + x.key; renderInv(); paintViz(); });
      kids.push(b);
      if (rescale) { scaleBase = x.n; kids.push(h("div", { class: "lq-break" }, `escala ampliada: ${fmt(x.n)} = barra cheia`)); }
    });
    return h("div", { class: "ladder-q" }, ...kids);
  }

  function rowStatus(row) {
    if (q.source !== "cadastro" || res.pending) return null;
    const v = res.vigMap.get(row);
    if (!v[q.reading]) return { kind: "out", text: v[T.readings[q.reading].why] };
    if (res.firstRow.get(row.id) !== row && q.measure === "distinct") return { kind: "rep", text: "linha repetida · conta 1" };
    return { kind: "in", text: "entra" };
  }

  function renderViz() {
    drillHost(null);
    const hide = res.pending || res.insufficient || res.blocked;
    els.viz.hidden = !!hide;
    if (hide) { els.viz.replaceChildren(); els.vizParts = null; return; }
    if (q.kitchen === "all") {
      if (q.source === "cadastro" && allView === "time") return renderAggTimeline();
      return renderBars();
    }
    if (q.source === "cadastro") {
      const n = res.base.length;
      const lines = vizPref === "lines" ? n <= LINES_MAX : vizPref === "agg" ? false : n <= LINES_AUTO;
      return lines ? renderTimeline() : renderAggTimeline();
    }
    return renderStrip();
  }

  function xOf(d, W) { return 24 + ((ms(d) - T0) / (T1 - T0)) * (W - 48); }

  function detailsBtn() {
    return h("button", { type: "button", class: "btn link viz-more", "aria-expanded": String(vizDetails), onclick: () => { vizDetails = !vizDetails; renderViz(); els.viz.querySelector(".viz-more")?.focus(); } }, vizDetails ? "Menos opções" : "Opções do gráfico");
  }

  function vizToggle() {
    if (q.kitchen === "all") {
      if (q.source !== "cadastro") return null;
      return h("div", { class: "seg small", role: "group", "aria-label": "Forma do gráfico" },
        h("button", { type: "button", "aria-pressed": String(allView === "bars"), onclick: () => { allView = "bars"; renderViz(); } }, "Por cozinha"),
        h("button", { type: "button", "aria-pressed": String(allView === "time"), onclick: () => { allView = "time"; renderViz(); } }, "Ao longo do tempo"));
    }
    if (q.source !== "cadastro") return null;
    const n = res.base.length;
    const linesNow = els.vizParts && els.vizParts.kind === "timeline";
    return h("div", { class: "seg small", role: "group", "aria-label": "Forma do gráfico" },
      h("button", { type: "button", "aria-pressed": String(!linesNow), onclick: () => { vizPref = "agg"; renderViz(); } }, "Por mês"),
      h("button", { type: "button", "aria-pressed": String(linesNow), disabled: n > LINES_MAX ? true : null, title: n > LINES_MAX ? `Acima de ${fmt(LINES_MAX)} linhas, só a visão por mês` : null, onclick: () => { vizPref = "lines"; renderViz(); } }, "Uma linha por cadastro"));
  }

  function vizHead(title, sub, extraTools) {
    const extras = [].concat(extraTools || []).filter(Boolean);
    const tools = h("div", { class: "viz-tools" }, ...(vizDetails ? extras : []), extras.length ? detailsBtn() : null);
    return h("div", { class: "viz-head" }, h("div", null, h("h3", null, title), sub ? h("p", null, sub) : null), tools);
  }

  function renderTimeline() {
    const W = 1200;
    const ids = [];
    const seen = new Map();
    for (const b of res.base.slice().sort((a, b) => (a.data_cadastro + a.id).localeCompare(b.data_cadastro + b.id))) {
      if (seen.has(b.id)) { seen.get(b.id).dup = b; continue; }
      const o = { row: b, dup: null };
      seen.set(b.id, o);
      ids.push(o);
    }
    const LH = ids.length > 600 ? 2 : 3, top = 46, H = top + ids.length * LH + 16;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Linhas do tempo de ${ids.length} beneficiários da ${kName(q.kitchen)}, do cadastro ao desligamento. A faixa marca ${q.year}.` });
    const y0 = xOf(`${q.year}-01-01`, W), y1 = xOf(`${q.year + 1}-01-01`, W);
    svg.append(s("rect", { class: "vband", x: y0, y: top - 14, width: y1 - y0, height: H - top + 14 }), s("line", { class: "vband-edge", x1: y0, x2: y0, y1: top - 14, y2: H }), s("line", { class: "vband-edge", x1: y1, x2: y1, y1: top - 14, y2: H }));
    const ax = s("g", { class: "vaxis" });
    for (let y = Y0; y <= Y1; y++) { const x = xOf(`${y}-01-01`, W); ax.append(s("line", { x1: x, x2: x, y1: 22, y2: H }), s("text", { x: x + 4, y: 18, style: y === q.year ? "fill: var(--a-deep); font-weight: 600" : "" }, String(y))); }
    svg.append(ax);
    const rule = s("line", { class: "vrule", x1: y1, x2: y1, y1: top - 14, y2: H, opacity: 0 });
    svg.append(rule);
    const lines = s("g");
    const starts = s("g");
    const ticks = s("g", { opacity: showTicks ? 1 : 0, style: "transition: opacity .3s" });
    const end = "2026-01-31";
    const sw = LH >= 3 ? 2.2 : 1.4;
    ids.forEach((o, i) => {
      const b = o.row;
      const y = top + i * LH + 2;
      const x0 = xOf(b.data_cadastro, W), x1 = xOf(b.data_desligamento || end, W);
      const g = s("g", { "data-id": b.id });
      if (o.dup) g.append(s("line", { class: "vline ghost", x1: x0 + 2.5, x2: x1 + 2.5, y1: y - 1.5, y2: y - 1.5, "stroke-width": 1.2 }));
      const ln = s("line", { class: "vline", x1: x0, x2: Math.max(x0 + 1.5, x1), y1: y, y2: y, "stroke-width": sw });
      ln._row = b;
      g.append(ln);
      const hit = s("line", { class: "vhit", x1: x0 - 2, x2: Math.max(x0 + 6, x1 + 2), y1: y, y2: y });
      hit.addEventListener("mouseenter", (e) => { ln.classList.add("hot"); tipRow(b, e); });
      hit.addEventListener("mousemove", (e) => tipRow(b, e));
      hit.addEventListener("mouseleave", () => { ln.classList.remove("hot"); untip(); });
      hit.addEventListener("click", () => { focusId = b.id; paintViz(); openInv("steps", "all"); });
      g.append(hit);
      lines.append(g);
      if (b.data_cadastro.startsWith(String(q.year))) starts.append(s("circle", { class: "vstart", cx: x0, cy: y, r: LH >= 3 ? 2 : 1.5 }));
      for (const a of T.attByBen.get(b.id) || []) ticks.append(s("rect", { class: "vtick", x: xOf(a.data, W) - 0.6, y: y - LH * 0.45, width: 1.2, height: LH * 0.9 }));
    });
    svg.append(lines, ticks, starts);
    els.vizParts = { svg, rule, starts, lines, ticks, kind: "timeline" };
    const tickBtn = h("button", { type: "button", class: "chip", "aria-pressed": String(showTicks), onclick: (e) => { showTicks = !showTicks; e.currentTarget.setAttribute("aria-pressed", String(showTicks)); ticks.setAttribute("opacity", showTicks ? 1 : 0); } }, "mostrar atendimentos");
    const legend = [h("span", null, h("i", { style: { background: "var(--a-deep)" } }), "entra na resposta"), h("span", null, h("i", { style: { background: "var(--ink-3)", opacity: 0.4 } }), "fica de fora")];
    if (vizDetails) legend.push(h("span", null, h("i", { style: { background: "var(--ink)", boxShadow: "2px -2px 0 0 var(--b)" } }), "id repetido"), h("span", null, h("i", { style: { width: "3px", height: "10px", background: "var(--b)" } }), "atendimento"), h("span", null, "linha até a borda: ainda cadastrado"));
    els.viz.replaceChildren(
      vizHead("Quem entra na resposta", `Cada linha é um cadastro da ${kName(q.kitchen)}, do cadastro ao desligamento. A faixa marca ${q.year}.`, [vizToggle(), tickBtn]),
      svg,
      h("div", { class: "viz-legend" }, ...legend),
      vizDetails ? h("p", { class: "viz-cap" }, "Sem agregação: cada linha é um cadastro. Clique numa linha para ver o registro; pelo teclado, os mesmos registros estão em Investigar a resposta.") : null);
    paintViz();
  }

  function aggCounts(k) {
    const A = els.agg;
    const tot = new Float64Array(A.n + 1), inc = new Float64Array(A.n + 1);
    A.rows.forEach((b, i) => {
      const a = A.st[i], e = A.en[i];
      if (e < 0 || a > A.n - 1) return;
      tot[Math.max(0, a)]++; tot[Math.min(A.n, e + 1)]--;
      if (k && res.vigMap.get(b)[k]) { inc[Math.max(0, a)]++; inc[Math.min(A.n, e + 1)]--; }
    });
    for (let i = 1; i <= A.n; i++) { tot[i] += tot[i - 1]; inc[i] += inc[i - 1]; }
    return { tot, inc };
  }

  function renderAggTimeline() {
    const rows = res.base;
    const n = (Y1 - Y0) * 12 + 1;
    const mIdx = (d) => (+d.slice(0, 4) - Y0) * 12 + (+d.slice(5, 7) - 1);
    const st = new Int32Array(rows.length), en = new Int32Array(rows.length);
    rows.forEach((b, i) => { st[i] = mIdx(b.data_cadastro); en[i] = b.data_desligamento ? mIdx(b.data_desligamento) : n - 1; });
    els.agg = { rows, st, en, n };
    const W = 900, H = 250, left = 52, right = 12, top = 30, bottom = 34;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "aggsvg", role: "group", "aria-label": `Cadastros ativos por mês, ${fmt(rows.length)} linhas da ${kName(q.kitchen)}` });
    const cw = (W - left - right) / n;
    const bx0 = left + (q.year - Y0) * 12 * cw;
    svg.append(s("rect", { class: "vband", x: bx0, y: top - 10, width: 12 * cw, height: H - top - bottom + 10 }));
    const ax = s("g", { class: "vaxis" });
    for (let y = Y0; y <= Y1; y++) { const x = left + (y - Y0) * 12 * cw; ax.append(s("line", { x1: x, x2: x, y1: top - 10, y2: H - bottom + 6 }), s("text", { x: x + 4, y: H - bottom + 20, style: y === q.year ? "fill: var(--a-deep); font-weight: 600" : "" }, String(y))); }
    svg.append(ax);
    const yaxis = s("g", { class: "vaxis" });
    svg.append(yaxis);
    const cols = s("g");
    svg.append(cols);
    els.vizParts = { kind: "agg", svg, cols, yaxis, W, H, left, top, bottom, cw };
    const summary = h("p", { class: "viz-cap" });
    els.vizParts.summary = summary;
    els.viz.replaceChildren(
      vizHead("Quem entra na resposta", `Cadastros ativos em cada mês · ${q.kitchen === "all" ? "todas as cozinhas" : kName(q.kitchen)}. Clique ou use Enter num mês para ver os registros.`, [vizToggle()]),
      svg,
      h("div", { class: "viz-legend" }, h("span", null, h("i", { style: { background: "var(--a-deep)" } }), "ativos no mês que entram"), h("span", null, h("i", { style: { background: "var(--ink-3)", opacity: 0.35 } }), "ativos no mês que ficam de fora")),
      summary,
      els.drill = h("div", { class: "drill" }));
    paintViz();
    if (drillMonth !== null && drillMonth < n) openDrill(drillMonth);
  }

  function paintAgg() {
    const P = els.vizParts;
    const k = preview || q.reading;
    const { tot, inc } = aggCounts(k);
    const n = els.agg.n;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, tot[i]);
    max = Math.max(1, max);
    const ph = P.H - P.top - P.bottom;
    P.yaxis.replaceChildren(s("text", { x: P.left - 8, y: P.top + 4, "text-anchor": "end" }, fmt(max)), s("text", { x: P.left - 8, y: P.H - P.bottom, "text-anchor": "end" }, "0"), s("line", { x1: P.left, x2: P.W - 12, y1: P.H - P.bottom, y2: P.H - P.bottom }));
    const frag = [];
    for (let i = 0; i < n; i++) {
      const x = P.left + i * P.cw + 0.6, w = Math.max(1, P.cw - 1.2);
      const ht = (tot[i] / max) * ph, hi = (inc[i] / max) * ph;
      const g = s("g", { class: `mcol ${drillMonth === i ? "sel" : ""}`, tabindex: "0", role: "button", "aria-label": `${MONTHS[i % 12]} ${Y0 + Math.floor(i / 12)}: ${fmt(tot[i])} cadastros ativos${k ? `, ${fmt(inc[i])} entram` : ""}. Ver registros.` });
      g.append(s("rect", { class: "mc-out", x, y: P.H - P.bottom - ht, width: w, height: ht }));
      if (k) g.append(s("rect", { class: "mc-in", x, y: P.H - P.bottom - hi, width: w, height: hi }));
      g.append(s("rect", { class: "mc-hit", x: P.left + i * P.cw, y: P.top - 10, width: P.cw, height: ph + 10 }));
      g.addEventListener("click", () => openDrill(i));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrill(i); } });
      g.addEventListener("mouseenter", (e) => tip(e.clientX, e.clientY, h("div", null, h("div", { class: "mono" }, `${MONTHS[i % 12]} ${Y0 + Math.floor(i / 12)}`), h("div", null, `${fmt(tot[i])} ativos no mês`), k ? h("div", null, `${fmt(inc[i])} entram · ${fmt(tot[i] - inc[i])} ficam de fora`) : null)));
      g.addEventListener("mouseleave", () => untip());
      frag.push(g);
    }
    P.cols.replaceChildren(...frag);
    const total = res.pending ? null : res.value;
    P.summary.replaceChildren(h("b", null, "Agregado por mês: "), "a mesma pessoa aparece em todos os meses em que esteve ativa, então as colunas não somam a resposta.",
      total !== null ? ` A resposta (${fmt(total)}) é calculada registro a registro, sem amostragem.` : "");
  }

  function openDrill(i) {
    drillMonth = i;
    const A = els.agg;
    if (!A || !els.drill) return;
    els.vizParts.cols.querySelectorAll(".mcol").forEach((g, j) => g.classList.toggle("sel", j === i));
    const k = q.reading || null;
    const rows = A.rows.filter((b, j) => A.st[j] <= i && A.en[j] >= i);
    const label = `${MONTHS[i % 12]} ${Y0 + Math.floor(i / 12)}`;
    const cols = [
      { key: "id", label: "id", mono: true }, { key: "nome", label: "nome" },
      q.kitchen === "all" ? { key: "cozinha_id", label: "cozinha", get: (r) => (r.cozinha_id ? kShort(r.cozinha_id) : "sem cozinha") } : null,
      { key: "data_cadastro", label: "cadastro", mono: true, render: (r) => T.dateBR(r.data_cadastro) }, { key: "data_desligamento", label: "desligamento", mono: true, render: (r) => T.dateBR(r.data_desligamento) },
      k ? { key: "_st", label: "nesta leitura", get: (r) => { const st = rowStatus(r); return st ? st.text : ""; }, render: (r) => { const st = rowStatus(r); return h("span", { class: `tagx ${st.kind === "in" ? "in" : st.kind === "rep" ? "rep" : "out"}` }, st.text); } } : null,
    ].filter(Boolean);
    els.drill.replaceChildren(
      h("div", { class: "drill-head" }, h("h4", null, `${label} · ${fmt(rows.length)} cadastros ativos`), h("button", { type: "button", class: "btn quiet", onclick: () => { drillMonth = null; els.drill.replaceChildren(); els.vizParts.cols.querySelectorAll(".mcol").forEach((g) => g.classList.remove("sel")); } }, "Fechar mês")),
      recordTable({ rows, pageSize: 20, maxHeight: "320px", ariaLabel: `Cadastros ativos em ${label}`, columns: cols }));
    announce(`${label}: ${fmt(rows.length)} cadastros ativos.`);
  }

  function drillHost() { els.drill = null; }

  function tipRow(b, e) {
    const st = rowStatus(b);
    const v = res.vigMap.get(b);
    const n = (T.attByBen.get(b.id) || []).length;
    tip(e.clientX, e.clientY, h("div", null, h("div", { class: "mono" }, `${b.id} · ${b.nome}`), h("div", null, `cadastro ${T.dateBR(b.data_cadastro)}${b.data_desligamento ? ` · desligamento ${T.dateBR(b.data_desligamento)}` : " · ativo"}`), h("div", null, `${n} atendimentos em 2025`),
      preview && preview !== q.reading ? h("div", { style: { marginTop: "4px", fontWeight: 600 } }, v[preview] ? "entraria nesta leitura" : `ficaria de fora: ${v[T.readings[preview].why]}`) : st ? h("div", { style: { marginTop: "4px", fontWeight: 600 } }, st.kind === "out" ? `fora: ${st.text}` : st.text) : null));
  }

  function paintViz() {
    const p = els.vizParts;
    if (!p) return;
    if (p.kind === "agg") { if (els.agg) paintAgg(); return; }
    if (p.kind !== "timeline") return;
    const k = preview || q.reading;
    p.rule.setAttribute("opacity", k === "activeEnd" ? 1 : 0);
    p.starts.setAttribute("opacity", k === "started" ? 1 : 0);
    const stepRows = stepFilterRows();
    p.lines.querySelectorAll(".vline:not(.ghost)").forEach((ln) => {
      const b = ln._row;
      const v = res.vigMap.get(b);
      ln.classList.remove("in", "out", "focus");
      if (k) ln.classList.add(v[k] ? "in" : "out");
      if (stepRows && stepRows.has(b)) ln.classList.add("focus");
      if (focusId && b.id === focusId) ln.classList.add("focus");
      ln.style.stroke = k ? "" : "var(--ink)";
      ln.style.opacity = k ? "" : "0.6";
    });
  }

  function stepFilterRows() {
    if (!tableFilter.startsWith("step:") || q.source !== "cadastro" || res.pending) return null;
    const key = tableFilter.slice(5);
    if (key === "reading") return new Set(res.vig.filter((x) => !x[q.reading]).map((x) => x.row));
    if (key === "measure") return new Set(res.base.filter((b) => res.firstRow.get(b.id) !== b));
    return null;
  }

  function renderStrip() {
    const W = 900;
    const byId = new Map();
    for (const x of res.attRows) { if (!byId.has(x.att.beneficiario_id)) byId.set(x.att.beneficiario_id, []); byId.get(x.att.beneficiario_id).push(x); }
    if (byId.size > LINES_AUTO) return renderStripAgg(byId);
    const first = (l) => l.reduce((m, x) => (x.att.data < m ? x.att.data : m), "9");
    const people = [...byId.entries()].sort((a, b) => first(a[1]).localeCompare(first(b[1])));
    const LH = 4, top = 46, H = top + people.length * LH + 16;
    const xs = (d) => 60 + ((ms(d) - Date.UTC(2025, 0, 1)) / (Date.UTC(2026, 0, 1) - Date.UTC(2025, 0, 1))) * (W - 84);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${people.length} beneficiários com atendimentos em 2025; cada marca é um atendimento.` });
    const ax = s("g", { class: "vaxis" });
    MONTHS.forEach((m, i) => { const x = xs(`2025-${String(i + 1).padStart(2, "0")}-01`); ax.append(s("line", { x1: x, x2: x, y1: 22, y2: H }), s("text", { x: x + 3, y: 18 }, m)); });
    svg.append(ax);
    let other = 0, none = 0;
    people.forEach(([id, list], i) => {
      const y = top + i * LH + 2;
      const ben = (benIdx.get(id) || [])[0];
      const refK = ben ? ben.cozinha_id : null;
      if (q.path === "event") {
        if (!ben) { none++; svg.append(s("circle", { cx: 40, cy: y, r: 1.8, fill: "none", stroke: "var(--b)", "stroke-width": 1 })); }
        else if (refK !== q.kitchen) { other++; svg.append(s("rect", { x: 38, y: y - 1.6, width: 3.2, height: 3.2, fill: "var(--b)" })); }
      }
      svg.append(s("line", { x1: 60, x2: W - 24, y1: y, y2: y, stroke: "var(--rule)", "stroke-width": 1 }));
      const seenAtt = new Set();
      for (const x of list) {
        if (seenAtt.has(x.att.id)) continue;
        seenAtt.add(x.att.id);
        const away = q.path === "reference" && x.att.cozinha_id !== refK;
        svg.append(s("rect", { x: xs(x.att.data) - 0.9, y: y - 1.7, width: 1.8, height: 3.4, fill: away ? "var(--b)" : "var(--a-deep)" }));
      }
      if (list.some((x) => x.mult > 1)) svg.append(s("rect", { x: 44, y: y - 1.6, width: 3.2, height: 3.2, fill: "none", stroke: "var(--ink)", "stroke-width": 0.8 }));
    });
    els.vizParts = { kind: "strip" };
    const legend = q.path === "event"
      ? [h("span", null, h("i", { style: { width: "3px", height: "10px", background: "var(--a-deep)" } }), "atendimento"), h("span", null, h("i", { style: { width: "8px", height: "8px", background: "var(--b)" } }), `cadastrado em outra cozinha (${other})`), none ? h("span", null, h("i", { style: { width: "8px", height: "8px", border: "1px solid var(--b)", borderRadius: "50%" } }), `sem cadastro (${none})`) : null]
      : [h("span", null, h("i", { style: { width: "3px", height: "10px", background: "var(--a-deep)" } }), "na cozinha de referência"), h("span", null, h("i", { style: { width: "3px", height: "10px", background: "var(--b)" } }), "em outra cozinha"), h("span", null, h("i", { style: { width: "8px", height: "8px", border: "1px solid var(--ink)" } }), "id repetido no cadastro")];
    els.viz.replaceChildren(vizHead("Quem entra na resposta", `${fmt(people.length)} pessoas, ${fmt(new Set(res.attRows.map((x) => x.att.id)).size)} atendimentos em 2025. Cada linha é uma pessoa; cada marca, um atendimento.`, []), svg, h("div", { class: "viz-legend" }, ...legend));
  }

  function renderStripAgg(byId) {
    const W = 900, H = 230, left = 52, top = 30, bottom = 34;
    const cw = (W - left - 12) / 12;
    const att = [...new Map(res.attRows.map((x) => [x.att.id, x])).values()];
    const inA = new Array(12).fill(0), outA = new Array(12).fill(0);
    const isOut = (x) => (q.path === "event" ? !x.ben || x.ben.cozinha_id !== x.att.cozinha_id : x.att.cozinha_id !== x.ben.cozinha_id);
    for (const x of att) { const m = +x.att.data.slice(5, 7) - 1; if (isOut(x)) outA[m]++; else inA[m]++; }
    const max = Math.max(1, ...inA.map((v, i) => v + outA[i]));
    const ph = H - top - bottom;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `Atendimentos por mês em 2025, ${fmt(att.length)} no total` });
    svg.append(s("g", { class: "vaxis" }, s("text", { x: left - 8, y: top + 4, "text-anchor": "end" }, fmt(max)), s("text", { x: left - 8, y: H - bottom, "text-anchor": "end" }, "0"), s("line", { x1: left, x2: W - 12, y1: H - bottom, y2: H - bottom })));
    const drill = h("div", { class: "drill" });
    MONTHS.forEach((m, i) => {
      const x = left + i * cw + 4, w = cw - 8;
      const hi = (inA[i] / max) * ph, ho = (outA[i] / max) * ph;
      const g = s("g", { class: "mcol", tabindex: "0", role: "button", "aria-label": `${m} 2025: ${fmt(inA[i] + outA[i])} atendimentos. Ver registros.` },
        s("rect", { class: "mc-in", x, y: H - bottom - hi, width: w, height: hi }), s("rect", { class: "mc-alt", x, y: H - bottom - hi - ho, width: w, height: ho }),
        s("text", { class: "mc-n", x: x + w / 2, y: H - bottom - hi - ho - 6, "text-anchor": "middle" }, fmt(inA[i] + outA[i])),
        s("text", { x: x + w / 2, y: H - bottom + 18, "text-anchor": "middle", class: "mc-m" }, m),
        s("rect", { class: "mc-hit", x: left + i * cw, y: top - 10, width: cw, height: ph + 10 }));
      const open = () => {
        svg.querySelectorAll(".mcol").forEach((c) => c.classList.toggle("sel", c === g));
        const rows = att.filter((x) => +x.att.data.slice(5, 7) - 1 === i);
        drill.replaceChildren(h("div", { class: "drill-head" }, h("h4", null, `${m} 2025 · ${fmt(rows.length)} atendimentos`), h("button", { type: "button", class: "btn quiet", onclick: () => { drill.replaceChildren(); g.classList.remove("sel"); } }, "Fechar mês")),
          recordTable({ rows, pageSize: 20, maxHeight: "320px", ariaLabel: `Atendimentos de ${m} 2025`, columns: [
            { key: "id", label: "atendimento", mono: true, get: (x) => x.att.id }, { key: "data", label: "data", mono: true, get: (x) => x.att.data, render: (x) => T.dateBR(x.att.data) },
            { key: "b", label: "beneficiário", mono: true, get: (x) => x.att.beneficiario_id }, { key: "k", label: "cozinha do atendimento", get: (x) => kShort(x.att.cozinha_id) },
            { key: "rk", label: "de referência", get: (x) => (x.ben ? kShort(x.ben.cozinha_id) : "sem cadastro") }] }));
      };
      g.addEventListener("click", open);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      svg.append(g);
    });
    els.vizParts = { kind: "stripAgg" };
    els.viz.replaceChildren(
      vizHead("Quem entra na resposta", `${fmt(byId.size)} pessoas, ${fmt(att.length)} atendimentos em 2025, agregados por mês. Clique ou use Enter num mês para ver os registros.`, []),
      svg,
      h("div", { class: "viz-legend" }, h("span", null, h("i", { style: { background: "var(--a-deep)" } }), q.path === "event" ? "pessoa cadastrada nesta cozinha" : "na cozinha de referência"), h("span", null, h("i", { style: { background: "var(--b)" } }), q.path === "event" ? "cadastrada em outra cozinha ou sem cadastro" : "atendido em outra cozinha")),
      h("p", { class: "viz-cap" }, h("b", null, "Agregado por mês: "), q.measure === "distinct" ? "quem foi atendido em vários meses aparece em várias colunas, então as colunas não somam a resposta." : "somadas, as colunas dão o total de atendimentos distintos."),
      drill);
  }

  function renderBars() {
    const W = 900;
    let groups = res.groups.slice().sort((a, b) => b.n - a.n);
    const totalGroups = groups.length;
    const capped = !barsAll && totalGroups > BARS_TOP;
    if (capped) groups = groups.slice(0, BARS_TOP);
    const max = Math.max(1, ...groups.map((g) => g.n));
    const LH = 28;
    const H = groups.length * LH + 70;
    const svg = s("svg", { class: "barsq", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Resultado por cozinha" });
    const bx = 220, bw = W - bx - 90;
    groups.forEach((g, i) => {
      const y = 10 + i * LH;
      svg.append(s("text", { class: "bk", x: 0, y: y + 14 }, g.k.nome.replace("Cozinha ", "")));
      svg.append(s("rect", { class: "qbar", x: bx, y: y + 3, width: Math.max(1, (g.n / max) * bw), height: 16 }));
      svg.append(s("text", { class: "bn", x: bx + (g.n / max) * bw + 8, y: y + 16 }, fmt(g.n)));
    });
    const yT = 10 + groups.length * LH + 18;
    svg.append(s("line", { x1: 0, x2: W, y1: yT - 14, y2: yT - 14, stroke: "var(--rule-2)" }));
    const sum = res.groups.reduce((a, g) => a + g.n, 0);
    svg.append(s("text", { class: "tot", x: 0, y: yT + 8 }, `total calculado: ${fmt(res.value)}`));
    if (sum !== res.value) svg.append(s("text", { class: "bn", x: bx, y: yT + 8, style: "fill: var(--b-deep)" }, `soma das ${totalGroups} cozinhas: ${fmt(sum)} · não é o total`));
    els.vizParts = { kind: "bars" };
    const more = totalGroups > BARS_TOP ? h("button", { type: "button", class: "btn link", onclick: () => { barsAll = !barsAll; renderViz(); } }, barsAll ? `Mostrar só as ${BARS_TOP} maiores` : `Mostrar as ${totalGroups} cozinhas`) : null;
    els.viz.replaceChildren(
      vizHead("Por cozinha", capped ? `As ${BARS_TOP} maiores de ${totalGroups}, do maior para o menor. As outras continuam no total.` : "Do maior para o menor.", [vizToggle()]),
      h("div", { class: barsAll && totalGroups > BARS_TOP ? "bars-scroll" : "" }, svg),
      more ? h("div", null, more) : null);
  }

  function renderRelated() {
    const hide = res.pending || res.insufficient;
    els.related.hidden = !!hide;
    if (hide) { els.related.replaceChildren(); return; }
    const link = (label, fn) => h("button", { type: "button", class: "btn link", onclick: fn }, label);
    els.related.replaceChildren(h("span", { class: "rl-k" }, "Variar a pergunta"),
      q.kitchen !== "all" ? link("por cozinha", () => setQ({ kitchen: "all" }, "kitchen")) : link(`só a ${kShort(T.ws.focusKitchen)}`, () => setQ({ kitchen: T.ws.focusKitchen }, "kitchen")),
      link(q.year === 2025 ? "em 2024" : "em 2025", () => setQ({ year: q.year === 2025 ? 2024 : 2025 }, "year")),
      link(q.source === "cadastro" ? "no registro de atendimentos" : "no cadastro", () => setQ({ source: q.source === "cadastro" ? "atendimento" : "cadastro" }, "source")),
      q.source === "cadastro" ? link("comparar cadastro × atendidos", () => App.go("comparacao", {})) : null);
  }

  const TABS = [["steps", "Passos e registros"], ["criteria", "Critérios e relações"], ["spec", "Pergunta estruturada"]];

  function renderInv() {
    const show = invOpen && !res.pending && !res.insufficient && !res.blocked;
    els.inv.hidden = !show;
    if (!show) { els.inv.replaceChildren(); return; }
    const tabs = TABS.map(([k, label]) => h("button", { type: "button", role: "tab", id: `qtab-${k}`, "aria-selected": String(invTab === k), "aria-controls": "qInvPanel", tabindex: invTab === k ? "0" : "-1", onclick: () => { invTab = k; renderInv(); document.getElementById(`qtab-${k}`)?.focus(); } }, label));
    const list = h("div", { class: "inv-tabs", role: "tablist", "aria-label": "Investigar a resposta" }, ...tabs);
    list.addEventListener("keydown", (e) => {
      const i = TABS.findIndex(([k]) => k === invTab);
      let j = null;
      if (e.key === "ArrowRight") j = (i + 1) % TABS.length;
      if (e.key === "ArrowLeft") j = (i - 1 + TABS.length) % TABS.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = TABS.length - 1;
      if (j !== null) { e.preventDefault(); invTab = TABS[j][0]; renderInv(); document.getElementById(`qtab-${invTab}`)?.focus(); }
    });
    const panel = h("div", { class: "inv-panel", role: "tabpanel", id: "qInvPanel", "aria-labelledby": `qtab-${invTab}` });
    if (invTab === "steps") panel.append(...stepsTab());
    if (invTab === "criteria") panel.append(...criteriaTab());
    if (invTab === "spec") panel.append(ticket());
    els.inv.replaceChildren(h("div", { class: "inv-head" }, h("h2", null, "Investigar a resposta"), h("button", { type: "button", class: "btn quiet", onclick: closeInv }, "Recolher")), list, panel);
  }

  function stepsTab() {
    const blockers = blockersOf(q);
    if (blockers.length) {
      return [h("div", { class: "gate" }, h("p", { class: "gate-t" }, "Este número ainda é uma prévia."), h("p", null, `Passos e registros aparecem depois de ${blockers.length === 1 ? "resolver 1 decisão" : `resolver ${blockers.length} decisões`}, para o rastreio não se apoiar em suposições.`)), needsList(blockers)];
    }
    if (!q.traced) {
      return [h("div", { class: "gate" }, h("p", { class: "gate-t" }, "Pronto para rastrear."), h("p", null, "Rastrear mostra cada passo, quantos registros entram e saem, e cada registro. Neste protótipo, o rastreio é calculado no navegador e nada é gravado."),
        h("div", { class: "q-actions" }, h("button", { type: "button", class: "btn primary", onclick: () => trace() }, "Rastrear agora")))];
    }
    const fiche = h("div", { id: "qFiche" });
    const grid = h("div", { class: "inv-grid" },
      h("div", { class: "inv-col" }, h("h3", null, "Passos"), h("p", { class: "small-note" }, "Clique num passo para filtrar os registros."), ladder(), fiche),
      h("div", { class: "inv-col" }, h("h3", null, "Registros"), recordsTable()));
    if (focusId && q.source === "cadastro") setTimeout(() => { const r = res.base.find((b) => b.id === focusId); if (r) renderFiche(r); }, 0);
    return [grid];
  }

  function recordsTable() {
    if (q.source === "cadastro") {
      const rows = res.base;
      const status = new Map(rows.map((r) => [r, rowStatus(r)]));
      const counts = { all: rows.length, in: 0, out: 0, rep: 0 };
      for (const r of rows) { const k = status.get(r).kind; if (k === "out") counts.out++; else counts.in++; if ((res.idCount.get(r.id) || 0) > 1) counts.rep++; }
      const stepRows = stepFilterRows();
      let shown = rows;
      if (tableFilter === "in") shown = rows.filter((r) => status.get(r).kind !== "out");
      if (tableFilter === "out") shown = rows.filter((r) => status.get(r).kind === "out");
      if (tableFilter === "rep") shown = rows.filter((r) => (res.idCount.get(r.id) || 0) > 1);
      if (stepRows) shown = rows.filter((r) => stepRows.has(r) || (tableFilter === "step:measure" && (res.idCount.get(r.id) || 0) > 1));
      const order = { in: 0, rep: 1, out: 2 };
      shown = shown.slice().sort((a, b) => order[status.get(a).kind] - order[status.get(b).kind] || a.id.localeCompare(b.id));
      const hasOut = shown.some((x) => status.get(x).kind === "out");
      let lastIn = null;
      if (hasOut) for (let i = shown.length - 1; i >= 0; i--) if (status.get(shown[i]).kind !== "out") { lastIn = shown[i]; break; }
      const chip = (key, label, n) => h("button", { type: "button", class: "chip", "aria-pressed": String(tableFilter === key), onclick: () => { tableFilter = key; renderInv(); paintViz(); } }, label, h("b", null, fmt(n)));
      const tbl = recordTable({
        rows: shown, pageSize: 40, maxHeight: "520px", ariaLabel: "Registros do cadastro nesta resposta",
        tools: [chip("all", "todos", counts.all), chip("in", "entram", counts.in), chip("out", "fora", counts.out), chip("rep", "id repetido", counts.rep)],
        rowClass: (r) => (r === lastIn ? "cut" : ""),
        onRow: (r) => { focusId = r.id; renderFiche(r); paintViz(); },
        columns: [
          { key: "id", label: "id", mono: true }, { key: "nome", label: "nome" },
          q.kitchen === "all" ? { key: "cozinha_id", label: "cozinha", get: (r) => (r.cozinha_id ? kShort(r.cozinha_id) : "sem cozinha") } : null,
          { key: "data_cadastro", label: "cadastro", mono: true, render: (r) => T.dateBR(r.data_cadastro) }, { key: "data_desligamento", label: "desligamento", mono: true, render: (r) => T.dateBR(r.data_desligamento) },
          { key: "_st", label: "nesta resposta", get: (r) => status.get(r).text, render: (r) => { const st = status.get(r); return h("span", { class: `tagx ${st.kind === "in" ? "in" : st.kind === "rep" ? "rep" : "out"}` }, st.text); } },
          { key: "_n", label: "atend. 2025", align: "r", get: (r) => (T.attByBen.get(r.id) || []).length },
        ].filter(Boolean),
      });
      if (focusId) setTimeout(() => tbl.reveal((r) => r.id === focusId), 0);
      return tbl;
    }
    const rows = [...new Map(res.attRows.map((x) => [x.att.id + (x.ben ? x.ben._line : ""), x])).values()];
    return recordTable({
      rows, pageSize: 40, maxHeight: "520px", ariaLabel: "Atendimentos nesta resposta",
      columns: [
        { key: "id", label: "atendimento", mono: true, get: (x) => x.att.id }, { key: "data", label: "data", mono: true, get: (x) => x.att.data, render: (x) => T.dateBR(x.att.data) },
        { key: "b", label: "beneficiário", mono: true, get: (x) => x.att.beneficiario_id }, { key: "k", label: "cozinha do atendimento", get: (x) => kShort(x.att.cozinha_id) },
        { key: "rk", label: "de referência", get: (x) => (x.ben ? kShort(x.ben.cozinha_id) : "sem cadastro") },
        { key: "mult", label: "cópias", align: "r", get: (x) => x.mult || 1 },
      ],
    });
  }

  function criteriaTab() {
    const out = [];
    const cad = q.source === "cadastro";
    if (cad) {
      const R = T.readings[q.reading];
      out.push(h("section", { class: "crit-sec" }, h("h3", null, "Leitura escolhida por você"),
        h("p", { class: "cs-t" }, `${READ_SHORT[q.reading]} ${q.year}`),
        h("dl", { class: "cs-dl" }, h("dt", null, "entra"), h("dd", null, R.inc(q.year).replace(/^entra /, "")), h("dt", null, "fica de fora"), h("dd", null, R.exc(q.year).replace(/^fica de fora /, "")), h("dt", null, "regra"), h("dd", { class: "mono" }, R.rule(q.year))),
        h("p", { class: "small-note" }, "As outras duas leituras continuam disponíveis em “Trocar leitura”.")));
    } else {
      out.push(h("section", { class: "crit-sec" }, h("h3", null, "Período e caminho"),
        h("dl", { class: "cs-dl" }, h("dt", null, "período"), h("dd", null, `data do atendimento entre 01/01/${q.year} e 31/12/${q.year}`), h("dt", null, "cozinha"), h("dd", null, q.path === "event" ? "onde o atendimento aconteceu (atendimentos.cozinha_id)" : "a cozinha de referência do beneficiário (beneficiarios.cozinha_id)"))));
    }
    out.push(h("section", { class: "crit-sec" }, h("h3", null, "Medida"), h("p", null, q.measure === "distinct" ? `Conta beneficiários diferentes: cada id conta uma vez, mesmo com mais de uma ${cad ? "linha" : "visita"}.` : cad ? "Conta linhas do cadastro: um id repetido conta mais de uma vez." : "Conta atendimentos: cada visita conta.")));
    const rels = neededRels(q).map(rel);
    out.push(h("section", { class: "crit-sec" }, h("h3", null, "Relações e modelo usados"),
      h("ul", { class: "rel-list" },
        cad ? h("li", null, h("span", { class: `nd-st ${T.ws.validityConfirmed ? "confirmed" : "pend"}` }, T.ws.validityConfirmed ? "confirmada" : "sugerida"), h("span", { class: "mono" }, `vigência ${T.schema.beneficiarios.validity.join(" → ")}`)) : null,
        ...rels.map((r) => h("li", null, h("span", { class: `nd-st ${r.status === "suggested" ? "pend" : r.status === "rejected" ? "rej" : r.status}` }, T.relStatusWord(r.status)), h("span", { class: "mono" }, `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`), h("button", { type: "button", class: "btn link", onclick: () => App.go("mapa", { select: r.id }) }, "ver evidência"))))));
    const notes = res.notes.filter((x) => x.kind !== "warn");
    if (notes.length) out.push(h("section", { class: "crit-sec" }, h("h3", null, "Ambiguidades e limites"), h("div", { class: "notes" }, ...notes.map((x) => h("div", { class: "note-i" }, h("i", { class: x.kind }), h("span", null, x.text))))));
    return [h("div", { class: "crit-grid" }, ...out)];
  }

  function renderFiche(r) {
    const host = document.getElementById("qFiche");
    if (!host) return;
    const st = rowStatus(r);
    const att = T.attByBen.get(r.id) || [];
    const dup = res.idCount ? res.idCount.get(r.id) || 1 : 1;
    host.replaceChildren(h("div", { class: "qfiche" },
      h("p", { class: "eyebrow", style: { margin: 0 } }, `beneficiarios.csv · linha ${r._line}`), h("h4", null, `${r.nome} · ${r.id}`),
      h("dl", { class: "kv" }, h("dt", null, "cozinha"), h("dd", null, r.cozinha_id ? kName(r.cozinha_id) : "sem cozinha_id"), h("dt", null, "cadastro"), h("dd", null, T.dateBR(r.data_cadastro)), h("dt", null, "desligamento"), h("dd", null, T.dateBR(r.data_desligamento)), h("dt", null, "atendimentos 2025"), h("dd", null, String(att.length))),
      st ? h("p", { class: "why", style: { margin: 0 } }, h("span", { class: `tagx ${st.kind === "in" ? "in" : st.kind === "rep" ? "rep" : "out"}` }, st.kind === "out" ? "fora" : "entra"), " ", st.kind === "out" ? `Saiu no passo da leitura: ${st.text}.` : dup > 1 ? `Este id aparece ${dup} vezes no cadastro e conta uma vez.` : `Entra pela leitura “${READ_SHORT[q.reading].toLowerCase()} ${q.year}”.`) : null,
      h("div", { class: "q-actions" }, h("button", { type: "button", class: "btn", onclick: () => App.go("mapa", { table: "beneficiarios" }) }, "Abrir no mapa"), h("button", { type: "button", class: "btn quiet", onclick: () => { focusId = null; host.replaceChildren(); paintViz(); } }, "Fechar"))));
  }

  function ticket() {
    const rels = neededRels(q).map(rel);
    const cad = q.source === "cadastro";
    const rows = [
      ["pergunta", plainSentence()],
      ["medida", q.measure === "distinct" ? `contagem de valores distintos · ${cad ? "beneficiarios.id" : "atendimentos.beneficiario_id"}` : `contagem de linhas · ${cad ? "beneficiarios" : "atendimentos"}`],
      ["fonte", cad ? `beneficiarios.csv · versão 1 · ${fmt(T.tables.beneficiarios.length)} linhas` : `atendimentos.csv · versão 1 · ${fmt(T.tables.atendimentos.length)} linhas`],
      ["filtro", q.kitchen === "all" ? `agrupar por ${cad || q.path === "reference" ? "beneficiarios.cozinha_id" : "atendimentos.cozinha_id"}` : `${cad || q.path === "reference" ? "beneficiarios.cozinha_id" : "atendimentos.cozinha_id"} = ${q.kitchen} (${kName(q.kitchen)})`],
      ["relações", rels.map((r) => `${r.from}.${r.fromCol} → ${r.to}.${r.toCol} · ${T.relStatusWord(r.status)}${r.status === "caveat" && r.decision ? ` · ${r.decision.policy === "block" ? "bloqueia o que multiplica" : "mostra a multiplicação"}` : ""}`).join("\n")],
      ["período", cad ? `vigência(data_cadastro, data_desligamento) ∩ [01/01/${q.year}, 31/12/${q.year}] · vigência ${T.ws.validityConfirmed ? "confirmada" : "sugerida"}` : `data entre 01/01/${q.year} e 31/12/${q.year}`],
      ["leitura", cad ? (q.reading ? `${READ_SPEC[q.reading]} · escolhida por você` : "pendente: escolher uma das três") : "data do atendimento"],
      ["resultado", res.insufficient ? "sem dados" : res.blocked ? "bloqueado pela decisão da relação" : res.pending ? "—" : `${fmt(res.value)}${q.measure === "distinct" && res.steps.at(-1).rep ? ` · de ${fmt(res.steps.at(-2).n)} linhas` : ""} · prévia calculada no navegador`],
    ];
    const dl = h("dl");
    for (const [k, v] of rows) {
      const dd = h("dd", { style: { whiteSpace: "pre-line" } }, v);
      if (lastTicket[k] !== undefined && lastTicket[k] !== v) dd.classList.add("changed");
      lastTicket[k] = v;
      dl.append(h("dt", null, k), dd);
    }
    return h("div", { class: "ticket" }, dl, h("p", { class: "foot", style: { margin: 0 } }, "Especificação que o motor validaria e executaria. Neste protótipo, o cálculo é feito no navegador sobre dados sintéticos."));
  }

  function setTrail() {
    App.setTrail([{ label: "Mapa", go: () => App.go("mapa", {}) }, { label: q.source === "cadastro" ? "beneficiarios" : "atendimentos", go: () => App.go("mapa", { table: q.source === "cadastro" ? "beneficiarios" : "atendimentos" }) }, { label: `Pergunta: ${q.kitchen === "all" ? "por cozinha" : kShort(q.kitchen)} em ${q.year}` }]);
  }

  function restart() {
    q = defaults(); focusId = null; tableFilter = "all"; lastTicket = {}; drillMonth = null; vizPref = "auto"; resetView();
    render();
    announce("Pergunta reiniciada");
  }

  function init(el) {
    root = el;
    root.style.position = "absolute";
    resetState();
    q = defaults();
    const wrap = h("div", { class: "q-wrap" });
    els.howBtn = h("button", { type: "button", class: "btn link", "aria-controls": "qHow", onclick: () => { howOpen = !howOpen; renderHow(); } }, "Como foi montada");
    els.how = h("p", { class: "q-how", id: "qHow", hidden: true });
    els.sentence = h("h1", { class: "q-sentence" });
    const hint = h("p", { class: "q-hint", "aria-hidden": "true" }, "Cada parte sublinhada pode ser trocada · Enter abre as opções · Esc fecha");
    const head = h("header", { class: "q-head" },
      h("div", { class: "q-meta" }, h("span", { class: "eyebrow ab" }, "Pergunta"), els.howBtn, h("button", { type: "button", class: "btn link", onclick: restart }, "Recomeçar")),
      els.how, els.sentence, hint);
    els.clar = h("section", { class: "clar", "aria-labelledby": "clarT" });
    els.answer = h("section", { class: "q-answer", id: "qAnswer", tabindex: "-1", "aria-label": "Resposta" });
    els.viz = h("section", { class: "viz", "aria-label": "Visualização da resposta" });
    els.related = h("nav", { class: "q-related", "aria-label": "Variar a pergunta" });
    els.inv = h("section", { class: "q-inv", id: "qInv", "aria-label": "Investigar a resposta" });
    wrap.append(head, els.clar, els.answer, els.viz, els.related, els.inv);
    el.append(wrap);
    el.addEventListener("click", (e) => { if (pop && !pop.contains(e.target)) closePop(); });
    el.addEventListener("scroll", () => closePop(), { passive: true });
    render();
  }

  function show(params) {
    if (params && params.reset) {
      q = Object.assign(defaults(), params);
      delete q.reset;
      if (q.kitchen === "focus") q.kitchen = T.ws.focusKitchen;
      if (q.source === "atendimento") q.reading = "served";
      focusId = null; tableFilter = "all"; lastTicket = {}; drillMonth = null; resetView();
    }
    render();
  }

  App.register("pergunta", { init, show, hide: () => closePop(), escape: () => { if (pop) { const a = pop._anchor; closePop(); a?.focus(); } else if (focusId) { focusId = null; document.getElementById("qFiche")?.replaceChildren(); paintViz(); } } });
})();
