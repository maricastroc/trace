"use client";

import { useState } from "react";
import { formatCount, formatPercent, plural } from "@/lib/format";
import { useDeleteDataset, useRowsWhere, useVersionRows } from "@/lib/queries";
import { useToast } from "@/components/ui/Toast";
import type { Relationship } from "@/lib/types";
import { StatePill } from "@/components/ui/StatePill";
import { CARDINALITY_SHORT, relationLabel } from "../model/evidence";
import { standingOf, type MapColumn, type MapModel, type MapTable } from "../model/graph";
import { TYPE_WORDS } from "./FieldIcon";
import { PairForm } from "./PairForm";
import { RecordTable } from "./RecordTable";
import { ValidityForm } from "@/features/shared/ValidityForm";

export type OpenRecord = (table: string, rowId: number, values: Record<string, string | null>, line: number) => void;

function columnNote(column: MapColumn) {
  if (column.issues.length) return { text: column.issues.map((i) => i.text).join(" · "), warn: column.issues.some((i) => i.kind === "dup") };
  const p = column.profile;
  if (column.role === "key") return { text: p.unique ? `${plural(p.distinct, "valor", "valores")}, nenhum repetido` : plural(p.distinct, "valor", "valores"), warn: false };
  if ((column.type === "date" || column.type === "number") && p.min && p.max) return { text: `de ${p.min} a ${p.max}${p.nulls ? ` · ${plural(p.nulls, "vazio", "vazios")}` : ""}`, warn: false };
  return { text: `${TYPE_WORDS[column.type] ?? column.type} · ${plural(p.distinct, "valor", "valores")}`, warn: false };
}

function FillBar({ column }: { column: MapColumn }) {
  const rows = column.profile.non_null + column.profile.nulls;
  const filled = rows ? column.profile.non_null / rows : 0;
  return (
    <span className="fill-bar" aria-hidden>
      <span className="on" style={{ width: `${filled * 100}%` }} />
      {filled < 1 && <span className="off" style={{ width: `${(1 - filled) * 100}%` }} />}
    </span>
  );
}

function RelationLinks({ relations, onSelectRelation }: { relations: Relationship[]; onSelectRelation: (id: string) => void }) {
  if (!relations.length) return <p className="small-note">Nenhuma relação.</p>;
  return (
    <div className="links-list">
      {relations.map((r) => (
        <button key={r.id} type="button" className="link-card" onClick={() => onSelectRelation(r.id)}>
          <span className="lt">{relationLabel(r)}</span>
          <StatePill status={standingOf(r)} />
          <span className="ld">
            cobertura {formatPercent(r.evidence.match.match_ratio)} · {CARDINALITY_SHORT[r.evidence.cardinality]}
            {r.evidence.to.unique ? " · destino único" : ` · ${plural(r.evidence.to.duplicate_values, "id repetido", "ids repetidos")}`}
          </span>
        </button>
      ))}
    </div>
  );
}

type TableProps = {
  table: MapTable;
  model: MapModel;
  onOpenField: (key: string, column: string) => void;
  onSelectRelation: (id: string) => void;
  onFocusTable: (key: string) => void;
  onOpenRecord: OpenRecord;
  onNewVersion: (key: string) => void;
  onRemoved: () => void;
};

function RemoveTable({ table, relations, onRemoved }: { table: MapTable; relations: number; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteDataset();
  const toast = useToast();
  if (!confirming) {
    return (
      <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
        Remover tabela
      </button>
    );
  }
  return (
    <div className="fix-box" role="group" aria-label={`Confirmar a remoção de ${table.key}`}>
      <p className="m-0 text-[15px] leading-relaxed">
        Remover <b className="font-mono">{table.key}</b> com todas as versões{relations > 0 ? ` e ${plural(relations, "relação", "relações")}` : ""}? Não dá para desfazer.
      </p>
      <p className="small-note">Tabelas usadas em execuções ou que são o ponto de partida de uma receita não podem ser removidas: a linhagem depende delas.</p>
      <div className="panel-actions">
        <button
          type="button"
          className="btn btn-danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(table.id, {
              onSuccess: () => {
                toast(`${table.key} removida.`);
                onRemoved();
              },
            })
          }
        >
          {remove.isPending ? "Removendo…" : "Remover de vez"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
          Cancelar
        </button>
      </div>
      {remove.error && (
        <p role="alert" className="small-note text-b-deep">
          {remove.error.message}
        </p>
      )}
    </div>
  );
}

