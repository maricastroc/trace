import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, selectScenario, workspaceApi, type ScenarioKey } from "./scenario";

const DEMO = join(__dirname, "../../backend/database/demo");

function rows(file: string) {
  const [header, ...lines] = readFileSync(join(DEMO, file), "utf8").trim().split("\n");
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, i) => [keys[i], value === "" ? null : value])) as Record<string, string | null>);
}

const count = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

async function open(page: Page, request: APIRequestContext, scenario: ScenarioKey) {
  await page.goto("/mapa");
  await selectScenario(page, scenario);
  const api = await workspaceApi(page, request, scenario);
  await api.removeQuestions();
  return api;
}

function sentence(page: Page) {
  return page.locator(".q-sentence");
}

function token(page: Page, what: string) {
  return page.getByRole("button", { name: new RegExp(`Alterar ${what}$`) });
}

test("a question is edited by its parts, previewed against the source file, traced and investigated", async ({ page, request }) => {
  const api = await open(page, request, "refeicoes");
  const meals = await api.find("refeicoes.cozinha_id", "cozinhas.id");
  if (meals && meals.status !== "confirmed") await api.decide(meals.id, "confirm");
  const data = rows("refeicoes.csv");
  const sum = (month: string) => data.filter((r) => r.data!.startsWith(month) && /^\d+$/.test(r.quantidade ?? "")).reduce((total, r) => total + Number(r.quantidade), 0);

  await page.goto("/perguntas");
  await expect(sentence(page)).toHaveText("Em refeições, quantos registros por cozinha com data em 2026?");
  await expect(page.getByRole("img", { name: `${count(data.length)} registros` })).toBeVisible();

  await token(page, "o que contar").focus();
  await page.keyboard.press("Enter");
  const options = page.getByRole("listbox", { name: "O que contar" });
  await expect(options.getByRole("option", { name: /^registros/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(token(page, "o que contar")).toBeFocused();
  await page.keyboard.press("Enter");
  await options.getByRole("option", { name: /^soma de quantidade/ }).click();
  await expect(sentence(page)).toHaveText("Em refeições, qual a soma de quantidade por cozinha com data em 2026?");
  await expect(page.getByRole("img", { name: `${count(sum("2026"))} soma de quantidade` })).toBeVisible();
  await expect(page.locator(".bar-total")).toContainText(`total calculado: ${count(sum("2026"))}`);

  await token(page, "o período").click();
  await page.getByRole("option", { name: "setembro de 2026" }).click();
  await expect(sentence(page)).toContainText("com data em setembro de 2026");
  await expect(page.getByRole("img", { name: `${count(sum("2026-09"))} soma de quantidade` })).toBeVisible();
  await expect(page.getByText("prévia", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Investigar a resposta" }).click();
  const investigation = page.locator("#q-inv");
  await expect(investigation.getByText("Pronto para rastrear.")).toBeVisible();
  await investigation.getByRole("button", { name: "Rastrear agora" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: `${count(sum("2026-09"))} soma de quantidade` })).toBeVisible();

  const outside = data.filter((r) => !r.data!.startsWith("2026-09")).length;
  await expect(investigation.getByRole("button", { name: new RegExp(`− ${count(outside)} `) })).toBeVisible();
  await investigation.getByRole("button", { name: /^ficam de fora/ }).click();
  await expect(investigation.getByRole("table", { name: "Registros que ficaram de fora" })).toContainText("data fora de 01/09/2026 a 30/09/2026");

  await investigation.getByRole("tab", { name: "Pergunta estruturada" }).click();
  await expect(investigation.getByText("Receita gerada")).toBeVisible();
  await expect(investigation.locator(".ticket")).toContainText("soma · refeicoes.quantidade");

  const traced = page.getByRole("button", { name: /Em refeições, qual a soma de quantidade por cozinha com data em setembro de 2026\?/ });
  await expect(traced).toHaveAttribute("aria-current", "true");
  await page.reload();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("a period question waits for the declaration, shows three readings and answers with the one chosen", async ({ page, request }) => {
  const api = await open(page, request, "cadastro");
  await api.clearValidity("beneficiarios");
  const kitchens = await api.find("beneficiarios.cozinha_id", "cozinhas.id");
  if (kitchens && kitchens.status !== "suggested") await api.decide(kitchens.id, "reopen");

  const people = rows("cadastro/beneficiarios.csv");
  const started = people.filter((r) => r.data_cadastro! >= "2025-01-01" && r.data_cadastro! <= "2025-12-31");
  const atEnd = people.filter((r) => r.data_cadastro! <= "2025-12-31" && (r.data_desligamento === null || r.data_desligamento >= "2025-12-31"));
  const distinct = (list: typeof people) => new Set(list.map((r) => r.id)).size;

  await page.goto("/perguntas?tabela=beneficiarios");
  await expect(sentence(page)).toHaveText("Em beneficiários, quantos beneficiários diferentes por cozinha com data_cadastro em 2025?");
  await token(page, "a data usada").click();
  await page.getByRole("option", { name: /^vigentes em/ }).click();
  await expect(sentence(page)).toHaveText("Em beneficiários, quantos beneficiários diferentes por cozinha estavam vigentes em 2025?");
  const clarification = page.locator(".clar");
  await expect(clarification).toContainText("Antes, declare a vigência de beneficiarios");
  await clarification.getByRole("radio", { name: /^Sim: quem tem fim em 31\/12/ }).check();
  await clarification.getByRole("button", { name: "Declarar vigência" }).click();

  const startedOption = clarification.getByRole("button", { name: /Começaram em 2025/ });
  await expect(startedOption).toContainText(count(distinct(started)));
  await expect(clarification.getByRole("button", { name: /Estavam ativos no último dia de 2025/ })).toContainText(count(distinct(atEnd)));
  await clarification.getByRole("button", { name: "Ver critérios exatos" }).click();
  await expect(clarification).toContainText("data_cadastro ≤ 31/12/2025 e (data_desligamento vazio ou data_desligamento ≥ 31/12/2025)");

  await clarification.getByRole("button", { name: /Estavam ativos no último dia de 2025/ }).click();
  await expect(sentence(page)).toHaveText("Em beneficiários, quantos beneficiários diferentes por cozinha estavam ativos no último dia de 2025?");
  await expect(page.getByRole("img", { name: `${count(distinct(atEnd))} beneficiários diferentes` })).toBeVisible();
  await expect(page.getByText("Para rastrear este resultado, falta 1 decisão.")).toBeVisible();

  await page.getByRole("button", { name: /^Cozinha Esperança:/ }).click();
  const esperanca = atEnd.filter((r) => r.cozinha_id === "0101");
  await expect(sentence(page)).toContainText("de Cozinha Esperança");
  await expect(page.getByRole("img", { name: `${count(distinct(esperanca))} beneficiários diferentes` })).toBeVisible();

  await page.getByRole("button", { name: "Resolver" }).click();
  await page.getByRole("button", { name: "Confirmar relação" }).click();
  await expect(page.getByText("Para rastrear este resultado, falta 1 decisão.")).toBeHidden();

  await page.getByRole("button", { name: "Investigar a resposta" }).click();
  const investigation = page.locator("#q-inv");
  await investigation.getByRole("button", { name: "Rastrear agora" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await investigation.getByRole("tab", { name: "Critérios e relações" }).click();
  await expect(investigation).toContainText("Estavam ativos no último dia de 2025");
  await expect(investigation).toContainText("beneficiarios.cozinha_id → cozinhas.id");

  const reopened = await api.find("beneficiarios.cozinha_id", "cozinhas.id");
  if (reopened) await api.decide(reopened.id, "reopen");
  await api.clearValidity("beneficiarios");
  await api.removeQuestions();
});

test("the investigation follows an imported file step by step and opens any record in full", async ({ page, request }) => {
  const created = await request.post(`${API_URL}/workspaces`, { data: { scenario: "refeicoes" }, headers: { Accept: "application/json" } });
  expect(created.ok()).toBe(true);
  const token = ((await created.json()) as { data: { token: string } }).data.token;
  await page.addInitScript((fresh) => {
    const tokens = JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}");
    localStorage.setItem("trace.workspace-tokens", JSON.stringify({ ...tokens, refeicoes: fresh }));
    localStorage.setItem("trace.scenario", "refeicoes");
  }, token);
  await page.goto("/mapa");
  await selectScenario(page, "refeicoes");
  const observation = "Família acompanhada desde 2019; mudou de endereço duas vezes e aguarda a visita técnica da equipe de assistência social do território";
  const csv = [
    "nome_completo_do_beneficiario_responsavel,cozinha_comunitaria_de_referencia,data_de_nascimento,observacoes_do_atendimento_social",
    `MARIA APARECIDA DOS SANTOS OLIVEIRA PEREIRA,PASTORAL DA CRIANÇA - CARRO ATOLADO,12/07/2024,${observation}`,
    "JOÃO BATISTA FERREIRA DA SILVA NETO,COMUNIDADE KOLPING CANTA GALO,03/02/2024,Sem observações",
    "ANA LÚCIA RODRIGUES DE ALMEIDA,PASTORAL DA CRIANÇA - CARRO ATOLADO,,Data de nascimento não informada no cadastro original",
    "PEDRO HENRIQUE COSTA,COMUNIDADE KOLPING CANTA GALO,15/08/2013,Irmão mais velho",
    "LUÍSA FERNANDES,PASTORAL DA CRIANÇA - CARRO ATOLADO,21/11/2024,",
    "RAIMUNDO NONATO SOUSA,COMUNIDADE KOLPING CANTA GALO,,Aguardando documento",
    "FRANCISCA DAS CHAGAS LIMA,PASTORAL DA CRIANÇA - CARRO ATOLADO,30/06/2019,Acompanhamento mensal",
  ].join("\n");
  await page.goto("/mapa?importar=nova");
  const panel = page.getByRole("dialog", { name: "Trazer um arquivo" });
  await panel.locator("input[type=file]").setInputFiles({ name: "beneficiarios_extensos.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(panel).toContainText("7 linhas e 4 colunas");
  await panel.getByRole("button", { name: "Importar tabela" }).click();
  await expect(page.getByRole("dialog", { name: "beneficiarios_extensos" })).toBeVisible();

  await page.goto("/perguntas?tabela=beneficiarios_extensos");
  await expect(sentence(page)).toHaveText("Em beneficiarios_extensos, quantas linhas no total com data_de_nascimento em 2024?");
  await expect(page.getByRole("img", { name: "3 linhas" })).toBeVisible();
  await page.getByRole("button", { name: "Investigar a resposta" }).click();
  const investigation = page.locator("#q-inv");
  await investigation.getByRole("button", { name: "Rastrear agora" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });

  const trail = investigation.getByRole("list", { name: "Percurso dos registros, do arquivo ao resultado" });
  await expect(trail.locator("li.ts-source")).toContainText("7registros de entrada");
  await expect(trail.getByRole("button", { name: "− 2 data_de_nascimento fora de 01/01/2024 a 31/12/2024" })).toBeVisible();
  await expect(trail.locator("li.ts-aggregate")).toContainText("3 registros entram no cálculo, sem agrupar: 1 resultado");
  await expect(trail.locator("li.ts-aggregate")).toContainText("Total contado: 3 registros");

  await trail.getByRole("button", { name: "− 2 sem data_de_nascimento" }).click();
  await expect(investigation.locator(".rec-context")).toHaveText("2 registros saíram no passo 1 (filtro) por: sem data_de_nascimento.");
  const outside = investigation.getByRole("table", { name: "Registros que ficaram de fora" });
  await expect(outside.getByRole("row")).toHaveCount(3);

  const row = outside.getByRole("row").filter({ hasText: "ANA LÚCIA" });
  await row.focus();
  await page.keyboard.press("Enter");
  const detail = investigation.getByRole("region", { name: /^Linha \d+ do arquivo$/ });
  await expect(detail).toContainText("beneficiarios_extensos · versão 1");
  await expect(detail).toContainText("saiu no passo 1");
  await expect(detail.getByRole("heading")).toBeFocused();
  const field = (name: string) => detail.locator(".rd-field").filter({ has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) }).locator("dd");
  await expect(field("data_de_nascimento")).toHaveText("vazio (sem valor no arquivo)");
  await expect(field("observacoes_do_atendimento_social")).toHaveText("Data de nascimento não informada no cadastro original");
  await expect(detail.locator("dt")).toHaveText([
    "nome_completo_do_beneficiario_responsavel",
    "cozinha_comunitaria_de_referencia",
    "data_de_nascimento",
    "observacoes_do_atendimento_social",
  ]);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(row).toBeFocused();

  await investigation.getByRole("button", { name: /^entram/ }).click();
  await investigation.getByRole("table", { name: "Registros que entram na resposta" }).getByRole("row").filter({ hasText: "MARIA APARECIDA" }).click();
  await expect(field("observacoes_do_atendimento_social")).toHaveText(observation);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(investigation.getByRole("region", { name: /^Linha \d+ do arquivo$/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

});
