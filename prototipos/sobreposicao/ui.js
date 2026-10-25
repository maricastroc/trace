(function () {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const clean = (kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    const rc = proto.replaceChildren, ap = proto.append;
    proto.replaceChildren = function (...kids) { return rc.apply(this, clean(kids)); };
    proto.append = function (...kids) { return ap.apply(this, clean(kids)); };
  }

  function apply(el, attrs, isSvg) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") isSvg ? el.setAttribute("class", v) : (el.className = v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  function append(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  function h(tag, attrs, ...kids) { const el = document.createElement(tag); apply(el, attrs, false); append(el, kids); return el; }
  function s(tag, attrs, ...kids) { const el = document.createElementNS(SVGNS, tag); apply(el, attrs, true); append(el, kids); return el; }

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    const el = document.getElementById("toast");
    el.replaceChildren(h("span", null, msg));
    if (actionLabel) el.append(h("button", { type: "button", onclick: () => { el.classList.remove("show"); onAction(); } }, actionLabel));
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 5200);
  }

  function announce(msg) {
    const el = document.getElementById("announce");
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = msg; });
  }

  const tipEl = () => document.getElementById("tip");
  function tip(x, y, content) {
    const el = tipEl();
    el.replaceChildren(content);
    const w = el.offsetWidth || 220, hgt = el.offsetHeight || 40;
    const left = Math.min(window.innerWidth - w - 12, x + 14);
    const top = y + hgt + 24 > window.innerHeight ? y - hgt - 12 : y + 16;
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.classList.add("show");
  }
  function untip() { tipEl().classList.remove("show"); }

  function countTo(el, to, opts = {}) {
    const from = Number(el.dataset.value ?? to);
    el.dataset.value = to;
    const fmt = opts.format || window.Trace.fmt;
    if (reduced() || from === to) { el.textContent = fmt(to); return; }
    const dur = opts.duration || 650;
    const t0 = performance.now();
    const token = (el._countToken = {});
    const step = () => {
      if (el._countToken !== token) return;
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) { const r = requestAnimationFrame(() => { clearTimeout(f); step(); }); const f = setTimeout(() => { cancelAnimationFrame(r); step(); }, 80); }
    };
    step();
  }

  class Panel {
    constructor(host, opts = {}) {
      this.host = host;
      this.onClose = opts.onClose || null;
      this.el = h("aside", { class: "panel", "aria-hidden": "true", "aria-labelledby": "" });
      this.head = h("header", { class: "panel-head" });
      this.body = h("div", { class: "panel-body" });
      this.el.append(this.head, this.body);
      host.append(this.el);
      this.isOpen = false;
      this.el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } });
    }
    open({ eyebrow, eyebrowClass = "", title, sub, body, focus = true, back }) {
      const id = "ph-" + Math.random().toString(36).slice(2, 8);
      const top = h("div", null,
        back ? h("button", { type: "button", class: "btn link", style: { fontSize: "13px", marginBottom: "8px" }, onclick: back.go }, "← " + back.label) : null,
        h("p", { class: "eyebrow " + eyebrowClass, style: { margin: 0 } }, eyebrow),
        h("h2", { id, tabindex: "-1" }, title));
      this.head.replaceChildren(top,
        h("button", { type: "button", class: "icon-btn", "aria-label": "Fechar painel", onclick: () => this.close() },
          s("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" }, s("path", { d: "M4 4l10 10M14 4L4 14", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round" }))),
        sub ? h("p", { class: "sub", style: { margin: 0 } }, sub) : null);
      this.body.replaceChildren(...[].concat(body));
      this.body.scrollTop = 0;
      this.el.setAttribute("aria-labelledby", id);
      this.el.setAttribute("aria-hidden", "false");
      const was = this.isOpen;
      this.isOpen = true;
      this.el.classList.add("open");
      this.host.classList.add("panel-open");
      if (focus) setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), was ? 30 : 320);
    }
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.el.classList.remove("open");
      this.el.setAttribute("aria-hidden", "true");
      this.host.classList.remove("panel-open");
      if (this.onClose) this.onClose();
    }
  }

  function recordTable(opts) {
    const state = { rows: opts.rows.slice(), q: "", sort: opts.sort || null, shown: opts.pageSize || 60, sel: null };
    const wrap = h("div", { class: "rt-wrap" });
    const tools = h("div", { class: "rt-tools" });
    let search = null;
    if (opts.search !== false) {
      search = h("input", { class: "rt-search", type: "search", placeholder: opts.searchPlaceholder || "Buscar", "aria-label": opts.searchPlaceholder || "Buscar nos registros" });
      search.addEventListener("input", () => { state.q = search.value.trim().toLowerCase(); state.shown = opts.pageSize || 60; render(); });
      tools.append(search);
    }
    (opts.tools || []).forEach((t) => tools.append(t));
    if (tools.childElementCount) wrap.append(tools);
    const scroll = h("div", { class: "rt-scroll", style: opts.maxHeight ? { maxHeight: opts.maxHeight } : null });
    const table = h("table", { class: "rt", "aria-label": opts.ariaLabel || "Registros" });
    const thead = h("thead");
    const tbody = h("tbody");
    table.append(thead, tbody);
    scroll.append(table);
    wrap.append(scroll);
    const foot = h("div", { class: "more" });
    wrap.append(foot);

    const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
    function header() {
      const tr = h("tr");
      for (const c of opts.columns) {
        const sorted = state.sort && state.sort.key === c.key;
        const th = h("th", { scope: "col", class: c.align === "r" ? "r" : "", "aria-sort": sorted ? (state.sort.dir > 0 ? "ascending" : "descending") : null });
        th.append(h("button", { type: "button", onclick: () => { state.sort = sorted ? { key: c.key, dir: -state.sort.dir } : { key: c.key, dir: 1 }; render(); } },
          c.label, h("span", { class: "dir", "aria-hidden": "true" }, sorted ? (state.sort.dir > 0 ? "▲" : "▼") : "↕")));
        tr.append(th);
      }
      thead.replaceChildren(tr);
    }
    function filtered() {
      let rows = state.rows;
      if (state.q) {
        rows = rows.filter((r) => opts.columns.some((c) => String(val(c, r) ?? "").toLowerCase().includes(state.q)));
      }
      if (state.sort) {
        const c = opts.columns.find((x) => x.key === state.sort.key);
        rows = rows.slice().sort((a, b) => {
          const x = val(c, a), y = val(c, b);
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true })) * state.sort.dir;
        });
      }
      return rows;
    }
    function render() {
      header();
      const rows = filtered();
      const frag = document.createDocumentFragment();
      rows.slice(0, state.shown).forEach((r) => {
        const cls = [opts.onRow ? "clickable" : "", opts.rowClass ? opts.rowClass(r) : "", state.sel === r ? "sel" : ""].join(" ").trim();
        const tr = h("tr", { class: cls, tabindex: opts.onRow ? "0" : null });
        tr._row = r;
        for (const c of opts.columns) {
          const content = c.render ? c.render(r) : (val(c, r) ?? "·");
          tr.append(h("td", { class: [c.align === "r" ? "r" : "", c.mono ? "m" : ""].join(" ").trim() }, content));
        }
        if (opts.onRow) {
          tr.addEventListener("click", () => { state.sel = r; tbody.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); opts.onRow(r, tr); });
          tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.click(); } });
        }
        if (opts.onHover) {
          tr.addEventListener("mouseenter", () => opts.onHover(r));
          tr.addEventListener("mouseleave", () => opts.onHover(null));
        }
        frag.append(tr);
      });
      tbody.replaceChildren(frag);
      if (!rows.length) tbody.append(h("tr", null, h("td", { colspan: opts.columns.length, class: "rt-empty" }, opts.emptyText || "Nenhum registro.")));
      const shown = Math.min(state.shown, rows.length);
      foot.replaceChildren(h("span", { class: "mono num" }, `${window.Trace.fmt(shown)} de ${window.Trace.fmt(rows.length)}${state.q ? " encontrados" : ""}`),
        rows.length > state.shown ? h("button", { type: "button", class: "btn link", onclick: () => { state.shown += opts.pageSize || 60; render(); } }, "Mostrar mais") : null);
    }
    render();
    wrap.setRows = (rows) => { state.rows = rows.slice(); state.shown = opts.pageSize || 60; render(); };
    wrap.reveal = (pred) => {
      const rows = filtered();
      const idx = rows.findIndex(pred);
      if (idx < 0) return false;
      if (idx >= state.shown) { state.shown = idx + 20; }
      state.sel = rows[idx];
      render();
      const tr = [...tbody.children].find((x) => x._row === rows[idx]);
      if (tr) { tr.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }); tr.classList.add("flash"); }
      return true;
    };
    return wrap;
  }

  const icons = {
    key: '<path d="M6.5 9.5a3 3 0 1 1 2.6-1.5L15 14m-2.2-2.2L14 10.6m-3.4-.8l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    link: '<path d="M7 11l4-4M6 8.5L4.6 9.9a2.5 2.5 0 0 0 3.5 3.5L9.5 12M12 9.5l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L8.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    date: '<rect x="3" y="4.5" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h12M6.5 3v3M11.5 3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    number: '<path d="M7 3.5L5.5 14.5M12.5 3.5L11 14.5M3.5 7h12M3 11h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    text: '<path d="M3 13.5L6.5 4.5l3.5 9M4.3 10.5h4.4M12 9.2c.5-.6 1.2-.9 2-.9 1.2 0 2 .8 2 2v3.2m0-2.2c-.6-.4-1.3-.6-2-.6-1.1 0-1.9.6-1.9 1.5s.7 1.4 1.6 1.4c1 0 2.3-.8 2.3-2.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  function icon(name, size = 18) {
    const el = s("svg", { width: size, height: size, viewBox: "0 0 18 18", "aria-hidden": "true" });
    el.innerHTML = icons[name] || "";
    return el;
  }

  window.UI = { h, s, toast, announce, tip, untip, countTo, Panel, recordTable, icon, reduced };
})();