export function TablePanel({ table, model, onOpenField, onSelectRelation, onFocusTable, onOpenRecord, onNewVersion, onRemoved }: TableProps) {
  const [page, setPage] = useState(1);
  const rows = useVersionRows(table.versionId, page);
  const relations = model.relations.filter((r) => r.from.dataset_key === table.key || r.to.dataset_key === table.key);
  return (
    <>
      <section className="panel-section">
        <h3>Campos</h3>
        <div className="field-grid">
          {table.columns.map((column) => {
            const note = columnNote(column);
            return (
              <button key={column.key} type="button" className="fcard" onClick={() => onOpenField(table.key, column.key)}>
                <b>{column.key}</b>
                <small className={note.warn ? "warn" : undefined}>{note.text}</small>
                <FillBar column={column} />
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel-section">
        <h3>Vigência</h3>
        <ValidityForm key={table.validity ? "declared" : "empty"} table={table} />
      </section>
      <section className="panel-section">
        <h3>Relações · {relations.length}</h3>
        <RelationLinks relations={relations} onSelectRelation={onSelectRelation} />
        {relations.length > 0 && (
          <button type="button" className="btn-link mt-3 text-[14px]" onClick={() => onFocusTable(table.key)}>
            Destacar a vizinhança no mapa
          </button>
        )}
      </section>
      <section className="panel-section">
        <h3>Arquivo</h3>
        <p className="small-note">
          {table.file} é a versão {table.versionNumber}. Uma nova versão não apaga esta: execuções antigas continuam apontando para a versão que usaram.
        </p>
        <div className="panel-actions mt-3">
          <button type="button" className="btn" onClick={() => onNewVersion(table.key)}>
            Enviar nova versão
          </button>
          <RemoveTable table={table} relations={relations.length} onRemoved={onRemoved} />
        </div>
      </section>
      <section className="panel-section">
        <h3>Registros</h3>
        <RecordTable
          label={`Registros de ${table.key}`}
          columns={table.columns.map((c) => c.key)}
          rows={rows.data?.data}
          meta={rows.data?.meta}
          loading={rows.isFetching}
          error={rows.error}
          onRetry={() => rows.refetch()}
          onPage={setPage}
          onRow={(row) => onOpenRecord(table.key, row.id, row.values, row.line_number)}
        />
      </section>
    </>
  );
}

type FieldProps = {
  table: MapTable;
  column: MapColumn;
  model: MapModel;
  onSelectRelation: (id: string) => void;
  onOpenRecord: OpenRecord;
};

export function FieldPanel({ table, column, model, onSelectRelation, onOpenRecord }: FieldProps) {
  const p = column.profile;
  const [linking, setLinking] = useState(false);
  const [page, setPage] = useState(1);
  const empty = useRowsWhere(p.nulls > 0 ? table.versionId : null, column.key, "", 10, page);
  const used = model.relations.filter((r) => (r.from.dataset_key === table.key && r.from.column === column.key) || (r.to.dataset_key === table.key && r.to.column === column.key));
  const facts: [string, string][] = [
    ["preenchidos", formatCount(p.non_null)],
    ["vazios", formatCount(p.nulls)],
    ["diferentes", formatCount(p.distinct)],
    ["valores únicos", p.unique ? "sim" : `não · ${plural(p.non_null - p.distinct, "repetição", "repetições")}`],
  ];
  if (p.min !== undefined && p.max !== undefined) facts.push(["menor e maior", `${p.min} · ${p.max}`]);
  if (p.fixed_length !== null) facts.push(["tamanho", `${p.fixed_length} caracteres em todos`]);
  if (p.leading_zero_values > 0) facts.push(["com zero à esquerda", formatCount(p.leading_zero_values)]);
  if (p.samples.length) facts.push(["exemplos", p.samples.slice(0, 6).join(" · ")]);

  return (
    <>
      <section className="panel-section">
        <h3>Tipo</h3>
        <p className="m-0 text-[15px]">
          <b>{TYPE_WORDS[column.type] ?? column.type}</b>
          {column.typeReason && <span className="text-ink-2"> · {column.typeReason}</span>}
        </p>
        <p className="small-note mt-1">Inferido na importação. O Trace compara valores pelo texto exato.</p>
      </section>
      <section className="panel-section">
        <h3>Perfil</h3>
        <dl className="kv">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {column.issues.length > 0 && (
        <section className="panel-section">
          <h3>Pontos de atenção</h3>
          <ul className="m-0 grid list-none gap-1 p-0 text-[15px]">
            {column.issues.map((issue) => (
              <li key={issue.text}>{issue.text}</li>
            ))}
          </ul>
        </section>
      )}
      {p.nulls > 0 && (
        <section className="panel-section">
          <h3>Linhas sem {column.key}</h3>
          <RecordTable
            label={`Linhas de ${table.key} sem ${column.key}`}
            columns={table.columns.map((c) => c.key)}
            rows={empty.data?.data}
            meta={empty.data?.meta}
            loading={empty.isFetching}
            error={empty.error}
            onRetry={() => empty.refetch()}
            onPage={setPage}
            onRow={(row) => onOpenRecord(table.key, row.id, row.values, row.line_number)}
          />
        </section>
      )}
      <section className="panel-section">
        <h3>Usado em</h3>
        <RelationLinks relations={used} onSelectRelation={onSelectRelation} />
        {column.type !== "date" && model.tables.length > 1 && (
          <div className="mt-3 grid gap-3">
            <button type="button" className="btn justify-self-start" aria-expanded={linking} onClick={() => setLinking((v) => !v)}>
              Ligar a outra tabela…
            </button>
            {linking && (
              <PairForm
                model={model}
                fromTable={table}
                fromColumn={column.key}
                initialTo={null}
                correcting={null}
                onDone={(id) => {
                  setLinking(false);
                  onSelectRelation(id);
                }}
              />
            )}
          </div>
        )}
      </section>
    </>
  );
}

type RecordProps = {
  table: MapTable;
  values: Record<string, string | null>;
  model: MapModel;
  onOpenRecord: OpenRecord;
};

function OutgoingLink({ relation, value, model, onOpenRecord }: { relation: Relationship; value: string | null; model: MapModel; onOpenRecord: OpenRecord }) {
  const target = model.byKey.get(relation.to.dataset_key);
  const found = useRowsWhere(value === null ? null : (target?.versionId ?? null), relation.to.column, value, 2);
  const head = `${relation.from.column} = ${value ?? "vazio"} → ${relation.to.dataset_key}`;
  const pending = relation.status === "suggested" ? " · relação ainda sugerida" : "";
  if (value === null)
    return (
      <div className="link-card">
        <span className="lt">{head}</span>
        <span className="tagx out">vazio</span>
      </div>
    );
  const total = found.data?.meta.total;
  const first = found.data?.data[0];
  if (total === undefined) return <p className="small-note">Procurando {relation.to.dataset_key}.{relation.to.column} = {value}…</p>;
  if (total > 0 && first)
    return (
      <button type="button" className="link-card" onClick={() => onOpenRecord(relation.to.dataset_key, first.id, first.values, first.line_number)}>
        <span className="lt">{head}</span>
        {total > 1 ? <span className="tagx rep">{total} linhas com este valor</span> : <span aria-hidden>→</span>}
        <span className="ld">
          {first.values.nome ?? `linha ${first.line_number}`}
          {pending}
        </span>
      </button>
    );
  const near = relation.evidence.near_matches.find((n) => n.value === value);
  return (
    <div className="link-card">
      <span className="lt">{head}</span>
      <span className={`tagx ${near ? "pos" : "out"}`}>{near ? "possível" : "sem par"}</span>
      {near && <span className="ld">Sem par exato; {near.candidate} existe. Não aplicado.</span>}
    </div>
  );
}

function IncomingCount({ relation, value, model }: { relation: Relationship; value: string | null; model: MapModel }) {
  const source = model.byKey.get(relation.from.dataset_key);
  const found = useRowsWhere(value === null ? null : (source?.versionId ?? null), relation.from.column, value, 1);
  const total = found.data?.meta.total;
  return (
    <div className="link-card">
      <span className="lt">{total === undefined ? "Contando…" : `${plural(total, `linha de ${relation.from.dataset_key} aponta`, `linhas de ${relation.from.dataset_key} apontam`)} para cá`}</span>
      <span />
      <span className="ld">
        {relation.from.dataset_key}.{relation.from.column} = {value ?? "vazio"}
        {relation.status === "suggested" ? " · relação ainda sugerida" : ""}
      </span>
    </div>
  );
}

export function RecordPanel({ table, values, model, onOpenRecord }: RecordProps) {
  const outgoing = model.relations.filter((r) => r.status !== "rejected" && r.from.dataset_key === table.key);
  const incoming = model.relations.filter((r) => r.status !== "rejected" && r.to.dataset_key === table.key && r.from.dataset_key !== table.key);
  return (
    <>
      <dl className="kv">
        {table.columns.map((column) => (
          <div key={column.key} className="contents">
            <dt>{column.key}</dt>
            <dd>{values[column.key] ?? "vazio"}</dd>
          </div>
        ))}
      </dl>
      <section className="panel-section">
        <h3>Ligações</h3>
        {outgoing.length + incoming.length === 0 && <p className="small-note">Esta tabela ainda não tem relações ativas.</p>}
        <div className="links-list">
          {outgoing.map((r) => (
            <OutgoingLink key={r.id} relation={r} value={values[r.from.column] ?? null} model={model} onOpenRecord={onOpenRecord} />
          ))}
          {incoming.map((r) => (
            <IncomingCount key={r.id} relation={r} value={values[r.to.column] ?? null} model={model} />
          ))}
        </div>
      </section>
    </>
  );
}
