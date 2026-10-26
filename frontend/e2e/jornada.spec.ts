import { expect, test, type Page } from "@playwright/test";
import { API_URL, selectScenario } from "./scenario";

const UNITS = ["id,nome,bairro", "U01,Unidade Aurora,Centro", "U02,Unidade Brisa,Norte", "U03,Unidade Cais,Sul", "U04,Unidade Duna,Leste", "U05,Unidade Eira,Oeste"];

const VISITS = [
  "id,unidade_id,data",
  "V01,U01,2025-01-14",
  "V02,U01,2025-02-03",
  "V03,U02,2025-02-20",
  "V04,U02,2025-03-11",
  "V05,U03,2025-04-02",
  "V06,U01,2025-05-19",
  "V07,U03,2025-06-07",
  "V08,U02,2025-07-23",
  "V09,U09,2025-08-30",
  "V10,,2025-09-12",
  "V11,U01,2025-10-01",
  "V12,U03,2025-11-15",
  "V13,U02,2024-12-28",
  "V14,U01,2024-11-03",
];

const count = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

function parsed(lines: string[]) {
  const [header, ...rows] = lines;
  const keys = header.split(",");
  return rows.map((line) => Object.fromEntries(line.split(",").map((value, i) => [keys[i], value === "" ? null : value])) as Record<string, string | null>);
}

