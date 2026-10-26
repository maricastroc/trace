import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, type ScenarioKey } from "./scenario";

const shared: Partial<Record<ScenarioKey, string>> = {};

const REFERENCE = "Por que 1.242 identidades em Beneficiários e 1.196 em Atendimentos com data em 2025?";

async function fresh(page: Page, request: APIRequestContext, scenario: ScenarioKey, own = false) {
  let token = own ? undefined : shared[scenario];
  if (!token) {
    const created = await request.post(`${API_URL}/workspaces`, { data: { scenario }, headers: { Accept: "application/json" } });
    expect(created.ok(), `workspace → ${created.status()}`).toBe(true);
    token = ((await created.json()) as { data: { token: string } }).data.token;
    if (!own) shared[scenario] = token;
  }
  await page.addInitScript(
    ([fresh, key]) => {
      const tokens = JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}");
      localStorage.setItem("trace.workspace-tokens", JSON.stringify({ ...tokens, [key]: fresh }));
      localStorage.setItem("trace.scenario", key);
    },
    [token, scenario],
  );
  const headers = { "X-Trace-Workspace": token, Accept: "application/json" };
  const call = async <T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
    const response = await request.fetch(`${API_URL}${path}`, { method, headers, data });
    expect(response.ok(), `${method} ${path} → ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  };
  const datasets = async () =>
    Object.fromEntries((await call<{ data: { id: string; key: string; latest_version: { id: string } }[] }>("GET", "/datasets")).data.map((d) => [d.key, d]));
  const send = async (path: string, name: string, csv: string) => {
    const response = await request.post(`${API_URL}${path}`, { headers, multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from(csv) } } });
    expect(response.ok(), `upload → ${response.status()}`).toBe(true);
  };
  return {
    call,
    datasets,
    async create(key: string, csv: string) {
      await send("/datasets", `${key}.csv`, csv);
    },
    async upload(key: string, csv: string) {
      await send(`/datasets/${(await datasets())[key].id}/versions`, `${key}.csv`, csv);
    },
    async rows(key: string) {
      const dataset = (await datasets())[key];
      return (await call<{ data: { values: Record<string, string | null> }[] }>("GET", `/dataset-versions/${dataset.latest_version.id}/rows?per_page=100`)).data.map(
        (row) => row.values,
      );
    },
    async waitRun(path: string) {
      await expect.poll(async () => (await call<{ data: { status: string } }>("GET", path)).data.status, { timeout: 30_000 }).toBe("succeeded");
    },
  };
}

function side(page: Page, name: "A" | "B") {
  return page.getByRole("group", { name: `Lado ${name}`, exact: true });
}

function answer(page: Page) {
  return page.getByRole("region", { name: "Resposta" });
}

function step(page: Page, n: number, label: string) {
  return page.getByRole("button", { name: `Passo ${n}: ${label}` });
}

function current(page: Page) {
  return page.getByRole("complementary", { name: "Passo atual" });
}

function panel(page: Page, title: string | RegExp) {
  return page.getByRole("dialog", { name: title });
}

function compareButton(page: Page) {
  return page.getByRole("button", { name: "Comparar", exact: true });
}

function confirmation(page: Page) {
  return page.getByRole("checkbox", { name: /^Confirmo que/ });
}

async function pickTable(page: Page, which: "A" | "B", key: string) {
  const select = side(page, which).getByLabel("Tabela");
  const value = await select.locator("option", { hasText: `(${key})` }).getAttribute("value");
  await select.selectOption(value!);
}

async function compareReference(page: Page) {
  await page.goto("/comparacoes");
  await expect(page.getByRole("button", { name: /Beneficiários × Atendimentos com data em 2025/ })).toHaveAttribute("aria-pressed", "true");
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(REFERENCE);
}

test("the sets and identifiers are chosen explicitly, and the reference case separates the net difference from the divergences", async ({ page, request }) => {
  await fresh(page, request, "cadastro");
  await page.goto("/comparacoes");
  const sentence = page.locator(".key-sentence");
  await expect(sentence).toContainText("beneficiarios.id (lado A) for igual a atendimentos.beneficiario_id (lado B)");
  const check = page.locator(".eq-box");
  await expect(check).toContainText("A relação atendimentos.beneficiario_id → beneficiarios.id do Mapa sugere estas colunas");
  await expect(check).toContainText("não prova que identificam a mesma entidade");
  await expect(compareButton(page)).toBeDisabled();

  await pickTable(page, "A", "cozinhas");
  await expect(side(page, "A").getByLabel("Coluna identificadora")).toHaveValue("");
  await expect(sentence).toContainText("Nenhuma coluna é escolhida pelo nome");
  await expect(compareButton(page)).toBeDisabled();
  await side(page, "A").getByLabel("Coluna identificadora").selectOption("id");
  await expect(sentence).toContainText("cozinhas.id (lado A)");
  await expect(check).toContainText("O Mapa não tem nenhuma relação entre estas duas colunas.");
  await expect(compareButton(page)).toBeDisabled();

  await page.getByRole("button", { name: /Beneficiários × Atendimentos com data em 2025/ }).click();
  await expect(side(page, "A").getByRole("textbox", { name: "Nome do lado A" })).toHaveAttribute("placeholder", "Beneficiários");
  await expect(side(page, "B").getByRole("textbox", { name: "Nome do lado B" })).toHaveAttribute("placeholder", "Atendimentos com data em 2025");
  await expect(side(page, "B")).toContainText("data em 2025");
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(REFERENCE);
  await expect(page.getByText("prévia", { exact: true })).toBeVisible();

  const result = answer(page);
  await expect(result).toContainText("46identidades de diferença nos totais1.242 − 1.196");
  await expect(result).toContainText("80identidades sem par exato63 só em Beneficiários + 17 só em Atendimentos com data em 2025");
  await expect(result).toContainText("A diferença nos totais é menor que o número de identidades sem par");
  await result.getByText("Linhas e identidades").click();
  await expect(result).toContainText("Beneficiários tem 1.248 linhas = 1.242 identidades (6 linhas repetidas)");

  await step(page, 1, "Fontes").click();
  await expect(step(page, 1, "Fontes")).toHaveAttribute("aria-current", "step");
  await expect(current(page)).toContainText("1.248 linhas → 1.242 identidades · 6 repetidas");
  await expect(current(page)).toContainText("9.756 linhas → 1.196 identidades · 8.560 repetidas");
  await expect(current(page)).toContainText("declarada por você");
  await expect(current(page)).toContainText("O Trace não verificou essa equivalência");
  await expect(current(page)).toContainText("Os lados vêm de tabelas diferentes");
  await page.getByRole("button", { name: /^6 linhas repetidas/ }).click();
  await expect(panel(page, "6 identidades repetidas")).toContainText("1.248 linhas com identificador − 6 repetidas = 1.242 identidades");
  await page.keyboard.press("Escape");

  await step(page, 4, "Fechar a conta").click();
  await expect(current(page).getByRole("group", { name: "1.242 menos 63 mais 17 igual a 1.196 identidades" })).toBeVisible();
  await expect(current(page)).toContainText("14 + 49");
  await expect(current(page)).toContainText("14 + 3");
  await expect(current(page)).toContainText("10 de 10 conferem");

  await step(page, 3, "Classificar").click();
  await expect(current(page).getByRole("button", { name: /^49 sem nenhuma correspondência em Atendimentos com data em 2025/ })).toBeVisible();
  await expect(current(page).getByRole("button", { name: /^3 sem nenhuma correspondência em Beneficiários/ })).toBeVisible();

  await page.getByRole("button", { name: "Editar os conjuntos" }).click();
  await expect(side(page, "B").getByLabel("Coluna identificadora")).toHaveValue("beneficiario_id");
  await expect(side(page, "B")).toContainText("data em 2025");
  await expect(confirmation(page)).toBeChecked();
});

test("fields without evidence need an explicit confirmation for that exact pair, and friendly names keep the technical ones in the details", async ({ page, request }) => {
  const api = await fresh(page, request, "refeicoes", true);
  await api.create(
    "pessoas_sinteticas",
    ["beneficiario,nome", ...Array.from({ length: 463 }, (_, i) => `B${String(i + 1).padStart(4, "0")},Pessoa ${i + 1}`), "B0001,Pessoa 1"].join("\n"),
  );
  await page.goto("/comparacoes");
  await pickTable(page, "A", "pessoas_sinteticas");
  await side(page, "A").getByLabel("Coluna identificadora").selectOption("beneficiario");
  await pickTable(page, "B", "cozinhas");
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("municipio");

  const check = page.locator(".eq-box");
  await expect(check).toContainText("Você escolheu comparar beneficiario com municipio. Esses campos podem representar tipos diferentes de informação.");
  await expect(check).toContainText("O Mapa não tem nenhuma relação entre estas duas colunas.");
  await expect(check).toContainText("cozinhas.municipiotexto · 5 valores diferentes");
  await expect(compareButton(page)).toBeDisabled();
  await confirmation(page).check();
  await expect(compareButton(page)).toBeEnabled();
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("nome");
  await expect(confirmation(page)).not.toBeChecked();
  await expect(compareButton(page)).toBeDisabled();
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("municipio");
  await expect(confirmation(page)).not.toBeChecked();
  await confirmation(page).check();

  await side(page, "A").getByRole("textbox", { name: "Nome do lado A" }).fill("Pessoas sintéticas");
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que 463 identidades em Pessoas sintéticas e 5 em Cozinhas?");
  await expect(answer(page)).toContainText("458identidades de diferença nos totais463 − 5");
  await expect(answer(page)).toContainText("Nenhuma identidade aparece nos dois lados");
  await expect(answer(page)).not.toContainText("cadastrados");
  await answer(page).getByText("Linhas e identidades").click();
  await expect(answer(page)).toContainText("Pessoas sintéticas tem 464 linhas = 463 identidades (1 linha repetida)");
  await expect(page.locator(".zero-tag:not(.gone)")).toHaveText("nenhuma identidade nos dois");
  await expect(page.locator(".ptab.a")).toContainText("463A · Pessoas sintéticas · identidades");
  await expect(current(page).getByRole("button", { name: /^0 nos dois/ })).toBeVisible();

  await step(page, 1, "Fontes").click();
  const card = current(page).locator(".src-card.a");
  await expect(card).toContainText("A · Pessoas sintéticas");
  await expect(card).toContainText("pessoas_sinteticas · versão 1");
  await expect(card).toContainText("pessoas_sinteticas.beneficiario");
  await expect(current(page)).toContainText(
    "Você declarou que pessoas_sinteticas.beneficiario e cozinhas.municipio identificam a mesma entidade. O Trace não verificou essa equivalência.",
  );

  await page.getByRole("button", { name: "Rastrear a comparação" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/comparacoes");
  const item = page.getByRole("region", { name: "Comparações rastreadas" }).getByRole("listitem").filter({ hasText: "Pessoas sintéticas × Cozinhas" });
  await expect(item).toContainText("declarada por você");
  await expect(item).toContainText("pessoas_sinteticas.beneficiario · versão 1");

  const ds = await api.datasets();
  const spec = {
    a: { kind: "population", dataset_id: ds.pessoas_sinteticas.id, version_id: null, key: "beneficiario", label: "Pessoas sintéticas" },
    b: { kind: "population", dataset_id: ds.cozinhas.id, version_id: null, key: "municipio" },
    rules: [],
    fields: [],
  };
  await page.goto(`/comparacoes?c=${encodeURIComponent(JSON.stringify(spec))}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirme o que está sendo comparado");
  await expect(compareButton(page)).toBeDisabled();
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que 463 identidades em Pessoas sintéticas e 5 em Cozinhas?");

  const oneToOne = await api.call<{ data: { id: string } }>("POST", "/relationships", {
    from_dataset_id: ds.refeicoes.id,
    from_column: "id",
    to_dataset_id: ds.cozinhas.id,
    to_column: "id",
  });
  await api.call("POST", `/relationships/${oneToOne.data.id}/confirm`);
  await page.goto("/comparacoes");
  await pickTable(page, "A", "cozinhas");
  await side(page, "A").getByLabel("Coluna identificadora").selectOption("id");
  await pickTable(page, "B", "refeicoes");
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("id");
  await expect(page.locator(".eq-box")).toContainText("está confirmada no Mapa, mas a origem também não se repete: uma relação um para um pode ligar entidades diferentes.");
  await expect(compareButton(page)).toBeDisabled();
});

