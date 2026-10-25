import { expect, type Page } from "@playwright/test";

export const SCENARIOS = {
  refeicoes: { label: "Refeições", datasets: ["cozinhas", "refeicoes"] },
  cadastro: { label: "Cadastro e atendimentos", datasets: ["atendimentos", "beneficiarios", "cozinhas"] },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;

export function scenarioButton(page: Page) {
  return page.getByRole("button", { name: /Cenário de demonstração/ });
}

export function datasetCard(page: Page, key: string) {
  return page.getByRole("button", { name: new RegExp(`^${key}\\b`) });
}

export async function selectScenario(page: Page, key: ScenarioKey) {
  const { label, datasets } = SCENARIOS[key];
  const button = scenarioButton(page);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  if (!(await button.textContent())?.includes(label)) {
    await button.click();
    await page.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
  }
  await expect(button).toContainText(label, { timeout: 30_000 });
  for (const dataset of datasets) {
    await expect(datasetCard(page, dataset)).toBeVisible({ timeout: 30_000 });
  }
}
