import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API_URL = process.env.TRACE_E2E_API_URL ?? "http://localhost:8000/api/v1";

export const SCENARIOS = {
  refeicoes: { label: "Refeições", datasets: ["cozinhas", "refeicoes"] },
  cadastro: { label: "Cadastro e atendimentos", datasets: ["atendimentos", "beneficiarios", "cozinhas"] },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;

export function scenarioButton(page: Page) {
  return page.getByRole("button", { name: /Cenário de demonstração/ });
}

export function tableSheet(page: Page, key: string) {
  return page.getByRole("article", { name: new RegExp(`^Tabela ${key},`) });
}

export function relationMark(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^Relação ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`) });
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
    await expect(tableSheet(page, dataset)).toBeVisible({ timeout: 30_000 });
  }
}

type Relation = {
  id: string;
  status: string;
  policy: string | null;
  standing: { key: string };
  from: { dataset_key: string; column: string };
  to: { dataset_key: string; column: string };
};

export async function workspaceApi(page: Page, request: APIRequestContext, scenario: ScenarioKey) {
  const tokens = await page.evaluate(() => JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}"));
  const headers = { "X-Trace-Workspace": tokens[scenario] as string, Accept: "application/json" };
  const call = async <T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
    const response = await request.fetch(`${API_URL}${path}`, { method, headers, data });
    expect(response.ok(), `${method} ${path} → ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  };
  const datasets = async () => (await call<{ data: { id: string; key: string }[] }>("GET", "/datasets")).data;
  const relations = async () => (await call<{ data: Relation[] }>("GET", "/relationships")).data;
  const find = async (from: string, to: string) =>
    (await relations()).find((r) => `${r.from.dataset_key}.${r.from.column}` === from && `${r.to.dataset_key}.${r.to.column}` === to) ?? null;
  return {
    relations,
    find,
    async decide(id: string, action: "confirm" | "reject" | "reopen") {
      return (await call<{ data: Relation }>("POST", `/relationships/${id}/${action}`)).data;
    },
    async ensure(from: string, to: string) {
      const byKey = Object.fromEntries((await datasets()).map((d) => [d.key, d.id]));
      const [fromTable, fromColumn] = from.split(".");
      const [toTable, toColumn] = to.split(".");
      return (
        await call<{ data: Relation }>("POST", "/relationships", {
          from_dataset_id: byKey[fromTable],
          from_column: fromColumn,
          to_dataset_id: byKey[toTable],
          to_column: toColumn,
        })
      ).data;
    },
  };
}
