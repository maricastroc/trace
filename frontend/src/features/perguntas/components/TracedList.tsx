"use client";

import { formatWhen } from "@/lib/format";
import type { QuestionSpec, Recipe } from "@/lib/types";

const RUN_WORDS = { queued: "na fila", running: "executando", succeeded: "rastreada", failed: "falhou" } as const;

type Props = { recipes: Recipe[]; currentKey: string | null; onOpen: (question: QuestionSpec) => void };

export function TracedList({ recipes, currentKey, onOpen }: Props) {
  const traced = recipes.filter((recipe): recipe is Recipe & { question: QuestionSpec } => recipe.question !== null);
  const others = recipes.filter((recipe) => recipe.question === null).map((recipe) => recipe.name);
  if (traced.length === 0 && others.length === 0) return null;

  return (
    <section aria-labelledby="traced-title" className="grid gap-3">
      <h2 id="traced-title" className="eyebrow m-0">
        Perguntas rastreadas neste cenário
      </h2>
      {traced.length === 0 ? (
        <p className="small-note">Nenhuma pergunta rastreada ainda. Rastrear grava a resposta e a linhagem para consultar depois.</p>
      ) : (
        <ul className="traced-list">
          {traced.map((recipe) => (
            <li key={recipe.id}>
              <button type="button" className="traced-item" aria-current={recipe.question_key === currentKey} onClick={() => onOpen(recipe.question)}>
                <span className="t">{recipe.name}</span>
                <span className="s">
                  {recipe.last_run ? `${RUN_WORDS[recipe.last_run.status]} em ${formatWhen(recipe.last_run.finished_at ?? recipe.last_run.queued_at)}` : "nunca executada"}
                  {recipe.revision > 1 ? ` · revisão ${recipe.revision}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <p className="small-note">
          {others.length === 1 ? "Criada fora de Perguntas, direto no motor" : "Criadas fora de Perguntas, direto no motor"}: {others.join(", ")}.{" "}
          {others.length === 1 ? "Continua executável, mas não tem" : "Continuam executáveis, mas não têm"} uma pergunta editável.
        </p>
      )}
    </section>
  );
}
