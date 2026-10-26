import type { QuestionPeriod } from "@/lib/types";
import { column, dateColumns, type CatalogTable } from "./catalog";

export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const pad = (value: number) => String(value).padStart(2, "0");

export function yearRange(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function monthRange(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

export function brDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

export function wholeYear(from: string, to: string) {
  const year = Number(from.slice(0, 4));
  const range = yearRange(year);
  return range.from === from && range.to === to ? year : null;
}

export function wholeMonth(from: string, to: string) {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const range = monthRange(year, month);
  return range.from === from && range.to === to ? { year, month } : null;
}

export function periodLabel(from: string, to: string) {
  const year = wholeYear(from, to);
  if (year !== null) return String(year);
  const month = wholeMonth(from, to);
  if (month) return `${MONTHS[month.month - 1]} de ${month.year}`;
  return `${brDate(from)} a ${brDate(to)}`;
}

export function lastDayLabel(to: string) {
  return brDate(to);
}

export function dateBounds(table: CatalogTable, period: Pick<QuestionPeriod, "kind"> & { column?: string }) {
  const keys =
    period.kind === "date" && period.column
      ? [period.column]
      : table.validity
        ? [table.validity.start_column, table.validity.end_column].filter((key): key is string => key !== null)
        : dateColumns(table).map((candidate) => candidate.key);
  const values = keys.flatMap((key) => {
    const profile = column(table, key)?.profile;
    return profile?.min && profile.max ? [profile.min, profile.max] : [];
  });
  if (values.length === 0) return null;
  const sorted = [...values].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

export function yearsBetween(min: string, max: string) {
  const years: number[] = [];
  for (let year = Number(min.slice(0, 4)); year <= Number(max.slice(0, 4)); year++) years.push(year);
  return years;
}

export function defaultYear(min: string, max: string) {
  const last = Number(max.slice(0, 4));
  const first = Number(min.slice(0, 4));
  return Number(max.slice(5, 7)) >= 6 || last === first ? last : last - 1;
}