test("a confirmed reference reads as registry against references, with plain counts per category and signs only in the account", async ({ page, request }) => {
  const api = await fresh(page, request, "refeicoes", true);
  const relation = (await api.call<{ data: { id: string; from: { dataset_key: string; column: string } }[] }>("GET", "/relationships")).data.find(
    (r) => r.from.dataset_key === "refeicoes" && r.from.column === "cozinha_id",
  )!;
  await api.call("POST", `/relationships/${relation.id}/confirm`);

  await page.goto("/comparacoes");
  await expect(page.getByRole("button", { name: /Cozinhas × Refeições com data em 2026/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".eq-line")).toContainText("cada valor de refeicoes.cozinha_id aponta para um único registro pela coluna cozinhas.id");
  await expect(confirmation(page)).toHaveCount(0);
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que Cozinhas e Refeições com data em 2026 têm 15 identidades cada, mas não as mesmas?");
  const meaning =
    "As duas seleções têm 15 identificadores distintos, mas representam populações diferentes: 15 cadastrados em Cozinhas e 15 de Cozinhas referenciados em Refeições com data em 2026. 13 aparecem nas duas. 2 estão no cadastro, mas não aparecem como referência nesta seleção; 2 são referenciados sem correspondência no cadastro selecionado. Ficar de fora de uma seleção não indica, por si só, inatividade nem erro.";
  await expect(answer(page)).toContainText(meaning);
  await expect(answer(page)).toContainText("0identidades de diferença nos totais15 − 15");
  await expect(answer(page)).toContainText("4identidades sem par exato2 só em Cozinhas + 2 só em Refeições com data em 2026");

  await step(page, 3, "Classificar").click();
  const registered = current(page).getByRole("button", { name: /^2 não aparecem como referência em Refeições com data em 2026/ });
  await expect(registered).toBeVisible();
  await expect(current(page).getByRole("button", { name: /^1 sem correspondência no cadastro selecionado/ })).toBeVisible();
  await expect(current(page).getByRole("button", { name: /^−|^\+/ })).toHaveCount(0);
  await expect(page.locator(".tray b")).toHaveText(["2", "1", "1"]);
  await registered.click();
  const cause = panel(page, /2 identidades · não aparecem como referência/);
  await expect(cause).toContainText("2 identidades só em Cozinhas");
  await expect(cause).toContainText("Não aparecer na seleção não indica, por si só, inatividade.");
  await page.keyboard.press("Escape");

  await step(page, 4, "Fechar a conta").click();
  await expect(current(page).getByRole("group", { name: "15 menos 2 mais 2 igual a 15 identidades" })).toBeVisible();
  await expect(current(page).locator(".lg-op")).toHaveText(["", "−", "+", "="]);
  await step(page, 1, "Fontes").click();
  await expect(current(page)).toContainText("referência confirmada no Mapa");

  await page.getByRole("button", { name: "Rastrear a comparação" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  const traced = page.url();
  await api.call("POST", `/relationships/${relation.id}/reopen`);
  await page.goto(traced);
  await expect(answer(page)).toContainText(meaning);
  await page.getByRole("button", { name: "Comparar com os dados atuais" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirme o que está sendo comparado");
  await expect(page.locator(".eq-box")).toContainText("do Mapa sugere estas colunas");
});

test("identical sets have nothing to explain, and a different period is attributed to the criterion with its excluded rows", async ({ page, request }) => {
  await fresh(page, request, "cadastro");
  await page.goto("/comparacoes");
  await pickTable(page, "B", "beneficiarios");
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("id");
  await expect(page.locator(".eq-line")).toContainText("mesma coluna");
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beneficiários (A) e Beneficiários (B) têm as mesmas 1.242 identidades");
  await expect(answer(page)).toContainText(
    "São duas seleções de Beneficiários pela mesma coluna, então os identificadores têm o mesmo significado nos dois lados. As duas têm exatamente os mesmos identificadores.",
  );
  await expect(answer(page)).toContainText("0identidades sem par exato");
  await step(page, 1, "Fontes").click();
  await expect(current(page)).toContainText("não deveria haver diferença");

  await page.getByRole("button", { name: "Editar os conjuntos" }).click();
  await side(page, "B").getByRole("button", { name: "Ajustar critérios" }).click();
  await side(page, "B").getByLabel("Período").selectOption("date:data_cadastro");
  await side(page, "B").getByLabel("Ano").selectOption("2024");
  await side(page, "B").getByRole("button", { name: "Fechar" }).click();
  await expect(side(page, "B").locator(".crit-chip.on")).toHaveText("data_cadastro em 2024");
  await compareButton(page).click();
  await expect(answer(page)).toContainText("São duas seleções de Beneficiários pela mesma coluna, então os identificadores têm o mesmo significado nos dois lados.");
  await expect(answer(page)).toContainText("As definições diferem só no critério de seleção.");
  await step(page, 1, "Fontes").click();
  await expect(current(page)).toContainText("Toda diferença vem desse critério de seleção");

  await step(page, 3, "Classificar").click();
  const name = /saíram da seleção de Beneficiários com data_cadastro em 2024/;
  const excluded = current(page).getByRole("button", { name });
  await expect(excluded).toBeVisible();
  const count = Number(((await excluded.locator("b").textContent()) ?? "").replace(/[^\d]/g, ""));
  expect(count).toBeGreaterThan(0);
  await excluded.click();
  const cause = panel(page, name);
  await expect(cause).toContainText("comprovado pelos dados");
  await expect(cause).toContainText("Beneficiários com data_cadastro em 2024: data_cadastro em 2024");
  await cause.getByRole("button", { name: "Rastrear a comparação" }).first().click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });

  await step(page, 3, "Classificar").click();
  await current(page).getByRole("button", { name }).click();
  const traced = panel(page, name);
  await expect(traced.getByRole("table", { name: "Identidades" }).getByText("excluída por critério").first()).toBeVisible();
  await traced.getByRole("table", { name: "Identidades" }).locator("tbody tr").first().click();
  const identity = page.getByRole("dialog").filter({ hasText: "Voltar à lista" });
  await expect(identity).toContainText("excluída por critério");
  await expect(identity).toContainText("Em Beneficiários com data_cadastro em 2024 · beneficiarios · versão 1");
  const rowsB = identity.getByRole("table", { name: /^Linhas de beneficiarios com / }).nth(1);
  await expect(rowsB).toContainText("saiu no passo 1");
  await expect(rowsB).toContainText("data_cadastro");
});

test("a possible match shows the rule, its effect and examples before being accepted, and the backend recalculates after", async ({ page, request }) => {
  await fresh(page, request, "cadastro");
  await compareReference(page);
  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^14 possível: a mesma identidade escrita de outro jeito existe em Atendimentos/ })
    .click();
  const hypothesis = panel(page, "14 pares possíveis");
  await expect(hypothesis).toContainText("possível · hipótese");
  await expect(hypothesis).toContainText("ignorar zeros à esquerda (0187 e 187 viram a mesma identidade) em beneficiarios.id e atendimentos.beneficiario_id");
  await expect(hypothesis).toContainText("+14 pares pela regra");
  await expect(hypothesis.locator(".decomp").first()).toContainText("1.242 − 63 + 17 = 1.196");
  await expect(hypothesis.locator(".decomp").nth(1)).toContainText("1.242 − 49 + 3 = 1.196");
  await expect(hypothesis).toContainText("A diferença líquida continua 46");
  const pairs = hypothesis.getByRole("table", { name: "Pares possíveis" });
  await expect(pairs.locator("tbody tr")).toHaveCount(10);
  await expect(pairs.locator("tbody tr").first()).toContainText("único candidato nos dois sentidos");

  await hypothesis.getByRole("button", { name: "Manter como hipótese" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nada mudou na conta" })).toBeVisible();
  await expect(answer(page)).toContainText("80identidades sem par exato");

  await hypothesis.getByRole("button", { name: "Aceitar a regra" }).click();
  await expect(page.getByText("regra aceita: zeros à esquerda")).toBeVisible();
  await expect(answer(page)).toContainText("52identidades sem par exato49 só em Beneficiários + 3 só em Atendimentos com data em 2025");
  await expect(answer(page)).toContainText("46identidades de diferença nos totais");
  const rule = panel(page, "14 pares pela regra");
  await expect(rule).toContainText("1.242 − 49 + 3 = 1.196");
  await step(page, 2, "Alinhar").click();
  await expect(current(page)).toContainText("14 das que estão nos dois foram pareadas pela regra aceita");
  await expect(current(page).getByRole("button", { name: /^1\.193 nos dois/ })).toBeVisible();

  await rule.getByRole("button", { name: "Remover a regra" }).click();
  await expect(answer(page)).toContainText("80identidades sem par exato");
});

test("an ambiguous match stays unpaired, shows every candidate, and survives an accepted rule", async ({ page, request }) => {
  const api = await fresh(page, request, "refeicoes", true);
  await api.create("codigos_a", "codigo,nome\n007,Ana\n12,Bia\n3,Caio\n");
  await api.create("codigos_b", "codigo,unidade\n7,Norte\n07,Sul\n12,Leste\n0003,Oeste\n");
  await page.goto("/comparacoes");
  await pickTable(page, "A", "codigos_a");
  await side(page, "A").getByLabel("Coluna identificadora").selectOption("codigo");
  await pickTable(page, "B", "codigos_b");
  await side(page, "B").getByLabel("Coluna identificadora").selectOption("codigo");
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que 3 identidades em Codigos a e 4 em Codigos b?");

  await step(page, 3, "Classificar").click();
  await expect(current(page).getByRole("button", { name: /^2 ambíguas: mais de um candidato/ })).toBeVisible();
  await current(page)
    .getByRole("button", { name: /^1 ambíguas: mais de um candidato/ })
    .click();
  const ambiguous = panel(page, /1 identidade · ambíguas: mais de um candidato/);
  await expect(ambiguous).toContainText("Aceitar uma regra não pareia estas identidades");
  await expect(ambiguous.getByRole("table", { name: "Identidades" })).toContainText("007");
  await expect(ambiguous.getByRole("table", { name: "Identidades" })).toContainText(/candidatos: (7, 07|07, 7)/);
  await ambiguous.getByRole("button", { name: "Rastrear a comparação" }).first().click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });

  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^1 ambíguas: mais de um candidato/ })
    .click();
  await panel(page, /ambíguas: mais de um candidato/)
    .getByRole("table", { name: "Identidades" })
    .locator("tbody tr")
    .first()
    .click();
  const identity = page.getByRole("dialog").filter({ hasText: "Voltar à lista" });
  await expect(identity).toContainText("ambígua");
  await expect(identity.getByRole("table", { name: "Linhas de codigos_a com 007" })).toContainText("Ana");
  await expect(identity.getByRole("table", { name: "Linhas de codigos_b com 7" })).toContainText("Norte");
  await expect(identity.getByRole("table", { name: "Linhas de codigos_b com 07" })).toContainText("Sul");
  await expect(identity).toContainText("Com mais de um candidato, nenhum par é feito.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await current(page)
    .getByRole("button", { name: /^1 possível: a mesma identidade escrita de outro jeito existe em Codigos b/ })
    .click();
  const hypothesis = panel(page, "1 par possível");
  await expect(hypothesis).toContainText("+1 par pela regra");
  await expect(hypothesis).toContainText("3 identidades ambíguas ou parecidas com uma já pareada continuam sem par.");
  await hypothesis.getByRole("button", { name: "Aceitar a regra" }).click();
  await expect(page.getByText("regra aceita: zeros à esquerda")).toBeVisible();
  await expect(answer(page)).toContainText("Com a regra aceita, 1 par escrito de outro jeito conta como nos dois.");
  await step(page, 3, "Classificar").click();
  await expect(current(page).getByRole("button", { name: /^1 ambíguas: mais de um candidato/ })).toBeVisible();
});

