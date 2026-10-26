"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTrail } from "@/components/shell/Trail";
import { SidePanel } from "@/components/ui/SidePanel";
import { formatCount, plural } from "@/lib/format";
import type { ComparisonIdentity, ComparisonRule, ComparisonSummary } from "@/lib/types";
import type { Catalog } from "@/features/perguntas/model/catalog";
import { buildScene, tabText, tabWidth, type Stage } from "../model/overprint";
import { answerSentence, explanationText, proofLabel, unitSentence } from "../model/reconciliation";
import { labelsFor, readingOf, titleOf, type ResultModel } from "../model/result";
import { describeSelection, RULE_TEXT } from "../model/spec";
import { focusOf, targetKey, targetLabel, type Target } from "../model/targets";
import { HypothesisBody, IdentityDetail, RuleBody } from "./Hypothesis";
import { CauseBody, EmptyBody, OnlyBody, RepeatedBody, SharedBody, SideBody, statusWord, type TraceControl } from "./Investigate";
import { Overprint } from "./Overprint";
import { StepSide } from "./StepSide";

type Props = {
  catalog: Catalog;
  result: ResultModel;
  stale: boolean;
  status: ReactNode;
  trace: TraceControl;
  onEdit: () => void;
  onRules: (rules: ComparisonRule[], effect: ComparisonSummary | null) => void;
  onKeep: () => void;
};

const ids = (count: number) => plural(count, "identidade", "identidades");

const STEPS = ["Fontes", "Alinhar", "Classificar", "Fechar a conta"];

