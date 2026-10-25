(function () {
  "use strict";
  const { h } = UI;
  const T = window.Trace;
  const screens = {};
  const order = ["mapa", "pergunta", "comparacao"];
  let current = null;
  let pending = null;

  const App = {
    register(name, def) { screens[name] = def; },
    go(name, params) {
      pending = params || null;
      if (location.hash.slice(1) === name) show(name);
      else location.hash = name;
    },
    get current() { return current; },
    setTrail(items) {
      const el = document.getElementById("trail");
      el.replaceChildren(h("span", { class: "lbl" }, "rastro"));
      items.forEach((it, i) => {
        if (i) el.append(h("span", { class: "sep", "aria-hidden": "true" }, "›"));
        const last = i === items.length - 1;
        if (last || !it.go) el.append(h("span", { class: last ? "cur" : "", "aria-current": last ? "location" : null }, it.label));
        else el.append(h("button", { type: "button", onclick: it.go }, it.label));
      });
    },
    start() {
      buildPalette();
      buildWorkspaceMenu();
      document.getElementById("protoBtn").addEventListener("click", openAbout);
      document.getElementById("aboutBack").addEventListener("click", (e) => { if (e.target.id === "aboutBack") closeAbout(); });
      window.addEventListener("hashchange", () => show(routeFromHash()));
      document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); togglePalette(); return; }
        if (e.key === "Escape" && !document.getElementById("aboutBack").hidden) { closeAbout(); return; }
        if (e.key === "Escape" && !document.getElementById("wsMenu").hidden) { closeWsMenu(); return; }
        if (e.key === "Escape" && !document.getElementById("paletteBack").hidden) { closePalette(); return; }
        if (e.key === "Escape" && current && screens[current].escape) screens[current].escape();
      });
      updateNavCount();
      show(routeFromHash());
    },
    updateNavCount,
    switchWorkspace,
  };

  function updateNavCount() {
    const ok = T.relationships.filter((r) => T.usable(r)).length;
    const el = document.getElementById("navMapCount");
    el.textContent = `${ok}/${T.relationships.length}`;
    el.title = `${ok} de ${T.relationships.length} relações confirmadas`;
  }

  function routeFromHash() {
    const k = location.hash.slice(1);
    return order.includes(k) ? k : "mapa";
  }

  function show(name) {
    const params = pending;
    pending = null;
    for (const n of order) {
      const el = document.getElementById("screen-" + n);
      if (n === name) continue;
      if (!el.hidden && screens[n] && screens[n].hide) screens[n].hide();
      el.hidden = true;
    }
    const el = document.getElementById("screen-" + name);
    const def = screens[name];
    const changed = current !== name;
    current = name;
    el.hidden = false;
    if (!def.inited) { def.init(el); def.inited = true; }
    if (changed) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    document.querySelectorAll("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", false));
    document.querySelector(`[data-nav="${name}"]`)?.setAttribute("aria-current", "page");
    def.show(params || {}, changed);
  }

  function buildWorkspaceMenu() {
    const btn = document.getElementById("wsBtn"), menu = document.getElementById("wsMenu");
    const mini = document.getElementById("wsMiniBtn");
    btn.addEventListener("click", () => (menu.hidden ? openWsMenu() : closeWsMenu()));
    mini.addEventListener("click", () => (menu.hidden ? openWsMenu() : closeWsMenu()));
    document.getElementById("protoMini").addEventListener("click", openAbout);
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target) && !mini.contains(e.target)) closeWsMenu(); });
    renderWsMenu();
  }
  function renderWsMenu() {
    const menu = document.getElementById("wsMenu");
    document.getElementById("wsName").textContent = T.ws.label;
    document.getElementById("wsMiniName").textContent = T.ws.label;
    menu.replaceChildren(h("p", { class: "eyebrow", style: { margin: "6px 10px 8px" } }, "Espaços de demonstração"),
      ...T.workspaces.map((w) => h("button", { type: "button", role: "menuitemradio", "aria-checked": String(T.ws.id === w.id), onclick: () => { closeWsMenu(); if (T.ws.id !== w.id) switchWorkspace(w.id); } },
        h("b", null, w.label), h("span", null, w.sub))),
      h("p", { class: "small-note", style: { margin: "8px 10px 4px" } }, "Os dois usam dados sintéticos. Trocar de espaço reinicia as decisões da página."));
  }
  function openWsMenu() { const m = document.getElementById("wsMenu"); m.hidden = false; document.getElementById("wsBtn").setAttribute("aria-expanded", "true"); m.querySelector("button[aria-checked='true']")?.focus(); }
  function closeWsMenu() { document.getElementById("wsMenu").hidden = true; document.getElementById("wsBtn").setAttribute("aria-expanded", "false"); }

  function switchWorkspace(id) {
    const busy = document.getElementById("busy");
    busy.querySelector("p").textContent = id === "rede" ? "Gerando a rede ampliada no navegador: 10 tabelas, perfis e evidências…" : "Carregando a demonstração…";
    busy.hidden = false;
    setTimeout(() => {
      T.use(id);
      for (const n of order) {
        const el = document.getElementById("screen-" + n);
        el.replaceChildren();
        if (screens[n]) screens[n].inited = false;
      }
      renderWsMenu();
      buildPalette(true);
      updateNavCount();
      busy.hidden = true;
      const name = current || "mapa";
      current = null;
      show(name);
      UI.toast(`${T.ws.label}: ${T.ws.sub}${T.ws.buildMs > 50 ? ` · gerado em ${(T.ws.buildMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : ""}`);
      UI.announce(`Espaço trocado para ${T.ws.label}.`);
    }, 30);
  }

  function openAbout() {
    const box = document.getElementById("about");
    const li = (t) => h("li", null, t);
    box.replaceChildren(
      h("div", { class: "about-head" }, h("p", { class: "eyebrow ab", style: { margin: 0 } }, "Protótipo · direção Sobreposição"), h("h2", { id: "aboutTitle" }, "O que é real nesta página"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Fechar", onclick: closeAbout }, "✕")),
      h("div", { class: "about-cols" },
        h("section", null, h("h3", null, h("i", { class: "k k-fn" }), "Funciona aqui"), h("ul", null,
          li("Navegação entre mapa, perguntas e comparações; rastro; busca ⌘K por tabelas, cozinhas e períodos."),
          li("Mapa: zoom, deslocamento, três níveis de detalhe, arranjo automático dos grupos, foco na vizinhança e grupos que recolhem."),
          li("Abrir tabelas, campos, relações e registros originais; ver o que multiplica numa junção."),
          li("Confirmar, confirmar com ressalva (bloquear ou mostrar a multiplicação), rejeitar, corrigir colunas e desfazer, na memória da página."),
          li("Pergunta: trocar cada parte pelo teclado, comparar as três leituras com seus critérios, escolher uma e examinar os registros; agregação por mês com detalhe até o registro."),
          li("Comparação: escolher o que comparar, percorrer os quatro passos, abrir cada causa com critério, chave e registros, aceitar e desfazer a regra dos zeros."))),
        h("section", null, h("h3", null, h("i", { class: "k k-demo" }), "Calculado, mas demonstrativo"), h("ul", null,
          li("Todos os números são calculados no navegador sobre dados sintéticos: os CSVs da proposta ou a Rede ampliada, gerada com semente fixa. Nenhum vem do backend."),
          li("“Rastreada”, “execução” e “versão 2 da comparação” são simulações: nenhuma linhagem é gravada e nada é executado pelo motor."),
          li("Na Rede, a comparação desenha blocos de vários ids (o tamanho aparece no canto do gráfico); as contagens nos rótulos são exatas."),
          li("Nada é salvo. Recarregar ou trocar de espaço volta ao início."))),
        h("section", null, h("h3", null, h("i", { class: "k k-fut" }), "Depende do motor ou do modelo"), h("ul", null,
          li("Contagem de distintos e filtro de vigência (o motor só soma e conta linhas)."),
          li("Relação confirmada com ressalva e sua política: o compilador ainda não conhece cardinalidade nem status além de confirmada."),
          li("Destinos concorrentes, chave quase única e evidência de multiplicação na descoberta (hoje só destino 100% único)."),
          li("Vigência como decisão do modelo e leituras de período compiladas pelo motor."),
          li("Operação de comparação com unidade explícita, regras em ordem, versões e itens rastreáveis."),
          li("Regras de chave aceitas e versionadas (zeros à esquerda; caixa e espaços ainda não são testados)."),
          li("Prévia sem gravar linhagem, rastreio real e reaproveitamento de execuções."),
          li("Agregação e paginação no servidor para conjuntos grandes; aqui tudo roda na memória do navegador."),
          li("A Rede ampliada tem 85 mil atendimentos: acima do limite atual de importação (50 mil linhas por arquivo).")))));
    document.getElementById("aboutBack").hidden = false;
    setTimeout(() => box.querySelector(".icon-btn").focus(), 20);
  }
  function closeAbout() { document.getElementById("aboutBack").hidden = true; document.getElementById("protoBtn").focus(); }

  const DIAC = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
  const norm = (s) => s.normalize("NFD").replace(DIAC, "").toLowerCase();
  let entries = [];
  let active = 0;
  let paletteWired = false;
  function buildPalette() {
    const K = T.tables.cozinhas;
    const fk = T.ws.focusKitchen;
    const fkName = T.kitchen[fk].nome;
    entries = [
      { k: "Pergunta", t: `Quantos beneficiários estavam cadastrados na ${fkName} em 2025?`, kw: `${fkName} 2025 cadastrados beneficiarios ativos`, go: () => App.go("pergunta", { reset: true, kitchen: fk, year: 2025, source: "cadastro", reading: null }) },
      { k: "Pergunta", t: "Beneficiários atendidos por cozinha em 2025", kw: "atendidos por cozinha 2025 distintos", go: () => App.go("pergunta", { reset: true, kitchen: "all", year: 2025, source: "atendimento", reading: "served" }) },
      { k: "Pergunta", t: "Atendimentos por cozinha em 2025", kw: "linhas atendimentos por cozinha 2025", go: () => App.go("pergunta", { reset: true, kitchen: "all", year: 2025, source: "atendimento", measure: "rows", reading: "served" }) },
      { k: "Comparação", t: "Cadastro inteiro × atendidos em 2025", kw: "comparar cadastro atendidos divergencia diferenca", go: () => App.go("comparacao", { comparison: "all" }) },
      { k: "Comparação", t: "Ativos em 2025 × atendidos em 2025", kw: "comparar ativos atendidos divergencia diferenca periodo", go: () => App.go("comparacao", { comparison: "active" }) },
      ...T.relationships.map((r) => ({ k: "Relação", t: `${r.from}.${r.fromCol} → ${r.to}.${r.toCol}`, kw: `relacao ${r.from} ${r.to} ${r.role}`, go: () => App.go("mapa", { select: r.id }) })),
      { k: "Caminho", t: "Caminhos de atendimentos até cozinhas", kw: "caminhos path rotas", go: () => App.go("mapa", { mode: "paths" }) },
      ...Object.keys(T.schema).map((t) => ({ k: "Tabela", t: `${t}.csv · ${T.fmt(T.tables[t].length)} linhas`, kw: t + " tabela arquivo", go: () => App.go("mapa", { table: t }) })),
      ...K.map((k) => ({ k: "Cozinha", t: `Beneficiários da ${k.nome} em 2025`, kw: `${k.nome} ${k.municipio || ""} 2025 ${k.id}`, go: () => App.go("pergunta", { reset: true, kitchen: k.id, year: 2025, source: "cadastro", reading: null }) })),
    ];
    if (paletteWired) return;
    paletteWired = true;
    const input = document.getElementById("paletteInput");
    input.addEventListener("input", renderPalette);
    input.addEventListener("keydown", (e) => {
      const items = [...document.querySelectorAll("#paletteList button")];
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(items); }
      if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(items); }
      if (e.key === "Enter") { e.preventDefault(); items[active]?.click(); }
    });
    document.getElementById("openPalette").addEventListener("click", togglePalette);
    document.getElementById("paletteBack").addEventListener("click", (e) => { if (e.target.id === "paletteBack") closePalette(); });
  }
  function paint(items) {
    items.forEach((b, i) => b.setAttribute("aria-selected", i === active ? "true" : "false"));
    items[active]?.scrollIntoView({ block: "nearest" });
    document.getElementById("paletteInput").setAttribute("aria-activedescendant", items[active]?.id || "");
  }
  function mark(text, q) {
    if (!q.length) return text;
    const n = norm(text);
    const spans = [];
    q.forEach((w) => { const i = n.indexOf(w); if (i >= 0) spans.push([i, i + w.length]); });
    spans.sort((a, b) => a[0] - b[0]);
    const out = [];
    let p = 0;
    for (const [a, b] of spans) { if (a < p) continue; out.push(text.slice(p, a), h("mark", null, text.slice(a, b))); p = b; }
    out.push(text.slice(p));
    return out;
  }
  function renderPalette() {
    const q = norm(document.getElementById("paletteInput").value).split(/\s+/).filter(Boolean);
    const list = document.getElementById("paletteList");
    const hits = entries.filter((e) => q.every((w) => norm(e.t + " " + e.kw).includes(w))).slice(0, 14);
    active = 0;
    list.replaceChildren(...hits.map((e, i) => h("li", { role: "presentation" },
      h("button", { type: "button", role: "option", id: "pal-" + i, "aria-selected": i === 0 ? "true" : "false", onclick: () => { closePalette(); e.go(); } },
        h("span", { class: "k" }, e.k), h("span", { class: "t" }, mark(e.t, q))))));
    if (!hits.length) list.append(h("li", { style: { padding: "14px 12px", color: "var(--ink-3)" } }, "Nada no modelo corresponde a isso."));
  }
  function togglePalette() { document.getElementById("paletteBack").hidden ? openPalette() : closePalette(); }
  function openPalette() {
    document.getElementById("paletteBack").hidden = false;
    const input = document.getElementById("paletteInput");
    input.value = "";
    renderPalette();
    setTimeout(() => input.focus(), 10);
  }
  function closePalette() {
    document.getElementById("paletteBack").hidden = true;
    document.getElementById("openPalette").focus();
  }

  window.App = App;
})();