test("a variant of an already matched identity is named but never paired, and rows without identifier are shown", async ({ page, request }) => {
  await fresh(page, request, "refeicoes");
  await page.goto("/comparacoes");
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Por que Cozinhas e Refeições com data em 2026 têm 15 identidades cada, mas não as mesmas\?$/);
  await expect(answer(page)).toContainText("Os totais são iguais, mas não são as mesmas identidades");
  await answer(page).getByText("Linhas e identidades").click();
  await expect(answer(page)).toContainText("1 sem identificador");

  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^1 parecidas com uma identidade já pareada/ })
    .click();
  const variant = panel(page, /1 identidade · parecidas com uma identidade já pareada/);
  await expect(variant).toContainText("Mesmo com a regra aceita, estas continuam sem par");
  await expect(variant.getByRole("table", { name: "Identidades" })).toContainText("187");
  await expect(variant.getByRole("table", { name: "Identidades" })).toContainText("já pareada: 0187");
  await variant.getByRole("button", { name: "Rastrear a comparação" }).first().click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });

  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^1 parecidas com uma identidade já pareada/ })
    .click();
  await panel(page, /parecidas com uma identidade já pareada/)
    .getByRole("table", { name: "Identidades" })
    .locator("tbody tr")
    .first()
    .click();
  const identity = page.getByRole("dialog").filter({ hasText: "Voltar à lista" });
  await expect(identity).toContainText("variante de uma pareada");
  await expect(identity).toContainText("0187 já tem par exato. Por isso 187 não vira um segundo par para a mesma identidade.");
  await expect(identity.getByRole("table", { name: "Linhas de cozinhas com 0187" })).toContainText("selecionada");
  await expect(identity.getByRole("table", { name: "Linhas de refeicoes com 187" })).toContainText("selecionada");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await step(page, 1, "Fontes").click();
  await page.getByRole("button", { name: /^1 sem identificador/ }).click();
  const empty = panel(page, "1 linha sem identificador");
  await expect(empty.getByRole("table", { name: "Linhas sem identificador" }).locator("tbody tr")).toHaveCount(1);
});

