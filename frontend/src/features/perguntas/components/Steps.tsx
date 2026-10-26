"use client";

import { RowOpen } from "@/components/ui/RowOpen";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { formatCount } from "@/lib/format";
import { useContributors, useExclusions, useIdentities, useJourney } from "@/lib/queries";
import type { Exclusion, PageMeta, QuestionSpec, RunDetail, SourceRow } from "@/lib/types";
import { ANSWER, type Group } from "../model/answer";
import type { CatalogTable } from "../model/catalog";
import { lossesBefore, type StepView } from "../model/steps";

export type RecordFilter = { kind: "in" } | { kind: "out"; step: number | null; code: string | null } | { kind: "rep" };

export type RowContext = { kind: "in"; status: string | null } | { kind: "out"; exclusion: Exclusion };

export type SelectedRow = { rowId: number; context: RowContext };

const KIND_WORD: Record<StepView["kind"], string> = { source: "Arquivo", filter: "Filtro", join: "Ligação", aggregate: "Cálculo" };

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function StepGlyph({ kind }: { kind: StepView["kind"] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      {kind === "source" && <path d="M4 2h6l3 3v9H4zM10 2v3h3" />}
      {kind === "filter" && <path d="M2.5 3h11L9.2 8.4V13l-2.4-1.2V8.4z" />}
      {kind === "join" && (
        <>
          <circle cx="6" cy="8" r="4" />
          <circle cx="10" cy="8" r="4" />
        </>
      )}
      {kind === "aggregate" && <path d="M12 3H4l4.5 5L4 13h8" />}
    </svg>
  );
}

type LadderProps = { views: StepView[]; filter: RecordFilter; onFilter: (filter: RecordFilter) => void };

