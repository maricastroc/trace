import { expect, test } from "@playwright/test";
import { datasetCard, scenarioButton, selectScenario } from "./scenario";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await selectScenario(page, "refeicoes");
});

test("the root opens the Mapa with the real meals tables and relation", async ({ page }) => {
  await expect(page).toHaveURL(/\/mapa$/);
  await expect(page).toHaveTitle("Mapa · Trace");
  await expect(datasetCard(page, "refeicoes")).toContainText("118 linhas");
  await expect(datasetCard(page, "cozinhas")).toContainText("15 linhas");

  const relation = page.getByRole("listitem").filter({ hasText: "refeicoes.cozinha_id → cozinhas.id" });
  await expect(relation).toContainText(/sugerida|confirmada|rejeitada/);
  await expect(relation).toContainText(/cobertura \d+,\d%/);

  await expect(page.getByRole("button", { name: "dados sintéticos" })).toBeVisible();
});

test("the main navigation has three areas and marks the current one", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Áreas do Trace" });
  await expect(nav.getByRole("link")).toHaveText(["Mapa", "Perguntas", "Comparações"]);
  await expect(nav.getByRole("link", { name: "Mapa" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Perguntas" }).click();
  await expect(page).toHaveURL(/\/perguntas$/);
  await expect(page).toHaveTitle("Perguntas · Trace");
  await expect(nav.getByRole("link", { name: "Perguntas" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Mapa" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Refeições de setembro por município")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Rastro da investigação" })).toContainText("Perguntas");

  await nav.getByRole("link", { name: "Comparações" }).click();
  await expect(page).toHaveURL(/\/comparacoes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Por que esses números não batem?");
  await expect(page.getByText("em construção")).toBeVisible();
});

test("the skip link is the first stop and moves focus to the content", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#conteudo")).toBeFocused();
});

test("switching scenario by keyboard loads its own workspace from the API", async ({ page }) => {
  const button = scenarioButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Cenários de demonstração" });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /^Refeições/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: /^Cadastro e atendimentos/ })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(button).toContainText("Cadastro e atendimentos");
  await expect(datasetCard(page, "beneficiarios")).toContainText("1.248 linhas");
  await expect(datasetCard(page, "atendimentos")).toContainText("9.756 linhas");
  await expect(datasetCard(page, "cozinhas")).toContainText("12 linhas");
  await expect(datasetCard(page, "refeicoes")).toHaveCount(0);

  const tokens = await page.evaluate(() => JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}"));
  expect(Object.keys(tokens).sort()).toEqual(["cadastro", "refeicoes"]);
  expect(tokens.cadastro).not.toEqual(tokens.refeicoes);

  await selectScenario(page, "refeicoes");
  await expect(datasetCard(page, "beneficiarios")).toHaveCount(0);
});

test("a table opens in a side panel that closes with Escape and returns focus", async ({ page }) => {
  const card = datasetCard(page, "cozinhas");
  await card.click();

  const panel = page.getByRole("dialog", { name: "cozinhas" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "cozinhas" })).toBeFocused();
  await expect(panel.getByText("Campos · 4")).toBeVisible();
  await expect(panel.getByText("municipio", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(card).toBeFocused();
});
