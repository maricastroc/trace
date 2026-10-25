import type { Relationship } from "@/lib/types";
import { competitorsOf, needsAttention, standingOf } from "../model/graph";

const C = 2 * Math.PI * 12;
const CROSS = "M22 1v5M22 38v5M1 22h5M38 22h5";

export function markGlyph(relation: Relationship, all: Relationship[]) {
  const standing = standingOf(relation);
  if (standing === "rejected") return "×";
  if (standing === "review") return "!";
  if (standing === "suggested" && competitorsOf(relation, all).some((c) => c.status === "suggested")) return "?";
  if (standing === "confirmed" || standing === "caveat") return "✓";
  return needsAttention(relation) ? "!" : "";
}

export function MarkArt({ relation, all }: { relation: Relationship; all: Relationship[] }) {
  const ratio = relation.evidence.match.match_ratio;
  const glyph = markGlyph(relation, all);
  return (
    <svg viewBox="0 0 44 44" aria-hidden>
      <circle className="flash" cx="22" cy="22" r="16" />
      <circle className="bgc" cx="22" cy="22" r="16" />
      <circle className="trk" cx="22" cy="22" r="12" />
      {ratio < 1 && <circle className="miss" cx="22" cy="22" r="12" strokeDasharray={`${Math.max(2, (1 - ratio) * C)} ${C}`} transform={`rotate(${-90 + ratio * 360} 22 22)`} />}
      <circle className="arc" cx="22" cy="22" r="12" strokeDasharray={`${Math.max(0, ratio * C - (ratio < 1 ? 1.5 : 0))} ${C}`} transform="rotate(-90 22 22)" />
      <path className="xa" d={CROSS} />
      <path className="xb" d={CROSS} />
      {glyph && (
        <text x="22" y="26.5" textAnchor="middle" className={`q ${glyph === "!" ? "warn" : ""}`}>
          {glyph}
        </text>
      )}
    </svg>
  );
}
