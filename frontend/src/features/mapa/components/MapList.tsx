"use client";

import { formatPercent, plural } from "@/lib/format";
import { StatePill } from "@/components/ui/StatePill";
import { CARDINALITY_SHORT, relationLabel } from "../model/evidence";
import { standingOf, type MapModel } from "../model/graph";
import { relationsSummary } from "../model/summary";
import { sheetView, showsAllFields } from "../model/layout";
import { TableSheet } from "./TableSheet";

type Props = {
  model: MapModel;
  discovering: boolean;
  onDiscover: () => void;
  onImport: () => void;
  onSelectRelation: (id: string) => void;
  onOpenTable: (key: string) => void;
  onOpenField: (key: string, column: string) => void;
};

export function MapList({ model, discovering, onDiscover, onImport, onSelectRelation, onOpenTable, onOpenField }: Props) {
  const ordered = [...model.tables].sort((a, b) => b.rows - a.rows);
  const allFields = showsAllFields(model.tables);
  return (
    <div className="map-list">
      <p className="eyebrow eyebrow-ab">Mapa · {plural(model.tables.length, "tabela", "tabelas")}</p>
      <h1>Como seus dados se conectam</h1>
      <p className="map-summary">{relationsSummary(model.relations)}.</p>
      <div className="map-actions">
        <button type="button" className="btn-link" onClick={onImport}>
          Importar CSV
        </button>
        <button type="button" className="btn-link map-discover" onClick={onDiscover} disabled={discovering}>
          {discovering ? "Procurando relações…" : "Procurar relações de novo"}
        </button>
      </div>
      {ordered.map((table) => (
        <div key={table.key} className="grid gap-3">
          <TableSheet
            table={table}
            view={sheetView(table, "detail", false, allFields)}
            lod="detail"
            relations={model.relations}
            highlighted={new Set()}
            onOpenTable={onOpenTable}
            onOpenField={onOpenField}
            onExpand={onOpenTable}
            onCollapse={() => {}}
          />
          {model.relations
            .filter((r) => r.from.dataset_key === table.key)
            .map((r) => {
              const e = r.evidence;
              const missing = e.match.unmatched_rows + e.match.null_rows;
              const rows = e.match.matched_rows + missing;
              return (
                <button key={r.id} type="button" className="rel-card" onClick={() => onSelectRelation(r.id)}>
                  <span className="lt">{relationLabel(r)}</span>
                  <span className="cov-bar" aria-hidden>
                    <span style={{ width: `${rows ? (e.match.matched_rows / rows) * 100 : 0}%`, background: "var(--ab)" }} />
                    <span style={{ width: `${rows ? (missing / rows) * 100 : 0}%`, background: "var(--b)" }} />
                  </span>
                  <span className="statusline">
                    <b className="font-mono">{formatPercent(e.match.match_ratio)}</b>
                    <StatePill status={standingOf(r)} />
                    <span className={e.to.unique ? "tagx" : "tagx rep"}>{e.to.unique ? `${CARDINALITY_SHORT[e.cardinality]} · destino único` : "N:1 não comprovada"}</span>
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
