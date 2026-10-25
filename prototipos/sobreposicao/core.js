(function () {
  "use strict";
  const nf = new Intl.NumberFormat("pt-BR");
  const fmt = (n) => nf.format(n);
  const pct = (x, d = 2) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
  const dateBR = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "·");
  const strip = (s) => s.replace(/^0+(?=.)/, "");
  const fold = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const DIAC = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

  function parse(t) {
    return t.csv.split("\n").map((line, i) => {
      const v = line.split(",");
      const o = { _line: i + 2 };
      t.header.forEach((h, j) => { o[h] = v[j] === "" || v[j] === undefined ? null : v[j]; });
      return o;
    });
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const msOf = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

  const SCHEMA_CORE = {
    cozinhas: { label: "Cozinhas", singular: "cozinha", plural: "cozinhas", grain: "1 linha = 1 cozinha", key: "id" },
    beneficiarios: { label: "Beneficiários", singular: "beneficiário", plural: "beneficiários", grain: "1 linha = 1 beneficiário", key: "id", validity: ["data_cadastro", "data_desligamento"] },
    atendimentos: { label: "Atendimentos", singular: "atendimento", plural: "atendimentos", grain: "1 linha = 1 atendimento", key: "id" },
  };

  function buildDemo() {
    const D = window.TRACE_DATA;
    const tables = { cozinhas: parse(D.cozinhas), beneficiarios: parse(D.beneficiarios), atendimentos: parse(D.atendimentos) };
    tables.atendimentos.forEach((r) => { r.refeicoes = r.refeicoes === null ? null : Number(r.refeicoes); });
    const schema = {
      cozinhas: Object.assign({ file: "cozinhas.csv", columns: [
        { key: "id", type: "identifier", role: "key" }, { key: "nome", type: "text", role: "label" },
        { key: "municipio", type: "text", role: "category" }, { key: "status", type: "text", role: "category", note: "estado atual, sem data de mudança" }] }, SCHEMA_CORE.cozinhas),
      beneficiarios: Object.assign({ file: "beneficiarios.csv", columns: [
        { key: "id", type: "identifier", role: "key" }, { key: "nome", type: "text", role: "label" }, { key: "cozinha_id", type: "identifier", role: "fk" },
        { key: "data_cadastro", type: "date", role: "validity-start" }, { key: "data_desligamento", type: "date", role: "validity-end" }] }, SCHEMA_CORE.beneficiarios),
      atendimentos: Object.assign({ file: "atendimentos.csv", columns: [
        { key: "id", type: "identifier", role: "key" }, { key: "data", type: "date", role: "event-date" }, { key: "beneficiario_id", type: "identifier", role: "fk" },
        { key: "cozinha_id", type: "identifier", role: "fk" }, { key: "refeicoes", type: "number", role: "measure" }] }, SCHEMA_CORE.atendimentos),
    };
    return {
      id: "demo", label: "Demonstração", sub: "3 tabelas · 11 mil linhas · CSVs da proposta", tables, schema, groups: null,
      relationships: [
        { id: "r1", from: "atendimentos", fromCol: "beneficiario_id", to: "beneficiarios", toCol: "id", role: "beneficiário do atendimento" },
        { id: "r2", from: "atendimentos", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha do atendimento" },
        { id: "r3", from: "beneficiarios", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha de referência" },
      ],
      focusKitchen: "0101", year: 2025, kitchenField: "nome",
    };
  }

  const MUNIS = ["Fortaleza", "Caucaia", "Maracanaú", "Sobral", "Juazeiro do Norte", "Crato", "Iguatu", "Quixadá", "Itapipoca", "Maranguape", "Crateús", "Aquiraz", "Canindé", "Russas", "Pacatuba", "Tianguá", "Aracati", "Cascavel", "Icó", "Horizonte", "Camocim", "Morada Nova", "Acaraú", "Viçosa do Ceará"];
  const KNAMES = ["Esperança", "Girassol", "Mandacaru", "Aurora", "Sol Nascente", "Novo Horizonte", "Primavera", "Cajueiro", "Carnaúba", "Jangada", "Juriti", "Maré", "Bem-te-vi", "Baobá", "Caatinga", "Sertão Vivo", "Pôr do Sol", "Mangue", "Pitanga", "Acerola", "Cajá", "Umbu", "Graviola", "Jucá", "Ipê Amarelo", "Oiticica", "Juazeiro", "Aroeira", "Angico", "Pau-Branco", "Jandaia", "Asa Branca", "Sabiá", "Carcará", "Galo de Campina", "Rendeira", "Labirinto", "Bordado", "Barro Vermelho", "Ladeira", "Vila Nova", "Boa Vista", "Alto Alegre", "Bela Vista", "Santa Luzia", "São Bento", "Lagoa Seca", "Riacho Fundo", "Serra Azul", "Pedra Branca", "Mar Azul", "Dunas", "Vento Leste", "Farol", "Areia Branca", "Coqueiral", "Maracajá", "Cacimba", "Açude Velho", "Várzea"];
  const PRODS = ["arroz", "feijão", "macarrão", "farinha", "óleo", "frango", "carne moída", "ovos", "leite", "cuscuz", "batata", "cebola", "tomate", "cenoura", "abóbora", "banana", "laranja", "sal", "açúcar", "café"];

  function buildRede() {
    const R = mulberry(20251024);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const between = (a, b) => iso(msOf(a) + Math.floor(R() * ((msOf(b) - msOf(a)) / DAY + 1)) * DAY);
    const pad = (n, w) => String(n).padStart(w, "0");

    const municipios = MUNIS.map((n, i) => ({ _line: i + 2, id: "23" + pad(10 + i * 7, 5), nome: n, regiao: ["Metropolitana", "Norte", "Sul", "Sertão Central", "Jaguaribe"][i % 5] }));
    const cozinhas = KNAMES.map((n, i) => ({ _line: i + 2, id: "C" + pad(i + 1, 3), nome: "Cozinha " + n, municipio_id: municipios[i % municipios.length].id, status: [11, 23, 34, 45, 52, 58].includes(i) ? "inativa" : "ativa", capacidade: String(120 + ((i * 37) % 280)) }));
    const familias = [];
    for (let i = 1; i <= 9400; i++) familias.push({ _line: i + 1, id: pad(i, 6), responsavel: "Família " + pad(i, 6), bairro: "Bairro " + (1 + (i % 140)) });
    const turnos = [{ _line: 2, id: "1", nome: "café da manhã" }, { _line: 3, id: "2", nome: "almoço" }, { _line: 4, id: "3", nome: "jantar" }];
    const produtos = [];
    for (let i = 1; i <= 140; i++) produtos.push({ _line: i + 1, id: String(i), nome: `${PRODS[i % PRODS.length]} ${1 + Math.floor(i / PRODS.length)}`, categoria: ["grãos", "proteína", "hortifruti", "laticínios", "mercearia"][i % 5] });
    const fornecedores = [];
    for (let i = 1; i <= 85; i++) fornecedores.push({ _line: i + 1, id: "FORN-" + pad(i, 3), nome: "Fornecedor " + pad(i, 3), cnpj: pad(10000000 + i * 7919, 8) + "0001" + pad(i % 97, 2) });

    const kWeights = cozinhas.map((k, i) => (k.status === "inativa" ? 0.5 : 1) * (0.6 + ((i * 53) % 100) / 100));
    const kTotal = kWeights.reduce((a, b) => a + b, 0);
    const pickK = () => { let x = R() * kTotal; for (let i = 0; i < cozinhas.length; i++) { x -= kWeights[i]; if (x <= 0) return cozinhas[i].id; } return cozinhas[0].id; };

    const STRIP_K = "C017";
    const beneficiarios = [];
    const people = [];
    let noService = 0, line = 2;
    for (let i = 1; i <= 24000; i++) {
      const id = pad(i, 6);
      const k = pickK();
      const r = R();
      let cad, desl = null;
      if (r < 0.07) { cad = between("2021-01-01", "2023-06-30"); desl = between(iso(msOf(cad) + 60 * DAY), "2024-12-31"); }
      else if (r < 0.09) { cad = between("2026-01-01", "2026-01-31"); }
      else if (r < 0.62) { cad = between("2021-01-01", "2024-12-31"); if (R() < 0.18) desl = between("2025-02-01", "2025-12-20"); }
      else { cad = between("2025-01-01", "2025-11-30"); if (R() < 0.08) desl = between(iso(msOf(cad) + 40 * DAY), "2025-12-20"); }
      if (desl && desl <= cad) desl = null;
      const familia = String(1 + Math.floor(R() * 9480)).padStart(6, "0");
      const row = { _line: line++, id, nome: "Pessoa " + id, cozinha_id: R() < 0.0035 ? null : k, familia_id: familia, data_cadastro: cad, data_desligamento: desl };
      beneficiarios.push(row);
      const active = cad <= "2025-12-31" && (!desl || desl >= "2025-01-01");
      let served = active;
      if (active && noService < 1012 && R() < 0.05) { served = false; noService++; }
      people.push({ row, active, served });
      if (i % 197 === 0) beneficiarios.push(Object.assign({}, row, { _line: line++ }));
    }

    const atendimentos = [];
    const atts = [];
    for (const p of people) {
      if (!p.served) continue;
      const r = p.row;
      const a = r.data_cadastro > "2025-01-01" ? r.data_cadastro : "2025-01-01";
      const b = r.data_desligamento && r.data_desligamento < "2025-12-31" ? r.data_desligamento : "2025-12-31";
      if (a > b) continue;
      const n = 1 + Math.floor(R() * 7);
      const home = r.cozinha_id || pickK();
      const written = home === STRIP_K ? strip(r.id) : r.id;
      for (let j = 0; j < n; j++) {
        const away = home !== STRIP_K && R() < 0.03;
        atts.push([between(a, b), away ? pickK() : home, written]);
      }
    }
    for (let i = 0; i < 1000; i++) {
      const id = pad(30001 + i, 6);
      const k = pickK();
      const n = 1 + Math.floor(R() * 4);
      for (let j = 0; j < n; j++) atts.push([between("2025-01-01", "2025-12-31"), k === STRIP_K ? "C016" : k, id]);
    }
    atts.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    atts.forEach((x, i) => atendimentos.push({ _line: i + 2, id: pad(i + 1, 7), data: x[0], beneficiario_id: x[2], cozinha_id: x[1], turno_id: String(1 + Math.floor(R() * 3)), refeicoes: R() < 0.15 ? 2 : 1 }));

    const entregas = [];
    for (let i = 1; i <= 5200; i++) {
      const f = pick(fornecedores).id;
      const v = R();
      const fid = v < 0.01 ? null : v < 0.04 ? f.toLowerCase() : v < 0.06 ? f + " " : f;
      entregas.push({ _line: i + 1, id: pad(i, 6), data: between("2025-01-01", "2025-12-31"), cozinha_id: pickK(), fornecedor_id: fid, produto_id: String(1 + Math.floor(R() * 140)), quantidade_kg: String(5 + Math.floor(R() * 120)) });
    }
    const repasses = [];
    let rl = 2;
    for (const k of cozinhas) for (let m = 1; m <= 12; m++) {
      repasses.push({ _line: rl, id: pad(rl - 1, 5), cozinha_id: R() < 0.04 ? k.id.toLowerCase() : k.id, mes: `2025-${pad(m, 2)}`, valor: String(8000 + Math.floor(R() * 9000)), refeicoes_informadas: String(900 + Math.floor(R() * 2600)) });
      rl++;
    }

    const id = (k) => ({ key: k, type: "identifier", role: "key" });
    const fk = (k) => ({ key: k, type: "identifier", role: "fk" });
    const tx = (k, role = "label") => ({ key: k, type: "text", role });
    const schema = {
      municipios: { label: "Municípios", singular: "município", plural: "municípios", grain: "1 linha = 1 município", key: "id", file: "municipios.csv", group: "rede", columns: [id("id"), tx("nome"), tx("regiao", "category")] },
      cozinhas: Object.assign({}, SCHEMA_CORE.cozinhas, { file: "cozinhas.csv", group: "rede", columns: [id("id"), tx("nome"), fk("municipio_id"), tx("status", "category"), { key: "capacidade", type: "number", role: "measure" }] }),
      beneficiarios: Object.assign({}, SCHEMA_CORE.beneficiarios, { file: "beneficiarios.csv", group: "atendimento", columns: [id("id"), tx("nome"), fk("cozinha_id"), fk("familia_id"), { key: "data_cadastro", type: "date", role: "validity-start" }, { key: "data_desligamento", type: "date", role: "validity-end" }] }),
      familias: { label: "Famílias", singular: "família", plural: "famílias", grain: "1 linha = 1 família", key: "id", file: "familias.csv", group: "atendimento", columns: [id("id"), tx("responsavel"), tx("bairro", "category")] },
      atendimentos: Object.assign({}, SCHEMA_CORE.atendimentos, { file: "atendimentos.csv", group: "atendimento", columns: [id("id"), { key: "data", type: "date", role: "event-date" }, fk("beneficiario_id"), fk("cozinha_id"), fk("turno_id"), { key: "refeicoes", type: "number", role: "measure" }] }),
      turnos: { label: "Turnos", singular: "turno", plural: "turnos", grain: "1 linha = 1 turno", key: "id", file: "turnos.csv", group: "atendimento", columns: [id("id"), tx("nome")] },
      entregas: { label: "Entregas", singular: "entrega", plural: "entregas", grain: "1 linha = 1 entrega", key: "id", file: "entregas.csv", group: "abastecimento", columns: [id("id"), { key: "data", type: "date", role: "event-date" }, fk("cozinha_id"), fk("fornecedor_id"), fk("produto_id"), { key: "quantidade_kg", type: "number", role: "measure" }] },
      fornecedores: { label: "Fornecedores", singular: "fornecedor", plural: "fornecedores", grain: "1 linha = 1 fornecedor", key: "id", file: "fornecedores.csv", group: "abastecimento", columns: [id("id"), tx("nome"), tx("cnpj")] },
      produtos: { label: "Produtos", singular: "produto", plural: "produtos", grain: "1 linha = 1 produto", key: "id", file: "produtos.csv", group: "abastecimento", columns: [id("id"), tx("nome"), tx("categoria", "category")] },
      repasses: { label: "Repasses", singular: "repasse", plural: "repasses", grain: "1 linha = 1 repasse mensal", key: "id", file: "repasses.csv", group: "financeiro", columns: [id("id"), fk("cozinha_id"), { key: "mes", type: "text", role: "category" }, { key: "valor", type: "number", role: "measure" }, { key: "refeicoes_informadas", type: "number", role: "measure" }] },
    };
    for (const r of atendimentos) r.refeicoes = Number(r.refeicoes);
    return {
      id: "rede", label: "Rede ampliada", sub: "10 tabelas · 125 mil linhas · gerado no navegador (semente fixa)",
      tables: { municipios, cozinhas, beneficiarios, familias, atendimentos, turnos, entregas, fornecedores, produtos, repasses }, schema,
      groups: [
        { id: "rede", label: "Rede de cozinhas" }, { id: "atendimento", label: "Atendimento" },
        { id: "abastecimento", label: "Abastecimento" }, { id: "financeiro", label: "Repasses" },
      ],
      relationships: [
        { id: "r1", from: "atendimentos", fromCol: "beneficiario_id", to: "beneficiarios", toCol: "id", role: "beneficiário do atendimento" },
        { id: "r2", from: "atendimentos", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha do atendimento" },
        { id: "r3", from: "beneficiarios", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha de referência" },
        { id: "r4", from: "cozinhas", fromCol: "municipio_id", to: "municipios", toCol: "id", role: "município da cozinha" },
        { id: "r5", from: "beneficiarios", fromCol: "familia_id", to: "familias", toCol: "id", role: "família do beneficiário" },
        { id: "r5b", from: "beneficiarios", fromCol: "familia_id", to: "beneficiarios", toCol: "id", role: "outro beneficiário?" },
        { id: "r6", from: "atendimentos", fromCol: "turno_id", to: "turnos", toCol: "id", role: "turno do atendimento" },
        { id: "r6b", from: "atendimentos", fromCol: "turno_id", to: "produtos", toCol: "id", role: "produto?" },
        { id: "r7", from: "entregas", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha da entrega" },
        { id: "r8", from: "entregas", fromCol: "fornecedor_id", to: "fornecedores", toCol: "id", role: "fornecedor da entrega" },
        { id: "r9", from: "entregas", fromCol: "produto_id", to: "produtos", toCol: "id", role: "produto entregue" },
        { id: "r10", from: "repasses", fromCol: "cozinha_id", to: "cozinhas", toCol: "id", role: "cozinha do repasse" },
      ],
      focusKitchen: "C001", year: 2025,
    };
  }

  function profile(rows, col) {
    const counts = new Map();
    let nulls = 0;
    for (const r of rows) {
      const v = r[col.key];
      if (v === null || v === undefined) { nulls++; continue; }
      const s = String(v);
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    const nonNull = rows.length - nulls;
    const dups = [];
    for (const [v, c] of counts) if (c > 1) dups.push([v, c]);
    const p = { rows: rows.length, nonNull, nulls, distinct: counts.size, unique: dups.length === 0 && nulls === 0, dupValues: dups.length, dupExtraRows: dups.reduce((s, [, c]) => s + c - 1, 0), dupList: dups.map(([v]) => v) };
    if (col.type === "identifier") {
      const lens = new Map();
      let variant = 0, variantVals = 0, upper = 0;
      for (const v of counts.keys()) if (/[A-Z]/.test(v)) upper++;
      const mostlyUpper = upper > counts.size / 2;
      for (const [v, c] of counts) { lens.set(v.length, (lens.get(v.length) || 0) + c); if (v !== v.trim() || (mostlyUpper && /[a-z]/.test(v))) { variant += c; variantVals++; } }
      const modal = [...lens.entries()].sort((a, b) => b[1] - a[1])[0];
      const short = [...counts.entries()].filter(([v]) => modal && v.length < modal[0] && /^\d+$/.test(v));
      p.modalLength = modal ? modal[0] : 0;
      p.shortRows = short.reduce((s, [, c]) => s + c, 0);
      p.shortValues = short.length;
      p.variantRows = variant;
      p.variantValues = variantVals;
    }
    if (col.type === "date") {
      const months = new Map();
      let min = null, max = null;
      for (const [v, c] of counts) { const m = v.slice(0, 7); months.set(m, (months.get(m) || 0) + c); if (!min || v < min) min = v; if (!max || v > max) max = v; }
      p.min = min; p.max = max;
      p.months = [...months.keys()].sort().map((k) => [k, months.get(k)]);
    }
    if (col.type === "number") {
      if (counts.size <= 12) p.values = [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
      let sum = 0, mn = Infinity, mx = -Infinity;
      for (const [v, c] of counts) { const n = Number(v); sum += n * c; if (n < mn) mn = n; if (n > mx) mx = n; }
      p.sum = sum; p.minN = mn; p.maxN = mx;
    }
    if (col.role === "category" || col.role === "fk" || (col.type === "text" && counts.size <= 30)) {
      p.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    }
    return p;
  }

  function evidence(ws, r) {
    const fromRows = ws.tables[r.from], toRows = ws.tables[r.to];
    const toIndex = new Map();
    for (const x of toRows) { const v = x[r.toCol]; if (v === null || v === undefined) continue; if (!toIndex.has(v)) toIndex.set(v, []); toIndex.get(v).push(x); }
    const byStrip = new Map(), byFold = new Map();
    for (const v of toIndex.keys()) {
      const s = strip(v); if (!byStrip.has(s)) byStrip.set(s, []); byStrip.get(s).push(v);
      const f = fold(v); if (!byFold.has(f)) byFold.set(f, []); byFold.get(f).push(v);
    }
    const e = { rows: fromRows.length, matchedRows: 0, nullRows: 0, nearRows: 0, noneRows: 0, joinedRows: 0, near: [], none: [], nulls: [], unmatched: [] };
    const fromCounts = new Map(), matchedDistinct = new Set(), nearMap = new Map(), noneDistinct = new Set(), referenced = new Set();
    for (const x of fromRows) {
      const v = x[r.fromCol];
      if (v === null || v === undefined) { e.nullRows++; e.nulls.push(x); continue; }
      fromCounts.set(v, (fromCounts.get(v) || 0) + 1);
      const m = toIndex.get(v);
      if (m) { e.matchedRows++; matchedDistinct.add(v); referenced.add(v); e.joinedRows += m.length; continue; }
      let cand = (byStrip.get(strip(v)) || []).filter((c) => c !== v), kind = "zeros";
      if (cand.length !== 1) { cand = (byFold.get(fold(v)) || []).filter((c) => c !== v); kind = "caixa ou espaço"; }
      if (cand.length === 1) { e.nearRows++; nearMap.set(v, { cand: cand[0], kind }); e.near.push(x); }
      else { e.noneRows++; noneDistinct.add(v); e.none.push(x); }
      e.unmatched.push(x);
    }
    const toDups = [...toIndex.entries()].filter(([, l]) => l.length > 1);
    const fromDistinct = fromCounts.size;
    const fromUnique = fromDistinct === e.rows - e.nullRows;
    const toUnique = toDups.length === 0;
    const nearKinds = {};
    for (const { kind } of nearMap.values()) nearKinds[kind] = (nearKinds[kind] || 0) + 1;
    Object.assign(e, {
      fromDistinct, fromUnique, matchedDistinct: matchedDistinct.size, nearDistinct: nearMap.size, nearPairs: [...nearMap.entries()].map(([v, o]) => [v, o.cand, o.kind]), nearKinds, noneDistinct: noneDistinct.size, noneValues: [...noneDistinct],
      toRows: toRows.length, toDistinct: toIndex.size, toUnique, toDupIds: toDups.map(([k]) => k), toDupRows: toDups.reduce((s, [, l]) => s + l.length, 0),
      ratio: e.matchedRows / Math.max(1, e.rows - e.nullRows),
      valueRatio: matchedDistinct.size / Math.max(1, fromDistinct),
    });
    e.unreferencedRows = toRows.filter((x) => x[r.toCol] !== null && x[r.toCol] !== undefined && !referenced.has(x[r.toCol]));
    e.unreferenced = [...new Set(e.unreferencedRows.map((x) => x[r.toCol]))];
    e.extraJoinRows = e.joinedRows - e.matchedRows;
    e.joinEffect = toDups.filter(([k]) => fromCounts.has(k)).map(([k, l]) => ({ key: k, toRows: l.length, fromRows: fromCounts.get(k), after: fromCounts.get(k) * l.length }));
    e.cardinality = toUnique ? (fromUnique ? "1:1" : "N:1") : "N:N";
    e.expected = "N:1";
    const toKeyCol = ws.schema[r.to].columns.find((c) => c.key === r.toCol);
    e.toIsKey = !!toKeyCol && toKeyCol.role === "key";
    e.coincidence = fromDistinct <= 12 && e.toDistinct >= fromDistinct * 8;
    const stem = (s) => s.replace(/_id$/, "").replace(/s$/, "");
    e.nameHint = stem(r.fromCol) === stem(r.to) || r.fromCol.startsWith(ws.schema[r.to].singular.normalize("NFD").replace(DIAC, "").slice(0, 5));
    return e;
  }

  const readings = {
    started: { key: "started", label: "começaram em", long: "Começaram em", rule: (y) => `data_cadastro entre 01/01/${y} e 31/12/${y}`, why: "whyStarted",
      inc: (y) => `entra quem tem data_cadastro de 01/01/${y} a 31/12/${y}`, exc: (y) => `fica de fora quem foi cadastrado antes ou depois de ${y}, mesmo que estivesse ativo` },
    activeAny: { key: "activeAny", label: "estavam ativos em algum momento de", long: "Ativos em algum momento de", rule: (y) => `cadastro até 31/12/${y} e sem desligamento antes de 01/01/${y}`, why: "whyAny",
      inc: (y) => `entra quem tem data_cadastro até 31/12/${y} e data_desligamento vazia ou a partir de 01/01/${y}`, exc: (y) => `fica de fora quem foi desligado antes de ${y} ou cadastrado depois` },
    activeEnd: { key: "activeEnd", label: "estavam ativos em 31/12 de", long: "Ativos em 31/12 de", rule: (y) => `cadastro até 31/12/${y} e sem desligamento até essa data`, why: "whyEnd",
      inc: (y) => `entra quem tem data_cadastro até 31/12/${y} e data_desligamento vazia ou depois de 31/12/${y}`, exc: (y) => `fica de fora quem saiu durante ${y}, saiu antes ou entrou depois` },
  };

  function vigencia(rows, year) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    return rows.map((r) => {
      const cad = r.data_cadastro, desl = r.data_desligamento;
      const started = cad >= start && cad <= end;
      const activeAny = cad <= end && (desl === null || desl >= start);
      const activeEnd = cad <= end && (desl === null || desl > end);
      let whyAny = null, whyEnd = null, whyStarted = null;
      if (!activeAny) whyAny = desl !== null && desl < start ? `desligado antes de ${year}` : `cadastrado depois de ${year}`;
      if (!activeEnd) whyEnd = whyAny || `desligado durante ${year}`;
      if (!started) whyStarted = cad < start ? `cadastrado antes de ${year}` : `cadastrado depois de ${year}`;
      return { row: r, started, activeAny, activeEnd, whyAny, whyEnd, whyStarted };
    });
  }

  function reconcile(ws, opts = {}) {
    const year = opts.year || 2025;
    const acceptZeros = !!opts.acceptZeros;
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const allA = ws.tables.beneficiarios;
    const filterA = opts.aFilter === "activeYear";
    const aFiltered = [];
    const aExcluded = { before: [], after: [] };
    for (const r of allA) {
      if (filterA) {
        if (r.data_desligamento !== null && r.data_desligamento < start) { aExcluded.before.push(r); continue; }
        if (r.data_cadastro > end) { aExcluded.after.push(r); continue; }
      }
      aFiltered.push(r);
    }
    const firstRow = new Map();
    const dupRows = [];
    for (const r of aFiltered) { if (firstRow.has(r.id)) dupRows.push(r); else firstRow.set(r.id, r); }
    const aKeys = new Set(firstRow.keys());
    const bMap = new Map();
    let bRows = 0;
    for (const a of ws.tables.atendimentos) {
      if (a.data < start || a.data > end) continue;
      bRows++;
      if (!bMap.has(a.beneficiario_id)) bMap.set(a.beneficiario_id, []);
      bMap.get(a.beneficiario_id).push(a);
    }
    const bKeys = new Set(bMap.keys());
    const both = [];
    for (const k of aKeys) if (bKeys.has(k)) both.push(k);
    const aOnly = [], bOnly = [];
    for (const k of aKeys) if (!bKeys.has(k)) aOnly.push(k);
    for (const k of bKeys) if (!aKeys.has(k)) bOnly.push(k);
    const aOnlyByStrip = new Map(), bOnlyByStrip = new Map();
    aOnly.forEach((k) => { const s = strip(k); if (!aOnlyByStrip.has(s)) aOnlyByStrip.set(s, []); aOnlyByStrip.get(s).push(k); });
    bOnly.forEach((k) => { const s = strip(k); if (!bOnlyByStrip.has(s)) bOnlyByStrip.set(s, []); bOnlyByStrip.get(s).push(k); });
    const allAByStrip = new Map();
    for (const k of aKeys) { const s = strip(k); if (!allAByStrip.has(s)) allAByStrip.set(s, []); allAByStrip.get(s).push(k); }

    const pairs = [], pairedA = new Map(), pairedB = new Map();
    for (const k of bOnly) {
      const c = (aOnlyByStrip.get(strip(k)) || []).filter((x) => x !== k);
      const back = c.length === 1 ? (bOnlyByStrip.get(strip(c[0])) || []).filter((x) => x !== c[0]) : [];
      if (c.length === 1 && back.length === 1) { pairs.push({ a: c[0], b: k }); pairedA.set(c[0], k); pairedB.set(k, c[0]); }
    }
    pairs.sort((x, y) => x.a.localeCompare(y.a));

    const cat = {
      before: { key: "before", side: "a", proof: "proven", rule: 2, title: `desligados antes de ${year}`, sub: "fora do período de B", items: [], criterion: `data_desligamento < 01/01/${year}` },
      after: { key: "after", side: "a", proof: "proven", rule: 2, title: `cadastrados depois de ${year}`, sub: "fora do período de B", items: [], criterion: `data_cadastro > 31/12/${year}` },
      hypA: { key: "hypA", side: "a", proof: "possible", rule: 3, title: "possível: id sem zeros", sub: "o mesmo número aparece em B sem os zeros à esquerda", items: [], criterion: "não existe em B, mas o id sem zeros à esquerda existe em B, e é o único candidato" },
      noService: { key: "noService", side: "a", proof: "proven", rule: 4, title: "sem nenhum atendimento", sub: `nenhum atendimento em ${year} com esse id`, items: [], criterion: `nenhum beneficiario_id igual em ${year}, nem igual depois de tirar zeros à esquerda` },
      hypB: { key: "hypB", side: "b", proof: "possible", rule: 3, title: "possível: id sem zeros", sub: "par provável de um cadastro com zeros à esquerda", items: [], criterion: "não existe em A, mas com zeros à esquerda existe em A, e é o único candidato" },
      noReg: { key: "noReg", side: "b", proof: "proven", rule: 4, title: "sem cadastro", sub: "nenhum cadastro com esse id", items: [], criterion: "nenhum id igual no cadastro, nem igual depois de tirar zeros à esquerda" },
    };
    const matchedViaRule = [];
    for (const k of aOnly) {
      const r = firstRow.get(k);
      if (!filterA && r.data_desligamento !== null && r.data_desligamento < start) { cat.before.items.push({ id: k, row: r }); continue; }
      if (!filterA && r.data_cadastro > end) { cat.after.items.push({ id: k, row: r }); continue; }
      if (pairedA.has(k)) { if (acceptZeros) matchedViaRule.push({ a: k, b: pairedA.get(k) }); else cat.hypA.items.push({ id: k, row: r, pair: pairedA.get(k) }); continue; }
      cat.noService.items.push({ id: k, row: r });
    }
    for (const k of bOnly) {
      if (pairedB.has(k)) { if (!acceptZeros) cat.hypB.items.push({ id: k, att: bMap.get(k), pair: pairedB.get(k) }); continue; }
      cat.noReg.items.push({ id: k, att: bMap.get(k) });
    }
    const divergent = [];
    for (const k of both) {
      const ref = firstRow.get(k).cozinha_id;
      const ks = new Set(bMap.get(k).map((a) => a.cozinha_id));
      if ([...ks].some((x) => x !== ref)) divergent.push({ id: k, ref, kitchens: [...ks], onlyElsewhere: !ks.has(ref) });
    }
    const aOnlyCount = cat.before.items.length + cat.after.items.length + cat.hypA.items.length + cat.noService.items.length;
    const bOnlyCount = cat.hypB.items.length + cat.noReg.items.length;
    const matched = both.length + matchedViaRule.length;
    const res = {
      year, acceptZeros, aFilter: opts.aFilter || null, aRowsTotal: allA.length, aExcluded, aCount: aFiltered.length, dupRows, aDistinct: aKeys.size, bRows, bDistinct: bKeys.size,
      both, matched, matchedViaRule, aOnlyCount, bOnlyCount, cat, pairs, divergent, bMap, firstRow,
    };
    res.closesIds = res.aDistinct - aOnlyCount + bOnlyCount === res.bDistinct;
    res.closesRows = res.aCount - dupRows.length === res.aDistinct;
    res.netDiff = res.aDistinct - res.bDistinct;
    res.unmatched = aOnlyCount + bOnlyCount;
    return res;
  }

  const WS = {};
  const builders = { demo: buildDemo, rede: buildRede };
  const T = {
    fmt, pct, dateBR, strip, fold, readings, vigencia,
    workspaces: [{ id: "demo", label: "Demonstração", sub: "3 tabelas · CSVs da proposta" }, { id: "rede", label: "Rede ampliada", sub: "10 tabelas · 125 mil linhas" }],
    model: { validityConfirmed: false },
  };

  function use(id) {
    if (!WS[id]) {
      const t0 = performance.now();
      const ws = builders[id]();
      ws.profiles = {};
      for (const t of Object.keys(ws.schema)) { ws.profiles[t] = {}; for (const c of ws.schema[t].columns) ws.profiles[t][c.key] = profile(ws.tables[t], c); }
      ws.relationships.forEach((r) => { r.status = "suggested"; r.decision = null; r.ev = evidence(ws, r); });
      for (const r of ws.relationships) r.competitors = ws.relationships.filter((x) => x !== r && x.from === r.from && x.fromCol === r.fromCol).map((x) => x.id);
      ws.kitchen = Object.fromEntries(ws.tables.cozinhas.map((k) => [k.id, k]));
      ws.benById = new Map();
      for (const r of ws.tables.beneficiarios) if (!ws.benById.has(r.id)) ws.benById.set(r.id, r);
      ws.attByBen = new Map();
      for (const a of ws.tables.atendimentos) { if (!ws.attByBen.has(a.beneficiario_id)) ws.attByBen.set(a.beneficiario_id, []); ws.attByBen.get(a.beneficiario_id).push(a); }
      ws.validityConfirmed = false;
      ws.buildMs = Math.round(performance.now() - t0);
      WS[id] = ws;
    }
    const ws = WS[id];
    T.ws = ws;
    T.tables = ws.tables; T.schema = ws.schema; T.profiles = ws.profiles; T.relationships = ws.relationships;
    T.kitchen = ws.kitchen; T.benById = ws.benById; T.attByBen = ws.attByBen; T.groups = ws.groups;
    return ws;
  }

  T.use = use;
  T.evidence = (from, fromCol, to, toCol) => evidence(T.ws, { from, fromCol, to, toCol });
  T.reconcile = (opts) => reconcile(T.ws, opts);
  T.countReading = (rows, year, reading) => { const v = vigencia(rows, year); const inRows = v.filter((x) => x[reading]); return { rows: inRows.length, distinct: new Set(inRows.map((x) => x.row.id)).size, detail: v }; };
  T.usable = (r) => r.status === "confirmed" || r.status === "caveat";
  T.paths = (a, b) => {
    const out = [];
    const walk = (node, seen, trail) => {
      if (node === b && trail.length) { out.push(trail.slice()); return; }
      for (const r of T.relationships) {
        if (r.status === "rejected" || r.from === r.to) continue;
        let next = null;
        if (r.from === node) next = r.to; else if (r.to === node) next = r.from;
        if (!next || seen.has(next)) continue;
        seen.add(next); trail.push(r); walk(next, seen, trail); trail.pop(); seen.delete(next);
      }
    };
    walk(a, new Set([a]), []);
    return out.sort((x, y) => x.length - y.length).slice(0, 6);
  };
  T.pathDisagreement = () => {
    let compared = 0, differ = 0;
    const people = new Set();
    for (const a of T.tables.atendimentos) {
      const b = T.benById.get(a.beneficiario_id);
      if (!b) continue;
      compared++;
      if (b.cozinha_id !== a.cozinha_id) { differ++; people.add(a.beneficiario_id); }
    }
    return { compared, differ, people: people.size };
  };
  T.relStatusWord = (st) => ({ suggested: "sugerida", confirmed: "confirmada", caveat: "confirmada com ressalva", rejected: "rejeitada" })[st];

  window.Trace = T;
  use("demo");
})();
