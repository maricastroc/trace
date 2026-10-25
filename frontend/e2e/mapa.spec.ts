import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { relationMark, selectScenario, tableSheet, workspaceApi, type ScenarioKey } from "./scenario";

const MEALS = "refeicoes.cozinha_id → cozinhas.id";

async function open(page: Page, request: APIRequestContext, scenario: ScenarioKey) {
  await page.goto("/mapa");
  await selectScenario(page, scenario);
  return workspaceApi(page, request, scenario);
}

async function resetMeals(page: Page, request: APIRequestContext) {
  const api = await open(page, request, "refeicoes");
  const relation = await api.find("refeicoes.cozinha_id", "cozinhas.id");
  if (relation && relation.status !== "suggested") {
    await api.decide(relation.id, "reopen");
    await page.reload();
    await selectScenario(page, "refeicoes");
  }
  return api;
}

test.describe("Mapa · Refeições", () => {
  test("the relation mark opens the evidence computed by the backend", async ({ page, request }) => {
    await resetMeals(page, request);
    const mark = relationMark(page, MEALS);
    await mark.click();

    await expect(page).toHaveURL(/\/mapa\?relacao=/);
    const panel = page.getByRole("dialog", { name: "refeicoes → cozinhas" });
    await expect(panel.getByRole("heading", { name: "refeicoes → cozinhas" })).toBeFocused();
    await expect(panel).toContainText("97,4% das linhas encontram par e o destino é único: a evidência sustenta N:1. 3 linhas ficam sem par.");
    await expect(panel.getByRole("list", { name: "Resumo da evidência" }).getByRole("listitem")).toHaveText(["97,4% cobertura", "único destino", "N:1 comprovada", "0 linhas a mais na junção"]);
    await expect(page.getByRole("navigation", { name: "Rastro da investigação" })).toContainText(MEALS);

    await panel.getByText("Evidência completa").click();
    await panel.getByRole("button", { name: /Sem par/ }).click();
    const rows = panel.getByRole("table", { name: "Registros de refeicoes" }).getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(panel.getByRole("table", { name: "Registros de refeicoes" })).toContainText("187");
    await expect(panel.getByText("1–3 de 3")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(/\/mapa$/);
    await expect(mark).toBeFocused();
  });

  test("confirming, undoing, rejecting and reopening update the map and the recipe", async ({ page, request }) => {
    const api = await resetMeals(page, request);
    const mark = relationMark(page, MEALS);
    await mark.click();
    const panel = page.getByRole("dialog", { name: "refeicoes → cozinhas" });
    const decision = panel.getByRole("region", { name: "Sua decisão" });

    await decision.getByRole("button", { name: "Confirmar como N:1" }).click();
    await expect(panel.getByText("confirmada", { exact: true })).toBeVisible();
    await expect(mark).toHaveAccessibleName(/: confirmada,/);
    const recipes = await request.fetch(`${process.env.TRACE_E2E_API_URL ?? "http://localhost:8000/api/v1"}/recipes`, {
      headers: { "X-Trace-Workspace": await page.evaluate(() => JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}").refeicoes) },
    });
    expect((await recipes.json()).data[0].compiled.runnable).toBe(true);

    await page.getByRole("status").getByRole("button", { name: "Desfazer" }).click();
    await expect(panel.getByText("sugerida", { exact: true })).toBeVisible();
    await expect(mark).toHaveAccessibleName(/: sugerida,/);

    await decision.getByRole("button", { name: "Rejeitar" }).click();
    await expect(panel).toContainText("Rejeitada. Não será usada em perguntas nem comparações.");
    await expect(mark).toHaveAccessibleName(/: rejeitada,/);

    await decision.getByRole("button", { name: "Desfazer decisão" }).click();
    await expect(panel.getByText("sugerida", { exact: true })).toBeVisible();
    expect((await api.find("refeicoes.cozinha_id", "cozinhas.id"))?.status).toBe("suggested");
  });

  test("a table shows its records, and a record follows its link to the other table", async ({ page, request }) => {
    await open(page, request, "refeicoes");
    await tableSheet(page, "refeicoes").getByRole("button", { name: "refeicoes", exact: true }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: "refeicoes" })).toBeVisible();
    await expect(panel.getByText("1–40 de 118")).toBeVisible();
    await panel.getByRole("button", { name: "Próximos" }).click();
    await expect(panel.getByText("41–80 de 118")).toBeVisible();
    await panel.getByRole("button", { name: "Anteriores" }).click();

    await panel.getByRole("table", { name: "Registros de refeicoes" }).getByRole("row").nth(1).click();
    await expect(panel.getByRole("heading", { name: /^refeicoes · linha \d+$/ })).toBeFocused();
    await expect(panel.getByRole("button", { name: /^← refeicoes$/ })).toBeVisible();
    const link = panel.getByRole("button", { name: /cozinha_id = \d+ → cozinhas/ });
    await link.click();
    await expect(panel.getByRole("heading", { name: /^Cozinha / })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel.getByRole("heading", { name: /^refeicoes · linha \d+$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel.getByRole("heading", { name: "refeicoes", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("a field with empty values lists exactly those rows", async ({ page, request }) => {
    await open(page, request, "refeicoes");
    await page.goto("/mapa?campo=refeicoes.cozinha_id");
    const panel = page.getByRole("dialog", { name: "cozinha_id" });
    await expect(panel).toContainText("1 vazio");
    const empty = panel.getByRole("table", { name: "Linhas de refeicoes sem cozinha_id" });
    await expect(empty.getByRole("row")).toHaveCount(2);
    await expect(empty).toContainText("vazio");
    await expect(page.getByRole("navigation", { name: "Rastro da investigação" }).getByRole("link", { name: "refeicoes" })).toHaveAttribute("href", "/mapa?tabela=refeicoes");
  });

  test("the keyboard zooms, pans and fits the map", async ({ page, request }) => {
    await open(page, request, "refeicoes");
    const zoom = page.locator(".zoom-ui .zl");
    const initial = await zoom.textContent();
    await page.locator(".map-stage").focus();
    await page.keyboard.press("+");
    await expect(zoom).not.toHaveText(initial ?? "");
    await page.keyboard.press("0");
    await expect(zoom).toHaveText(initial ?? "");
  });
});

async function outsideView(page: Page, keys?: string[]) {
  return page.evaluate((only) => {
    const panel = document.querySelector("[role=dialog]")!.getBoundingClientRect();
    const stage = document.querySelector(".map-stage")!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>("article.sheet")]
      .filter((sheet) => !only || only.includes(sheet.dataset.table ?? ""))
      .filter((sheet) => {
        const r = sheet.getBoundingClientRect();
        return !(r.left >= stage.left && r.right <= panel.left && r.top >= stage.top && r.bottom <= stage.bottom);
      })
      .map((sheet) => {
        const r = sheet.getBoundingClientRect();
        return `${sheet.dataset.table} ${Math.round(r.left)}-${Math.round(r.right)} x ${Math.round(r.top)}-${Math.round(r.bottom)} (painel ${Math.round(panel.left)}, palco ${Math.round(stage.top)}-${Math.round(stage.bottom)})`;
      });
  }, keys ?? null);
}

test("the heading explains the screen and summarises the real relations", async ({ page, request }) => {
  await resetMeals(page, request);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Como seus dados se conectam");
  await expect(page.locator(".map-summary")).toHaveText("1 relação aguarda sua decisão. Clique numa conexão para ver a evidência.");
});

test("opening a field keeps its table and the neighbour visible beside the panel", async ({ page, request }) => {
  await open(page, request, "refeicoes");
  await tableSheet(page, "refeicoes").getByRole("button", { name: /^Campo id:/ }).click();
  await expect(page.getByRole("dialog", { name: "id" })).toBeVisible();
  await expect.poll(() => outsideView(page)).toEqual([]);
});

test.describe("Mapa · Cadastro e atendimentos", () => {
  test("opening a relation keeps both of its tables in view beside the panel", async ({ page, request }) => {
    await open(page, request, "cadastro");
    await relationMark(page, "beneficiarios.cozinha_id → cozinhas.id").click();
    await expect(page.getByRole("dialog", { name: "beneficiarios → cozinhas" })).toBeVisible();
    await expect.poll(() => outsideView(page, ["beneficiarios", "cozinhas"])).toEqual([]);
  });

  test("linking to a target with repeated ids never presents N:1 as proven", async ({ page, request }) => {
    const api = await open(page, request, "cadastro");
    await page.goto("/mapa?campo=atendimentos.beneficiario_id");
    const panel = page.getByRole("dialog", { name: "beneficiario_id" });
    await panel.getByRole("button", { name: "Ligar a outra tabela…" }).click();
    await expect(panel.getByLabel("Coluna de destino")).toHaveValue("beneficiarios.id");
    await expect(panel).toContainText("cobertura 98,8% (9.634 de 9.756 linhas)");
    await expect(panel).toContainText("6 ids repetidos no destino");

    const create = panel.getByRole("button", { name: "Criar relação" });
    const existing = panel.getByRole("button", { name: "Abrir a relação existente" });
    await expect(create.or(existing)).toBeVisible();
    await (await create.isVisible() ? create : existing).click();

    const relation = page.getByRole("dialog", { name: "atendimentos → beneficiarios" });
    await expect(relation).toBeVisible();
    const reopen = relation.getByRole("button", { name: "Desfazer decisão" });
    if (await reopen.isVisible()) await reopen.click();
    await expect(relation).toContainText("N:1 não comprovada.");
    await expect(relation.getByRole("list", { name: "Resumo da evidência" })).toContainText("6 ids repetidos");
    await expect(relation.getByRole("list", { name: "Resumo da evidência" })).toContainText("N:N observada");
    await expect(relation.getByRole("list", { name: "Resumo da evidência" })).toContainText(/\+[\d.]+ linhas na junção/);
    await expect(relation.getByRole("button", { name: /^Confirmar como/ })).toHaveCount(0);
    await expect(relation.getByRole("button", { name: "Aceitar a multiplicidade…" })).toBeVisible();

    const created = await api.find("atendimentos.beneficiario_id", "beneficiarios.id");
    expect(created?.status).toBe("suggested");
    await api.decide(created!.id, "reject");
  });

  test("correcting columns replaces the relation and rejects the wrong one", async ({ page, request }) => {
    const api = await open(page, request, "cadastro");
    const wrong = await api.ensure("atendimentos.id", "beneficiarios.id");
    await page.goto(`/mapa?relacao=${wrong.id}`);
    const panel = page.getByRole("dialog", { name: "atendimentos → beneficiarios" });
    await expect(panel).toContainText("0,0% das linhas encontram par");

    await panel.getByRole("button", { name: "Corrigir colunas" }).click();
    await panel.getByLabel("Coluna de origem").selectOption("beneficiario_id");
    await expect(panel).toContainText("cobertura 98,8%");
    await panel.getByRole("button", { name: "Usar estas colunas" }).click();

    await expect(page).not.toHaveURL(new RegExp(wrong.id));
    await expect(panel).toContainText("atendimentos.beneficiario_id = beneficiarios.id");
    await expect(page.getByRole("status")).toContainText("Colunas corrigidas");
    expect((await api.find("atendimentos.id", "beneficiarios.id"))?.status).toBe("rejected");
    const corrected = await api.find("atendimentos.beneficiario_id", "beneficiarios.id");
    expect(corrected?.status).toBe("suggested");
    await api.decide(corrected!.id, "reject");
  });

  test("paths mode lists the direct and the indirect route", async ({ page, request }) => {
    const api = await open(page, request, "cadastro");
    const link = await api.ensure("atendimentos.beneficiario_id", "beneficiarios.id");
    await page.reload();
    await selectScenario(page, "cadastro");

    await page.getByRole("group", { name: "Modo do mapa" }).getByRole("button", { name: "Caminhos" }).click();
    await page.getByLabel("Tabela de partida").selectOption("atendimentos");
    await page.getByLabel("Tabela de chegada").selectOption("cozinhas");
    const options = page.getByRole("group", { name: "2 caminhos possíveis" }).getByRole("button");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText(/atendimentos\s*→\s*\d?cozinhas/);
    await expect(options.nth(0)).toContainText("direto");
    await expect(options.nth(1)).toContainText(/atendimentos\s*→\s*\d?beneficiarios\s*→\s*\d?cozinhas/);
    await expect(options.nth(1)).toContainText(/decis(ão|ões) pendentes?/);
    await expect(options.nth(1)).toContainText("destino com ids repetidos");
    await expect(options.nth(1)).toContainText("só estrutural");
    await options.nth(1).click();
    await expect(options.nth(1)).toContainText(/atendimentos → beneficiarios: cobertura 98,8% · \+[\d.]+ linhas na junção/);
    await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(tableSheet(page, "atendimentos").locator(".route-badge")).toHaveText("1");
    await expect(tableSheet(page, "beneficiarios").locator(".route-badge")).toHaveText("2");
    await expect(tableSheet(page, "cozinhas").locator(".route-badge")).toHaveText("3");

    await api.decide(link.id, "reject");
  });
});

test.describe("Mapa · relações com ressalva", () => {
  test("accepting the multiplicity is explicit, marked on the map and explained with the records involved", async ({ page, request }) => {
    const api = await open(page, request, "cadastro");
    const link = await api.ensure("atendimentos.beneficiario_id", "beneficiarios.id");
    if (link.status !== "suggested") await api.decide(link.id, "reopen");
    await page.goto(`/mapa?relacao=${link.id}`);
    const panel = page.getByRole("dialog", { name: "atendimentos → beneficiarios" });

    await expect(panel.getByRole("list", { name: "Resumo da evidência" })).toContainText(/\+[\d.]+ linhas na junção/);
    await expect(panel).toContainText(/Na junção, 9\.634 linhas com par viram [\d.]+: [\d.]+ linhas? a mais/);
    await panel.getByRole("button", { name: "Aceitar a multiplicidade…" }).click();
    await expect(panel).toContainText("a decisão vale para atendimentos v1 e beneficiarios v1");
    await panel.getByRole("button", { name: "Confirmar aceitando a multiplicidade" }).click();

    await expect(panel.getByText("com ressalva", { exact: true })).toBeVisible();
    await expect(relationMark(page, "atendimentos.beneficiario_id → beneficiarios.id")).toHaveAccessibleName(/confirmada com ressalva/);
    const saved = await api.find("atendimentos.beneficiario_id", "beneficiarios.id");
    expect([saved?.status, saved?.policy, saved?.standing.key]).toEqual(["confirmed", "accept_multiplicity", "caveat"]);

    await panel.getByText("O que acontece numa junção").click();
    await panel.getByRole("table", { name: "Ids repetidos que multiplicam linhas" }).getByRole("row").nth(1).click();
    const copies = panel.getByRole("table", { name: "Cópias em beneficiarios" });
    await expect(copies).toBeVisible();
    await expect.poll(() => copies.getByRole("row").count()).toBeGreaterThanOrEqual(3);

    await api.decide(link.id, "reject");
  });
});

test("the paths card never covers the map on a narrow desktop", async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page, request, "refeicoes");
  await page.getByRole("group", { name: "Modo do mapa" }).getByRole("button", { name: "Caminhos" }).click();
  await expect(page.locator(".paths-card")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const card = document.querySelector(".paths-card")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>("article.sheet, .mark")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < card.right && card.left < r.right && r.top < card.bottom && card.top < r.bottom;
        }).length;
      }),
    )
    .toBe(0);
});

