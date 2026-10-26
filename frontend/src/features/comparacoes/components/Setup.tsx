"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatCount, formatWhen } from "@/lib/format";
import { useDatasetDetail, useQuestionPreview } from "@/lib/queries";
import type { QuestionPeriod, Recipe, ValidityReading } from "@/lib/types";
import type { Catalog, CatalogTable } from "@/features/perguntas/model/catalog";
import { dateColumns } from "@/features/perguntas/model/catalog";
import { groups as groupsOf, previewOutcome, formatAnswer } from "@/features/perguntas/model/answer";
import { dateBounds, defaultYear, periodLabel, yearRange, yearsBetween } from "@/features/perguntas/model/period";
import { dimensionFrom, dimensionKey, dimensionOptions, READING_HINT, READING_TITLE, READINGS } from "@/features/perguntas/model/question";
import {
  defaultLabel,
  emptyPopulation,
  emptyRun,
  equivalenceOf,
  keyFromRelation,
  keyOptions,
  keyType,
  pairOf,
  RULE_TEXT,
  sameSpec,
  toSpec,
  withSide,
  type Draft,
  type Naming,
  type PopulationDraft,
  type RunDraft,
  type Side,
  type SideDraft,
  type Suggestion,
} from "../model/spec";
import { EquivalenceCheck } from "./Equivalence";

type Props = {
  catalog: Catalog;
  recipes: Recipe[];
  naming: Naming;
  draft: Draft;
  suggestions: Suggestion[];
  editing: boolean;
  onChange: (draft: Draft) => void;
  onCompare: () => void;
  onCancel: () => void;
};

export function Setup({ catalog, recipes, naming, draft, suggestions, editing, onChange, onCompare, onCancel }: Props) {
  const pair = pairOf(draft);
  const equivalence = equivalenceOf(catalog, pair, draft.equivalence);
  const complete = toSpec(draft) !== null;
  const ready = complete && equivalence.status !== "unconfirmed";
  const setSide = (side: Side, next: SideDraft) => onChange(withSide(draft, side, next));

  return (
    <section className="cmp-setup" aria-labelledby="cmp-setup-title">
      <header className="cs-head">
        <p className="eyebrow eyebrow-ab">Comparação · escolher os conjuntos</p>
        <h1 id="cmp-setup-title">O que você quer comparar?</h1>
        <p className="cs-lede">Escolha dois conjuntos e a coluna que reconhece a mesma identidade em cada um. A comparação conta identidades distintas, não linhas.</p>
      </header>

      {suggestions.length > 0 && (
        <div className="cs-sugs" role="group" aria-label="Sugestões">
          <span className="cs-k">Sugestões</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="sug"
              aria-pressed={sameSpec(toSpec(suggestion.draft, naming), toSpec({ ...draft, equivalence: null }, naming))}
              onClick={() => onChange(suggestion.draft)}
            >
              <b>{suggestion.title}</b>
              <span>{suggestion.reason}</span>
            </button>
          ))}
        </div>
      )}

      <div className="cs-sides">
        <SideEditor side="a" catalog={catalog} recipes={recipes} naming={naming} draft={draft.a} other={draft.b} onChange={(next) => setSide("a", next)} />
        <SideEditor side="b" catalog={catalog} recipes={recipes} naming={naming} draft={draft.b} other={draft.a} onChange={(next) => setSide("b", next)} />
      </div>

      <div className="cs-compare">
        <KeySentence catalog={catalog} draft={draft} recipes={recipes} />
        <EquivalenceCheck catalog={catalog} pair={pair} declaration={draft.equivalence} onChange={(equivalence) => onChange({ ...draft, equivalence })} />
        {draft.rules.length > 0 && (
          <p className="small-note">
            Regra aceita nesta comparação: {draft.rules.map((rule) => RULE_TEXT[rule].effect).join("; ")}.{" "}
            <button type="button" className="btn-link" onClick={() => onChange({ ...draft, rules: [] })}>
              Remover a regra
            </button>
          </p>
        )}
        <div className="cs-actions">
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={onCompare}>
            Comparar
          </button>
          {editing && (
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Cancelar
            </button>
          )}
          {!complete && <span className="small-note">Escolha a tabela (ou a execução) e a coluna identificadora dos dois lados.</span>}
          {complete && !ready && <span className="small-note">Confirme acima que as colunas identificam a mesma entidade.</span>}
        </div>
      </div>
    </section>
  );
}

function sideName(side: Side) {
  return side === "a" ? "A" : "B";
}

