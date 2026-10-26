"use client";

import { useCallback, useMemo, useState } from "react";
import { formatCount } from "@/lib/format";
import { useQuestionPreview, useQuestionReadings, useVersionRows } from "@/lib/queries";
import type { QuestionSpec } from "@/lib/types";
import { formatAnswer, groups, previewOutcome } from "../model/answer";
import type { Catalog } from "../model/catalog";
import { dateBounds, defaultYear, MONTHS, monthRange, periodLabel, wholeMonth, wholeYear, yearRange, yearsBetween } from "../model/period";
import {
  currentDimension,
  dimensionFrom,
  dimensionOptions,
  measureOptions,
  pathAlternatives,
  periodKindKey,
  periodKindOptions,
  plainText,
  READING_HINT,
  READING_TITLE,
  READINGS,
  sameMeasure,
  sentence,
  starterQuestion,
  type TokenKind,
} from "../model/question";
import { TokenPopover, type PopOption } from "./TokenPopover";

type Props = {
  catalog: Catalog;
  question: QuestionSpec;
  valueLabel: string | null;
  busy: boolean;
  onChange: (question: QuestionSpec) => void;
};

const TITLES: Record<TokenKind, string> = {
  source: "De qual tabela",
  measure: "O que contar",
  dimension: "Recorte",
  path: "Por qual caminho",
  periodKind: "Como ler o período",
  periodValue: "Qual período",
};

export function QuestionHead({ catalog, question, valueLabel, busy, onChange }: Props) {
  const [open, setOpen] = useState<{ kind: TokenKind; anchor: HTMLElement; container: HTMLElement } | null>(null);
  const [how, setHow] = useState(false);
  const parts = useMemo(() => sentence(catalog, question, valueLabel), [catalog, question, valueLabel]);
  const length = plainText(parts).length;
  const base = catalog.byId.get(question.base_dataset_id);

  const close = useCallback(
    (refocus: boolean) => {
      const anchor = open?.anchor;
      setOpen(null);
      if (refocus) window.setTimeout(() => anchor?.focus(), 0);
    },
    [open],
  );

  return (
    <header className="q-head">
      <div className="q-meta">
        <span className="eyebrow eyebrow-ab">Pergunta</span>
        <button type="button" className="btn-link" aria-expanded={how} aria-controls="q-how" onClick={() => setHow((value) => !value)}>
          Como foi montada
        </button>
        <button type="button" className="btn-link" onClick={() => onChange(starterQuestion(catalog, question.base_dataset_id) ?? question)}>
          Recomeçar
        </button>
      </div>
      {how && base && (
        <p className="q-how" id="q-how">
          Montada a partir de {base.key} e das relações do Mapa. Sem IA: cada parte sublinhada corresponde a uma parte da pergunta estruturada, que o motor valida
          e executa. Pelo teclado, Tab chega a cada parte, Enter abre as opções e Esc fecha.
        </p>
      )}
      <h1 className={`q-sentence ${length > 130 ? "xlong" : length > 92 ? "long" : ""}`} aria-busy={busy}>
        {parts.map((part, i) =>
          typeof part === "string" ? (
            <span key={i}>{part}</span>
          ) : (
            <button
              key={i}
              type="button"
              className={`tok ${part.pending ? "pending" : ""}`}
              data-tok={part.kind}
              aria-haspopup="listbox"
              aria-expanded={open?.kind === part.kind}
              aria-label={`${part.text}${part.pending ? " (pendente: escolha antes de calcular)" : ""}. Alterar ${part.what}`}
              onClick={(event) => {
                const anchor = event.currentTarget;
                const container = anchor.closest<HTMLElement>(".q-head");
                if (!container) return;
                setOpen((current) => (current?.kind === part.kind ? null : { kind: part.kind, anchor, container }));
              }}
            >
              {part.text}
            </button>
          ),
        )}
      </h1>
      <p className="q-hint" aria-hidden>
        Cada parte sublinhada pode ser trocada · Enter abre as opções · Esc fecha
      </p>
      {open && <OptionsPopover kind={open.kind} catalog={catalog} question={question} anchor={open.anchor} container={open.container} onClose={close} onChange={onChange} />}
    </header>
  );
}

