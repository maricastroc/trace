"use client";

import { useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { formatCount } from "@/lib/format";
import { useComparisonIdentities, useComparisonPreview, useComparisonRows } from "@/lib/queries";
import type { ComparisonIdentity, ComparisonRule, ComparisonSummary } from "@/lib/types";
import { explanationText, type Labels } from "../model/reconciliation";
import type { ResultModel } from "../model/result";
import { RULE_TEXT, type Side } from "../model/spec";
import { detailText, RowsTable, SharedBody, statusWord, TraceGate, type TraceControl } from "./Investigate";

const ALL_RULES: ComparisonRule[] = ["leading_zeros", "case_and_spacing"];

function proposalOf(samples: ComparisonIdentity[]): ComparisonRule[] {
  const tally = new Map<string, number>();
  for (const sample of samples) {
    const rules = ((sample.detail?.rules as string[] | undefined) ?? []).filter((rule): rule is ComparisonRule => ALL_RULES.includes(rule as ComparisonRule));
    if (rules.length === 0) continue;
    const key = [...rules].sort().join("+");
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return best ? (best.split("+") as ComparisonRule[]) : ["leading_zeros"];
}

function Decomposition({
  summary,
  labels,
  caption,
}: {
  summary: Pick<ComparisonSummary, "a" | "b" | "only_a" | "only_b" | "shared" | "shared_by_rule">;
  labels: Labels;
  caption: string;
}) {
  return (
    <p className="decomp">
      <span className="dc-k">{caption}</span>
      <span className="mono">
        <b className="a">{formatCount(summary.a.distinct)}</b> − <b className="a">{formatCount(summary.only_a)}</b> + <b className="b">{formatCount(summary.only_b)}</b> ={" "}
        <b>{formatCount(summary.b.distinct)}</b>
      </span>
      <span className="dc-s">
        {formatCount(summary.shared)} nos dois pela chave exata{summary.shared_by_rule > 0 ? ` · ${formatCount(summary.shared_by_rule)} pela regra` : ""} ·{" "}
        {formatCount(summary.only_a)} só em {labels.a} · {formatCount(summary.only_b)} só em {labels.b}
      </span>
    </p>
  );
}

function PairsTable({ items, labels, onPick }: { items: ComparisonIdentity[]; labels: Labels; onPick: (identity: ComparisonIdentity) => void }) {
  return (
    <div className="rt-wrap">
      <div className="rt-scroll">
        <table className="pairs-t">
          <caption className="sr-only">Pares possíveis</caption>
          <thead>
            <tr>
              <th scope="col">{labels.a} (A)</th>
              <th scope="col" aria-label="ligação" />
              <th scope="col">{labels.b} (B)</th>
              <th scope="col">evidências</th>
            </tr>
          </thead>
          <tbody>
            {items.map((identity) => (
              <tr
                key={identity.identity}
                tabIndex={0}
                className="clickable"
                aria-label={`${identity.identity} em A e ${String(identity.detail?.candidate ?? "")} em B. Abrir as linhas de origem.`}
                onClick={() => onPick(identity)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPick(identity);
                  }
                }}
              >
                <td>
                  <div className="idv a">{identity.identity}</div>
                  <div className="pt-sub">
                    {formatCount(identity.a_rows)} {identity.a_rows === 1 ? "linha" : "linhas"}
                  </div>
                </td>
                <td className="lk" aria-hidden>
                  ◌ ↔ ◌
                </td>
                <td>
                  <div className="idv b">{String(identity.detail?.candidate ?? "")}</div>
                  <div className="pt-sub">sem par exato em A</div>
                </td>
                <td>
                  <div className="ev-chips">
                    {((identity.detail?.rules as ComparisonRule[] | undefined) ?? []).map((rule) => (
                      <span key={rule}>{RULE_TEXT[rule]?.name ?? rule}</span>
                    ))}
                    <span>único candidato nos dois sentidos</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Props = {
  result: ResultModel;
  labels: Labels;
  trace: TraceControl;
  onPick: (identity: ComparisonIdentity) => void;
  onAccept: (rules: ComparisonRule[], effect: ComparisonSummary | null) => void;
  onKeep: () => void;
};

export function HypothesisBody({ result, labels, trace, onPick, onAccept, onKeep }: Props) {
  const traced = useComparisonIdentities(result.runId, { category: "only_a", explanation: "possible_match" }, 1, 30);
  const samples = result.runId ? (traced.data?.data ?? []) : (result.explained?.only_a?.possible_match ?? []);
  const proposal = proposalOf(samples);
  const rules = [...new Set([...result.spec.rules, ...proposal])].sort() as ComparisonRule[];
  const effect = useComparisonPreview({ ...result.spec, rules });
  const after = effect.data?.data.computed ? effect.data.data.summary : null;
  const { summary } = result;
  const count = summary.explanations.only_a.possible_match;
  const leftovers = after
    ? after.explanations.only_a.ambiguous_match +
      after.explanations.only_b.ambiguous_match +
      after.explanations.only_a.variant_of_matched +
      after.explanations.only_b.variant_of_matched
    : 0;
  const { a, b } = result.sides;

  return (
    <>
      <div className="statusline">
        <span className="proof possible">
          <i aria-hidden />
          possível · hipótese
        </span>
        <span className="mono small">
          {formatCount(count)} em A e {formatCount(summary.explanations.only_b.possible_match)} em B continuam sem par
        </span>
      </div>
      <section className="cat-sec">
        <h3>Por que está aqui</h3>
        <div className="rule-box">
          <b>Hipótese, não par</b>
          <span>{explanationText("possible_match", "a", labels).rule}</span>
        </div>
      </section>
      <section className="cat-sec">
        <h3>A regra que transformaria em pares</h3>
        <p className="mono key-l">
          {proposal.map((rule) => RULE_TEXT[rule].effect).join(" e ")} em {a.dataset.key}.{a.key} e {b.dataset.key}.{b.key}
        </p>
        <p className="small-note">A regra só pareia quando o candidato é único nos dois sentidos. Nenhum valor dos arquivos é alterado.</p>
      </section>
      <section className="cat-sec" aria-live="polite">
        <h3>Se a regra for aceita</h3>
        {effect.isError && <ErrorBlock error={effect.error} onRetry={() => effect.refetch()} />}
        {!after && !effect.isError && <LoadingBlock label="Calculando o efeito da regra" />}
        {after && (
          <>
            <p className="effect-n">
              <b>+{formatCount(after.shared_by_rule)}</b> {after.shared_by_rule === 1 ? "par" : "pares"} pela regra
              {after.shared_by_rule !== count && (
                <span className="small-note"> · a prévia acima tinha {formatCount(count)} candidatos; a regra pareia só os únicos nos dois sentidos</span>
              )}
            </p>
            <Decomposition summary={summary} labels={labels} caption="Hoje" />
            <Decomposition summary={after} labels={labels} caption="Com a regra" />
            <p className="small-note">
              A diferença líquida continua {formatCount(Math.abs(after.net_difference))}: a regra muda quais identidades têm par, não o total de cada lado.
              {leftovers > 0 &&
                ` ${formatCount(leftovers)} ${leftovers === 1 ? "identidade ambígua ou parecida com uma já pareada continua" : "identidades ambíguas ou parecidas com uma já pareada continuam"} sem par.`}
            </p>
          </>
        )}
      </section>
      <div className="accept">
        <p>
          <b>Aceitar a regra?</b> Ela passa a fazer parte da definição desta comparação, e cada par feito por ela fica marcado. A comparação sem a regra continua disponível.
        </p>
        {result.source === "trace" && <p className="small-note">A execução rastreada não muda: aceitar abre uma prévia nova com a regra, que você pode rastrear.</p>}
        <div className="panel-actions">
          <button type="button" className="btn btn-ab" disabled={!after} onClick={() => onAccept(rules, after)}>
            Aceitar a regra
          </button>
          <button type="button" className="btn btn-quiet" onClick={onKeep}>
            Manter como hipótese
          </button>
        </div>
      </div>
      <section className="cat-sec">
        <h3>Pares possíveis{samples.length < count ? ` · ${formatCount(samples.length)} de ${formatCount(count)}` : ""}</h3>
        {samples.length > 0 ? (
          <PairsTable items={samples} labels={labels} onPick={onPick} />
        ) : traced.isPending && result.runId ? (
          <LoadingBlock label="Carregando os pares" />
        ) : null}
        {!result.runId && <TraceGate trace={trace} what="todos os pares e as linhas de origem de cada lado" />}
      </section>
    </>
  );
}

export function RuleBody({
  result,
  labels,
  trace,
  onPick,
  onRemove,
}: {
  result: ResultModel;
  labels: Labels;
  trace: TraceControl;
  onPick: (identity: ComparisonIdentity) => void;
  onRemove: () => void;
}) {
  const before = useComparisonPreview({ ...result.spec, rules: [] });
  const without = before.data?.data.computed ? before.data.data.summary : null;
  return (
    <>
      <div className="statusline">
        <span className="proof declared">
          <i aria-hidden />
          declarado · regra aceita por você
        </span>
        <span className="mono small">contam como nos dois</span>
      </div>
      <section className="cat-sec">
        <h3>Regra aceita</h3>
        <p className="mono key-l">{result.spec.rules.map((rule) => RULE_TEXT[rule].effect).join(" e ")}</p>
        {without && <Decomposition summary={without} labels={labels} caption="Sem a regra" />}
        <Decomposition summary={result.summary} labels={labels} caption="Com a regra" />
        <div className="panel-actions">
          <button type="button" className="btn btn-quiet" onClick={onRemove}>
            Remover a regra
          </button>
        </div>
      </section>
      <SharedBody result={result} labels={labels} trace={trace} onOpen={() => undefined} onPick={onPick} category="shared_by_rule" />
    </>
  );
}

function SideRows({ result, side, value, labels, note }: { result: ResultModel; side: Side; value: string; labels: Labels; note?: string }) {
  const [page, setPage] = useState(1);
  const rows = useComparisonRows(result.runId, side, { identity: value }, "all", page);
  const basis = result.sides[side];
  return (
    <section className="cat-sec">
      <h3>
        Em {labels[side]} · {basis.dataset.key} · versão {basis.version.number}
      </h3>
      {note && <p className="small-note">{note}</p>}
      {rows.isError && <ErrorBlock error={rows.error} onRetry={() => rows.refetch()} />}
      {!rows.data && rows.isPending && <LoadingBlock label="Carregando as linhas de origem" />}
      {rows.data &&
        (rows.data.data.length === 0 ? (
          <p className="small-note">
            Nenhuma linha de {basis.dataset.key} tem <span className="mono">{value}</span> em {basis.key}.
          </p>
        ) : (
          <>
            <RowsTable rows={rows.data.data} caption={`Linhas de ${basis.dataset.key} com ${value}`} />
            {rows.data.meta.last_page > 1 && (
              <div className="rt-foot pager">
                <span>
                  Página {rows.data.meta.page} de {rows.data.meta.last_page} · {formatCount(rows.data.meta.total)} linhas
                </span>
                <span className="q-actions">
                  <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Anterior
                  </button>
                  <button type="button" className="btn btn-quiet" disabled={page >= rows.data.meta.last_page} onClick={() => setPage(page + 1)}>
                    Próxima
                  </button>
                </span>
              </div>
            )}
          </>
        ))}
    </section>
  );
}

export function IdentityDetail({ result, identity, labels, trace }: { result: ResultModel; identity: ComparisonIdentity; labels: Labels; trace: TraceControl }) {
  const status = statusWord(identity);
  const own: Side | null = identity.category === "only_a" ? "a" : identity.category === "only_b" ? "b" : null;
  const sentence =
    identity.category === "shared"
      ? `Está nos dois lados com o mesmo texto: ${formatCount(identity.a_rows)} ${identity.a_rows === 1 ? "linha" : "linhas"} em ${labels.a} e ${formatCount(identity.b_rows)} em ${labels.b}.`
      : identity.category === "shared_by_rule"
        ? `Pareada pela regra aceita: ${identity.a_value} em ${labels.a} e ${identity.b_value} em ${labels.b}. O texto de cada lado é preservado.`
        : `${explanationText(identity.explanation ?? "absent", own!, labels).rule}`;
  const candidate = typeof identity.detail?.candidate === "string" ? identity.detail.candidate : null;
  const candidates = Array.isArray(identity.detail?.candidates) ? (identity.detail.candidates as string[]).slice(0, 3) : [];
  const repeated = [
    identity.a_rows > 1 ? `${formatCount(identity.a_rows)} linhas em ${labels.a}` : null,
    identity.b_rows > 1 ? `${formatCount(identity.b_rows)} linhas em ${labels.b}` : null,
  ].filter(Boolean);

  const lookups = (side: Side): { value: string; note?: string }[] => {
    if (identity.category === "shared_by_rule") return [{ value: side === "a" ? identity.a_value! : identity.b_value! }];
    if (!own || side === own) return [{ value: identity.identity }];
    if (identity.explanation === "possible_match" && candidate)
      return [{ value: candidate, note: `Linhas do candidato ${candidate}, escrito de outro jeito. Hipótese: não contam como par.` }];
    if (identity.explanation === "ambiguous_match" && candidates.length)
      return candidates.map((value) => ({
        value,
        note: `Candidato ${value}: escrito de outro jeito, é um dos ${formatCount(Number(identity.detail?.count ?? candidates.length))} valores possíveis. Com mais de um candidato, nenhum par é feito.`,
      }));
    if (identity.explanation === "variant_of_matched" && candidates.length)
      return candidates.map((value) => ({
        value,
        note: `${value} já tem par exato. Por isso ${identity.identity} não vira um segundo par: os dois podem ser a mesma identidade.`,
      }));
    if (identity.explanation === "excluded_in_other") return [{ value: identity.identity, note: "Linhas com o mesmo texto que saíram da seleção deste lado, com o motivo." }];
    return [
      {
        value: identity.identity,
        note: identity.explanation === "outside_other_period" ? undefined : "Não encontrada: nenhum valor igual, nem escrito de outro jeito, deste lado.",
      },
    ];
  };

  return (
    <>
      <div className="statusline">
        <span className={`tagx ${status.tone}`}>{status.text}</span>
        {detailText(identity) && <span className="mono small">{detailText(identity)}</span>}
      </div>
      <p className="step-note">{sentence}</p>
      {repeated.length > 0 && <p className="small-note">Aparece em {repeated.join(" e ")}: continua sendo uma identidade só na conta.</p>}
      {result.runId ? (
        <>
          {(["a", "b"] as const).flatMap((side) =>
            lookups(side).map((lookup) => <SideRows key={`${side}-${lookup.value}`} result={result} side={side} value={lookup.value} labels={labels} note={lookup.note} />),
          )}
        </>
      ) : (
        <TraceGate trace={trace} what="as linhas de origem de cada lado, com a linha do arquivo e os valores completos" />
      )}
    </>
  );
}
