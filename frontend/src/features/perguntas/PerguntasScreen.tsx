"use client";

import { useTrail } from "@/components/shell/Trail";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { formatWhen } from "@/lib/format";
import { useRecipes } from "@/lib/queries";
import { UnderConstruction } from "@/features/shared/UnderConstruction";

const RUN_WORDS = { queued: "na fila", running: "executando", succeeded: "concluída", failed: "falhou" } as const;

export function PerguntasScreen() {
  useTrail([{ label: "Perguntas" }]);
  const recipes = useRecipes();
  const list = recipes.data?.data ?? [];

  return (
    <div className="mx-auto grid max-w-[1240px] gap-10 px-8 pt-9 pb-24">
      <header className="grid gap-2">
        <p className="eyebrow eyebrow-ab">Perguntas</p>
        <h1 className="font-display text-[clamp(30px,3.2vw,44px)] leading-[1.08] font-bold tracking-[-0.03em]">Pergunte aos dados, passo a passo</h1>
        <UnderConstruction>
          A pergunta editável, os esclarecimentos e a resposta rastreável chegam depois do motor de perguntas. Abaixo, as receitas que o motor atual já executa neste cenário.
        </UnderConstruction>
      </header>

      <section aria-labelledby="perguntas-receitas" className="grid gap-4">
        <h2 id="perguntas-receitas" className="eyebrow">
          Receitas salvas
        </h2>
        {recipes.isPending && <LoadingBlock label="Carregando receitas" />}
        {recipes.isError && <ErrorBlock error={recipes.error} onRetry={() => recipes.refetch()} />}
        {recipes.isSuccess && list.length === 0 && (
          <EmptyBlock title="Nenhuma receita neste cenário ainda.">As perguntas criadas aqui vão virar receitas executáveis e validáveis.</EmptyBlock>
        )}
        {list.length > 0 && (
          <ul className="grid max-w-[860px] gap-2">
            {list.map((recipe) => (
              <li key={recipe.id} className="grid gap-1 rounded-xl border border-rule bg-sheet px-4 py-3">
                <span className="text-[16px] font-semibold">{recipe.name}</span>
                <span className="text-[14px] text-ink-2">
                  revisão {recipe.revision} · {recipe.compiled.steps.length} passos ·{" "}
                  {recipe.last_run ? `última execução ${RUN_WORDS[recipe.last_run.status]} em ${formatWhen(recipe.last_run.finished_at ?? recipe.last_run.queued_at)}` : "nunca executada"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
