"use client";

import { RowOpen } from "@/components/ui/RowOpen";
import { useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { formatCount, plural } from "@/lib/format";
import { useComparisonIdentities, useComparisonRows, type IdentityFilters } from "@/lib/queries";
import type { ComparisonCategory, ComparisonExplanation, ComparisonIdentity } from "@/lib/types";
import { causes, explanationText, proofLabel, proofOf, type Labels } from "../model/reconciliation";
import type { ResultModel } from "../model/result";
import { describeSelection, RULE_TEXT, type Side } from "../model/spec";
import { causeTarget } from "./StepSide";
import type { Target } from "../model/targets";

export type TraceControl = { onTrace: () => void; pending: boolean; error: Error | null };

const ORDER: ComparisonExplanation[] = ["excluded_in_other", "outside_other_period", "possible_match", "ambiguous_match", "variant_of_matched", "absent"];

const VALIDITY_REASON: Record<string, string> = {
  started_after: "a vigência começou depois do período",
  ended_before: "a vigência terminou antes do período",
  started_before: "a vigência começou antes do período",
  ended_during: "a vigência terminou durante o período",
};

export function statusWord(identity: Pick<ComparisonIdentity, "category" | "explanation">) {
  if (identity.category === "shared") return { text: "nos dois", tone: "in" };
  if (identity.category === "shared_by_rule") return { text: "nos dois pela regra", tone: "rule" };
  switch (identity.explanation) {
    case "excluded_in_other":
      return { text: "excluída por critério", tone: "out" };
    case "outside_other_period":
      return { text: "fora do período", tone: "out" };
    case "possible_match":
      return { text: "possível", tone: "pos" };
    case "ambiguous_match":
      return { text: "ambígua", tone: "pos" };
    case "variant_of_matched":
      return { text: "parecida com uma pareada", tone: "pos" };
    default:
      return { text: "não encontrada", tone: "out" };
  }
}

export function detailText(identity: ComparisonIdentity) {
  const detail = identity.detail ?? {};
  if (identity.category === "shared_by_rule") return `${identity.a_value} ↔ ${identity.b_value}`;
  switch (identity.explanation) {
    case "excluded_in_other": {
      const by = (detail.by as { step: number; code: string; rows: number }[] | undefined) ?? [];
      return by.map((item) => `${formatCount(item.rows)} ${item.rows === 1 ? "linha saiu" : "linhas saíram"} no passo ${item.step}`).join(" · ");
    }
    case "outside_other_period": {
      const reasons = (detail.reasons as Record<string, number> | undefined) ?? {};
      return Object.keys(reasons)
        .map((reason) => VALIDITY_REASON[reason] ?? reason)
        .join(" · ");
    }
    case "possible_match":
      return `candidato: ${String(detail.candidate ?? "")}`;
    case "ambiguous_match":
    case "variant_of_matched": {
      const list = (detail.candidates as string[] | undefined) ?? [];
      return `${identity.explanation === "variant_of_matched" ? "já pareada" : "candidatos"}: ${list.join(", ")}${(detail.count as number) > list.length ? "…" : ""}`;
    }
    default:
      return "";
  }
}

export function TraceGate({ trace, what }: { trace: TraceControl; what: string }) {
  return (
    <div className="gate">
      <p className="gate-t">Prévia: nada foi gravado ainda.</p>
      <p>
        Os números são os mesmos que uma execução rastreada daria, mas {what} só ficam disponíveis depois de rastrear. Rastrear grava a comparação, fixa as versões e grava cada
        identidade classificada.
      </p>
      <div className="q-actions">
        <button type="button" className="btn btn-ab" disabled={trace.pending} onClick={trace.onTrace}>
          {trace.pending ? "Rastreando…" : "Rastrear a comparação"}
        </button>
      </div>
      {trace.error && <ErrorBlock error={trace.error} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cat-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KeyUsed({ result, extra }: { result: ResultModel; extra?: string }) {
  const { a, b } = result.sides;
  return (
    <Section title="Chave usada">
      <p className="mono key-l">
        {a.dataset.key}.{a.key} = {b.dataset.key}.{b.key}
      </p>
      <p className="small-note">
        {result.spec.rules.length
          ? `Texto igual, ou igual ao ${result.spec.rules.map((rule) => RULE_TEXT[rule].effect).join(" e ")}, pela regra aceita.`
          : "Comparação por texto exato. Normalizações (zeros à esquerda, maiúsculas e espaços) só geram hipóteses."}
        {extra ? ` ${extra}` : ""}
      </p>
    </Section>
  );
}

function Pager({ page, last, total, onPage, label }: { page: number; last: number; total: number; onPage: (page: number) => void; label: string }) {
  if (last <= 1)
    return (
      <p className="rt-foot">
        {formatCount(total)} {label}
      </p>
    );
  return (
    <div className="rt-foot pager">
      <span>
        Página {page} de {last} · {formatCount(total)} {label}
      </span>
      <span className="q-actions">
        <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </button>
        <button type="button" className="btn btn-quiet" disabled={page >= last} onClick={() => onPage(page + 1)}>
          Próxima
        </button>
      </span>
    </div>
  );
}

function IdentityTable({ items, labels, onPick, caption }: { items: ComparisonIdentity[]; labels: Labels; onPick: (identity: ComparisonIdentity) => void; caption: string }) {
  return (
    <div className="rt-wrap">
      <div className="rt-scroll">
        <table className="rt">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">identidade</th>
              <th scope="col" className="r">
                linhas em {labels.a}
              </th>
              <th scope="col" className="r">
                linhas em {labels.b}
              </th>
              <th scope="col">situação</th>
              <th scope="col">detalhe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((identity) => {
              const status = statusWord(identity);
              return (
                <tr key={`${identity.category}-${identity.identity}`} className="clickable" onClick={() => onPick(identity)}>
                  <td className="mono">
                    <RowOpen label={`Identidade ${identity.identity}, ${status.text}. Abrir as linhas de origem.`} onOpen={() => onPick(identity)}>
                      {identity.category === "shared_by_rule" ? `${identity.a_value} ↔ ${identity.b_value}` : identity.identity}
                    </RowOpen>
                  </td>
                  <td className="mono r">{formatCount(identity.a_rows)}</td>
                  <td className="mono r">{formatCount(identity.b_rows)}</td>
                  <td>
                    <span className={`tagx ${status.tone}`}>{status.text}</span>
                  </td>
                  <td className="small">{detailText(identity)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ListProps = {
  result: ResultModel;
  labels: Labels;
  filters: IdentityFilters;
  sample: ComparisonIdentity[] | null;
  total: number;
  trace: TraceControl;
  onPick: (identity: ComparisonIdentity) => void;
  title: string;
};

export function IdentityList({ result, labels, filters, sample, total, trace, onPick, title }: ListProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useComparisonIdentities(result.runId, { ...filters, search: search.trim() || undefined }, page);

  if (!result.runId) {
    return (
      <Section title={title}>
        {sample && sample.length > 0 ? (
          <>
            <IdentityTable items={sample} labels={labels} onPick={onPick} caption={title} />
            <p className="small-note">
              Amostra da prévia: {formatCount(sample.length)} de {formatCount(total)}, em ordem de identidade.
            </p>
          </>
        ) : (
          <p className="small-note">A prévia não traz exemplos desta parte.</p>
        )}
        <TraceGate trace={trace} what="todas as identidades, página por página, e as linhas de origem de cada uma" />
      </Section>
    );
  }

  return (
    <Section title={title}>
      <label className="search">
        <span className="sr-only">Procurar uma identidade</span>
        <input
          type="search"
          className="input"
          placeholder="Procurar uma identidade"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {query.isError && <ErrorBlock error={query.error} onRetry={() => query.refetch()} />}
      {!query.data && query.isPending && <LoadingBlock label="Carregando as identidades" />}
      {query.data && (
        <>
          {query.data.data.length > 0 ? (
            <IdentityTable items={query.data.data} labels={labels} onPick={onPick} caption={title} />
          ) : (
            <p className="small-note">Nenhuma identidade{search.trim() ? " com esse texto" : ""}.</p>
          )}
          <Pager page={query.data.meta.page} last={query.data.meta.last_page} total={query.data.meta.total} onPage={setPage} label="identidades" />
        </>
      )}
    </Section>
  );
}

function Proof({ explanation }: { explanation: ComparisonExplanation }) {
  const possible = proofOf(explanation) === "possible";
  return (
    <span className={`proof ${possible ? "possible" : "proven"}`}>
      <i aria-hidden />
      {proofLabel(explanation)}
    </span>
  );
}

function ruleNumber(explanation: ComparisonExplanation, rules: string[]) {
  return ORDER.indexOf(explanation) + 2 + (rules.length > 0 ? 1 : 0);
}

type PanelProps = { result: ResultModel; labels: Labels; trace: TraceControl; onOpen: (target: Target) => void; onPick: (identity: ComparisonIdentity) => void };

export function CauseBody({ side, explanation, result, labels, trace, onPick }: PanelProps & { side: Side; explanation: ComparisonExplanation }) {
  const counts = side === "a" ? result.summary.explanations.only_a : result.summary.explanations.only_b;
  const count = counts[explanation] ?? 0;
  const text = explanationText(explanation, side, labels);
  const sample = result.explained?.[side === "a" ? "only_a" : "only_b"]?.[explanation] ?? null;
  const total = ORDER.length + 1 + (result.spec.rules.length > 0 ? 1 : 0);
  return (
    <>
      <div className="statusline">
        <Proof explanation={explanation} />
        <span className="mono small">
          {plural(count, "identidade", "identidades")} só em {labels[side]}
        </span>
      </div>
      <Section title="Por que está aqui">
        <div className="rule-box">
          <b>
            Regra {ruleNumber(explanation, result.spec.rules)} de {total}
          </b>
          <span>{text.rule}</span>
          <span className="mono crit">
            {labels.a}: {describeSelection(result.sides.a)}
          </span>
          <span className="mono crit">
            {labels.b}: {describeSelection(result.sides.b)}
          </span>
        </div>
        {explanation === "ambiguous_match" && (
          <p className="small-note">Aceitar uma regra não pareia estas identidades: com mais de um candidato, qualquer escolha seria arbitrária.</p>
        )}
        {explanation === "variant_of_matched" && (
          <p className="small-note">
            Mesmo com a regra aceita, estas continuam sem par: o valor parecido já tem par exato, e um segundo par poderia contar a mesma identidade duas vezes.
          </p>
        )}
      </Section>
      <Section title="Contagem">
        <dl className="kv">
          <dt>identidades</dt>
          <dd>{formatCount(count)}</dd>
          <dt>unidade</dt>
          <dd>identidades distintas, não linhas</dd>
        </dl>
      </Section>
      <KeyUsed result={result} />
      <IdentityList
        key={`${side}-${explanation}`}
        result={result}
        labels={labels}
        filters={{ category: side === "a" ? "only_a" : "only_b", explanation }}
        sample={sample}
        total={count}
        trace={trace}
        onPick={onPick}
        title="Identidades"
      />
    </>
  );
}

export function OnlyBody({ side, result, labels, onOpen }: PanelProps & { side: Side }) {
  const list = causes(result.summary, labels).filter((cause) => cause.side === side);
  const total = side === "a" ? result.summary.only_a : result.summary.only_b;
  return (
    <>
      <div className="links-list">
        {list.map((cause) => (
          <button key={cause.explanation} type="button" className="link-card" onClick={() => onOpen(causeTarget(cause))}>
            <span className="lt">
              {formatCount(cause.count)} · {cause.title}
            </span>
            <span className={`proof ${cause.proof}`}>
              <i aria-hidden />
              {proofLabel(cause.explanation, true)}
            </span>
            <span className="ld">{cause.sub}</span>
          </button>
        ))}
      </div>
      <p className="small-note">
        {list.length > 1 ? `Soma: ${list.map((cause) => formatCount(cause.count)).join(" + ")} = ${formatCount(total)} identidades. ` : ""}
        Nenhuma identidade aparece em duas causas.
      </p>
    </>
  );
}

export function SharedBody({ result, labels, trace, onPick, category }: PanelProps & { category: ComparisonCategory }) {
  const { summary } = result;
  const count = category === "shared" ? summary.shared : summary.shared_by_rule;
  return (
    <>
      <Section title="Contagem">
        <dl className="kv">
          <dt>pela chave exata</dt>
          <dd>{formatCount(summary.shared)}</dd>
          {summary.shared_by_rule > 0 && (
            <>
              <dt>pela regra aceita</dt>
              <dd>{formatCount(summary.shared_by_rule)}</dd>
            </>
          )}
          <dt>unidade</dt>
          <dd>identidades distintas, não linhas</dd>
        </dl>
      </Section>
      {summary.fields.length > 0 && (
        <Section title="Campos comparados">
          {summary.fields.map((field) => (
            <p key={`${field.a}-${field.b}`} className="small-note">
              {field.a} × {field.b}: {formatCount(field.same)} iguais, {formatCount(field.different)} diferentes, {formatCount(field.partial)} em parte.
            </p>
          ))}
        </Section>
      )}
      <KeyUsed result={result} extra={category === "shared_by_rule" ? "Cada par feito pela regra fica marcado; o texto de cada lado é preservado." : undefined} />
      <IdentityList
        key={category}
        result={result}
        labels={labels}
        filters={{ category }}
        sample={result.samples?.[category] ?? null}
        total={count}
        trace={trace}
        onPick={onPick}
        title={category === "shared" ? "Identidades nos dois" : "Pares pela regra"}
      />
    </>
  );
}

export function SideBody({ side, result, labels, onOpen }: PanelProps & { side: Side }) {
  const { summary } = result;
  const only = side === "a" ? summary.only_a : summary.only_b;
  const counts = summary[side];
  return (
    <>
      <dl className="kv">
        <dt>linhas selecionadas</dt>
        <dd>{formatCount(counts.rows)}</dd>
        <dt>sem identificador</dt>
        <dd>{formatCount(counts.empty_rows)}</dd>
        <dt>repetidas</dt>
        <dd>
          {formatCount(counts.repeated_rows)} linhas em {formatCount(counts.repeated_identities)} identidades
        </dd>
        <dt>identidades</dt>
        <dd>{formatCount(counts.distinct)}</dd>
      </dl>
      <div className="links-list">
        <button type="button" className="link-card" onClick={() => onOpen({ kind: "shared" })}>
          <span className="lt">{formatCount(summary.shared + summary.shared_by_rule)} · nos dois</span>
          <span className="ld">
            {summary.shared_by_rule > 0 ? `${formatCount(summary.shared)} pela chave exata e ${formatCount(summary.shared_by_rule)} pela regra` : "pela chave exata"}
          </span>
        </button>
        <button type="button" className="link-card" onClick={() => onOpen({ kind: "only", side })}>
          <span className="lt">
            {formatCount(only)} · só em {labels[side]}
          </span>
          <span className="ld">sem par do outro lado; cada uma com a sua explicação</span>
        </button>
        {counts.repeated_identities > 0 && (
          <button type="button" className="link-card" onClick={() => onOpen({ kind: "repeated", side })}>
            <span className="lt">{formatCount(counts.repeated_identities)} · aparecem em mais de uma linha</span>
            <span className="ld">contam uma vez cada</span>
          </button>
        )}
        {counts.empty_rows > 0 && (
          <button type="button" className="link-card" onClick={() => onOpen({ kind: "empty", side })}>
            <span className="lt">{formatCount(counts.empty_rows)} · linhas sem identificador</span>
            <span className="ld">ficam fora da comparação de identidades</span>
          </button>
        )}
      </div>
      <p className="small-note">
        {formatCount(summary.shared + summary.shared_by_rule)} + {formatCount(only)} = {formatCount(counts.distinct)} identidades.
      </p>
    </>
  );
}

export function RepeatedBody({ side, result, labels, trace, onPick }: PanelProps & { side: Side }) {
  const counts = result.summary[side];
  return (
    <>
      <div className="rule-box">
        <b>Linhas → identidades</b>
        <span>
          A mesma identidade aparece em mais de uma linha de {labels[side]}. A comparação conta identidades: {formatCount(counts.rows_with_key)} linhas com identificador −{" "}
          {formatCount(counts.repeated_rows)} repetidas = {formatCount(counts.distinct)} identidades. Não são causa de diferença.
        </span>
      </div>
      <IdentityList
        key={`rep-${side}`}
        result={result}
        labels={labels}
        filters={{ repeated: side }}
        sample={null}
        total={counts.repeated_identities}
        trace={trace}
        onPick={onPick}
        title="Identidades repetidas"
      />
    </>
  );
}

export function EmptyBody({ side, result, labels, trace }: PanelProps & { side: Side }) {
  const [page, setPage] = useState(1);
  const rows = useComparisonRows(result.runId, side, { empty: true }, "selected", page);
  const counts = result.summary[side];
  return (
    <>
      <div className="rule-box">
        <b>Sem identificador</b>
        <span>
          {formatCount(counts.empty_rows)} linhas de {labels[side]} não têm valor em {result.sides[side].key} (ou têm só espaços). Elas ficam fora da comparação de identidades e
          não entram em nenhuma categoria.
        </span>
      </div>
      {!result.runId ? (
        <TraceGate trace={trace} what="as linhas sem identificador" />
      ) : rows.data ? (
        <>
          <RowsTable rows={rows.data.data} caption="Linhas sem identificador" />
          <Pager page={rows.data.meta.page} last={rows.data.meta.last_page} total={rows.data.meta.total} onPage={setPage} label="linhas" />
        </>
      ) : rows.isError ? (
        <ErrorBlock error={rows.error} onRetry={() => rows.refetch()} />
      ) : (
        <LoadingBlock label="Carregando as linhas" />
      )}
    </>
  );
}

export function RowsTable({
  rows,
  caption,
}: {
  rows: {
    id: number;
    line_number: number;
    values: Record<string, string | null>;
    state?: "selected" | "excluded";
    exclusion?: { step_position: number; label: string; explanation: string } | null;
  }[];
  caption: string;
}) {
  const keys: string[] = [];
  for (const row of rows) for (const key of Object.keys(row.values)) if (!keys.includes(key)) keys.push(key);
  return (
    <div className="rt-wrap">
      <div className="rt-scroll">
        <table className="rt">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="r">
                linha
              </th>
              <th scope="col">situação</th>
              {keys.map((key) => (
                <th key={key} scope="col">
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="mono r">{formatCount(row.line_number)}</td>
                <td>
                  {row.state === "excluded" && row.exclusion ? (
                    <span className="tagx out" title={row.exclusion.explanation}>
                      saiu no passo {row.exclusion.step_position}: {row.exclusion.label}
                    </span>
                  ) : (
                    <span className="tagx in">selecionada</span>
                  )}
                </td>
                {keys.map((key) => (
                  <td key={key} className={row.values[key] === null ? "empty" : "mono"}>
                    {row.values[key] === null ? "vazio" : <span className="cell">{row.values[key]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
