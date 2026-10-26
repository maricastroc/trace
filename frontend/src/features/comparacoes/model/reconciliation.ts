import { formatCount } from "@/lib/format";
import type { ComparisonAttribution, ComparisonExplanation, ComparisonSummary } from "@/lib/types";
import type { Side } from "./spec";

export type Labels = { a: string; b: string; roles?: { registry: Side; references: Side } };

export type Reading = {
  kind: "registry_references" | "same_field" | "unknown";
  registry: Side | null;
  entity: string | null;
  selections: Record<Side, string>;
  attribution: ComparisonAttribution["kind"] | null;
};

export type Proof = "proven" | "possible";

export type Cause = { side: Side; explanation: ComparisonExplanation; count: number; title: string; sub: string; proof: Proof; rule: string };

const ORDER: ComparisonExplanation[] = ["excluded_in_other", "outside_other_period", "possible_match", "ambiguous_match", "variant_of_matched", "absent"];

const POSSIBLE = new Set<ComparisonExplanation>(["possible_match", "ambiguous_match", "variant_of_matched"]);

export function proofOf(explanation: ComparisonExplanation): Proof {
  return POSSIBLE.has(explanation) ? "possible" : "proven";
}

export function proofLabel(explanation: ComparisonExplanation, short = false) {
  if (proofOf(explanation) === "possible") return short ? "possível" : "possível · hipótese";
  if (explanation === "outside_other_period") return short ? "comprovado com a vigência declarada" : "comprovado pelos dados e pela vigência declarada";
  return short ? "comprovado" : "comprovado pelos dados";
}

export function explanationText(explanation: ComparisonExplanation, side: Side, labels: Labels) {
  const other = side === "a" ? labels.b : labels.a;
  if (explanation === "absent" && labels.roles?.registry === side) {
    return {
      title: `não aparecem como referência em ${other}`,
      sub: "estão no cadastro, sem referência igual nem escrita de outro jeito nesta seleção",
      rule: `O identificador está no cadastro selecionado, mas nenhuma linha de ${other} o referencia, nem escrito de outro jeito. Não aparecer na seleção não indica, por si só, inatividade.`,
    };
  }
  if (explanation === "absent" && labels.roles?.references === side) {
    return {
      title: "sem correspondência no cadastro selecionado",
      sub: `referenciados em ${labels[side]}, sem identificador igual nem escrito de outro jeito em ${other}`,
      rule: `O identificador é referenciado em ${labels[side]}, mas não existe no cadastro selecionado (${other}), nem escrito de outro jeito. Isso não comprova, por si só, um erro de cadastro.`,
    };
  }
  switch (explanation) {
    case "excluded_in_other":
      return {
        title: `saíram da seleção de ${other}`,
        sub: `existem na tabela de ${other}, mas o critério de ${other} deixou essas linhas de fora`,
        rule: "A mesma identidade existe na origem do outro lado, mas todas as suas linhas saíram da seleção dele. A linhagem mostra em qual passo e por quê.",
      };
    case "outside_other_period":
      return {
        title: `fora do período de ${other}`,
        sub: `a vigência destas identidades não alcança o período de ${other}`,
        rule: "A tabela deste lado tem vigência declarada, e nenhuma linha destas identidades estava vigente no período do outro lado.",
      };
    case "possible_match":
      return {
        title: "pode ser a mesma identidade escrita de outro jeito",
        sub: `há em ${other} um valor que fica igual ao ignorar zeros à esquerda, maiúsculas ou espaços`,
        rule: "Não há texto igual do outro lado, mas há um único candidato quando se ignoram zeros à esquerda ou maiúsculas e espaços. É hipótese: não conta como par.",
      };
    case "ambiguous_match":
      return {
        title: "ambíguas: mais de um candidato",
        sub: `ao ignorar zeros à esquerda, maiúsculas ou espaços, há mais de um valor igual em ${other}`,
        rule: "Ignorando zeros à esquerda ou maiúsculas e espaços, há mais de um candidato do outro lado. Nenhum par é feito.",
      };
    case "variant_of_matched":
      return {
        title: "parecidas com uma identidade já pareada",
        sub: `fica igual a um identificador que já tem par exato em ${other}`,
        rule: "Ao ignorar zeros à esquerda, maiúsculas ou espaços, fica igual a um identificador que já tem par exato. Não vira um segundo par: seria contar duas vezes o que pode ser uma só identidade.",
      };
    default:
      return {
        title: `sem nenhuma correspondência em ${other}`,
        sub: "nenhum valor igual, nem escrito de outro jeito",
        rule: `Nenhuma identidade igual em ${other}, nem igual depois de ignorar zeros à esquerda, maiúsculas ou espaços.`,
      };
  }
}

