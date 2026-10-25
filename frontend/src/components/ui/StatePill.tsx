import type { RelationshipStandingKey } from "@/lib/types";

const WORDS: Record<RelationshipStandingKey, string> = {
  suggested: "sugerida",
  confirmed: "confirmada",
  caveat: "com ressalva",
  rejected: "rejeitada",
  review: "reavaliar",
};

export function StatePill({ status }: { status: RelationshipStandingKey }) {
  return <span className={`state-pill state-pill-${status}`}>{WORDS[status]}</span>;
}
