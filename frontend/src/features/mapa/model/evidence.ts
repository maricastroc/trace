import { formatCount, formatPercent, plural } from "@/lib/format";
import type { Evidence, Relationship } from "@/lib/types";
import { competitorsOf } from "./graph";

export type CheckState = "ok" | "warn" | "fail" | "hyp" | "info";
export type UnmatchedSide = "from" | "from_null" | "to";

export type Check = {
  key: string;
  state: CheckState;
  title: string;
  text: string;
  side?: UnmatchedSide;
  relationId?: string;
};

export const CARDINALITY_SHORT: Record<string, string> = {
  one_to_one: "1:1",
  many_to_one: "N:1",
  one_to_many: "1:N",
  many_to_many: "N:N",
};

const NEAR_KIND: Record<Evidence["near_matches"][number]["kind"], string> = {
  leading_zeros: "zeros à esquerda",
  case_or_spacing: "maiúsculas e espaços",
};

export function nearKindLabel(kind: Evidence["near_matches"][number]["kind"]) {
  return NEAR_KIND[kind];
}

export function relationLabel(r: Relationship) {
  return `${r.from.dataset_key}.${r.from.column} → ${r.to.dataset_key}.${r.to.column}`;
}

export function cardinalityEnds(cardinality: string | null): { from: "one" | "many"; to: "one" | "many" } {
  switch (cardinality) {
    case "one_to_one":
      return { from: "one", to: "one" };
    case "one_to_many":
      return { from: "one", to: "many" };
    case "many_to_many":
      return { from: "many", to: "many" };
    default:
      return { from: "many", to: "one" };
  }
}

export function coverageState(ratio: number): CheckState {
  if (ratio >= 0.98) return "ok";
  if (ratio >= 0.9) return "warn";
  return "fail";
}

export function effectSentences(r: Relationship) {
  const effect = r.evidence.join_effect;
  if (!effect) return null;
  const from = r.from.dataset_key;
  const inner =
    effect.extra_rows > 0
      ? `Na junção, ${plural(effect.matched_rows, "linha com par vira", "linhas com par viram")} ${formatCount(effect.inner_rows)}: ${plural(effect.extra_rows, "linha a mais", "linhas a mais")}, porque ${plural(effect.multiplied_rows, `linha de ${from} aponta`, `linhas de ${from} apontam`)} para ${plural(effect.repeated_keys, "id repetido", "ids repetidos")}.`
      : `Na junção, cada linha com par continua sendo uma só: ${plural(effect.matched_rows, "linha gera", "linhas geram")} ${formatCount(effect.inner_rows)}.`;
  const left = `Na junção à esquerda, as ${formatCount(effect.source_rows)} linhas de ${from} viram ${formatCount(effect.left_rows)}${effect.unmatched_rows + effect.null_key_rows > 0 ? `, mantendo ${plural(effect.unmatched_rows + effect.null_key_rows, "linha sem par ou vazia", "linhas sem par ou vazias")}` : ""}.`;
  return { inner, left };
}

export function summaryOf(r: Relationship): { text: string; warn: boolean } {
  const e = r.evidence;
  const pct = formatPercent(e.match.match_ratio);
  const target = `${r.to.dataset_key}.${r.to.column}`;
  if (!e.to.unique) {
    const extra = e.join_effect?.extra_rows;
    return {
      text: `${pct} das linhas encontram par, mas ${target} tem ${plural(e.to.duplicate_values, "valor repetido", "valores repetidos")}: ${
        extra !== undefined ? `ligar as tabelas acrescenta ${plural(extra, "linha", "linhas")} de ${r.from.dataset_key}.` : `uma junção pode multiplicar linhas de ${r.from.dataset_key}.`
      }`,
      warn: true,
    };
  }
  const short = CARDINALITY_SHORT[e.cardinality] ?? e.cardinality;
  const rest = e.match.unmatched_rows > 0 ? ` ${plural(e.match.unmatched_rows, "linha fica", "linhas ficam")} sem par.` : "";
  return { text: `${pct} das linhas encontram par e o destino é único: a evidência sustenta ${short}.${rest}`, warn: false };
}

export function factsOf(r: Relationship) {
  const e = r.evidence;
  const short = CARDINALITY_SHORT[e.cardinality] ?? e.cardinality;
  return [
    { key: "cov", value: formatPercent(e.match.match_ratio), label: "cobertura", bad: coverageState(e.match.match_ratio) === "fail" },
    e.to.unique
      ? { key: "uniq", value: "único", label: "destino", bad: false }
      : { key: "uniq", value: formatCount(e.to.duplicate_values), label: e.to.duplicate_values === 1 ? "id repetido" : "ids repetidos", bad: true },
    { key: "card", value: short, label: e.to.unique ? "comprovada" : "observada", bad: !e.to.unique },
    ...(e.join_effect
      ? [
          e.join_effect.extra_rows > 0
            ? { key: "effect", value: `+${formatCount(e.join_effect.extra_rows)}`, label: "linhas na junção", bad: true }
            : { key: "effect", value: "0", label: "linhas a mais na junção", bad: false },
        ]
      : []),
  ];
}

