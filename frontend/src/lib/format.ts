const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : integer.format(value);
}

export function formatMeasure(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return decimal.format(value);
  return NUMERIC.test(value) ? decimal.format(Number(value)) : value;
}

export function formatPercent(ratio: number) {
  return percent.format(ratio);
}

export function formatWhen(iso: string | null | undefined) {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${decimal.format(Math.round(ms / 100) / 10)} s`;
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

export function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export const TYPE_LABEL: Record<string, string> = {
  identifier: "ID",
  number: "NÚM",
  date: "DATA",
  text: "TEXTO",
};
