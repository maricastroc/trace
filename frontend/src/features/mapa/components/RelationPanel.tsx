"use client";

import { useState, type ReactNode } from "react";
import { formatCount, formatWhen, plural } from "@/lib/format";
import { useDecideRelationship, useRelationship, useRowsWhere, useUnmatched, type RelationshipDecision } from "@/lib/queries";
import type { Relationship, RelationshipPolicy } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { StatePill } from "@/components/ui/StatePill";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { checksFor, CARDINALITY_SHORT, effectSentences, factsOf, nearKindLabel, summaryOf, type Check, type UnmatchedSide } from "../model/evidence";
import { competitorsOf, standingOf, type MapModel } from "../model/graph";
import { Overprint } from "./Overprint";
import { PairForm } from "./PairForm";
import { RecordTable } from "./RecordTable";
import type { OpenRecord } from "./TablePanels";

const GLYPH: Record<Check["state"], string> = { ok: "✓", warn: "!", fail: "✕", hyp: "?", info: "·" };
const STATE_LABEL: Record<Check["state"], string> = { ok: "ok", warn: "atenção", fail: "falha", hyp: "hipótese", info: "informação" };

function More({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <details className="ev-more">
      <summary>
        <span className="em-t">{title}</span>
        {meta && <span className="em-m">{meta}</span>}
      </summary>
      <div className="em-body">{children}</div>
    </details>
  );
}

function CheckRow({ check, pressed, onPress }: { check: Check; pressed: boolean; onPress?: () => void }) {
  const content = (
    <>
      <span className="cg" role="img" aria-label={STATE_LABEL[check.state]}>
        {GLYPH[check.state]}
      </span>
      <span className="ct">
        <b>{check.title}</b>
        <span>{check.text}</span>
      </span>
      {onPress ? (
        <span className="chev" aria-hidden>
          {check.relationId ? "↗" : "›"}
        </span>
      ) : (
        <span />
      )}
    </>
  );
  if (!onPress) return <div className={`ck ${check.state}`}>{content}</div>;
  return (
    <button type="button" className={`ck ${check.state} click`} aria-pressed={check.relationId ? undefined : pressed} onClick={onPress}>
      {content}
    </button>
  );
}

function UnmatchedRecords({ relation, side, onOpenRecord }: { relation: Relationship; side: UnmatchedSide; onOpenRecord: (table: string, rowId: number, values: Record<string, string | null>, line: number) => void }) {
  const [page, setPage] = useState(1);
  const query = useUnmatched(relation.id, side, page);
  const table = side === "to" ? relation.to.dataset_key : relation.from.dataset_key;
  const columns = query.data?.data[0] ? Object.keys(query.data.data[0].values) : [];
  return (
    <RecordTable
      label={`Registros de ${table}`}
      columns={columns}
      rows={query.data?.data}
      meta={query.data?.meta}
      loading={query.isFetching}
      error={query.error}
      onRetry={() => query.refetch()}
      onPage={setPage}
      onRow={(row) => onOpenRecord(table, row.id, row.values, row.line_number)}
    />
  );
}

