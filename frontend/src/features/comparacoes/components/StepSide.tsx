"use client";

import Link from "next/link";
import { formatCount } from "@/lib/format";
import type { ComparisonCheck, ComparisonSideBasis, ComparisonSummary } from "@/lib/types";
import type { Catalog } from "@/features/perguntas/model/catalog";
import type { Stage } from "../model/overprint";
import { causeGroups, causes, ledger, type Cause, type Labels } from "../model/reconciliation";
import { EQUIVALENCE_TAG, type ResultModel } from "../model/result";
import { describeSelection, linkingRelation, RULE_TEXT, type Side } from "../model/spec";
import { focusOf, targetKey, type Target } from "../model/targets";

type Props = {
  result: ResultModel;
  catalog: Catalog;
  stage: Stage;
  labels: Labels;
  openKey: string | null;
  onStage: (stage: Stage) => void;
  onOpen: (target: Target) => void;
  onFocus: (focus: Set<string> | null) => void;
};

function Head({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="side-k">
      <i aria-hidden>{n}</i>
      {title}
    </h2>
  );
}

function Next({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-primary" onClick={onClick}>
      {label} →
    </button>
  );
}

export function causeTarget(cause: Cause): Target {
  return cause.explanation === "possible_match" ? { kind: "hypothesis" } : { kind: "cause", side: cause.side, explanation: cause.explanation };
}

function SourceCard({ side, basis, counts, label, latest }: { side: Side; basis: ComparisonSideBasis; counts: ComparisonSummary["a"]; label: string; latest: boolean }) {
  return (
    <div className={`src-card ${side}`}>
      <p className="sc-t">
        <i aria-hidden />
        {side.toUpperCase()} · {label}
      </p>
      <dl>
        <dt>{basis.kind === "run" ? "execução" : "tabela"}</dt>
        <dd>
          {basis.dataset.key} · versão {basis.version.number}
          {latest ? " (a mais recente)" : ""}
        </dd>
        <dt>seleção</dt>
        <dd>{describeSelection(basis)}</dd>
        <dt>chave</dt>
        <dd className="mono">
          {basis.dataset.key}.{basis.key}
        </dd>
        <dt>unidade</dt>
        <dd>
          <b>
            {formatCount(counts.rows)} {counts.rows === 1 ? "linha" : "linhas"} → {formatCount(counts.distinct)} identidades
          </b>
          {counts.repeated_rows > 0 && ` · ${formatCount(counts.repeated_rows)} repetidas`}
          {counts.empty_rows > 0 && ` · ${formatCount(counts.empty_rows)} sem identificador`}
        </dd>
      </dl>
    </div>
  );
}

function CauseButton({
  cause,
  openKey,
  onOpen,
  onFocus,
}: {
  cause: Cause;
  openKey: string | null;
  onOpen: (target: Target) => void;
  onFocus: (focus: Set<string> | null) => void;
}) {
  const target = causeTarget(cause);
  const focus = cause.explanation === "possible_match" ? focusOf({ kind: "hypothesis" }) : focusOf(target);
  return (
    <button
      type="button"
      className={`cat-i ${cause.side} ${cause.proof === "possible" ? "hyp" : ""}`}
      aria-pressed={openKey === targetKey(target)}
      onMouseEnter={() => onFocus(focus)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(focus)}
      onBlur={() => onFocus(null)}
      onClick={() => onOpen(target)}
    >
      <b>{formatCount(cause.count)}</b>
      <span className="ci-t">{cause.title}</span>
      <span className="ci-s">{cause.sub}</span>
    </button>
  );
}