test("traced identities open page by page with their source rows, and the history reopens without recalculating", async ({ page, request }) => {
  await fresh(page, request, "cadastro");
  await compareReference(page);
  await page.getByRole("button", { name: "Rastrear a comparação" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Execução rastreada em" })).toContainText("beneficiarios versão 1 e atendimentos versão 1");

  await current(page)
    .getByRole("button", { name: /^1\.179 nos dois/ })
    .click();
  const both = panel(page, "1.179 identidades nos dois");
  await both.getByRole("table", { name: "Identidades nos dois" }).locator("tbody tr").first().click();
  const sharedIdentity = page.getByRole("dialog").filter({ hasText: "Voltar à lista" });
  await expect(sharedIdentity).toContainText("Está nos dois lados com o mesmo texto");
  await expect(sharedIdentity).toContainText(/Aparece em .* linhas em Atendimentos com data em 2025: continua sendo uma identidade só na conta\./);
  await expect(sharedIdentity.getByRole("table", { name: /^Linhas de atendimentos com / })).toContainText("selecionada");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await step(page, 3, "Classificar").click();
  const button = current(page).getByRole("button", { name: /^49 sem nenhuma correspondência em Atendimentos com data em 2025/ });
  await button.click();
  const cause = panel(page, /49 identidades · sem nenhuma correspondência em Atendimentos com data em 2025/);
  await expect(cause).toContainText("Página 1 de 5 · 49 identidades");
  await cause.getByRole("button", { name: "Próxima" }).click();
  await expect(cause).toContainText("Página 2 de 5 · 49 identidades");
  const first = (await cause.getByRole("table", { name: "Identidades" }).locator("tbody tr td").first().textContent()) ?? "";
  await cause.getByPlaceholder("Procurar uma identidade").fill(first);
  await expect(cause.getByRole("table", { name: "Identidades" }).locator("tbody tr")).toHaveCount(1);
  await cause.getByRole("table", { name: "Identidades" }).locator("tbody tr").first().focus();
  await page.keyboard.press("Enter");
  const identity = page.getByRole("dialog").filter({ hasText: "Voltar à lista" });
  await expect(identity.getByRole("heading", { level: 2 })).toHaveText(first);
  await expect(identity).toContainText("não encontrada");
  const rows = identity.getByRole("table", { name: `Linhas de beneficiarios com ${first}` });
  await expect(rows.getByRole("columnheader")).toContainText(["linha", "situação", "id"]);
  await expect(rows).toContainText("selecionada");
  await expect(identity).toContainText("Não encontrada: nenhum valor igual, nem escrito de outro jeito, deste lado.");
  await expect(identity).toContainText(`Nenhuma linha de atendimentos tem ${first} em beneficiario_id.`);
  await page.keyboard.press("Escape");
  await expect(cause).toContainText("Página");
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();

  const runUrl = page.url();
  await page.goto("/comparacoes");
  const history = page.getByRole("region", { name: "Comparações rastreadas" });
  const item = history.getByRole("listitem").filter({ hasText: "Beneficiários × Atendimentos com data em 2025" });
  await expect(item).toContainText("beneficiarios.id · versão 1");
  await expect(item).toContainText("declarada por você");
  await expect(item).toContainText("1.242 − 63 + 17 = 1.196");
  const previews: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/comparisons/preview")) previews.push(req.url());
  });
  await item.getByRole("link", { name: "Abrir a execução" }).click();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible();
  await expect(answer(page)).toContainText("80identidades sem par exato");
  expect(previews).toHaveLength(0);

  await page.getByRole("button", { name: "Comparar com os dados atuais" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Prévia calculada agora." })).toContainText("Confere com a execução rastreada");
});

test("two versions of a file are compared by key, and an old trace keeps the version it used", async ({ page, request }) => {
  const api = await fresh(page, request, "refeicoes", true);
  const ds = await api.datasets();
  const created = await api.call<{ data: { id: string } }>("POST", "/comparisons/trace", {
    spec: {
      a: { kind: "population", dataset_id: ds.cozinhas.id, version_id: null, key: "id", label: "Cozinhas" },
      b: { kind: "population", dataset_id: ds.refeicoes.id, version_id: null, key: "cozinha_id", label: "Refeições" },
      rules: [],
      fields: [],
      equivalence: { a: { dataset_id: ds.cozinhas.id, key: "id" }, b: { dataset_id: ds.refeicoes.id, key: "cozinha_id" } },
    },
    name: "Cozinhas × Refeições",
  });
  await api.waitRun(`/comparison-runs/${created.data.id}`);

  const rows = await api.rows("cozinhas");
  const keys = Object.keys(rows[0]);
  const kept = rows.slice(1);
  const added: Record<string, string | null> = { ...rows[1], id: "0299", nome: "Cozinha Nova Esperança" };
  const csv = [keys.join(","), ...[...kept, added].map((row) => keys.map((key) => row[key] ?? "").join(","))].join("\n");
  await api.upload("cozinhas", csv);

  await page.goto(`/comparacoes?execucao=${created.data.id}`);
  const status = page.getByRole("status").filter({ hasText: "Execução rastreada em" });
  await expect(status).toContainText("cozinhas versão 1");
  await expect(status).toContainText("Desde então, cozinhas tem a versão 2; esta execução continua apontando para as versões que usou.");
  await page.getByRole("button", { name: "Comparar com os dados atuais" }).click();
  await expect(page.getByRole("status").filter({ hasText: "não confere com a execução rastreada" })).toContainText("A execução usou cozinhas versão 1");

  await page.goto("/comparacoes");
  await page.getByRole("button", { name: /Cozinhas: versão 1 × versão 2/ }).click();
  await expect(side(page, "A").locator(".crit-chip.on")).toHaveText("versão 1");
  await expect(side(page, "B").locator(".crit-chip.on")).toHaveText("versão 2");
  await expect(page.locator(".eq-line")).toContainText("mesma coluna");
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que Cozinhas (versão 1) e Cozinhas (versão 2) têm 15 identidades cada, mas não as mesmas?");
  await expect(answer(page)).toContainText("1 só em Cozinhas (versão 1) + 1 só em Cozinhas (versão 2)");
  await step(page, 1, "Fontes").click();
  await expect(current(page)).toContainText("Os lados diferem só na versão de cozinhas (versão 1 e versão 2). Toda diferença vem da mudança nos dados.");
  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^1 sem nenhuma correspondência em Cozinhas \(versão 1\)/ })
    .click();
  await expect(panel(page, /sem nenhuma correspondência em Cozinhas \(versão 1\)/).getByRole("table", { name: "Identidades" })).toContainText("0299");
});