export function Ladder({ views, filter, onFilter }: LadderProps) {
  const scale = Math.max(1, views[0]?.kind === "source" ? views[0].rows : 1);
  const bar = (n: number) => <span className="ts-bar" aria-hidden style={{ width: `${Math.max(1.5, Math.min(100, (n / scale) * 100))}%` }} />;

  return (
    <ol className="trail-steps" aria-label="Percurso das linhas, do arquivo ao resultado">
      {views.map((view) => {
        const stepSelected = filter.kind === "out" && view.kind !== "source" && view.kind !== "aggregate" && filter.step === view.position;
        const resultSelected = (filter.kind === "in" || filter.kind === "rep") && view.kind === "aggregate";
        const head = (title: string, count: number, unit: string) => (
          <>
            <span className="ts-title">{title}</span>
            <span className="ts-count">
              <b>{formatCount(count)}</b>
              <small>{unit}</small>
            </span>
          </>
        );

        let main: ReactNode;
        let details: ReactNode = null;
        if (view.kind === "source") {
          main = <div className="ts-main">{head(`${view.name} · versão ${view.version}`, view.rows, view.rows === 1 ? "linha de entrada" : "linhas de entrada")}</div>;
          details = bar(view.rows);
        } else if (view.kind === "aggregate") {
          main = (
            <button type="button" className="ts-main" aria-pressed={resultSelected} onClick={() => onFilter({ kind: "in" })}>
              {head(view.title, view.results, view.grouped ? (view.results === 1 ? "grupo" : "grupos") : view.results === 1 ? "resultado" : "resultados")}
            </button>
          );
          details = (
            <ul className="ts-facts">
              {view.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          );
        } else {
          const lost = view.losses.reduce((sum, loss) => sum + loss.count, 0);
          const unit = view.output === 1 ? "linha segue" : "linhas seguem";
          main =
            lost > 0 ? (
              <button type="button" className="ts-main" aria-pressed={stepSelected && filter.kind === "out" && filter.code === null} onClick={() => onFilter({ kind: "out", step: view.position, code: null })}>
                {head(view.title, view.output, unit)}
              </button>
            ) : (
              <div className="ts-main">{head(view.title, view.output, unit)}</div>
            );
          details = (
            <>
              {bar(view.output)}
              {view.kind === "join" && (
                <ul className="ts-facts">
                  <li>
                    {plural(view.matched, "linha encontrou", "linhas encontraram")} par em {view.lookup}
                  </li>
                  {view.withoutPartner > 0 && (
                    <li>
                      {plural(view.withoutPartner, "linha sem par continua", "linhas sem par continuam")}, sem dados de {view.lookup}
                    </li>
                  )}
                  {view.copies > 0 && (
                    <li className="copies">
                      + {plural(view.copies, "linha copiada", "linhas copiadas")}: o valor procurado aparece mais de uma vez em {view.lookup}
                    </li>
                  )}
                </ul>
              )}
              {view.losses.length > 0 && (
                <ul className="ts-losses" aria-label={`Saíram no passo ${view.position}`}>
                  {view.losses.map((loss) => {
                    const pressed = filter.kind === "out" && filter.step === view.position && filter.code === loss.code;
                    return (
                      <li key={loss.code}>
                        <button
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => onFilter(pressed ? { kind: "out", step: view.position, code: null } : { kind: "out", step: view.position, code: loss.code })}
                        >
                          − {formatCount(loss.count)} {loss.text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        }

        return (
          <li key={view.key} className={`ts ts-${view.kind} ${stepSelected || resultSelected ? "on" : ""}`}>
            <span className="ts-mark" title={KIND_WORD[view.kind]}>
              <StepGlyph kind={view.kind} />
            </span>
            <div className="ts-body">
              <p className="ts-kind">
                {KIND_WORD[view.kind]}
                {view.kind !== "source" ? ` · passo ${view.position}` : ""}
              </p>
              {main}
              {details}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function relevantColumns(question: QuestionSpec, base: CatalogTable) {
  const keys = ["id", question.measure.column ?? null];
  if (question.period?.kind === "date") keys.push(question.period.column);
  if (question.period?.kind === "validity" && base.validity) keys.push(base.validity.start_column, base.validity.end_column);
  const picked = [...new Set(keys.filter((key): key is string => !!key && base.columns.some((column) => column.key === key)))];
  for (const column of base.columns) {
    if (picked.length >= 5) break;
    if (!picked.includes(column.key)) picked.push(column.key);
  }
  return picked;
}

function Pager({ meta, loading, onPage }: { meta: PageMeta; loading: boolean; onPage: (page: number) => void }) {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.per_page + 1;
  const last = Math.min(meta.total, meta.page * meta.per_page);
  return (
    <div className="rt-foot">
      <span className="font-mono">
        {formatCount(first)}–{formatCount(last)} de {formatCount(meta.total)}
      </span>
      {meta.last_page > 1 && (
        <span className="flex gap-2">
          <button type="button" className="btn" disabled={meta.page <= 1 || loading} onClick={() => onPage(meta.page - 1)}>
            Anteriores
          </button>
          <button type="button" className="btn" disabled={meta.page >= meta.last_page || loading} onClick={() => onPage(meta.page + 1)}>
            Próximos
          </button>
        </span>
      )}
    </div>
  );
}

function ValueCells({ row, columns }: { row: SourceRow | null; columns: string[] }) {
  return (
    <>
      {columns.map((column) => {
        const value = row?.values[column] ?? null;
        return (
          <td key={column} className={value === null ? "empty" : undefined}>
            {value === null ? (
              "vazio"
            ) : (
              <span className="cell" title={value.length > 24 ? value : undefined}>
                {value}
              </span>
            )}
          </td>
        );
      })}
    </>
  );
}

function rowProps(open: () => void) {
  return { className: "clickable", onClick: open };
}

function OpenCell({ id, line, selected, open }: { id: number; line: number | null; selected: boolean; open: () => void }) {
  return (
    <td>
      <RowOpen id={`rec-row-${id}`} label={`Abrir a linha ${line ?? ""} do arquivo`} pressed={selected} onOpen={open}>
        {line ?? "—"}
      </RowOpen>
    </td>
  );
}

const STATUS: Record<string, [string, string]> = {
  counted: ["in", "conta"],
  repeated: ["rep", "repetida"],
  ignored_null: ["out", "vazia · não conta"],
  ignored_unconvertible: ["out", "não é número"],
};

function lossText(views: StepView[], step: number, code: string) {
  for (const view of views) {
    if ((view.kind === "filter" || view.kind === "join") && view.position === step) return view.losses.find((loss) => loss.code === code)?.text ?? null;
  }
  return null;
}

type RecordsProps = {
  run: RunDetail;
  base: CatalogTable;
  question: QuestionSpec;
  views: StepView[];
  groups: Group[];
  resultNo: number;
  entering: number | null;
  onResult: (resultNo: number) => void;
  filter: RecordFilter;
  onFilter: (filter: RecordFilter) => void;
  selected: SelectedRow | null;
  onSelect: (selected: SelectedRow | null) => void;
};

export function Records({ run, base, question, views, groups, resultNo, entering, onResult, filter, onFilter, selected, onSelect }: RecordsProps) {
  const [page, setPage] = useState(1);
  const columns = relevantColumns(question, base);
  const distinct = question.measure.function === "count_distinct";
  const outStep = filter.kind === "out" ? filter.step : null;
  const outCode = filter.kind === "out" ? filter.code : null;
  const contributors = useContributors(filter.kind === "in" ? run.id : null, resultNo, 0, null, page);
  const exclusions = useExclusions(filter.kind === "out" ? run.id : null, { step: outStep ?? undefined, code: outCode ?? undefined }, page);
  const identities = useIdentities(filter.kind === "rep" ? run.id : null, resultNo, distinct ? ANSWER : null, page);
  const steps = views.filter((view): view is Extract<StepView, { kind: "filter" | "join" }> => view.kind === "filter" || view.kind === "join");
  const excluded = steps.reduce((sum, view) => sum + view.losses.reduce((n, loss) => n + loss.count, 0), 0);
  const group = groups.find((candidate) => candidate.resultNo === resultNo) ?? null;
  const pick = (next: RecordFilter) => {
    setPage(1);
    onSelect(null);
    onFilter(next);
  };

  const stepView = outStep !== null ? (steps.find((view) => view.position === outStep) ?? null) : null;
  const stepLost = stepView ? stepView.losses.reduce((n, loss) => n + loss.count, 0) : 0;
  const codeLost = stepView && outCode ? (stepView.losses.find((loss) => loss.code === outCode)?.count ?? 0) : stepLost;
  const before = outStep !== null ? lossesBefore(views, outStep) : 0;
  const sourceRows = contributors.data?.meta.total ?? null;
  const copied = filter.kind === "in" && sourceRows !== null && entering !== null && sourceRows !== entering;
  const context =
    filter.kind === "in"
      ? `${group ? `Grupo ${group.key === null ? "sem valor no recorte" : group.label}: ` : ""}${
          copied
            ? `${plural(entering ?? 0, "linha chega", "linhas chegam")} ao resultado, vindas de ${plural(sourceRows ?? 0, "linha", "linhas")} de ${base.key}: algumas foram copiadas por uma ligação.`
            : `${plural(entering ?? 0, "linha de", "linhas de")} ${base.key} ${entering === 1 ? "chega" : "chegam"} ao resultado.`
        }`
      : filter.kind === "rep"
        ? `Valores de ${question.measure.column} que aparecem em mais de uma linha do resultado.`
        : stepView
          ? `${plural(codeLost, "linha saiu", "linhas saíram")} no passo ${stepView.position} (${KIND_WORD[stepView.kind].toLowerCase()})${outCode ? ` por: ${lossText(views, stepView.position, outCode)}` : ""}.${before > 0 ? ` Outros ${formatCount(before)} já tinham saído em passos anteriores.` : ""}`
          : `${plural(excluded, "linha saiu", "linhas saíram")} ao longo dos passos. Escolha um passo ou um motivo para ver só aqueles.`;

  return (
    <div className="grid gap-3">
      {groups.length > 1 && filter.kind !== "out" && (
        <label className="flex flex-wrap items-center gap-2 text-[14.5px]">
          <span>Linhas do grupo</span>
          <select
            className="select"
            value={resultNo}
            onChange={(event) => {
              setPage(1);
              onSelect(null);
              onResult(Number(event.target.value));
            }}
          >
            {groups.map((candidate) => (
              <option key={candidate.resultNo} value={candidate.resultNo}>
                {candidate.key === null ? "sem valor no recorte" : candidate.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="rec-tools" role="group" aria-label="Filtrar linhas">
        <button type="button" className="chip" aria-pressed={filter.kind === "in"} onClick={() => pick({ kind: "in" })}>
          entram <b>{formatCount(entering)}</b>
        </button>
        <button type="button" className="chip" aria-pressed={filter.kind === "out"} onClick={() => pick({ kind: "out", step: null, code: null })}>
          ficam de fora <b>{formatCount(excluded)}</b>
        </button>
        {distinct && (
          <button type="button" className="chip" aria-pressed={filter.kind === "rep"} onClick={() => pick({ kind: "rep" })}>
            valores repetidos
          </button>
        )}
      </div>
      <p className="rec-context" aria-live="polite">
        {context}
      </p>

      {filter.kind === "out" && excluded > 0 && (
        <div className="reason-list" role="group" aria-label="Motivos de saída">
          {(stepView ? [stepView] : steps.filter((view) => view.losses.length > 0)).flatMap((view) =>
            view.losses.map((loss) => {
              const pressed = outStep === view.position && outCode === loss.code;
              return (
                <button
                  key={`${view.position}-${loss.code}`}
                  type="button"
                  className="chip"
                  aria-pressed={pressed}
                  onClick={() => pick(pressed ? { kind: "out", step: view.position, code: null } : { kind: "out", step: view.position, code: loss.code })}
                >
                  {stepView ? "" : `passo ${view.position} · `}
                  {loss.text} <b>{formatCount(loss.count)}</b>
                </button>
              );
            }),
          )}
        </div>
      )}

      {selected && <RecordDetail key={selected.rowId} run={run} views={views} selected={selected} onClose={() => onSelect(null)} />}

      {filter.kind === "in" &&
        (contributors.isError ? (
          <ErrorBlock error={contributors.error} onRetry={() => contributors.refetch()} />
        ) : !contributors.data ? (
          <LoadingBlock label="Carregando linhas" />
        ) : (
          <div className="grid gap-2">
            {distinct && (
              <p className="small-note">
                <span className="tagx in">conta</span> primeira linha de cada {question.measure.column} · <span className="tagx rep">repetida</span> o {question.measure.column} já foi
                contado, a linha contribui com zero.
              </p>
            )}
            <div className="rt-wrap" aria-busy={contributors.isFetching}>
              <div className="rt-scroll">
                <table className="rt" aria-label="Linhas que entram na resposta">
                  <thead>
                    <tr>
                      <th scope="col">linha</th>
                      {columns.map((column) => (
                        <th key={column} scope="col">
                          {column}
                        </th>
                      ))}
                      <th scope="col">nesta resposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributors.data.data.map((row) => {
                      const status = row.measure_values.find((measure) => measure.measure === ANSWER)?.status ?? null;
                      const [tone, text] = status ? STATUS[status] : ["in", "conta"];
                      const open = () => onSelect({ rowId: row.id, context: { kind: "in", status } });
                      return (
                        <tr key={row.id} {...rowProps(open)}>
                          <OpenCell id={row.id} line={row.line_number} selected={selected?.rowId === row.id} open={open} />
                          <ValueCells row={row} columns={columns} />
                          <td>
                            <span className={`tagx ${tone}`}>{text}</span>
                            {row.tuples > 1 && <span className="small-note"> · {row.tuples} cópias</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager meta={contributors.data.meta} loading={contributors.isFetching} onPage={setPage} />
            </div>
          </div>
        ))}

      {filter.kind === "out" &&
        (exclusions.isError ? (
          <ErrorBlock error={exclusions.error} onRetry={() => exclusions.refetch()} />
        ) : !exclusions.data ? (
          <LoadingBlock label="Carregando linhas que saíram" />
        ) : (
          <div className="rt-wrap" aria-busy={exclusions.isFetching}>
            <div className="rt-scroll">
              <table className="rt" aria-label="Linhas que ficaram de fora">
                <thead>
                  <tr>
                    <th scope="col">linha</th>
                    {outStep === null && <th scope="col">saiu no passo</th>}
                    {columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                    <th scope="col">motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {exclusions.data.data.map((exclusion) => {
                    const row = exclusion.sources.find((source) => source.input === 0)?.row ?? null;
                    const reason = lossText(views, exclusion.step_position, exclusion.code) ?? exclusion.label;
                    const open = row ? () => onSelect({ rowId: row.id, context: { kind: "out", exclusion } }) : null;
                    return (
                      <tr key={exclusion.tuple_no} {...(open ? rowProps(open) : {})}>
                        {row && open ? <OpenCell id={row.id} line={row.line_number} selected={selected?.rowId === row.id} open={open} /> : <td>—</td>}
                        {outStep === null && <td>{exclusion.step_position}</td>}
                        <ValueCells row={row} columns={columns} />
                        <td>
                          <span className="tagx out">{reason}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {exclusions.data.data.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 3} className="empty">
                        Nenhuma linha saiu {outStep !== null ? "neste passo" : "nesta pergunta"}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager meta={exclusions.data.meta} loading={exclusions.isFetching} onPage={setPage} />
          </div>
        ))}

      {filter.kind === "rep" &&
        (identities.isError ? (
          <ErrorBlock error={identities.error} onRetry={() => identities.refetch()} />
        ) : !identities.data ? (
          <LoadingBlock label="Carregando valores" />
        ) : (
          <div className="grid gap-2">
            <p className="small-note">
              {formatCount(identities.data.meta.rows)} linhas, {formatCount(identities.data.meta.distinct)} valores diferentes de {identities.data.meta.source.column}:{" "}
              {formatCount(identities.data.meta.repeated)} linhas repetem um valor já contado
              {identities.data.meta.ignored_null > 0 ? ` e ${formatCount(identities.data.meta.ignored_null)} vazias não contam` : ""}. Os mais repetidos primeiro.
            </p>
            <div className="rt-wrap" aria-busy={identities.isFetching}>
              <div className="rt-scroll">
                <table className="rt" aria-label="Valores contados e suas repetições">
                  <thead>
                    <tr>
                      <th scope="col">{identities.data.meta.source.column}</th>
                      <th scope="col">linhas</th>
                      <th scope="col">contam</th>
                      <th scope="col">repetidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {identities.data.data.map((identity) => (
                      <tr key={identity.value}>
                        <td>
                          <span className="cell" title={identity.value.length > 24 ? identity.value : undefined}>
                            {identity.value}
                          </span>
                        </td>
                        <td>{formatCount(identity.tuples)}</td>
                        <td>1</td>
                        <td>{identity.repeated > 0 ? <span className="tagx rep">{formatCount(identity.repeated)}</span> : "0"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager meta={identities.data.meta} loading={identities.isFetching} onPage={setPage} />
            </div>
          </div>
        ))}
    </div>
  );
}

type DetailProps = { run: RunDetail; views: StepView[]; selected: SelectedRow; onClose: () => void };

export function RecordDetail({ run, views, selected, onClose }: DetailProps) {
  const journey = useJourney(run.id, selected.rowId, 1);
  const heading = useRef<HTMLHeadingElement>(null);
  const loaded = journey.data !== undefined;

  useEffect(() => {
    if (!loaded) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [loaded]);

  const close = () => {
    onClose();
    window.setTimeout(() => document.getElementById(`rec-row-${selected.rowId}`)?.focus(), 0);
  };

  if (journey.isError) return <ErrorBlock error={journey.error} onRetry={() => journey.refetch()} />;
  if (!journey.data) return <LoadingBlock label="Carregando a linha completa" />;

  const data = journey.data.data;
  const order = run.inputs[data.row.input]?.columns.map((column) => column.key) ?? [];
  const keys = [...order.filter((key) => key in data.row.values), ...Object.keys(data.row.values).filter((key) => !order.includes(key))];
  const context = selected.context;
  const exclusion = context.kind === "out" ? context.exclusion : null;
  const reason = exclusion ? (lossText(views, exclusion.step_position, exclusion.code) ?? exclusion.label) : null;
  const status = context.kind === "in" ? context.status : null;

  return (
    <section
      className="rec-detail"
      aria-labelledby={`rec-detail-${selected.rowId}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="rd-head">
        <div className="grid gap-1">
          <p className="eyebrow m-0">
            {data.row.dataset_name === data.row.alias ? data.row.alias : `${data.row.dataset_name} · ${data.row.alias}`} · versão {data.row.version_number}
          </p>
          <h4 id={`rec-detail-${selected.rowId}`} ref={heading} tabIndex={-1}>
            Linha {formatCount(data.row.line_number)} do arquivo
          </h4>
          <p className="small-note">
            Registro nº {formatCount(data.row.row_number)} da versão {data.row.version_number}
          </p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={close}>
          Fechar detalhe
        </button>
      </div>
      <p className="rd-status">
        {exclusion ? (
          <>
            <span className="tagx out">saiu no passo {exclusion.step_position}</span> {reason}.
          </>
        ) : (
          <>
            <span className={`tagx ${status === "repeated" ? "rep" : "in"}`}>{status === "repeated" ? "entra, repetida" : "entra"}</span>{" "}
            {status === "repeated" ? "Este valor já tinha sido contado em outra linha; esta linha contribui com zero." : "Esta linha chega ao resultado."}
          </>
        )}
      </p>
      <dl className="rd-fields">
        {keys.map((key) => {
          const value = data.row.values[key];
          return (
            <div key={key} className="rd-field">
              <dt>
                {key.split("_").map((part, i) => (
                  <span key={i}>
                    {i > 0 && (
                      <>
                        _<wbr />
                      </>
                    )}
                    {part}
                  </span>
                ))}
              </dt>
              <dd className={value === null ? "empty" : undefined}>{value === null ? "vazio (sem valor no arquivo)" : value === "" ? "texto vazio" : value}</dd>
            </div>
          );
        })}
      </dl>
      <p className="m-0 text-[14.5px] leading-relaxed text-ink-2">{data.summary}</p>
      <div className="q-actions">
        <Link className="btn" href={`/mapa?tabela=${data.row.alias}`}>
          Abrir {data.row.alias} no mapa
        </Link>
      </div>
    </section>
  );
}
