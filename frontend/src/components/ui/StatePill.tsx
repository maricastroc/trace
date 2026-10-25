import type { RelationshipStatus } from "@/lib/types";

const WORDS: Record<RelationshipStatus, string> = {
  suggested: "sugerida",
  confirmed: "confirmada",
  rejected: "rejeitada",
};

export function StatePill({ status }: { status: RelationshipStatus }) {
  return <span className={`state-pill state-pill-${status}`}>{WORDS[status]}</span>;
}