test("opening a table on a narrow desktop keeps the map readable", async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page, request, "refeicoes");
  const zoom = page.locator(".zoom-ui .zl");
  const before = parseInt((await zoom.textContent()) ?? "0", 10);
  await tableSheet(page, "refeicoes").getByRole("button", { name: "refeicoes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "refeicoes" })).toBeVisible();
  await expect.poll(() => outsideView(page, ["refeicoes"])).toEqual([]);
  const after = parseInt((await zoom.textContent()) ?? "0", 10);
  expect(after).toBeGreaterThanOrEqual(Math.min(before, 80));
});

test("on a phone the map becomes a list and the panel takes the full width", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request, "refeicoes");
  const card = page.getByRole("button", { name: new RegExp(`^${MEALS}`) });
  await card.click();
  const panel = page.getByRole("dialog", { name: "refeicoes → cozinhas" });
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("searching for relations again keeps the decisions already made", async ({ page, request }) => {
  const api = await resetMeals(page, request);
  const meals = await api.find("refeicoes.cozinha_id", "cozinhas.id");
  await api.decide(meals!.id, "reject");
  await page.reload();
  await selectScenario(page, "refeicoes");

  await page.getByRole("button", { name: "Procurar relações" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nenhuma relação nova" })).toBeVisible();
  await expect(relationMark(page, MEALS)).toHaveAccessibleName(/: rejeitada,/);
  expect((await api.find("refeicoes.cozinha_id", "cozinhas.id"))?.status).toBe("rejected");
  await api.decide(meals!.id, "reopen");
});

test("validity is declared explicitly in the table panel and marked on the map", async ({ page, request }) => {
  const api = await open(page, request, "cadastro");
  await api.clearValidity("beneficiarios");

  await page.goto("/mapa?tabela=beneficiarios");
  const panel = page.getByRole("dialog", { name: "beneficiarios" });
  const declare = panel.getByRole("button", { name: "Declarar vigência" });
  await expect(declare).toBeDisabled();
  await panel.getByRole("radio", { name: /^Sim: quem tem fim em 31\/12/ }).check();
  await declare.click();

  await expect(panel).toContainText("data_cadastro marca o início e data_desligamento o fim; o dia do fim ainda conta como vigente.");
  await expect(tableSheet(page, "beneficiarios").getByRole("button", { name: "Campo data_cadastro: início da vigência" })).toBeVisible();

  await panel.getByRole("button", { name: "Remover declaração" }).click();
  await expect(panel.getByRole("button", { name: "Declarar vigência" })).toBeVisible();
});
