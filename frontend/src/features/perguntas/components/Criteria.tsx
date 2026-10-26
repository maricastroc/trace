"use client";

import Link from "next/link";
import { StatePill } from "@/components/ui/StatePill";
import { formatCount, shortId } from "@/lib/format";
import { useQuestionReadings } from "@/lib/queries";
import type { Preview, QuestionSpec, RunDetail } from "@/lib/types";
import { answerValue, formatAnswer, type Note, type Outcome } from "../model/answer";
import type { Catalog, CatalogTable } from "../model/catalog";
import { brDate, periodLabel } from "../model/period";
import { currentDimension, READING_TITLE } from "../model/question";

const STANDING_WORDS: Record<string, string> = { suggested: "sugerida", confirmed: "confirmada", caveat: "confirmada com ressalva", rejected: "rejeitada", review: "para reavaliar" };

function measureText(question: QuestionSpec) {
  const column = question.measure.column;
  switch (question.measure.function) {
    case "count_distinct":
      return `Conta valores diferentes de ${column}: cada valor conta uma vez, comparado como texto exato (0187 e 187 são valores diferentes). Linhas com ${column} vazio não contam.`;
    case "sum":
      return `Soma ${column}. Vazios e valores que não são números ficam fora da soma e aparecem nos diagnósticos da execução.`;
    default:
      return "Conta linhas: cada linha que chega ao fim conta uma vez, inclusive cópias criadas por uma ligação com ids repetidos no destino.";
  }
}

function useReadingCriteria(question: QuestionSpec) {
  const period = question.period;
  const readings = useQuestionReadings(period?.kind === "validity" ? { ...question, period: { ...period, reading: null } } : null);
  if (period?.kind !== "validity") return null;
  return readings.data?.data.readings.find((option) => option.reading === period.reading)?.criteria ?? null;
}

type CriteriaProps = { catalog: Catalog; base: CatalogTable; question: QuestionSpec; notes: Note[] };

