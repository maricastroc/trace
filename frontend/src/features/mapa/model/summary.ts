import { plural } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { needsAttention, pathTables, standingOf } from "./graph";

export function relationsSummary(relations: Relationship[]) {
  if (relations.length === 0) return "Nenhuma relação encontrada entre as tabelas ainda.";
  const count = (key: string) => relations.filter((r) => standingOf(r) === key).length;
  const suggested = relations.filter((r) => standingOf(r) === "suggested");
  const confirmed = count("confirmed");
  const caveat = count("caveat");
  const review = count("review");
  const rejected = count("rejected");
  const attention = suggested.filter(needsAttention).length;
  const parts: string[] = [];
  const lead = (one: string, many: string, n: number, short: [string, string]) => (parts.length ? plural(n, short[0], short[1]) : plural(n, one, many));
  if (suggested.length) parts.push(`${plural(suggested.length, "sugestão de relação aguarda", "sugestões de relação aguardam")} sua decisão`);
  if (review) parts.push(lead("relação para reavaliar", "relações para reavaliar", review, ["para reavaliar", "para reavaliar"]));
  if (confirmed) parts.push(lead("relação confirmada", "relações confirmadas", confirmed, ["confirmada", "confirmadas"]));
  if (caveat) parts.push(lead("relação com ressalva", "relações com ressalva", caveat, ["com ressalva", "com ressalva"]));
  if (rejected) parts.push(lead("relação rejeitada", "relações rejeitadas", rejected, ["rejeitada", "rejeitadas"]));
  if (attention) parts.push(plural(attention, "pede atenção", "pedem atenção"));
  return parts.join(" · ");
}

export type PathStanding = { key: "authorized" | "structural" | "pending" | "review" | "caveat" | "risk"; label: string };

export function pathStandings(path: Relationship[]): PathStanding[] {
  const standings = path.map(standingOf);
  const pending = standings.filter((s) => s === "suggested").length;
  const review = standings.filter((s) => s === "review").length;
  const caveat = standings.filter((s) => s === "caveat").length;
  const risky = path.filter((r) => standingOf(r) === "suggested" && !r.evidence.to.unique).length;
  const usable = path.every((r) => r.standing?.usable ?? r.status === "confirmed");
  const tags: PathStanding[] = [usable ? { key: "authorized", label: caveat ? "autorizado com ressalva" : "autorizado para uso" } : { key: "structural", label: "só estrutural" }];
  if (pending) tags.push({ key: "pending", label: plural(pending, "decisão pendente", "decisões pendentes") });
  if (review) tags.push({ key: "review", label: plural(review, "relação para reavaliar", "relações para reavaliar") });
  if (caveat) tags.push({ key: "caveat", label: caveat === 1 ? "multiplicidade aceita" : `${caveat} com multiplicidade aceita` });
  if (risky) tags.push({ key: "risk", label: risky === 1 ? "destino com ids repetidos" : `${risky} destinos com ids repetidos` });
  return tags;
}

export function routeLabel(from: string, path: Relationship[]) {
  return pathTables(from, path).join(" → ");
}