export function checksFor(r: Relationship, all: Relationship[]): Check[] {
  const e = r.evidence;
  const from = r.from.dataset_key;
  const to = r.to.dataset_key;
  const target = `${to}.${r.to.column}`;
  const checks: Check[] = [];

  checks.push({
    key: "cov",
    state: coverageState(e.match.match_ratio),
    title: "Cobertura",
    text: `${formatPercent(e.match.match_ratio)} das linhas de ${from} com ${r.from.column} preenchido encontram o mesmo valor em ${target} (${formatCount(e.match.matched_rows)} de ${formatCount(e.from.non_null)}).`,
  });

  checks.push(
    e.to.unique
      ? { key: "uniq", state: "ok", title: "Unicidade do destino", text: `${target} é única: ${plural(e.to.distinct, "valor", "valores")}, nenhum repetido.` }
      : {
          key: "uniq",
          state: "fail",
          title: "Unicidade do destino",
          text: `${target} não é única: ${plural(e.to.duplicate_values, "valor aparece", "valores aparecem")} mais de uma vez.`,
        },
  );

  const short = CARDINALITY_SHORT[e.cardinality] ?? e.cardinality;
  checks.push({
    key: "card",
    state: e.to.unique ? "ok" : "fail",
    title: "Cardinalidade",
    text: e.to.unique
      ? `Observada nos dados: ${short}. Cada linha de ${from} aponta para no máximo uma linha de ${to}.`
      : `Observada nos dados: ${short}. Uma linha de ${from} pode encontrar mais de uma linha de ${to}, então N:1 não está comprovada.`,
  });

  const effect = effectSentences(r);
  if (effect && e.join_effect) {
    checks.push({ key: "effect", state: e.join_effect.extra_rows > 0 ? "fail" : "ok", title: "Efeito numa junção", text: `${effect.inner} ${effect.left}` });
  }

  if (e.match.unmatched_rows > 0) {
    checks.push({
      key: "none",
      state: "warn",
      title: "Sem par",
      text: `${plural(e.match.unmatched_rows, "linha", "linhas")} (${plural(e.match.unmatched_distinct, "valor", "valores")}) sem correspondência exata em ${target}.`,
      side: "from",
    });
  }

  if (e.match.null_rows > 0) {
    checks.push({
      key: "nulls",
      state: "warn",
      title: "Vazios",
      text: `${plural(e.match.null_rows, "linha tem", "linhas têm")} ${r.from.column} vazio e não ${e.match.null_rows === 1 ? "pode" : "podem"} se relacionar.`,
      side: "from_null",
    });
  }

  if (e.unreferenced.rows > 0) {
    checks.push({
      key: "unref",
      state: "info",
      title: "Nunca citados",
      text: `${plural(e.unreferenced.rows, "linha", "linhas")} de ${to} não ${e.unreferenced.rows === 1 ? "é citada" : "são citadas"} por nenhuma linha de ${from}. Não é erro: só não foram citadas.`,
      side: "to",
    });
  }

  checks.push({ key: "name", state: e.name.matched ? "ok" : "warn", title: "Nome da coluna", text: e.name.reason });
  checks.push({ key: "types", state: e.types.compatible ? "ok" : "fail", title: "Tipos", text: e.types.detail });

  if (e.near_matches.length > 0) {
    const kinds = [...new Set(e.near_matches.map((n) => NEAR_KIND[n.kind]))].join(" e ");
    checks.push({
      key: "near",
      state: "hyp",
      title: "Quase-pares, não aplicados",
      text: `${plural(e.near_matches.length, "valor", "valores")} de ${from} ${e.near_matches.length === 1 ? "casaria" : "casariam"} se ${kinds} fossem ignorados. Nenhum identificador foi normalizado.`,
    });
  }

  for (const c of competitorsOf(r, all)) {
    checks.push({
      key: `comp-${c.id}`,
      state: "hyp",
      title: "Destino concorrente",
      text: `Os valores de ${r.from.dataset_key}.${r.from.column} também têm correspondência em ${c.to.dataset_key}.${c.to.column} (outra sugestão): cobertura ${formatPercent(c.evidence.match.match_ratio)}, destino ${c.evidence.to.unique ? "único" : "com repetidos"}. Só uma deve valer.`,
      relationId: c.id,
    });
  }

  return checks;
}

export function overprintCounts(e: Evidence) {
  return {
    fromDistinct: e.from.distinct,
    toDistinct: e.to.distinct,
    both: e.match.matched_distinct,
    fromOnly: e.match.unmatched_distinct,
    toOnly: Math.max(0, e.to.distinct - e.match.matched_distinct),
  };
}