export function Criteria({ catalog, base, question, notes }: CriteriaProps) {
  const criteria = useReadingCriteria(question);
  const period = question.period;
  const dimension = currentDimension(catalog, base, question.dimension);
  const relations = (question.dimension?.relationships ?? []).map((id) => catalog.relationById.get(id)).filter((relation) => relation !== undefined);

  return (
    <div className="crit-grid">
      <section className="crit-sec">
        <h3>Período</h3>
        {period?.kind === "validity" && period.reading && (
          <>
            <p className="cs-t">
              {READING_TITLE[period.reading]} {periodLabel(period.from, period.to)}
            </p>
            {criteria ? (
              <dl className="cs-dl">
                <dt>entra</dt>
                <dd>{criteria.enters}</dd>
                <dt>fica de fora</dt>
                <dd>{criteria.leaves}</dd>
                <dt>regra</dt>
                <dd className="mono">{criteria.rule}</dd>
                <dt>indeterminado</dt>
                <dd>{criteria.undetermined}</dd>
              </dl>
            ) : (
              <p>Carregando a regra exata…</p>
            )}
            <p>As outras duas leituras continuam disponíveis no termo da leitura, na pergunta.</p>
          </>
        )}
        {period?.kind === "date" && (
          <dl className="cs-dl">
            <dt>coluna</dt>
            <dd className="mono">
              {base.key}.{period.column}
            </dd>
            <dt>regra</dt>
            <dd className="mono">
              {brDate(period.from)} ≤ {period.column} ≤ {brDate(period.to)}
            </dd>
            <dt>fica de fora</dt>
            <dd>linhas com data fora do período, vazia ou que não é uma data, cada uma com o motivo</dd>
          </dl>
        )}
        {!period && <p>Sem recorte de período: todas as linhas de {base.key} entram.</p>}
      </section>

      <section className="crit-sec">
        <h3>Medida</h3>
        <p>{measureText(question)}</p>
      </section>

      <section className="crit-sec">
        <h3>Recorte e relações</h3>
        {!question.dimension && <p>Sem recorte: uma resposta só, sem atravessar nenhuma relação.</p>}
        {question.dimension && dimension && (
          <p>
            {question.dimension.value === null
              ? `Agrupa por ${dimension.table.key}.${dimension.column}${dimension.labelColumn ? `, com o rótulo de ${dimension.labelColumn}` : ""}. Quem não encontra correspondência continua no total, num grupo próprio.`
              : `Mantém só ${dimension.table.key}.${dimension.column} = ${question.dimension.value}. Quem não encontra correspondência sai na ligação, com o motivo.`}
          </p>
        )}
        {relations.length > 0 && (
          <ul className="rel-list">
            {relations.map((relation) => (
              <li key={relation.id}>
                <StatePill status={relation.standing} />
                <span className="mono">
                  {catalog.byId.get(relation.from.table)?.key}.{relation.from.column} → {catalog.byId.get(relation.to.table)?.key}.{relation.to.column}
                </span>
                <Link className="btn-link text-[14px]" href={`/mapa?relacao=${relation.id}`}>
                  ver evidência
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notes.length > 0 && (
        <section className="crit-sec">
          <h3>Ambiguidades e limites</h3>
          <div className="notes">
            {notes.map((note) => (
              <div key={note.text} className="note-i">
                <i className={note.kind} aria-hidden />
                <span>{note.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type SpecProps = {
  catalog: Catalog;
  base: CatalogTable;
  question: QuestionSpec;
  text: string;
  preview: Preview | null;
  run: RunDetail | null;
  outcome: Outcome | null;
};

export function Spec({ catalog, base, question, text, preview, run, outcome }: SpecProps) {
  const period = question.period;
  const dimension = currentDimension(catalog, base, question.dimension);
  const relations = (question.dimension?.relationships ?? []).map((id) => catalog.relationById.get(id)).filter((relation) => relation !== undefined);
  const measure =
    question.measure.function === "count"
      ? `contagem de linhas · ${base.key}`
      : question.measure.function === "count_distinct"
        ? `contagem de valores distintos · ${base.key}.${question.measure.column}`
        : `soma · ${base.key}.${question.measure.column}`;
  const periodRow = !period
    ? "sem período"
    : period.kind === "date"
      ? `${base.key}.${period.column} entre ${brDate(period.from)} e ${brDate(period.to)}`
      : `vigência de ${base.key}${base.validity ? ` (${base.validity.start_column}${base.validity.end_column ? ` → ${base.validity.end_column}` : ""})` : " (não declarada)"} · leitura ${period.reading ? `${period.reading} (${READING_TITLE[period.reading].toLocaleLowerCase("pt-BR")})` : "pendente"} · ${brDate(period.from)} a ${brDate(period.to)}`;
  const recorte = !question.dimension
    ? "nenhum"
    : question.dimension.value === null
      ? `agrupar por ${dimension?.table.key ?? "?"}.${question.dimension.column}`
      : `${dimension?.table.key ?? "?"}.${question.dimension.column} = ${question.dimension.value}`;
  const steps = run ? run.steps.map((step) => ({ position: step.position, summary: step.summary })) : (preview?.recipe_steps ?? []).map((step) => ({ position: step.position, summary: step.summary }));
  const value = outcome ? answerValue(outcome) : null;

  return (
    <div className="grid gap-6">
      <div className="ticket">
        <dl>
          <dt>pergunta</dt>
          <dd>{text}</dd>
          <dt>tabela</dt>
          <dd>
            {base.key} · versão {base.versionNumber} · {formatCount(base.rows)} linhas
          </dd>
          <dt>medida</dt>
          <dd>{measure}</dd>
          <dt>período</dt>
          <dd>{periodRow}</dd>
          <dt>recorte</dt>
          <dd>{recorte}</dd>
          <dt>relações</dt>
          <dd>
            {relations.length === 0
              ? "nenhuma"
              : relations.map((relation) => `${catalog.byId.get(relation.from.table)?.key}.${relation.from.column} → ${catalog.byId.get(relation.to.table)?.key}.${relation.to.column} · ${STANDING_WORDS[relation.standing] ?? relation.standing}`).join("\n")}
          </dd>
          <dt>resultado</dt>
          <dd>{value === null ? "—" : `${formatAnswer(value)} · ${run ? `execução ${shortId(run.id)}` : "prévia, nada gravado"}`}</dd>
        </dl>
        <p className="foot">Esta é a pergunta estruturada que o backend valida e converte em receita. A frase é só a forma de ler e editar estes campos.</p>
      </div>
      {steps.length > 0 && (
        <section className="grid gap-2">
          <h3 className="eyebrow m-0">Receita gerada</h3>
          <ol className="recipe-steps">
            {steps.map((step) => (
              <li key={step.position}>{step.summary}</li>
            ))}
          </ol>
        </section>
      )}
      <details>
        <summary className="cursor-pointer text-[14.5px] font-semibold text-a-deep">Ver a pergunta como JSON</summary>
        <pre className="mt-3 max-w-[860px] overflow-auto rounded-xl border border-rule bg-sheet p-4 font-mono text-[12.5px] leading-relaxed">{JSON.stringify(question, null, 2)}</pre>
      </details>
    </div>
  );
}