function Classification({ summary, rules }: { summary: ComparisonSummary; rules: string[] }) {
  const both = (key: keyof ComparisonSummary["explanations"]["only_a"]) => summary.explanations.only_a[key] + summary.explanations.only_b[key];
  const rows: [string, number, string | null][] = [
    ["nos dois pela chave exata", summary.shared, null],
    ...(rules.length > 0 ? ([["nos dois pela regra aceita", summary.shared_by_rule, "par único nos dois sentidos"]] as [string, number, string | null][]) : []),
    ["saíram da seleção do outro lado", both("excluded_in_other"), "existem na origem do outro lado, mas o critério tirou"],
    ["fora do período do outro lado", both("outside_other_period"), "pela vigência declarada"],
    ["possível: escrita de outro jeito", both("possible_match"), "hipótese: não conta como par"],
    ["ambíguas: mais de um candidato", both("ambiguous_match"), "nenhum par é feito"],
    ["parecidas com uma já pareada", both("variant_of_matched"), "não vira um segundo par"],
    ["sem nenhuma correspondência", both("absent"), null],
  ];
  return (
    <details className="ev-more">
      <summary>
        <span className="em-t">Como cada identidade é classificada</span>
        <span className="em-m">{rows.length} regras, nesta ordem</span>
      </summary>
      <div className="em-body">
        <p className="small-note">Cada identidade recebe a primeira regra que se aplica. Nenhuma aparece em duas causas, e as explicações não mudam a conta.</p>
        <ol className="rule-list">
          {rows.map(([label, count, note], i) => (
            <li key={label}>
              <i>{i + 1}</i>
              <span>{label}</span>
              <b>{formatCount(count)}</b>
              {note && <small>{note}</small>}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

export function checkText(check: ComparisonCheck, summary: ComparisonSummary, labels: Labels) {
  const n = formatCount;
  const side = (s: Side) => summary[s];
  const rule = summary.shared_by_rule > 0 ? ` + ${n(summary.shared_by_rule)} pela regra` : "";
  switch (check.name) {
    case "distinct_a":
      return `${n(summary.shared)} nos dois${rule} + ${n(summary.only_a)} só em ${labels.a} = ${n(side("a").distinct)} identidades`;
    case "distinct_b":
      return `${n(summary.shared)} nos dois${rule} + ${n(summary.only_b)} só em ${labels.b} = ${n(side("b").distinct)} identidades`;
    case "rows_a":
    case "rows_b": {
      const c = side(check.name === "rows_a" ? "a" : "b");
      return `${labels[check.name === "rows_a" ? "a" : "b"]}: ${n(c.rows)} linhas = ${n(c.rows_with_key)} com identificador + ${n(c.empty_rows)} sem`;
    }
    case "keyed_a":
    case "keyed_b": {
      const c = side(check.name === "keyed_a" ? "a" : "b");
      return `${labels[check.name === "keyed_a" ? "a" : "b"]}: ${n(c.rows_with_key)} com identificador = ${n(c.distinct)} identidades + ${n(c.repeated_rows)} repetidas`;
    }
    case "net":
      return `${n(side("a").distinct)} − ${n(side("b").distinct)} = ${n(summary.only_a)} − ${n(summary.only_b)} = ${n(summary.net_difference)}`;
    case "explained_a":
      return `as explicações de só em ${labels.a} somam ${n(check.left)} de ${n(check.right)}`;
    case "explained_b":
      return `as explicações de só em ${labels.b} somam ${n(check.left)} de ${n(check.right)}`;
    case "identities":
      return `${n(check.left)} identidades classificadas, cada uma uma vez`;
    default:
      return `${check.formula}: ${n(check.left)} = ${n(check.right)}`;
  }
}

export function StepSide({ result, catalog, stage, labels, openKey, onStage, onOpen, onFocus }: Props) {
  const { summary, sides, spec } = result;
  const list = causes(summary, labels);
  const relation =
    sides.a.dataset.id !== sides.b.dataset.id ? linkingRelation(catalog, { table: sides.a.dataset.id, key: sides.a.key }, { table: sides.b.dataset.id, key: sides.b.key }) : null;
  const warnings = result.issues.filter((issue) => issue.severity === "warning");
  const latest = (side: Side) => spec[side].kind === "population" && (spec[side] as { version_id: string | null }).version_id === null;

  if (stage === 1) {
    return (
      <>
        <Head n={1} title="Fontes" />
        <SourceCard side="a" basis={sides.a} counts={summary.a} label={labels.a} latest={latest("a")} />
        <SourceCard side="b" basis={sides.b} counts={summary.b} label={labels.b} latest={latest("b")} />
        {(summary.a.repeated_rows > 0 || summary.b.repeated_rows > 0) && <p className="step-note">Linhas repetidas de uma mesma identidade contam uma vez.</p>}
        <Next label="Alinhar pela chave" onClick={() => onStage(2)} />
        <div className="src-card key">
          <p className="sc-t">Como se compara</p>
          <dl>
            <dt>chave</dt>
            <dd className="mono">
              {sides.a.dataset.key}.{sides.a.key} = {sides.b.dataset.key}.{sides.b.key}
            </dd>
            <dt>regra</dt>
            <dd>
              {spec.rules.length
                ? `texto igual, ou igual ao ${spec.rules.map((r) => RULE_TEXT[r].effect).join(" e ")} (regra aceita)`
                : "texto exatamente igual; normalizações viram hipóteses"}
            </dd>
            <dt>equivalência</dt>
            <dd>
              {result.equivalence ? (
                <>
                  <span className={`eq-tag ${result.equivalence.status === "declared" ? "user" : result.equivalence.status === "unconfirmed" ? "warn" : "ok"}`}>
                    {EQUIVALENCE_TAG[result.equivalence.status]}
                  </span>{" "}
                  {result.equivalence.statement}
                </>
              ) : (
                "não registrada nesta execução, anterior à confirmação de equivalência"
              )}
            </dd>
            <dt>diferença</dt>
            <dd>{result.attribution.statement}</dd>
          </dl>
          {relation && (
            <Link className="btn-link" href={`/mapa?relacao=${relation.id}`}>
              Ver a relação no Mapa
            </Link>
          )}
        </div>
        {warnings.length > 0 && (
          <ul className="caveats" aria-label="Ressalvas">
            {warnings.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{issue.message}</li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (stage === 2) {
    return (
      <>
        <Head n={2} title="Alinhar pela chave" />
        <p className="step-note">
          Onde o azul e o rosa se sobrepõem (violeta), a identidade está nos dois lados. À esquerda ficam as que só estão em A; à direita, as que só estão em B.
          {summary.shared_by_rule > 0 && ` ${formatCount(summary.shared_by_rule)} das que estão nos dois foram pareadas pela regra aceita.`}
        </p>
        <div className="align-stats">
          <button
            type="button"
            className="m"
            onClick={() => onOpen({ kind: "shared" })}
            onMouseEnter={() => onFocus(focusOf({ kind: "shared" }))}
            onMouseLeave={() => onFocus(null)}
          >
            <b>{formatCount(summary.shared + summary.shared_by_rule)}</b>
            <span>nos dois</span>
          </button>
          <button
            type="button"
            className="a"
            onClick={() => onOpen({ kind: "only", side: "a" })}
            onMouseEnter={() => onFocus(focusOf({ kind: "only", side: "a" }))}
            onMouseLeave={() => onFocus(null)}
          >
            <b>{formatCount(summary.only_a)}</b>
            <span>só em {labels.a}</span>
          </button>
          <button
            type="button"
            className="b"
            onClick={() => onOpen({ kind: "only", side: "b" })}
            onMouseEnter={() => onFocus(focusOf({ kind: "only", side: "b" }))}
            onMouseLeave={() => onFocus(null)}
          >
            <b>{formatCount(summary.only_b)}</b>
            <span>só em {labels.b}</span>
          </button>
        </div>
        {summary.fields.map((field) => (
          <p key={`${field.a}-${field.b}`} className="step-note">
            {field.a} × {field.b} nas {formatCount(field.compared)} em comum: {formatCount(field.same)} iguais, {formatCount(field.different)} diferentes,{" "}
            {formatCount(field.partial)} em parte.
          </p>
        ))}
        <Next label="Ver o que explica as sobras" onClick={() => onStage(3)} />
      </>
    );
  }

  if (stage === 3) {
    const groups = causeGroups(list, labels);
    return (
      <>
        <Head n={3} title="O que explica as sobras" />
        {groups.length === 0 ? (
          <p className="step-note">Não há sobras: todas as identidades dos dois lados têm par.</p>
        ) : (
          <>
            <p className="step-note">Escolha uma causa para destacá-la e ver o critério, a chave e os registros.</p>
            <div className="cat-groups">
              {groups.map((group) => (
                <section key={group.key} className={`cat-g ${group.key === "possible" ? "hyp" : ""}`}>
                  <h3>{group.title}</h3>
                  {group.items.map((cause) => (
                    <CauseButton key={`${cause.side}-${cause.explanation}`} cause={cause} openKey={openKey} onOpen={onOpen} onFocus={onFocus} />
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
        {summary.shared_by_rule > 0 && (
          <section className="cat-g hyp">
            <h3>Regra aceita</h3>
            <button
              type="button"
              className="cat-i ab"
              aria-pressed={openKey === "rule"}
              onClick={() => onOpen({ kind: "rule" })}
              onMouseEnter={() => onFocus(focusOf({ kind: "rule" }))}
              onMouseLeave={() => onFocus(null)}
            >
              <b>{formatCount(summary.shared_by_rule)}</b>
              <span className="ci-t">pares pela regra</span>
              <span className="ci-s">agora contam como nos dois</span>
            </button>
          </section>
        )}
        <Next label="Fechar a conta" onClick={() => onStage(4)} />
        <Classification summary={summary} rules={spec.rules} />
      </>
    );
  }

  const rows = ledger(summary, labels, list);
  const targets: Target[] = [
    { kind: "side", side: "a" },
    { kind: "only", side: "a" },
    { kind: "only", side: "b" },
    { kind: "side", side: "b" },
  ];
  const ok = summary.checks.filter((check) => check.holds).length;
  return (
    <>
      <Head n={4} title="Fechar a conta" />
      <div
        className="ledger"
        role="group"
        aria-label={`${formatCount(summary.a.distinct)} menos ${formatCount(summary.only_a)} mais ${formatCount(summary.only_b)} igual a ${formatCount(summary.b.distinct)} identidades`}
      >
        {rows.map((row, i) => (
          <button
            key={row.label}
            type="button"
            className={`lg-row ${row.tone === "total" ? "tot" : row.op ? row.tone : ""}`}
            onClick={() => onOpen(targets[i])}
            onMouseEnter={() => onFocus(focusOf(targets[i]))}
            onMouseLeave={() => onFocus(null)}
            onFocus={() => onFocus(focusOf(targets[i]))}
            onBlur={() => onFocus(null)}
          >
            <span className="lg-op" aria-hidden>
              {row.op}
            </span>
            <b>{formatCount(row.value)}</b>
            <span className="lg-l">
              {row.label}
              {row.parts.length > 0 && <small>{row.parts.map(formatCount).join(" + ")}</small>}
            </span>
          </button>
        ))}
      </div>
      {summary.only_a > 0 && summary.only_b > 0 && (
        <p className="step-note">
          {formatCount(Math.abs(summary.net_difference))} é a diferença líquida; {formatCount(summary.unmatched)} são as identidades sem par. Cada identidade entra uma vez na
          conta.
        </p>
      )}
      <details className="ev-more">
        <summary>
          <span className="em-t">Verificações da conta</span>
          <span className="em-m">
            {ok} de {summary.checks.length} conferem
          </span>
        </summary>
        <div className="em-body">
          <ul className="checks">
            {summary.checks.map((check) => (
              <li key={check.name} className={check.holds ? "ok" : "bad"}>
                <i aria-hidden>{check.holds ? "✓" : "✕"}</i>
                <span>
                  <span className="sr-only">{check.holds ? "confere: " : "não confere: "}</span>
                  {checkText(check, summary, labels)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>
      <Classification summary={summary} rules={spec.rules} />
    </>
  );
}