type PopoverProps = {
  kind: TokenKind;
  catalog: Catalog;
  question: QuestionSpec;
  anchor: HTMLElement;
  container: HTMLElement;
  onClose: (refocus: boolean) => void;
  onChange: (question: QuestionSpec) => void;
};

function currentRange(catalog: Catalog, question: QuestionSpec) {
  if (question.period) return { from: question.period.from, to: question.period.to };
  const base = catalog.byId.get(question.base_dataset_id);
  const bounds = base ? dateBounds(base, { kind: "validity" }) : null;
  return yearRange(bounds ? defaultYear(bounds.min, bounds.max) : new Date().getFullYear());
}

function OptionsPopover({ kind, catalog, question, anchor, container, onClose, onChange }: PopoverProps) {
  const base = catalog.byId.get(question.base_dataset_id)!;
  const dimension = currentDimension(catalog, base, question.dimension);
  const groupedQuestion = kind === "dimension" && question.dimension ? { ...question, dimension: { ...question.dimension, value: null } } : null;
  const readingQuestion = kind === "periodKind" && question.period?.kind === "validity" ? { ...question, period: { ...question.period, reading: null } } : null;
  const grouped = useQuestionPreview(groupedQuestion);
  const readings = useQuestionReadings(readingQuestion);
  const rows = useVersionRows(kind === "dimension" && dimension ? dimension.table.versionId : null, 1);

  const options: PopOption[] = [];
  let footer: string | undefined;

  if (kind === "source") {
    for (const table of catalog.tables) {
      options.push({
        id: table.id,
        label: table.noun,
        hint: `${table.key} · ${formatCount(table.rows)} linhas`,
        selected: table.id === question.base_dataset_id,
        onSelect: () => table.id !== question.base_dataset_id && onChange(starterQuestion(catalog, table.id) ?? question),
      });
    }
  }

  if (kind === "measure") {
    for (const option of measureOptions(catalog, base)) {
      options.push({
        id: `${option.measure.function}:${option.measure.column ?? ""}`,
        label: option.label,
        hint: option.hint,
        selected: sameMeasure(option.measure, question.measure),
        onSelect: () => onChange({ ...question, measure: option.measure }),
      });
    }
  }

  if (kind === "dimension") {
    options.push({ id: "total", label: "no total", hint: "uma resposta só, sem recorte", selected: question.dimension === null, section: "Agrupar ou não", onSelect: () => onChange({ ...question, dimension: null }) });
    const seen = new Set<string>();
    const all = dimensionOptions(catalog, base);
    const ordered = dimension ? [dimension, ...all.filter((option) => option.key !== dimension.key)] : all;
    for (const option of ordered) {
      const target = `${option.table.id}:${option.column}`;
      if (seen.has(target)) continue;
      seen.add(target);
      options.push({
        id: option.key,
        label: `por ${option.noun}`,
        hint: option.route,
        selected: question.dimension !== null && question.dimension.value === null && option.key === dimension?.key,
        section: "Agrupar ou não",
        onSelect: () => onChange({ ...question, dimension: dimensionFrom(option) }),
      });
    }
    if (dimension) {
      const section = `Só um valor de ${dimension.noun}`;
      const preview = grouped.data?.data.preview;
      if (preview?.computed) {
        for (const group of groups(previewOutcome(preview))) {
          if (group.key === null) continue;
          options.push({
            id: `v:${group.key}`,
            label: group.label,
            hint: group.label !== group.key ? group.key : undefined,
            value: formatAnswer(group.value),
            selected: question.dimension?.value === group.key,
            section,
            onSelect: () => onChange({ ...question, dimension: dimensionFrom(dimension, group.key) }),
          });
        }
        footer = "Os números são a resposta para cada valor. Valores sem registros no período não aparecem.";
      } else if (rows.data) {
        const seenValues = new Set<string>();
        for (const row of rows.data.data) {
          const value = row.values[dimension.column];
          if (value === null || seenValues.has(value)) continue;
          seenValues.add(value);
          const label = dimension.labelColumn ? row.values[dimension.labelColumn] : null;
          options.push({
            id: `v:${value}`,
            label: label ?? value,
            hint: label ? value : undefined,
            selected: question.dimension?.value === value,
            section,
            onSelect: () => onChange({ ...question, dimension: dimensionFrom(dimension, value) }),
          });
        }
        if (rows.data.meta.total > rows.data.data.length) footer = `Mostrando os valores das primeiras ${formatCount(rows.data.data.length)} linhas de ${dimension.table.key}.`;
      } else if (grouped.isPending || rows.isPending) {
        footer = "Carregando os valores…";
      }
    }
  }

  if (kind === "path" && dimension) {
    for (const option of pathAlternatives(catalog, base, dimension)) {
      options.push({
        id: option.key,
        label: `via ${option.via}`,
        hint: option.route,
        selected: option.key === dimension.key,
        onSelect: () => onChange({ ...question, dimension: dimensionFrom(option, question.dimension?.value ?? null) }),
      });
    }
    footer = "Caminhos diferentes podem dar números diferentes: cada um usa outra coluna para chegar ao recorte.";
  }

  if (kind === "periodKind") {
    const range = currentRange(catalog, question);
    const period = question.period;
    if (period?.kind === "validity") {
      const byReading = new Map(readings.data?.data.readings.map((reading) => [reading.reading, reading]));
      for (const reading of READINGS) {
        const found = byReading.get(reading);
        options.push({
          id: reading,
          label: `${READING_TITLE[reading]} ${periodLabel(period.from, period.to)}`,
          hint: READING_HINT[reading],
          value: found?.computed ? formatAnswer(found.value) : undefined,
          unavailable: found && !found.computed ? "pendente" : undefined,
          selected: period.reading === reading,
          section: "Leitura da vigência",
          onSelect: () => onChange({ ...question, period: { ...period, reading } }),
        });
      }
    }
    for (const option of periodKindOptions(base)) {
      if (option.key === "validity" && period?.kind === "validity") continue;
      options.push({
        id: option.key,
        label: option.label,
        hint: option.hint,
        selected: periodKindKey(period) === option.key,
        section: period?.kind === "validity" ? "Outra forma de ler o período" : undefined,
        onSelect: () => onChange({ ...question, period: option.period(range.from, range.to) }),
      });
    }
  }

  if (kind === "periodValue" && question.period) {
    const period = question.period;
    const bounds = dateBounds(base, period.kind === "date" ? { kind: "date", column: period.column } : { kind: "validity" });
    const year = wholeYear(period.from, period.to) ?? wholeMonth(period.from, period.to)?.year ?? Number(period.from.slice(0, 4));
    for (const candidate of bounds ? yearsBetween(bounds.min, bounds.max) : [year]) {
      const range = yearRange(candidate);
      options.push({
        id: `y${candidate}`,
        label: String(candidate),
        hint: bounds && candidate === Number(bounds.max.slice(0, 4)) && bounds.max < range.to ? `os dados vão até ${bounds.max.split("-").reverse().join("/")}` : undefined,
        selected: period.from === range.from && period.to === range.to,
        section: "Ano inteiro",
        onSelect: () => onChange({ ...question, period: { ...period, ...range } }),
      });
    }
    MONTHS.forEach((name, i) => {
      const range = monthRange(year, i + 1);
      options.push({
        id: `m${year}-${i + 1}`,
        label: `${name} de ${year}`,
        selected: period.from === range.from && period.to === range.to,
        section: `Um mês de ${year}`,
        onSelect: () => onChange({ ...question, period: { ...period, ...range } }),
      });
    });
  }

  return <TokenPopover title={TITLES[kind]} options={options} anchor={anchor} container={container} onClose={onClose} footer={footer} />;
}