function SampleRows({ relation, value, model, onOpenRecord }: { relation: Relationship; value: string; model: MapModel; onOpenRecord: OpenRecord }) {
  const target = model.byKey.get(relation.to.dataset_key);
  const source = model.byKey.get(relation.from.dataset_key);
  const [targetPage, setTargetPage] = useState(1);
  const [sourcePage, setSourcePage] = useState(1);
  const copies = useRowsWhere(target?.versionId ?? null, relation.to.column, value, 10, targetPage);
  const pointing = useRowsWhere(source?.versionId ?? null, relation.from.column, value, 10, sourcePage);
  return (
    <div className="grid gap-3">
      <p className="small-note">
        Cópias de {relation.to.column} = {value} em {relation.to.dataset_key}
      </p>
      <RecordTable
        label={`Cópias em ${relation.to.dataset_key}`}
        columns={target?.columns.map((c) => c.key) ?? []}
        rows={copies.data?.data}
        meta={copies.data?.meta}
        loading={copies.isFetching}
        error={copies.error}
        onRetry={() => copies.refetch()}
        onPage={setTargetPage}
        onRow={(row) => onOpenRecord(relation.to.dataset_key, row.id, row.values, row.line_number)}
      />
      <p className="small-note">
        Linhas de {relation.from.dataset_key} que apontam para {value}
      </p>
      <RecordTable
        label={`Linhas de ${relation.from.dataset_key} que apontam para ${value}`}
        columns={source?.columns.map((c) => c.key) ?? []}
        rows={pointing.data?.data}
        meta={pointing.data?.meta}
        loading={pointing.isFetching}
        error={pointing.error}
        onRetry={() => pointing.refetch()}
        onPage={setSourcePage}
        onRow={(row) => onOpenRecord(relation.from.dataset_key, row.id, row.values, row.line_number)}
      />
    </div>
  );
}

