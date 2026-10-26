"use client";

import { useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { useQuestionReadings } from "@/lib/queries";
import type { QuestionSpec, ValidityReading } from "@/lib/types";
import { ValidityForm } from "@/features/shared/ValidityForm";
import { formatAnswer } from "../model/answer";
import type { CatalogTable } from "../model/catalog";
import { periodLabel } from "../model/period";
import { READING_HINT, READING_TITLE, READINGS } from "../model/question";
import { Needs } from "./Needs";

const LINES: Record<ValidityReading, [number, number, boolean][]> = {
  started: [
    [30, 70, true],
    [6, 44, false],
    [56, 74, false],
  ],
  active_any: [
    [6, 34, true],
    [30, 70, true],
    [4, 18, false],
  ],
  active_at_end: [
    [6, 70, true],
    [10, 40, false],
    [56, 74, false],
  ],
};

export function ReadingGlyph({ reading }: { reading: ValidityReading }) {
  return (
    <svg width="64" height="34" viewBox="0 0 76 40" aria-hidden>
      <rect x="24" y="2" width="28" height="36" fill="var(--a-wash)" />
      <line x1="24" x2="24" y1="2" y2="38" stroke="var(--a)" strokeWidth="1" />
      <line x1="52" x2="52" y1="2" y2="38" stroke="var(--a)" strokeWidth="1" />
      {LINES[reading].map(([a, b, inside], i) => (
        <line key={i} x1={a} x2={b} y1={10 + i * 10} y2={10 + i * 10} stroke={inside ? "var(--a-deep)" : "var(--ink-3)"} strokeWidth="3" strokeLinecap="round" opacity={inside ? 1 : 0.4} />
      ))}
      {reading === "started" && <circle cx="30" cy="10" r="3" fill="var(--ab)" />}
      {reading === "active_at_end" && <line x1="52" x2="52" y1="0" y2="40" stroke="var(--ab)" strokeWidth="2" strokeDasharray="3 2" />}
    </svg>
  );
}

type Props = {
  question: QuestionSpec;
  table: CatalogTable;
  unit: string;
  onChoose: (reading: ValidityReading) => void;
};

export function Clarification({ question, table, unit, onChoose }: Props) {
  const readings = useQuestionReadings(question);
  const [criteria, setCriteria] = useState(false);
  const period = question.period;
  if (!period) return null;
  const label = `vigentes em ${periodLabel(period.from, period.to)}`;
  const data = readings.data?.data;
  const pendingReading = data?.readings.find((option) => option.pending.length > 0) ?? null;

  return (
    <section className="clar" aria-labelledby="clar-title">
      <h2 id="clar-title">
        O que você quer dizer com <q>{label}</q>?
      </h2>
      {readings.isPending && <LoadingBlock label="Calculando as três leituras" />}
      {readings.isError && <ErrorBlock error={readings.error} onRetry={() => readings.refetch()} />}
      {data && !data.declaration && (
        <div className="insuff">
          <h2>Antes, declare a vigência de {table.key}</h2>
          <p>
            As três leituras dependem de saber quais colunas marcam o início e o fim de cada registro. O Trace não deduz isso sozinho, então nenhuma leitura é
            calculada até a declaração.
          </p>
          <ValidityForm key={table.id} table={{ id: table.id, key: table.key, columns: table.columns, validity: table.validity }} />
        </div>
      )}
      {data?.declaration && (
        <>
          <p className="clar-sub">São três leituras válidas, com resultados diferentes. O Trace não escolhe por você.</p>
          <ul className="clar-list" aria-labelledby="clar-title">
            {READINGS.map((reading) => {
              const option = data.readings.find((candidate) => candidate.reading === reading);
              return (
                <li key={reading} className="clar-row">
                  <button type="button" className="clar-opt" data-reading={reading} aria-describedby={criteria ? `crit-${reading}` : undefined} onClick={() => onChoose(reading)}>
                    <span className="co-num">
                      <b>{option?.computed ? formatAnswer(option.value) : "—"}</b>
                      <small>
                        {option?.computed
                          ? option.pending.length > 0
                            ? `${unit} · provisório`
                            : unit
                          : option?.reason === "failed"
                            ? "não foi possível calcular"
                            : "depende de uma decisão"}
                      </small>
                    </span>
                    <span className="co-body">
                      <span className="co-t">
                        {READING_TITLE[reading]} {periodLabel(period.from, period.to)}
                      </span>
                      <span className="co-d">{READING_HINT[reading]}</span>
                    </span>
                    <span className="co-g">
                      <ReadingGlyph reading={reading} />
                    </span>
                    <span className="co-go" aria-hidden>
                      Escolher →
                    </span>
                  </button>
                  {criteria && option?.criteria && (
                    <div className="co-crit" id={`crit-${reading}`}>
                      <p>
                        <b>entra</b> {option.criteria.enters}
                      </p>
                      <p>
                        <b>fica de fora</b> {option.criteria.leaves}
                      </p>
                      <p className="rule">{option.criteria.rule}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {criteria && data.readings[0]?.criteria && <p className="small-note">{data.readings[0].criteria.undetermined}</p>}
          <button type="button" className="btn-link justify-self-start text-[15px]" aria-expanded={criteria} onClick={() => setCriteria((value) => !value)}>
            {criteria ? "Ocultar critérios" : "Ver critérios exatos"}
          </button>
          {pendingReading && (
            <div className="clar-pending">
              {pendingReading.computed && (
                <p className="small-note">Os números marcados como provisórios usam uma relação ainda não decidida no Mapa. Eles mostram o efeito, mas não podem ser rastreados até a decisão.</p>
              )}
              <Needs issues={pendingReading.pending} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