test("a traced question run can be one side of the comparison", async ({ page, request }) => {
  const api = await fresh(page, request, "refeicoes");
  const ds = await api.datasets();
  const traced = await api.call<{ data: { run: { id: string } } }>("POST", "/questions/trace", {
    question: { base_dataset_id: ds.refeicoes.id, measure: { function: "count" }, period: null, dimension: null },
    title: "Refeições registradas",
  });
  await api.waitRun(`/runs/${traced.data.run.id}`);

  await page.goto("/comparacoes");
  await side(page, "B").getByRole("button", { name: "Execução rastreada" }).click();
  const run = side(page, "B").getByLabel("Execução");
  const value = await run.locator("option", { hasText: "Refeições registradas" }).getAttribute("value");
  await run.selectOption(value!);
  await expect(side(page, "B").getByLabel("Coluna identificadora")).toHaveValue("cozinha_id");
  await expect(side(page, "B").getByRole("textbox", { name: "Nome do lado B" })).toHaveAttribute("placeholder", "Refeições registradas");
  await confirmation(page).check();
  await compareButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que Cozinhas e Refeições registradas têm 15 identidades cada, mas não as mesmas?");
  await step(page, 1, "Fontes").click();
  await expect(current(page)).toContainText("execução");
  await expect(current(page)).toContainText("118 linhas → 15 identidades");
});

test("the comparison works by keyboard and fits a phone", async ({ page, request }) => {
  await fresh(page, request, "cadastro");
  await compareReference(page);
  const stage = page.getByRole("group", { name: /^Visualização da comparação/ });
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  await expect(step(page, 3, "Classificar")).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(step(page, 1, "Fontes")).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  const tray = page.getByRole("button", { name: /^49 identidades, sem nenhuma correspondência em Atendimentos com data em 2025, comprovado\. Abrir\.$/ });
  await tray.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page, /49 identidades · sem nenhuma correspondência/)).toBeVisible();
  await expect(tray).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(panel(page, /49 identidades · sem nenhuma correspondência/)).toBeHidden();
  await expect(tray).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(REFERENCE);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await step(page, 3, "Classificar").click();
  await current(page)
    .getByRole("button", { name: /^49 sem nenhuma correspondência/ })
    .click();
  const cause = panel(page, /49 identidades · sem nenhuma correspondência/);
  await expect(cause).toBeVisible();
  const box = await cause.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBeLessThanOrEqual(390);

  await page.goto("/comparacoes");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(confirmation(page)).toBeVisible();
  await expect(side(page, "B").locator(".crit-chip.on")).toHaveText("data em 2025");
});
