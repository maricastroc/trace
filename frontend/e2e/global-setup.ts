import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { selectScenario } from "./scenario";

export default async function globalSetup(config: FullConfig) {
  const { baseURL, storageState } = config.projects[0].use;
  const statePath = String(storageState);
  mkdirSync(dirname(statePath), { recursive: true });

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ baseURL, storageState: existsSync(statePath) ? statePath : undefined });
  const page = await context.newPage();

  await page.goto("/mapa");
  await selectScenario(page, "cadastro");
  await selectScenario(page, "refeicoes");

  await context.storageState({ path: statePath });
  await browser.close();
}
