import { formatCount } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { overprintCounts } from "../model/evidence";

const W = 620;
const H = 168;

export function Overprint({ relation }: { relation: Relationship }) {
  const c = overprintCounts(relation.evidence);
  const from = `${relation.from.dataset_key}.${relation.from.column}`;
  const to = `${relation.to.dataset_key}.${relation.to.column}`;
  const L = c.fromOnly ? 104 : 0;
  const R = c.toOnly ? 132 : 0;
  const M = W - 8 - L - R;
  const x0 = 4;
  const bx = x0 + L;
  const yA = 30;
  const yB = 46;
  const hh = 52;
  const brk = bx + M * 0.32;
  const cx = bx + M * 0.66;
  const mono = (size: number, weight: number, fill: string) => ({ font: `${weight} ${size}px var(--f-mono)`, fill });
  return (
    <div className="overprint">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${formatCount(c.fromDistinct)} valores em ${from} e ${formatCount(c.toDistinct)} em ${to}: ${formatCount(c.both)} nos dois, ${formatCount(c.fromOnly)} só na origem, ${formatCount(c.toOnly)} só no destino.`}
      >
        <text x={x0} y="18" style={mono(12, 600, "var(--a-deep)")}>
          {from} · {formatCount(c.fromDistinct)} valores
        </text>
        <text x={W - 4} y={H - 4} textAnchor="end" style={mono(12, 600, "var(--b-deep)")}>
          {to} · {formatCount(c.toDistinct)} valores
        </text>
        {c.fromOnly > 0 && (
          <>
            <rect x={x0} y={yA} width={L} height={hh} fill="var(--a)" />
            <text x={x0} y={yA + hh + 18} style={mono(12.5, 600, "var(--ink)")}>
              {formatCount(c.fromOnly)} sem par
            </text>
          </>
        )}
        <rect x={bx} y={yA} width={M} height={hh} fill="var(--a)" />
        <rect x={bx} y={yB} width={M + R} height={hh} fill="var(--b)" style={{ mixBlendMode: "multiply" }} />
        {(c.fromOnly > 0 || c.toOnly > 0) && <path d={`M${brk},${yA - 4} l-9,${hh + 24} M${brk + 9},${yA - 4} l-9,${hh + 24}`} stroke="var(--sheet)" strokeWidth="4" />}
        <text x={cx} y={yB + 22} textAnchor="middle" style={mono(18, 700, "#fff")}>
          {formatCount(c.both)}
        </text>
        <text x={cx} y={yB + 36} textAnchor="middle" style={mono(11.5, 500, "#fff")}>
          nos dois
        </text>
        {c.toOnly > 0 && (
          <>
            <text x={bx + M + R / 2} y={yB + hh / 2 + 10} textAnchor="middle" style={mono(15, 700, "#fff")}>
              {formatCount(c.toOnly)}
            </text>
            <text x={bx + M + R / 2} y={yA + 10} textAnchor="middle" style={mono(11, 500, "var(--ink-3)")}>
              nunca citados
            </text>
          </>
        )}
        {c.fromOnly === 0 && c.toOnly === 0 && (
          <text x={x0} y={yB + hh + 22} style={mono(12.5, 500, "var(--ink-2)")}>
            nenhuma sobra dos dois lados
          </text>
        )}
        {(c.fromOnly > 0 || c.toOnly > 0) && (
          <text x={brk - 4} y={yB + hh + 22} textAnchor="middle" style={mono(10.5, 500, "var(--ink-3)")}>
            escala comprimida
          </text>
        )}
      </svg>
    </div>
  );
}