export function Result({ catalog, result, stale, status, trace, onEdit, onRules, onKeep }: Props) {
  const { summary } = result;
  const { sides, equivalence } = result;
  const labels = useMemo(() => labelsFor({ sides, equivalence }), [sides, equivalence]);
  const scene = useMemo(
    () =>
      buildScene(summary, {
        a: tabWidth(summary.a.distinct, tabText("a", labels.a, summary.a.rows, true)),
        b: tabWidth(summary.b.distinct, tabText("b", labels.b, summary.b.rows, true)),
      }),
    [summary, labels],
  );
  const [stage, setStageState] = useState<Stage>(2);
  const [target, setTarget] = useState<Target | null>(null);
  const [identity, setIdentity] = useState<ComparisonIdentity | null>(null);
  const [hover, setHover] = useState<Set<string> | null>(null);
  const timers = useRef<number[]>([]);

  const stop = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const setStage = (next: Stage) => {
    stop();
    setStageState(next);
  };

  const play = () => {
    stop();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStageState(4);
      return;
    }
    setStageState(1);
    timers.current = [window.setTimeout(() => setStageState(2), 1400), window.setTimeout(() => setStageState(3), 3400), window.setTimeout(() => setStageState(4), 5400)];
  };

  const open = (next: Target) => {
    stop();
    setIdentity(null);
    setTarget(next);
    if ((next.kind === "cause" || next.kind === "hypothesis" || next.kind === "rule") && stage < 3) setStageState(3);
  };
  const close = () => {
    setTarget(null);
    setIdentity(null);
  };

  const focus = hover ?? (target ? focusOf(target) : null);
  const openKey = target ? targetKey(target) : null;
  const pair = `${labels.a} × ${labels.b}`;
  useTrail([
    { label: "Comparações", href: "/comparacoes" },
    { label: pair },
    ...(target ? [{ label: targetLabel(target, labels) }] : []),
    ...(identity ? [{ label: identity.identity }] : []),
  ]);

  const accept = (rules: ComparisonRule[], effect: ComparisonSummary | null) => {
    onRules(rules, effect);
    setIdentity(null);
    setTarget({ kind: "rule" });
  };

  const panel = target ? panelFor(target) : null;

  function panelFor(current: Target): { eyebrow: string; tone: string; title: string; sub?: string; body: ReactNode } {
    const shared = { result, labels, trace, onOpen: open, onPick: setIdentity };
    switch (current.kind) {
      case "side": {
        const counts = summary[current.side];
        return {
          eyebrow: `${current.side.toUpperCase()} · ${labels[current.side]}`,
          tone: current.side,
          title: `${ids(counts.distinct)} em ${labels[current.side]}`,
          sub: `de ${formatCount(counts.rows)} linhas · ${describeSelection(result.sides[current.side])}`,
          body: <SideBody {...shared} side={current.side} />,
        };
      }
      case "only": {
        const count = current.side === "a" ? summary.only_a : summary.only_b;
        const other = current.side === "a" ? labels.b : labels.a;
        return {
          eyebrow: `Só em ${current.side.toUpperCase()} · ${labels[current.side]}`,
          tone: current.side,
          title: `${ids(count)} sem par exato em ${other}`,
          sub: "Decomposição exclusiva, na ordem das regras",
          body: <OnlyBody {...shared} side={current.side} />,
        };
      }
      case "shared":
        return {
          eyebrow: "Nos dois",
          tone: "ab",
          title: `${ids(summary.shared + summary.shared_by_rule)} nos dois`,
          sub: summary.shared_by_rule > 0 ? `${formatCount(summary.shared)} pela chave exata · ${formatCount(summary.shared_by_rule)} pela regra aceita` : "pela chave exata",
          body: <SharedBody {...shared} category="shared" />,
        };
      case "rule":
        return {
          eyebrow: "Nos dois · pela regra aceita",
          tone: "ab",
          title: `${plural(summary.shared_by_rule, "par", "pares")} pela regra`,
          sub: result.spec.rules.map((rule) => RULE_TEXT[rule].effect).join(" e "),
          body: <RuleBody result={result} labels={labels} trace={trace} onPick={setIdentity} onRemove={() => onRules([], null)} />,
        };
      case "hypothesis":
        return {
          eyebrow: "Possível · hipótese",
          tone: "ab",
          title: `${plural(summary.explanations.only_a.possible_match, "par possível", "pares possíveis")}`,
          sub: "pode ser a mesma identidade escrita de outro jeito",
          body: <HypothesisBody result={result} labels={labels} trace={trace} onPick={setIdentity} onAccept={accept} onKeep={onKeep} />,
        };
      case "repeated":
        return {
          eyebrow: `${current.side.toUpperCase()} · ${labels[current.side]} · linhas → identidades`,
          tone: current.side,
          title: `${plural(summary[current.side].repeated_identities, "identidade repetida", "identidades repetidas")}`,
          sub: `${formatCount(summary[current.side].repeated_rows)} linhas a mais; não são causa de diferença`,
          body: <RepeatedBody {...shared} side={current.side} />,
        };
      case "empty":
        return {
          eyebrow: `${current.side.toUpperCase()} · ${labels[current.side]}`,
          tone: current.side,
          title: `${plural(summary[current.side].empty_rows, "linha", "linhas")} sem identificador`,
          body: <EmptyBody {...shared} side={current.side} />,
        };
      case "cause": {
        const counts = current.side === "a" ? summary.explanations.only_a : summary.explanations.only_b;
        const text = explanationText(current.explanation, current.side, labels);
        return {
          eyebrow: `Só em ${current.side.toUpperCase()} · ${labels[current.side]} · ${proofLabel(current.explanation, true)}`,
          tone: current.side,
          title: `${ids(counts[current.explanation] ?? 0)} · ${text.title}`,
          sub: text.sub,
          body: <CauseBody {...shared} side={current.side} explanation={current.explanation} />,
        };
      }
    }
  }

  const answer = answerSentence(summary, labels, readingOf(result));
  const ruleNames = result.spec.rules.map((rule) => RULE_TEXT[rule].name);

  return (
    <div className={`rc ${target ? "panel-open" : ""}`} aria-busy={stale}>
      <header className="rc-head">
        <div className="rc-title">
          <p className="eyebrow eyebrow-ab rc-eyebrow">
            Comparação
            <span className={`ver-chip ${result.source === "trace" ? "traced" : ""}`}>{result.source === "trace" ? "rastreada" : "prévia"}</span>
            {ruleNames.length > 0 && <span className="ver-chip v2">regra aceita: {ruleNames.join(", ")}</span>}
          </p>
          <h1>{titleOf(summary, labels)}</h1>
        </div>
        <div className="rc-nav">
          <div className="steps" role="group" aria-label="Passos da comparação">
            {STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={`Passo ${i + 1}: ${label}`}
                aria-current={stage === i + 1 ? "step" : undefined}
                className={stage > i + 1 ? "done" : ""}
                onClick={() => setStage((i + 1) as Stage)}
              >
                <i>{i + 1}</i>
                <span>{label}</span>
              </button>
            ))}
            <button type="button" className="play" aria-label="Reproduzir os quatro passos" title="Reproduzir os quatro passos" onClick={play}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3 2l9 5-9 5z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onEdit}>
            Editar os conjuntos
          </button>
        </div>
        <div className="rc-sources" aria-label="Legenda e conjuntos">
          {(["a", "b"] as const).map((side) => (
            <span key={side} className={`src ${side}`}>
              <i aria-hidden />
              <b>
                {side.toUpperCase()} · {labels[side]}
              </b>
              <span>
                {result.sides[side].dataset.key} · versão {result.sides[side].version.number} · {describeSelection(result.sides[side])}
              </span>
            </span>
          ))}
          <span className="src m">
            <i aria-hidden />
            <b>nos dois</b>
          </span>
          <span className="src-key">
            {result.sides.a.dataset.key}.{result.sides.a.key} = {result.sides.b.dataset.key}.{result.sides.b.key}
          </span>
        </div>
      </header>

      {status}

      <section className="rc-answer" aria-live="polite" aria-label="Resposta">
        <div className="ra-n">
          <b>{formatCount(Math.abs(summary.net_difference))}</b>
          <span>identidades de diferença nos totais</span>
          <small>
            {formatCount(summary.a.distinct)} − {formatCount(summary.b.distinct)}
          </small>
        </div>
        <button
          type="button"
          className="ra-n u"
          onClick={() => setStage(3)}
          onMouseEnter={() => setHover(new Set([...focusOf({ kind: "only", side: "a" }), ...focusOf({ kind: "only", side: "b" })]))}
          onMouseLeave={() => setHover(null)}
        >
          <b>{formatCount(summary.unmatched)}</b>
          <span>identidades sem par exato</span>
          <small>
            {formatCount(summary.only_a)} só em {labels.a} + {formatCount(summary.only_b)} só em {labels.b}
          </small>
        </button>
        <div className="ra-x">
          <p>{answer}</p>
          <details className="ra-more">
            <summary>Linhas e identidades</summary>
            <p>{unitSentence(summary, labels)}</p>
            <button type="button" className="btn-link" onClick={() => setStage(4)}>
              Ver a conta completa
            </button>
          </details>
        </div>
      </section>

      <div className="rc-body">
        <Overprint scene={scene} stage={stage} focus={focus} labels={labels} summary={summary} openKey={openKey} onFocus={setHover} onOpen={open} onStage={setStage} />
        <aside className="rc-side" aria-label="Passo atual">
          <StepSide result={result} catalog={catalog} stage={stage} labels={labels} openKey={openKey} onStage={setStage} onOpen={open} onFocus={setHover} />
        </aside>
      </div>

      <SidePanel
        open={panel !== null}
        onClose={close}
        onEscape={identity ? () => setIdentity(null) : close}
        eyebrow={identity ? `Identidade · ${statusWord(identity).text}` : panel?.eyebrow}
        eyebrowClassName={`eyebrow-${identity ? "ab" : (panel?.tone ?? "ab")}`}
        title={identity ? (identity.category === "shared_by_rule" ? `${identity.a_value} ↔ ${identity.b_value}` : identity.identity) : (panel?.title ?? "")}
        sub={identity ? undefined : panel?.sub}
        back={identity ? { label: "Voltar à lista", onClick: () => setIdentity(null) } : target ? { label: "Voltar à visão geral", onClick: close } : undefined}
        focusKey={`${openKey}:${identity?.identity ?? ""}:${identity?.category ?? ""}`}
      >
        {identity ? <IdentityDetail result={result} identity={identity} labels={labels} trace={trace} /> : panel?.body}
      </SidePanel>
    </div>
  );
}
