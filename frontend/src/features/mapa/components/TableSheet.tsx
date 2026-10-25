"use client";

import { memo, type CSSProperties } from "react";
import { formatCount, plural } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { isActive, type MapColumn, type MapTable } from "../model/graph";
import type { Lod, SheetView } from "../model/layout";
import { FieldIcon, TYPE_WORDS } from "./FieldIcon";

function fieldNote(table: MapTable, column: MapColumn, relations: Relationship[]) {
  const issue = column.issues[0];
  if (issue) return { text: issue.text, tone: issue.kind === "near" ? "pos" : issue.kind === "dup" ? "warn" : "" };
  if (column.role === "key") return { text: "chave", tone: "" };
  const targets = relations.filter((r) => isActive(r) && r.from.dataset_key === table.key && r.from.column === column.key).map((r) => r.to.dataset_key);
  if (targets.length > 1) return { text: `liga a ${targets.join(" ou ")}?`, tone: "pos" };
  if (targets.length === 1) return { text: `liga a ${targets[0]}`, tone: "" };
  return { text: TYPE_WORDS[column.type] ?? column.type, tone: "" };
}

type Props = {
  table: MapTable;
  view: SheetView;
  lod: Lod;
  relations: Relationship[];
  style?: CSSProperties;
  className?: string;
  highlighted: Set<string>;
  stackDepth?: number;
  badge?: number;
  onOpenTable: (key: string) => void;
  onOpenField: (key: string, column: string) => void;
  onExpand: (key: string) => void;
  onCollapse: (key: string) => void;
};

export const TableSheet = memo(function TableSheet({ table, view, lod, relations, style, className = "", highlighted, stackDepth = 0, badge, onOpenTable, onOpenField, onExpand, onCollapse }: Props) {
  const issues = table.columns.flatMap((c) => c.issues);
  const bare = view.columns.length === 0 && !view.showMore && !view.showLess;
  return (
    <article className={`sheet lod-${lod} ${bare ? "bare" : ""} ${className}`} style={style} aria-label={`Tabela ${table.key}, ${plural(table.rows, "linha", "linhas")}`} data-table={table.key}>
      {Array.from({ length: stackDepth }, (_, i) => stackDepth - i).map((i) => (
        <div key={i} className="stack" aria-hidden style={{ transform: `translate(${i * 5}px, ${i * 5}px)`, opacity: 1 - i * 0.11 }} />
      ))}
      {badge !== undefined && (
        <span className="route-badge" aria-hidden>
          {badge}
        </span>
      )}
      <div className="sheet-head">
        <button type="button" className="sheet-title" onClick={() => onOpenTable(table.key)}>
          {table.key}
        </button>
        <div className="sheet-dims">
          <b>{formatCount(table.rows)}</b>
          <span>linhas</span>
        </div>
        {lod === "overview" && issues.length > 0 && (
          <div className="sheet-issues">
            {issues.slice(0, 2).map((issue) => (
              <span key={issue.text} className={`tagx ${issue.kind === "dup" ? "rep" : issue.kind === "near" ? "pos" : ""}`}>
                {issue.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {!bare && (
        <ul className="fields">
          {view.columns.map((column) => {
            const note = fieldNote(table, column, relations);
            return (
              <li key={column.key}>
                <button
                  type="button"
                  className={`field ${column.role === "key" ? "key" : ""} ${column.issues.length ? "has-issue" : ""} ${highlighted.has(column.key) ? "reg" : ""}`}
                  aria-label={`Campo ${column.key}: ${note.text}`}
                  onClick={() => onOpenField(table.key, column.key)}
                >
                  <span className="ft" title={TYPE_WORDS[column.type]}>
                    <FieldIcon column={column} />
                  </span>
                  <span className="fn">
                    <b>{column.key}</b>
                    <small className={note.tone}>{note.text}</small>
                  </span>
                </button>
              </li>
            );
          })}
          {view.showMore && (
            <li>
              <button type="button" className="more-fields" onClick={() => onExpand(table.key)}>
                + {plural(view.hidden, "campo", "campos")}
              </button>
            </li>
          )}
          {view.showLess && (
            <li>
              <button type="button" className="more-fields" onClick={() => onCollapse(table.key)}>
                mostrar só os campos principais
              </button>
            </li>
          )}
        </ul>
      )}
    </article>
  );
});