async function importCsv(page: Page, name: string, lines: string[]) {
  await page.goto("/mapa?importar=nova");
  const panel = page.getByRole("dialog", { name: "Trazer um arquivo" });
  await panel.locator("input[type=file]").setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await expect(panel).toContainText(`${lines.length - 1} linhas e 3 colunas`);
  await panel.getByRole("button", { name: "Importar tabela" }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible({ timeout: 30_000 });
}

test("a file goes from import to a traced question and a traced comparison, and both reopen as recorded", async ({ page, request }) => {
  test.setTimeout(120_000);
  const created = await request.post(`${API_URL}/workspaces`, { data: { scenario: "refeicoes" }, headers: { Accept: "application/json" } });
  expect(created.ok()).toBe(true);
  const token = ((await created.json()) as { data: { token: string } }).data.token;
  await page.addInitScript((fresh) => {
    const tokens = JSON.parse(localStorage.getItem("trace.workspace-tokens") ?? "{}");
    localStorage.setItem("trace.workspace-tokens", JSON.stringify({ ...tokens, refeicoes: fresh }));
    localStorage.setItem("trace.scenario", "refeicoes");
  }, token);
  const headers = { "X-Trace-Workspace": token, Accept: "application/json" };
  const relationId = async () => {
    const response = await request.get(`${API_URL}/relationships`, { headers });
    const list = ((await response.json()) as { data: { id: string; from: { dataset_key: string; column: string }; to: { dataset_key: string; column: string } }[] }).data;
    return (
      list.find((r) => r.from.dataset_key === "visitas_jornada" && r.from.column === "unidade_id" && r.to.dataset_key === "unidades_jornada" && r.to.column === "id")?.id ?? null
    );
  };

  await page.goto("/mapa");
  await selectScenario(page, "refeicoes");
  await importCsv(page, "unidades_jornada", UNITS);
  await importCsv(page, "visitas_jornada", VISITS);

  await expect.poll(relationId, { timeout: 30_000 }).not.toBeNull();
  const relation = (await relationId())!;
  await page.goto(`/mapa?relacao=${relation}`);
  const decision = page.getByRole("region", { name: "Sua decisão" });
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: /^Confirmar como/ }).click();
  await expect(page.getByRole("region", { name: "Mesma entidade?" })).toBeVisible();

  const visits = parsed(VISITS);
  const in2025 = visits.filter((visit) => visit.data!.startsWith("2025"));
  await page.goto("/perguntas?tabela=visitas_jornada");
  const sentence = page.locator(".q-sentence");
  await expect(sentence).toContainText("Em visitas_jornada com data em 2025, quantos registros");
  await expect(page.getByRole("img", { name: `${count(in2025.length)} registros` })).toBeVisible();
  await expect(page.getByText("Para rastrear este resultado")).toHaveCount(0);

  await page.getByRole("button", { name: "Investigar a resposta" }).click();
  const investigation = page.locator("#q-inv");
  await investigation.getByRole("button", { name: "Rastrear agora" }).click();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  const trail = investigation.getByRole("list", { name: "Percurso das linhas, do arquivo ao resultado" });
  await expect(trail.locator("li.ts-source")).toContainText(`${visits.length}linhas de entrada`);
  await investigation.getByRole("button", { name: /^entram/ }).click();
  const entering = investigation.getByRole("table", { name: "Linhas que entram na resposta" });
  await entering
    .getByRole("button", { name: /^Abrir a linha \d+ do arquivo$/ })
    .first()
    .click();
  await expect(investigation.getByRole("region", { name: /^Linha \d+ do arquivo$/ })).toContainText("visitas_jornada · versão 1");

  await page.reload();
  await expect(page.getByText("rastreada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: `${count(in2025.length)} registros` })).toBeVisible();

  const units = new Set(parsed(UNITS).map((unit) => unit.id!));
  const referenced = new Set(visits.map((visit) => visit.unidade_id).filter((value): value is string => value !== null));
  const shared = [...units].filter((id) => referenced.has(id)).length;
  await page.goto("/comparacoes");
  const side = (name: "A" | "B") => page.getByRole("group", { name: `Lado ${name}`, exact: true });
  const pick = async (name: "A" | "B", key: string, column: string) => {
    const select = side(name).getByLabel("Tabela");
    await select.selectOption((await select.locator("option", { hasText: `(${key})` }).getAttribute("value"))!);
    await side(name).getByLabel("Coluna identificadora").selectOption(column);
  };
  await pick("A", "unidades_jornada", "id");
  await pick("B", "visitas_jornada", "unidade_id");
  const check = page.locator(".eq-box");
  await expect(check).toContainText("Isso autoriza usar a relação para ligar tabelas, mas não declara que as colunas identificam a mesma entidade.");
  await page.getByRole("checkbox", { name: /^Confirmo que/ }).check();
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`^Por que ${units.size} identidades em .+ e ${referenced.size} em .+\\?$`));
  const answer = page.getByRole("region", { name: "Resposta" });
  const split = `${units.size - shared} só em Unidades jornada + ${referenced.size - shared} só em Visitas jornada`;
  await expect(answer).toContainText(split);
  await expect(answer).toContainText(`${shared} aparecem nas duas`);

  await page.getByRole("button", { name: "Rastrear a comparação" }).click();
  const status = page.getByRole("status").filter({ hasText: "Execução rastreada em" });
  await expect(status).toContainText("unidades_jornada versão 1 e visitas_jornada versão 1", { timeout: 30_000 });
  const runUrl = page.url();

  await page.goto("/comparacoes");
  const history = page.getByRole("region", { name: "Comparações rastreadas" });
  const item = history.getByRole("listitem").filter({ hasText: "unidades_jornada.id" });
  await expect(item).toContainText(`${units.size} − ${units.size - shared} + ${referenced.size - shared} = ${referenced.size}`);
  const previews: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/comparisons/preview")) previews.push(req.url());
  });
  await item.getByRole("link", { name: "Abrir a execução" }).click();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByRole("status").filter({ hasText: "Execução rastreada em" })).toBeVisible();
  await expect(answer).toContainText(split);
  expect(previews).toHaveLength(0);

  await page.goto("/mapa?tabela=visitas_jornada");
  const panel = page.getByRole("dialog", { name: "visitas_jornada" });
  await panel.getByRole("button", { name: "Remover tabela" }).click();
  const confirm = panel.getByRole("group", { name: "Confirmar a remoção de visitas_jornada" });
  await expect(confirm).toContainText("visitas_jornada foi usada em 2 execuções rastreadas, 1 pergunta ou receita, 1 comparação.");
  await expect(confirm).toContainText("Cópias feitas fora do Trace");
  const erase = confirm.getByRole("button", { name: "Apagar a tabela e o histórico" });
  await expect(erase).toBeDisabled();
  await confirm.getByRole("textbox", { name: /Para confirmar, digite/ }).fill("visitas_jornada");
  await erase.click();
  await expect(page.getByText("visitas_jornada apagada com 2 execuções e 1 comparação que dependiam dela.")).toBeVisible();
  const erasures = (await (await request.get(`${API_URL}/dataset-erasures`, { headers })).json()) as { data: { dataset_key: string; versions: { row_count: number }[] }[] };
  expect(erasures.data.map((item) => [item.dataset_key, item.versions[0].row_count])).toEqual([["visitas_jornada", visits.length]]);
  await page.goto("/comparacoes");
  await expect(page.getByRole("region", { name: "Comparações rastreadas" }).getByRole("listitem").filter({ hasText: "unidades_jornada.id" })).toHaveCount(0);
});