function runTable(recipes: Recipe[], catalog: Catalog, draft: RunDraft) {
  const recipe = recipes.find((candidate) => candidate.last_run?.id === draft.runId);
  const id = draft.datasetId ?? recipe?.base_dataset.id ?? null;
  return id ? (catalog.byId.get(id) ?? null) : null;
}

function tableOf(catalog: Catalog, recipes: Recipe[], draft: SideDraft): CatalogTable | null {
  if (draft.kind === "run") return runTable(recipes, catalog, draft);
  return draft.datasetId ? (catalog.byId.get(draft.datasetId) ?? null) : null;
}

type SideProps = { side: Side; catalog: Catalog; recipes: Recipe[]; naming: Naming; draft: SideDraft; other: SideDraft; onChange: (next: SideDraft) => void };

function SideEditor({ side, catalog, recipes, naming, draft, other, onChange }: SideProps) {
  const ids = useId();
  const table = tableOf(catalog, recipes, draft);
  const otherTable = tableOf(catalog, recipes, other);
  const otherKey = otherTable && other.key ? { table: otherTable.id, key: other.key } : null;
  const traced = recipes.filter((recipe) => recipe.last_run?.status === "succeeded");
  const suggestedName = defaultLabel(draft, naming);

  const pickTable = (id: string) => {
    const next = catalog.byId.get(id);
    if (!next) return onChange(emptyPopulation());
    const suggested = keyFromRelation(catalog, next.id, otherKey);
    onChange({ ...emptyPopulation(), datasetId: next.id, key: suggested?.key ?? null });
  };

  const pickRun = (runId: string) => {
    const recipe = traced.find((candidate) => candidate.last_run?.id === runId);
    if (!recipe) return onChange(emptyRun());
    const base = catalog.byId.get(recipe.base_dataset.id);
    const suggested = base ? keyFromRelation(catalog, base.id, otherKey) : null;
    onChange({ kind: "run", runId, datasetId: recipe.base_dataset.id, key: suggested?.key ?? null, label: "" });
  };

  return (
    <fieldset className={`side-ed ${side}`}>
      <legend>
        <i aria-hidden />
        Lado {sideName(side)}
      </legend>
      <div className="se-name">
        <label className="sr-only" htmlFor={`${ids}-label`}>
          Nome do lado {sideName(side)}
        </label>
        <input
          id={`${ids}-label`}
          className="name-input"
          value={draft.label}
          maxLength={80}
          placeholder={suggestedName || "Nome deste lado"}
          title={draft.label || suggestedName}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
        <span className="se-name-hint" aria-hidden>
          {draft.label.trim() ? "nome dado por você" : "nome sugerido · clique para mudar"}
        </span>
      </div>

      <div className="se-source">
        <div className="seg small" role="group" aria-label={`Lado ${sideName(side)}: de onde vêm os registros`}>
          <button type="button" aria-pressed={draft.kind === "population"} onClick={() => draft.kind !== "population" && onChange(emptyPopulation())}>
            Tabela
          </button>
          <button type="button" aria-pressed={draft.kind === "run"} disabled={traced.length === 0} onClick={() => draft.kind !== "run" && onChange(emptyRun())}>
            Execução rastreada
          </button>
        </div>
        {draft.kind === "population" ? (
          <div className="fld">
            <label htmlFor={`${ids}-table`}>Tabela</label>
            <select id={`${ids}-table`} className="select" value={draft.datasetId ?? ""} onChange={(event) => pickTable(event.target.value)}>
              <option value="">Escolha uma tabela</option>
              {catalog.tables.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.key}) · {formatCount(candidate.rows)} linhas
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="fld">
            <label htmlFor={`${ids}-run`}>Execução</label>
            <select id={`${ids}-run`} className="select" value={draft.runId ?? ""} onChange={(event) => pickRun(event.target.value)}>
              <option value="">Escolha uma execução rastreada</option>
              {traced.map((recipe) => (
                <option key={recipe.last_run!.id} value={recipe.last_run!.id}>
                  {recipe.name} · {formatWhen(recipe.last_run!.finished_at)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {table && (
        <div className="fld">
          <label htmlFor={`${ids}-key`}>Coluna identificadora</label>
          <select id={`${ids}-key`} className="select" value={draft.key ?? ""} onChange={(event) => onChange({ ...draft, key: event.target.value || null })}>
            <option value="">Escolha a coluna</option>
            {keyOptions(table).map((option) => (
              <option key={option.key} value={option.key}>
                {option.key} — {option.hint}
              </option>
            ))}
          </select>
        </div>
      )}

      {draft.kind === "population" && table && <Criteria table={table} catalog={catalog} draft={draft} onChange={onChange} />}
      {draft.kind === "run" && table && (
        <p className="crit-sum">
          <span className="crit-k">Critérios</span>
          <span className="crit-chip on">os da execução, sem recalcular</span>
        </p>
      )}
    </fieldset>
  );
}

type PeriodChoice = { key: string; label: string; make: (year: number) => QuestionPeriod | null };

function periodChoices(table: CatalogTable): PeriodChoice[] {
  const choices: PeriodChoice[] = [{ key: "none", label: "Todas as linhas, sem período", make: () => null }];
  for (const candidate of dateColumns(table)) {
    choices.push({ key: `date:${candidate.key}`, label: `Com ${candidate.key} no ano`, make: (year) => ({ kind: "date", column: candidate.key, ...yearRange(year) }) });
  }
  if (table.validity) {
    choices.push({ key: "validity", label: "Pela vigência declarada, no ano", make: (year) => ({ kind: "validity", reading: "active_any", ...yearRange(year) }) });
  }
  return choices;
}

function choiceKey(period: QuestionPeriod | null) {
  if (!period) return "none";
  return period.kind === "date" ? `date:${period.column}` : "validity";
}

function periodText(period: QuestionPeriod | null) {
  if (!period) return null;
  if (period.kind === "date") return `${period.column} em ${periodLabel(period.from, period.to)}`;
  return period.reading
    ? `${READING_TITLE[period.reading].toLocaleLowerCase("pt-BR")} ${periodLabel(period.from, period.to)}`
    : `vigência em ${periodLabel(period.from, period.to)}`;
}

function Criteria({ table, catalog, draft, onChange }: { table: CatalogTable; catalog: Catalog; draft: PopulationDraft; onChange: (next: SideDraft) => void }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const detail = useDatasetDetail(draft.datasetId);
  const versions = [...(detail.data?.data.versions ?? [])].sort((x, y) => y.number - x.number);
  const latest = versions[0];
  const chosen = draft.versionId ? versions.find((version) => version.id === draft.versionId) : undefined;
  const choices = periodChoices(table);
  const period = draft.period;
  const bounds = dateBounds(table, period?.kind === "date" ? { kind: "date", column: period.column } : { kind: "validity" });
  const years = bounds ? yearsBetween(bounds.min, bounds.max) : [];
  const year = period ? Number(period.from.slice(0, 4)) : null;
  const filtered = periodText(period);
  const cut = draft.dimension ? (draft.dimension.value ? `${draft.dimension.column} = ${draft.dimension.value}` : `${draft.dimension.column}: escolha o valor`) : null;
  const versionText = chosen
    ? `versão ${chosen.number}`
    : latest
      ? versions.length > 1
        ? `versão mais recente (${latest.number})`
        : `versão ${latest.number}, a única`
      : "versão…";

  const setChoice = (key: string) => {
    const choice = choices.find((candidate) => candidate.key === key);
    if (!choice) return;
    const next = choice.make(0);
    if (!next) return onChange({ ...draft, period: null });
    const b = dateBounds(table, next.kind === "date" ? { kind: "date", column: next.column } : { kind: "validity" });
    onChange({ ...draft, period: choice.make(year ?? (b ? defaultYear(b.min, b.max) : new Date().getFullYear())) });
  };

  return (
    <div className="crit">
      <div className="crit-sum">
        <span className="crit-k">Critérios</span>
        <span className={`crit-chip ${chosen ? "on" : ""}`}>{versionText}</span>
        <span className={`crit-chip ${filtered ? "on" : ""}`}>{filtered ?? "todas as linhas"}</span>
        {cut && <span className="crit-chip on">{cut}</span>}
        <button type="button" className="btn-link crit-toggle" aria-expanded={open} aria-controls={`${ids}-crit`} onClick={() => setOpen((value) => !value)}>
          {open ? "Fechar" : "Ajustar critérios"}
        </button>
      </div>
      {open && (
        <div className="crit-body" id={`${ids}-crit`}>
          {(versions.length > 1 || draft.versionId) && (
            <div className="fld">
              <label htmlFor={`${ids}-version`}>Versão</label>
              <select id={`${ids}-version`} className="select" value={draft.versionId ?? ""} onChange={(event) => onChange({ ...draft, versionId: event.target.value || null })}>
                <option value="">Mais recente{latest ? ` (versão ${latest.number})` : ""}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    Versão {version.number} · {formatCount(version.row_count)} linhas · {formatWhen(version.created_at)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="fld">
            <label htmlFor={`${ids}-period`}>Período</label>
            <select id={`${ids}-period`} className="select" value={choiceKey(period)} onChange={(event) => setChoice(event.target.value)}>
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          {period && years.length > 0 && (
            <div className="fld">
              <label htmlFor={`${ids}-year`}>Ano</label>
              <select
                id={`${ids}-year`}
                className="select"
                value={year ?? ""}
                onChange={(event) => onChange({ ...draft, period: { ...period, ...yearRange(Number(event.target.value)) } })}
              >
                {years.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
            </div>
          )}
          {period?.kind === "validity" && (
            <div className="fld">
              <label htmlFor={`${ids}-reading`}>Leitura da vigência</label>
              <select
                id={`${ids}-reading`}
                className="select"
                value={period.reading ?? ""}
                onChange={(event) => onChange({ ...draft, period: { ...period, reading: (event.target.value || null) as ValidityReading | null } })}
              >
                {READINGS.map((reading) => (
                  <option key={reading} value={reading}>
                    {READING_TITLE[reading]} {year ?? ""} — {READING_HINT[reading]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <CutPicker table={table} catalog={catalog} draft={draft} onChange={onChange} />
          {!table.validity && dateColumns(table).length >= 2 && (
            <p className="fld-note">
              Para comparar por vigência, declare o início e o fim em {table.key} no{" "}
              <Link className="btn-link" href={`/mapa?tabela=${table.key}`}>
                Mapa
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CutPicker({ table, catalog, draft, onChange }: { table: CatalogTable; catalog: Catalog; draft: PopulationDraft; onChange: (next: SideDraft) => void }) {
  const ids = useId();
  const options = dimensionOptions(catalog, table);
  const current = draft.dimension ? options.find((option) => option.key === dimensionKey(draft.dimension!)) : undefined;
  const grouped = useQuestionPreview(
    current
      ? {
          base_dataset_id: table.id,
          measure: { function: "count" },
          period: draft.period?.kind === "validity" && !draft.period.reading ? null : draft.period,
          dimension: dimensionFrom(current),
        }
      : null,
  );
  const preview = grouped.data?.data.preview;
  const values = preview?.computed ? groupsOf(previewOutcome(preview)).filter((group) => group.key !== null) : [];
  if (options.length === 0) return null;

  return (
    <>
      <div className="fld">
        <label htmlFor={`${ids}-cut`}>Recorte</label>
        <select
          id={`${ids}-cut`}
          className="select"
          value={current?.key ?? ""}
          onChange={(event) => {
            const option = options.find((candidate) => candidate.key === event.target.value);
            onChange({ ...draft, dimension: option ? dimensionFrom(option, null) : null });
          }}
        >
          <option value="">Sem recorte</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              Só um valor de {option.noun} ({option.route})
            </option>
          ))}
        </select>
      </div>
      {current && (
        <div className="fld">
          <label htmlFor={`${ids}-value`}>Valor de {current.noun}</label>
          <select
            id={`${ids}-value`}
            className="select"
            value={draft.dimension?.value ?? ""}
            onChange={(event) => onChange({ ...draft, dimension: dimensionFrom(current, event.target.value || null) })}
          >
            <option value="">{grouped.isPending ? "Carregando os valores…" : "Escolha o valor"}</option>
            {values.map((group) => (
              <option key={group.key!} value={group.key!}>
                {group.label}
                {group.label !== group.key ? ` (${group.key})` : ""} · {formatAnswer(group.value)} linhas
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function KeySentence({ catalog, draft, recipes }: { catalog: Catalog; draft: Draft; recipes: Recipe[] }) {
  const a = tableOf(catalog, recipes, draft.a);
  const b = tableOf(catalog, recipes, draft.b);
  const typeA = keyType(catalog, a?.id ?? null, draft.a.key);
  const typeB = keyType(catalog, b?.id ?? null, draft.b.key);
  const name = (table: CatalogTable | null, key: string | null) => (table && key ? `${table.key}.${key}` : "…");
  const complete = a && b && draft.a.key && draft.b.key;

  return (
    <div className="key-sentence" aria-live="polite">
      <p className="ks-main">
        Dois registros representam a mesma identidade quando <b className="ks-a">{name(a, draft.a.key)}</b> (lado A) for igual a <b className="ks-b">{name(b, draft.b.key)}</b>{" "}
        (lado B).
      </p>
      {!complete && <p className="ks-why">Nenhuma coluna é escolhida pelo nome: escolha a coluna identificadora de cada lado.</p>}
      {typeA && typeB && typeA !== typeB && (
        <p className="ks-warn">
          Os tipos são diferentes ({typeA} e {typeB}). A comparação continua por texto exato e pode encontrar poucos pares.
        </p>
      )}
      <p className="ks-rule">Igualdade por texto exato: 0187 e 187 são identidades diferentes. Uma normalização só vale se você aceitar a regra, depois de ver o efeito.</p>
    </div>
  );
}