export function causes(summary: ComparisonSummary, labels: Labels): Cause[] {
  const list: Cause[] = [];
  for (const side of ["a", "b"] as const) {
    const counts = side === "a" ? summary.explanations.only_a : summary.explanations.only_b;
    for (const explanation of ORDER) {
      const count = counts[explanation] ?? 0;
      if (count > 0) list.push({ side, explanation, count, proof: proofOf(explanation), ...explanationText(explanation, side, labels) });
    }
  }
  return list;
}

export function causeGroups(list: Cause[], labels: Labels) {
  return [
    { key: "a", title: `Comprovado · só em ${labels.a}`, items: list.filter((c) => c.side === "a" && c.proof === "proven") },
    { key: "possible", title: "Possível · não conta como par", items: list.filter((c) => c.proof === "possible") },
    { key: "b", title: `Comprovado · só em ${labels.b}`, items: list.filter((c) => c.side === "b" && c.proof === "proven") },
  ].filter((group) => group.items.length > 0);
}

function counted(n: number, one: string, many: string) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

function registrySentence(summary: ComparisonSummary, labels: Labels, reading: Reading) {
  const r = reading.registry!;
  const f: Side = r === "a" ? "b" : "a";
  const entity = reading.entity!;
  const nR = summary[r].distinct;
  const nF = summary[f].distinct;
  const both = summary.shared + summary.shared_by_rule;
  const onlyR = r === "a" ? summary.only_a : summary.only_b;
  const onlyF = r === "a" ? summary.only_b : summary.only_a;
  const scope = reading.selections[r] === "todas as linhas" ? "" : ` (${reading.selections[r]})`;
  const registered = `${formatCount(nR)} ${nR === 1 ? "cadastrado" : "cadastrados"} em ${entity}${scope}`;
  const referenced = `${formatCount(nF)} de ${entity} ${nF === 1 ? "referenciado" : "referenciados"} em ${labels[f]}`;
  const parts = [
    nR === nF
      ? `As duas seleções têm ${counted(nR, "identificador distinto", "identificadores distintos")}, mas representam populações diferentes: ${registered} e ${referenced}.`
      : `As seleções representam populações diferentes: ${counted(nR, "identificador", "identificadores")} ${nR === 1 ? "cadastrado" : "cadastrados"} em ${entity}${scope} e ${counted(nF, "identificador", "identificadores")} de ${entity} ${nF === 1 ? "referenciado" : "referenciados"} em ${labels[f]}.`,
    both === 0 ? "Nenhum aparece nas duas." : `${formatCount(both)} ${both === 1 ? "aparece" : "aparecem"} nas duas.`,
  ];
  const sides = [
    onlyR > 0 ? `${formatCount(onlyR)} ${onlyR === 1 ? "está no cadastro, mas não aparece" : "estão no cadastro, mas não aparecem"} como referência nesta seleção` : null,
    onlyF > 0 ? `${formatCount(onlyF)} ${onlyF === 1 ? "é referenciado" : "são referenciados"} sem correspondência no cadastro selecionado` : null,
  ].filter(Boolean);
  if (sides.length) parts.push(`${sides.join("; ")}.`.replace(/^./, (c) => c.toLocaleUpperCase("pt-BR")));
  if (sides.length) parts.push("Ficar de fora de uma seleção não indica, por si só, inatividade nem erro.");
  return parts.join(" ");
}

function sameFieldSentence(summary: ComparisonSummary, labels: Labels, reading: Reading) {
  const both = summary.shared + summary.shared_by_rule;
  const parts = [`São duas seleções de ${reading.entity} pela mesma coluna, então os identificadores têm o mesmo significado nos dois lados.`];
  if (summary.unmatched === 0) parts.push("As duas têm exatamente os mesmos identificadores.");
  else
    parts.push(
      `${formatCount(both)} ${both === 1 ? "aparece" : "aparecem"} nas duas; ${formatCount(summary.only_a)} só em ${labels.a} e ${formatCount(summary.only_b)} só em ${labels.b}.`,
    );
  const cause =
    reading.attribution === "criteria"
      ? "As definições diferem só no critério de seleção."
      : reading.attribution === "versions"
        ? "As definições diferem só na versão dos dados."
        : reading.attribution === "mixed"
          ? "As definições diferem em mais de um ponto; não há uma causa única."
          : null;
  if (cause && summary.unmatched > 0) parts.push(cause);
  return parts.join(" ");
}

