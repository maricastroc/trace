import type { ComparisonExplanation, ComparisonSummary } from "@/lib/types";
import type { GroupKey } from "./overprint";
import { explanationText, type Labels } from "./reconciliation";
import type { Side } from "./spec";

export type Target =
  | { kind: "side"; side: Side }
  | { kind: "only"; side: Side }
  | { kind: "shared" }
  | { kind: "rule" }
  | { kind: "cause"; side: Side; explanation: ComparisonExplanation }
  | { kind: "hypothesis" }
  | { kind: "repeated"; side: Side }
  | { kind: "empty"; side: Side };

const EXPLANATIONS: ComparisonExplanation[] = ["excluded_in_other", "outside_other_period", "possible_match", "ambiguous_match", "variant_of_matched", "absent"];

export function targetKey(target: Target) {
  switch (target.kind) {
    case "cause":
      return `cause:${target.side}:${target.explanation}`;
    case "shared":
    case "rule":
    case "hypothesis":
      return target.kind;
    default:
      return `${target.kind}:${target.side}`;
  }
}

export function groupKey(side: Side, group: GroupKey) {
  return `${side}:${group}`;
}

export function focusOf(target: Target): Set<string> {
  const all = (side: Side) => ["shared", "rule", ...EXPLANATIONS].map((group) => groupKey(side, group as GroupKey));
  switch (target.kind) {
    case "side":
    case "repeated":
    case "empty":
      return new Set(all(target.side));
    case "only":
      return new Set(EXPLANATIONS.map((e) => groupKey(target.side, e)));
    case "shared":
      return new Set(["a:shared", "b:shared", "a:rule", "b:rule"]);
    case "rule":
      return new Set(["a:rule", "b:rule"]);
    case "hypothesis":
      return new Set(["a:possible_match", "b:possible_match"]);
    case "cause":
      return new Set([groupKey(target.side, target.explanation)]);
  }
}

export function targetLabel(target: Target, labels: Labels) {
  switch (target.kind) {
    case "side":
      return `identidades em ${labels[target.side]}`;
    case "only":
      return `só em ${labels[target.side]}`;
    case "shared":
      return "nos dois";
    case "rule":
      return "pares pela regra";
    case "hypothesis":
      return "pares possíveis";
    case "repeated":
      return `repetidas em ${labels[target.side]}`;
    case "empty":
      return `sem identificador em ${labels[target.side]}`;
    case "cause":
      return explanationText(target.explanation, target.side, labels).title;
  }
}

export function targetFromGroup(side: Side, group: GroupKey, summary: Pick<ComparisonSummary, "explanations">): Target {
  if (group === "shared") return { kind: "shared" };
  if (group === "rule") return { kind: "rule" };
  if (group === "possible_match" && (summary.explanations.only_a.possible_match ?? 0) > 0) return { kind: "hypothesis" };
  return { kind: "cause", side, explanation: group };
}
