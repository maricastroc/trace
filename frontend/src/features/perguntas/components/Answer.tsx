"use client";

import { useEffect, useRef, useState } from "react";
import { formatWhen, shortId } from "@/lib/format";
import type { Preview, RunDetail, RunSummary } from "@/lib/types";
import { answerValue, formatAnswer, numeric, type Note, type Outcome } from "../model/answer";
import { Needs } from "./Needs";

function AnswerNumber({ value, unit }: { value: string | number | null; unit: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef<number | null>(null);
  const size = numeric(value) ?? 0;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = typeof value === "number" ? value : null;
    const start = last.current;
    last.current = target;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (target === null || start === null || start === target || reduced) {
      element.textContent = formatAnswer(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 650);
      element.textContent = formatAnswer(Math.round(start + (target - start) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      element.textContent = formatAnswer(target);
    };
  }, [value]);

  return (
    <p className={`answer-n ${size >= 10000 ? "wide" : size >= 1000 ? "mid" : ""}`} role="img" aria-label={`${formatAnswer(value)} ${unit}`}>
      <span ref={ref} aria-hidden />
    </p>
  );
}

type Props = {
  outcome: Outcome | null;
  preview: Preview | null;
  run: RunDetail | null;
  earlier: { run: RunDetail; reasons: string[] } | null;
  tracing: RunSummary | RunDetail | null;
  unit: string;
  context: string;
  stale: boolean;
  notes: Note[];
  invOpen: boolean;
  onInvestigate: () => void;
  remedy: { label: string; apply: () => void } | null;
};

function Earlier({ earlier, computed }: { earlier: NonNullable<Props["earlier"]>; computed: boolean }) {
  return (
    <div className="ans-earlier" role="note">
      <p>
        <b>
          Execução rastreada {shortId(earlier.run.id)}, {formatWhen(earlier.run.finished_at)}
        </b>
        : não corresponde ao estado atual.
      </p>
      <ul>
        {earlier.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p>
        {computed
          ? "Ela continua gravada como estava. O número ao lado é uma prévia com os dados e as decisões de agora; rastreie de novo para gravá-lo."
          : "Ela continua gravada como estava. Com os dados e as decisões de agora, a pergunta ainda não pode ser calculada."}
      </p>
    </div>
  );
}

export function Answer({ outcome, preview, run, earlier, tracing, unit, context, stale, notes, invOpen, onInvestigate, remedy }: Props) {
  const [decisions, setDecisions] = useState(false);
  const value = outcome ? answerValue(outcome) : null;

  if (preview && !preview.computed) {
    return (
      <section className="q-answer" id="q-answer" tabIndex={-1} aria-label="Resposta" aria-busy={stale}>
        <div className="insuff warn" style={{ gridColumn: "1 / -1" }}>
          <h2>{preview.reason === "failed" ? "O cálculo falhou" : "Esta pergunta ainda não pode ser calculada"}</h2>
          <p>
            {preview.reason === "failed"
              ? (preview.error?.message ?? "O motor não conseguiu calcular a prévia.")
              : "Uma decisão pendente muda o resultado. O Trace não calcula com suposições: resolva a pendência abaixo ou mude a pergunta."}
          </p>
          <Needs issues={preview.pending} />
          {earlier && <Earlier earlier={earlier} computed={false} />}
        </div>
      </section>
    );
  }

  const pending = preview?.pending ?? [];
  const warnings = [
    ...(preview?.issues ?? []).filter((issue) => issue.severity === "warning").map((issue) => issue.message),
    ...notes.filter((note) => note.kind === "warn").map((note) => note.text),
  ];

  return (
    <section className="q-answer" id="q-answer" tabIndex={-1} aria-label="Resposta" aria-busy={stale}>
      <div className="ans-main" aria-live="polite" aria-atomic="true">
        <AnswerNumber value={value} unit={unit} />
        <div className="ans-text">
          <p className="answer-unit">{unit}</p>
          <p className="ans-reading">{context}</p>
        </div>
      </div>
      <div className="ans-side">
        <p className="ans-status">
          <span className={`ans-chip ${run ? "traced" : ""}`}>{run ? "rastreada" : "prévia"}</span>
          {run
            ? `Execução ${shortId(run.id)}, ${formatWhen(run.finished_at)}. Versões, regras, resultado e registros estão gravados.`
            : tracing
              ? "Rastreando: o motor está gravando versões, regras e registros."
              : "Calculada agora pelo motor, sem gravar a linhagem. Rastrear grava versões, regras e registros."}
        </p>
        {pending.length > 0 && !run && (
          <>
            <p className="ans-pend">
              <span className="pend-dot" aria-hidden />
              Para rastrear este resultado, {pending.length === 1 ? "falta 1 decisão" : `faltam ${pending.length} decisões`}.
              <button type="button" className="btn-link" aria-expanded={decisions} aria-controls="q-decisions" onClick={() => setDecisions((open) => !open)}>
                {decisions ? "Ocultar" : "Resolver"}
              </button>
            </p>
            {decisions && <Needs id="q-decisions" issues={pending} />}
          </>
        )}
        {earlier && !tracing && <Earlier earlier={earlier} computed />}
        {warnings.map((text) => (
          <p key={text} className="ans-warn">
            {text}
          </p>
        ))}
        <div className="q-actions">
          <button type="button" className="btn btn-primary" aria-expanded={invOpen} aria-controls="q-inv" onClick={onInvestigate}>
            {invOpen ? "Recolher investigação" : "Investigar a resposta"}
          </button>
          {remedy && (
            <button type="button" className="btn" onClick={remedy.apply}>
              {remedy.label}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