function neutralSentence(summary: ComparisonSummary, labels: Labels) {
  const { only_a: onlyA, only_b: onlyB, net_difference: net, unmatched } = summary;
  const together = summary.shared + summary.shared_by_rule;
  if (unmatched === 0) return "Os dois lados têm exatamente as mesmas identidades.";
  if (together === 0) return "Nenhuma identidade aparece nos dois lados: por estas colunas, os conjuntos não têm nada em comum.";
  if (net === 0) return "Os totais são iguais, mas não são as mesmas identidades: cada lado tem identidades que o outro não tem.";
  if (onlyB === 0) return `Todas as identidades de ${labels.b} estão em ${labels.a}; a diferença são as que só ${labels.a} tem.`;
  if (onlyA === 0) return `Todas as identidades de ${labels.a} estão em ${labels.b}; a diferença são as que só ${labels.b} tem.`;
  return `A diferença nos totais é menor que o número de identidades sem par: as que só existem em ${labels.b} compensam, na soma, parte das que só existem em ${labels.a}. São identidades diferentes.`;
}

export function answerSentence(summary: ComparisonSummary, labels: Labels, reading: Reading | null = null) {
  const parts: string[] = [];
  if (reading?.kind === "registry_references" && reading.registry && reading.entity) parts.push(registrySentence(summary, labels, reading));
  else if (reading?.kind === "same_field" && reading.entity) parts.push(sameFieldSentence(summary, labels, reading));
  else parts.push(neutralSentence(summary, labels));
  const rule = summary.shared_by_rule;
  if (rule > 0) parts.push(`Com a regra aceita, ${formatCount(rule)} ${rule === 1 ? "par escrito de outro jeito conta" : "pares escritos de outro jeito contam"} como nos dois.`);
  const possible = summary.possible_matches;
  if (possible > 0) parts.push(`${formatCount(possible)} de cada lado ${possible === 1 ? "tem" : "têm"} um possível par escrito de outro jeito, que ainda não conta.`);
  return parts.join(" ");
}

export function unitSentence(summary: ComparisonSummary, labels: Labels) {
  const side = (label: string, counts: ComparisonSummary["a"]) => {
    const notes = [
      counts.repeated_rows > 0
        ? `${formatCount(counts.repeated_rows)} ${counts.repeated_rows === 1 ? "linha repete uma identidade já contada" : "linhas repetem uma identidade já contada"}`
        : null,
      counts.empty_rows > 0 ? `${formatCount(counts.empty_rows)} sem identificador` : null,
    ].filter(Boolean);
    return `${label} tem ${formatCount(counts.rows)} ${counts.rows === 1 ? "linha" : "linhas"} e ${formatCount(counts.distinct)} ${counts.distinct === 1 ? "identidade distinta" : "identidades distintas"}${notes.length ? ` (${notes.join("; ")})` : ""}`;
  };
  return `Contado em identidades distintas. ${side(labels.a, summary.a)}; ${side(labels.b, summary.b)}.`;
}

export type LedgerRow = { op: "" | "−" | "+" | "="; value: number; label: string; parts: number[]; tone: "a" | "b" | "total" };

export function ledger(summary: ComparisonSummary, labels: Labels, list: Cause[]): LedgerRow[] {
  const parts = (side: Side) => {
    const values = list.filter((c) => c.side === side).map((c) => c.count);
    return values.length > 1 ? values : [];
  };
  return [
    { op: "", value: summary.a.distinct, label: `identidades em ${labels.a}`, parts: [], tone: "a" },
    { op: "−", value: summary.only_a, label: `só em ${labels.a}`, parts: parts("a"), tone: "a" },
    { op: "+", value: summary.only_b, label: `só em ${labels.b}`, parts: parts("b"), tone: "b" },
    { op: "=", value: summary.b.distinct, label: `identidades em ${labels.b}`, parts: [], tone: "total" },
  ];
}

export function closes(summary: ComparisonSummary) {
  return summary.a.distinct - summary.only_a + summary.only_b === summary.b.distinct && summary.checks.every((check) => check.holds);
}
