"use client";

import { formatDuration, formatWhen, shortId } from "@/lib/format";
import type { DatasetSummary, Recipe, Relationship, RunDetail, RunSummary } from "@/lib/types";

type Props = {
  recipe: Recipe;
  datasets: DatasetSummary[];
  relationships: Relationship[];
  runs: RunSummary[];
  run: RunDetail | null;
  runId: string | null;
  textMode: boolean;
  launching: boolean;
  onRunSelect: (id: string) => void;
  onRun: () => void;
  onRelationship: (id: string) => void;
  onDataset: (alias: string) => void;
  onTextMode: (value: boolean) => void;
};

const STATUS = { suggested: "sugerido", confirmed: "confirmado", rejected: "rejeitado" } as const;
const RUN = { queued: "na fila", running: "executando", succeeded: "concluída", failed: "falhou" } as const;

export function ContextBar({ recipe, datasets, relationships, runs, run, runId, textMode, launching, onRunSelect, onRun, onRelationship, onDataset, onTextMode }: Props) {
  const runnable = recipe.compiled.runnable;
  const busy = launching || run?.status === "queued" || run?.status === "running";

  return (
    <div className="border-y border-ink/12 bg-paper">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5 text-[15px] sm:px-8">
        <span className="flex flex-wrap items-center gap-2">
          {datasets.map((d) => (
            <button key={d.id} type="button" onClick={() => onDataset(d.key)} className="rounded-full border border-ink/20 px-3 py-1 hover:border-ink">
              <span className="font-mono">{d.key}</span> <span className="numerals text-ink-2">{d.latest_version?.row_count ?? "—"} · v{d.latest_version?.number ?? "—"}</span>
            </button>
          ))}
        </span>
        {relationships.map((r) => (
          <button key={r.id} type="button" onClick={() => onRelationship(r.id)} className="flex items-center gap-2 rounded-full border border-ink/20 px-3 py-1 hover:border-ink">
            <span aria-hidden className="size-2 rounded-full" style={{ background: r.status === "confirmed" ? "#1d7a4b" : r.status === "rejected" ? "#8f8778" : "#c58a00" }} />
            <span className="font-mono">
              {r.from.dataset_key}.{r.from.column} → {r.to.dataset_key}.{r.to.column}
            </span>
            <span className="text-ink-2">{STATUS[r.status]}</span>
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-3">
          {runs.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="text-ink-2">execução</span>
              <select
                value={runId ?? ""}
                onChange={(event) => onRunSelect(event.target.value)}
                className="rounded-full border border-ink/20 bg-paper px-3 py-1 font-mono text-[14px] hover:border-ink"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {shortId(r.id)} · {r.status === "succeeded" ? formatWhen(r.finished_at) : RUN[r.status]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {run?.status === "succeeded" && <span className="text-ink-2">{formatDuration(run.duration_ms)}</span>}
          {run?.recipe_changed_since && <span className="rounded-full bg-[#f6e8c6] px-2.5 py-0.5 text-[14px] text-[#7a5300]">a receita mudou depois desta execução</span>}
          {run?.inputs.some((i) => i.newer_version_available) && <span className="rounded-full bg-[#f6e8c6] px-2.5 py-0.5 text-[14px] text-[#7a5300]">há versão mais nova dos dados</span>}
          {runnable && run && (
            <button type="button" disabled={busy} onClick={onRun} className="rounded-full bg-ink px-4 py-1.5 font-semibold text-[#f3efe6] hover:bg-ink-2 disabled:opacity-60">
              {busy ? "Executando…" : "Executar novamente"}
            </button>
          )}
          <button type="button" aria-pressed={textMode} onClick={() => onTextMode(!textMode)} className={`rounded-full px-3 py-1 ${textMode ? "bg-ink text-[#f3efe6]" : "border border-ink/20 hover:border-ink"}`}>
            ler como texto
          </button>
        </span>
      </div>
    </div>
  );
}
