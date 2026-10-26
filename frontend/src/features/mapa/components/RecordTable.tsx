"use client";

import { RowOpen } from "@/components/ui/RowOpen";
import { formatCount } from "@/lib/format";
import type { PageMeta, SourceRow } from "@/lib/types";
import { ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";

type Props = {
  label: string;
  columns: string[];
  rows: SourceRow[] | undefined;
  meta: PageMeta | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onPage: (page: number) => void;
  onRow?: (row: SourceRow) => void;
  emptyText?: string;
};

export function RecordTable({ label, columns, rows, meta, loading, error, onRetry, onPage, onRow, emptyText = "Nenhum registro." }: Props) {
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (!rows || !meta) return <LoadingBlock label="Carregando registros" />;
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.per_page + 1;
  const last = Math.min(meta.total, meta.page * meta.per_page);
  return (
    <div className="rt-wrap" aria-busy={loading}>
      <div className="rt-scroll">
        <table className="rt" aria-label={label}>
          <thead>
            <tr>
              <th scope="col">linha</th>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={onRow ? "clickable" : undefined} onClick={onRow ? () => onRow(row) : undefined}>
                <td>
                  {onRow ? (
                    <RowOpen label={`Abrir a linha ${row.line_number} do arquivo`} onOpen={() => onRow(row)}>
                      {row.line_number}
                    </RowOpen>
                  ) : (
                    row.line_number
                  )}
                </td>
                {columns.map((column) => {
                  const value = row.values[column];
                  return (
                    <td key={column} className={value === null || value === undefined ? "empty" : undefined}>
                      {value === null || value === undefined ? "vazio" : value}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="empty">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    </div>
  );
}