function JoinEffectDetails({ relation, model, onOpenRecord }: { relation: Relationship; model: MapModel; onOpenRecord: OpenRecord }) {
  const effect = relation.evidence.join_effect!;
  const sentences = effectSentences(relation)!;
  const [sample, setSample] = useState<string | null>(null);
  const from = relation.from.dataset_key;
  const facts: [string, string][] = [
    [`linhas de ${from}`, formatCount(effect.source_rows)],
    ["com par", formatCount(effect.matched_rows)],
    ["sem par", formatCount(effect.unmatched_rows)],
    [`com ${relation.from.column} vazio`, formatCount(effect.null_key_rows)],
    ["junção interna", `${formatCount(effect.inner_rows)} linhas`],
    ["junção à esquerda", `${formatCount(effect.left_rows)} linhas`],
    ["linhas a mais", formatCount(effect.extra_rows)],
    ["ids repetidos citados", `${formatCount(effect.repeated_keys)} de ${formatCount(relation.evidence.to.duplicate_values)} repetidos no destino`],
  ];
  return (
    <>
      <p className="small-note">
        {sentences.inner} {sentences.left}
      </p>
      <dl className="kv">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {effect.samples.length > 0 && (
        <>
          <p className="small-note">Ids que mais multiplicam linhas. Escolha um para ver os registros envolvidos.</p>
          <div className="rt-wrap">
            <div className="rt-scroll">
              <table className="rt" aria-label="Ids repetidos que multiplicam linhas">
                <thead>
                  <tr>
                    <th scope="col">{relation.to.column}</th>
                    <th scope="col">cópias</th>
                    <th scope="col">na origem</th>
                    <th scope="col">a mais</th>
                  </tr>
                </thead>
                <tbody>
                  {effect.samples.map((row) => (
                    <tr
                      key={row.value}
                      className="clickable"
                      tabIndex={0}
                      aria-selected={sample === row.value}
                      onClick={() => setSample(row.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSample(row.value);
                        }
                      }}
                    >
                      <td>{row.value}</td>
                      <td>{formatCount(row.target_rows)}</td>
                      <td>{formatCount(row.source_rows)}</td>
                      <td>+{formatCount(row.extra_rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small-note">
            “Cópias” são as linhas de {relation.to.dataset_key} com o mesmo id; “na origem”, as linhas de {from} que apontam para ele.
          </p>
          {sample && <SampleRows key={sample} relation={relation} value={sample} model={model} onOpenRecord={onOpenRecord} />}
        </>
      )}
    </>
  );
}

type Props = {
  id: string;
  listed: Relationship | null;
  model: MapModel;
  onSelectRelation: (id: string) => void;
  onFocusTable: (key: string) => void;
  onOpenTable: (key: string) => void;
  onOpenRecord: (table: string, rowId: number, values: Record<string, string | null>, line: number) => void;
};

export function RelationPanel({ id, listed, model, onSelectRelation, onFocusTable, onOpenTable, onOpenRecord }: Props) {
  const current = useRelationship(id);
  const relation = current.data?.data ?? listed;
  if (!relation) {
    if (current.isError) return <ErrorBlock error={current.error} onRetry={() => current.refetch()} />;
    return <LoadingBlock label="Carregando a relação" />;
  }
  return <RelationBody relation={relation} stale={listed ? !listed.evidence_is_current : false} model={model} onSelectRelation={onSelectRelation} onFocusTable={onFocusTable} onOpenTable={onOpenTable} onOpenRecord={onOpenRecord} />;
}

type BodyProps = Omit<Props, "id" | "listed"> & { relation: Relationship; stale: boolean };

function RelationBody({ relation, stale, model, onSelectRelation, onFocusTable, onOpenTable, onOpenRecord }: BodyProps) {
  const e = relation.evidence;
  const summary = summaryOf(relation);
  const checks = checksFor(relation, model.relations);
  const competitors = competitorsOf(relation, model.relations).filter((c) => c.status === "suggested");
  const [side, setSide] = useState<UnmatchedSide | null>(null);
  const [fixing, setFixing] = useState(false);
  const decide = useDecideRelationship();
  const toast = useToast();
  const standing = standingOf(relation);
  const effect = e.join_effect;
  const sentences = effectSentences(relation);
  const [accepting, setAccepting] = useState(false);

  const run = (action: RelationshipDecision, policy?: RelationshipPolicy) =>
    decide.mutate(
      { id: relation.id, action, policy },
      {
        onSuccess: () => {
          setAccepting(false);
          if (action === "reopen") toast("Decisão desfeita. A relação voltou a ser sugestão.");
          else
            toast(action === "reject" ? "Relação rejeitada" : policy ? "Relação confirmada com ressalva: multiplicidade aceita" : "Relação confirmada", {
              label: "Desfazer",
              onClick: () => decide.mutate({ id: relation.id, action: "reopen" }),
            });
        },
      },
    );

  const listChecks = checks.filter((c) => c.state !== "hyp");
  const hypotheses = checks.filter((c) => c.state === "hyp");
  const fails = listChecks.filter((c) => c.state === "fail").length;
  const warns = listChecks.filter((c) => c.state === "warn").length;
  const decidedAt = relation.status === "confirmed" ? relation.confirmed_at : relation.rejected_at;
  const short = CARDINALITY_SHORT[e.cardinality] ?? e.cardinality;
  const target = `${relation.to.dataset_key}.${relation.to.column}`;
  const versions = `${relation.from.dataset_key} v${e.from.version_number} e ${relation.to.dataset_key} v${e.to.version_number}`;

  const acceptButton = (
    <button type="button" className="btn btn-ab" aria-expanded={accepting} onClick={() => setAccepting((v) => !v)}>
      Aceitar a multiplicidade…
    </button>
  );
  const fixButton = (quiet: boolean) => (
    <button type="button" className={`btn ${quiet ? "btn-quiet" : ""}`} aria-expanded={fixing} onClick={() => setFixing((v) => !v)}>
      Corrigir colunas
    </button>
  );
  const rejectButton = (
    <button type="button" className="btn btn-quiet" disabled={decide.isPending} onClick={() => run("reject")}>
      Rejeitar
    </button>
  );
  const undoButton = (
    <button type="button" className="btn" disabled={decide.isPending} onClick={() => run("reopen")}>
      Desfazer decisão
    </button>
  );

  return (
    <>
      <div className="rel-top">
        <div className="statusline">
          <StatePill status={standing} />
          <span className="font-mono text-[13.5px] text-ink-3">{relation.origin === "manual" ? "criada por você" : "encontrada pelo Trace"}</span>
        </div>
        <p className={`rel-summary ${summary.warn ? "warn" : ""}`}>{summary.text}</p>
        <ul className="rel-facts" aria-label="Resumo da evidência">
          {factsOf(relation).map((fact) => (
            <li key={fact.key} className={fact.bad ? "bad" : undefined}>
              <b>{fact.value}</b> {fact.label}
            </li>
          ))}
        </ul>
        {sentences && <p className="rel-effect">{sentences.inner}</p>}
        {competitors.length > 0 && relation.status === "suggested" && (
          <p className="rel-comp">
            Esta coluna também se liga a {competitors.map((c) => `${c.to.dataset_key}.${c.to.column}`).join(", ")}. Só uma deve valer.
            {competitors.map((c) => (
              <button key={c.id} type="button" className="btn-link" onClick={() => onSelectRelation(c.id)}>
                Ver {c.to.dataset_key}
              </button>
            ))}
          </p>
        )}
        {stale && <p className="small-note">Os dados mudaram desde a última avaliação. A evidência acima foi recalculada nas versões atuais.</p>}
      </div>

      <section className="decision" aria-label="Sua decisão">
        {standing === "suggested" && (
          <>
            {!e.to.unique && (
              <p className="dec-block">
                <b>N:1 não comprovada. </b>
                {target} tem {plural(e.to.duplicate_values, "id repetido", "ids repetidos")}. Para usar esta relação, aceite a multiplicidade explicitamente, corrija as colunas ou rejeite.
              </p>
            )}
            <div className="panel-actions">
              {e.to.unique ? (
                <button type="button" className="btn btn-ab" disabled={decide.isPending} onClick={() => run("confirm")}>
                  Confirmar como {short}
                </button>
              ) : (
                acceptButton
              )}
              {fixButton(false)}
              {rejectButton}
            </div>
            {competitors.length > 0 && <p className="small-note">Confirmar esta não rejeita a concorrente sozinha: decida as duas.</p>}
          </>
        )}
        {standing === "review" && (
          <>
            <p className="dec-block">
              <b>Precisa ser reavaliada. </b>
              {relation.standing.reason}
            </p>
            <div className="panel-actions">
              {e.to.unique ? (
                <button type="button" className="btn btn-ab" disabled={decide.isPending} onClick={() => run("confirm")}>
                  Confirmar como {short}
                </button>
              ) : (
                acceptButton
              )}
              {undoButton}
              {rejectButton}
            </div>
          </>
        )}
        {(standing === "confirmed" || standing === "caveat" || standing === "rejected") && (
          <div className="dec-record">
            <p className="eyebrow">
              sua decisão · {formatWhen(decidedAt)} · {relation.from.dataset_key} v{e.from.version_number}, {relation.to.dataset_key} v{e.to.version_number}
            </p>
            <p>
              {standing === "rejected"
                ? "Rejeitada. Não será usada em perguntas nem comparações."
                : standing === "caveat"
                  ? `Confirmada com ressalva: a multiplicidade foi aceita para ${versions}. ${effect ? `Junções por esta relação acrescentam ${plural(effect.extra_rows, "linha", "linhas")}, e` : "Nas junções,"} cada linha multiplicada fica registrada nos diagnósticos da execução.`
                  : `Confirmada como ${short}. A evidência sustenta a cardinalidade: cada linha de ${relation.from.dataset_key} aponta para no máximo uma de ${relation.to.dataset_key}.`}
            </p>
            <div className="panel-actions">
              {undoButton}
              {fixButton(true)}
            </div>
          </div>
        )}
        {accepting && effect && (
          <div className="caveat-form">
            <p className="eyebrow eyebrow-ab">Política: aceitar a multiplicidade</p>
            <p>Uma linha de {relation.from.dataset_key} que aponta para um id repetido vira uma linha por cópia na junção. Com os dados atuais:</p>
            <ul>
              <li>
                <b>+{formatCount(effect.extra_rows)}</b> linhas na junção, vindas de {plural(effect.multiplied_rows, `linha de ${relation.from.dataset_key}`, `linhas de ${relation.from.dataset_key}`)} que{" "}
                {effect.multiplied_rows === 1 ? "aponta" : "apontam"} para {plural(effect.repeated_keys, "id repetido", "ids repetidos")};
              </li>
              <li>somas e contagens que atravessarem a relação incluem essas linhas;</li>
              <li>cada linha multiplicada aparece nos diagnósticos da execução;</li>
              <li>nenhum id é corrigido ou escolhido automaticamente;</li>
              <li>a decisão vale para {versions}. Uma nova versão pede nova decisão.</li>
            </ul>
            <div className="panel-actions">
              <button type="button" className="btn btn-ab" disabled={decide.isPending} onClick={() => run("confirm", "accept_multiplicity")}>
                Confirmar aceitando a multiplicidade
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setAccepting(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {decide.error && (
          <p role="alert" className="small-note text-b-deep">
            {decide.error.message}
          </p>
        )}
        {fixing && model.byKey.get(relation.from.dataset_key) && (
          <PairForm
            model={model}
            fromTable={model.byKey.get(relation.from.dataset_key)!}
            fromColumn={relation.from.column}
            initialTo={{ table: relation.to.dataset_key, column: relation.to.column }}
            correcting={relation}
            onDone={(id) => {
              setFixing(false);
              onSelectRelation(id);
            }}
          />
        )}
      </section>

      <div>
        <More title="Evidência completa" meta={`${plural(listChecks.length, "verificação", "verificações")}${fails ? ` · ${plural(fails, "falha", "falhas")}` : ""}${warns ? ` · ${plural(warns, "atenção", "atenções")}` : ""}`}>
          <p className="small-note">Verificações com seta abrem os registros.</p>
          <div className="ck-list">
            {listChecks.map((check) => (
              <CheckRow key={check.key} check={check} pressed={side !== null && side === check.side} onPress={check.side ? () => setSide(check.side ?? null) : undefined} />
            ))}
          </div>
          {side && <UnmatchedRecords key={side} relation={relation} side={side} onOpenRecord={onOpenRecord} />}
        </More>
        {effect && (
          <More title="O que acontece numa junção" meta={effect.extra_rows > 0 ? `+${formatCount(effect.extra_rows)} linhas` : "nenhuma linha a mais"}>
            <JoinEffectDetails relation={relation} model={model} onOpenRecord={onOpenRecord} />
          </More>
        )}
        <More title="Valores de chave sobrepostos" meta={`${plural(e.match.matched_distinct, "valor", "valores")} nos dois`}>
          <Overprint relation={relation} />
        </More>
        {hypotheses.length > 0 && (
          <More title="Hipóteses, não aplicadas" meta={String(hypotheses.length)}>
            <p className="small-note">Nenhum identificador foi alterado. São pistas para você decidir.</p>
            <div className="ck-list">
              {hypotheses.map((check) => (
                <CheckRow key={check.key} check={check} pressed={false} onPress={check.relationId ? () => onSelectRelation(check.relationId!) : undefined} />
              ))}
            </div>
            {e.near_matches.length > 0 && (
              <ul className="links-list">
                {e.near_matches.map((near) => (
                  <li key={`${near.value}-${near.candidate}`} className="link-card">
                    <span className="lt">
                      {near.value} ≈ {near.candidate}
                    </span>
                    <span className="tagx pos">{nearKindLabel(near.kind)}</span>
                  </li>
                ))}
              </ul>
            )}
          </More>
        )}
        <More title="Daqui você pode">
          <div className="links-list">
            <button type="button" className="link-card" onClick={() => onFocusTable(relation.from.dataset_key)}>
              <span className="lt">Destacar a vizinhança de {relation.from.dataset_key}</span>
              <span aria-hidden>→</span>
              <span className="ld">esmaece o resto do mapa</span>
            </button>
            {[relation.from.dataset_key, relation.to.dataset_key].map((key) => (
              <button key={key} type="button" className="link-card" onClick={() => onOpenTable(key)}>
                <span className="lt">Abrir a tabela {key}</span>
                <span aria-hidden>→</span>
                <span className="ld">campos, relações e registros</span>
              </button>
            ))}
          </div>
        </More>
      </div>
    </>
  );
}
