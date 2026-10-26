"use client";

import { useState } from "react";
import { formatCount } from "@/lib/format";
import { formatAnswer, numeric, type Group } from "../model/answer";

const TOP = 15;

type Props = {
  groups: Group[];
  total: string | number | null;
  sumOfGroups: string | number | null;
  unit: string;
  noun: string;
  onPick: (key: string) => void;
};

export function GroupBars({ groups, total, sumOfGroups, unit, noun, onPick }: Props) {
  const [all, setAll] = useState(false);
  const sorted = [...groups].sort((a, b) => (numeric(b.value) ?? 0) - (numeric(a.value) ?? 0));
  const shown = all ? sorted : sorted.slice(0, TOP);
  const max = Math.max(1, ...shown.map((group) => numeric(group.value) ?? 0));
  const differs = numeric(total) !== numeric(sumOfGroups);

  return (
    <section className="viz" aria-labelledby="viz-title">
      <div className="viz-head">
        <div>
          <h3 id="viz-title">Por {noun}</h3>
          <p>
            {sorted.length > TOP && !all ? `As ${TOP} maiores de ${formatCount(sorted.length)}, do maior para o menor.` : "Do maior para o menor."} Escolha um valor para
            perguntar só sobre ele.
          </p>
        </div>
      </div>
      <ul className="bars" aria-label={`${unit} por ${noun}`}>
        {shown.map((group) => {
          const width = `${Math.max(0.6, ((numeric(group.value) ?? 0) / max) * 100)}%`;
          const body = (
            <>
              <span className={`bk ${group.key === null ? "empty" : ""}`}>{group.key === null ? `sem valor de ${noun}` : group.label}</span>
              <span className="bar-track" aria-hidden>
                <span className="bar-fill" style={{ width }} />
              </span>
              <span className="bn">{formatAnswer(group.value)}</span>
            </>
          );
          return (
            <li key={group.resultNo}>
              {group.key === null ? (
                <div className="bar-row">{body}</div>
              ) : (
                <button type="button" className="bar-row" aria-label={`${group.label}: ${formatAnswer(group.value)} ${unit}. Perguntar só sobre ${group.label}`} onClick={() => onPick(group.key!)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="bar-total">
        <span>total calculado: {formatAnswer(total)}</span>
        {differs && <span className="sum">soma dos {formatCount(groups.length)} grupos: {formatAnswer(sumOfGroups)} · não é o total</span>}
      </div>
      {sorted.length > TOP && (
        <button type="button" className="btn-link justify-self-start text-[15px]" onClick={() => setAll((value) => !value)}>
          {all ? `Mostrar só as ${TOP} maiores` : `Mostrar os ${formatCount(sorted.length)} grupos`}
        </button>
      )}
    </section>
  );
}
