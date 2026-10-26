"use client";

import { forwardRef } from "react";
import { formatCount, formatPercent, plural } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { findPaths, pathTables, type MapModel } from "../model/graph";
import { pathStandings, relationsSummary } from "../model/summary";

export type MapMode = "structure" | "paths";
export type PathState = { from: string; to: string; pick: number };

type StatusProps = { model: MapModel; hidden: boolean; discovering: boolean; onDiscover: () => void; onImport: () => void };

export const MapStatus = forwardRef<HTMLDivElement, StatusProps>(function MapStatus({ model, hidden, discovering, onDiscover, onImport }, ref) {
  const pending = model.relations.some((r) => r.status === "suggested");
  return (
    <div ref={ref} className="map-ov map-status" hidden={hidden}>
      <p className="eyebrow eyebrow-ab">Mapa · {plural(model.tables.length, "tabela", "tabelas")}</p>
      <h1>Como seus dados se conectam</h1>
      <p className="map-summary">
        {relationsSummary(model.relations)}
        {pending ? ". Clique numa conexão para ver a evidência." : "."}
      </p>
      <div className="map-actions">
        <button type="button" className="btn-link" onClick={onImport}>
          Importar CSV
        </button>
        <button type="button" className="btn-link map-discover" onClick={onDiscover} disabled={discovering}>
          {discovering ? "Procurando relações…" : "Procurar relações de novo"}
        </button>
      </div>
    </div>
  );
});

type ToolsProps = {
  mode: MapMode;
  onMode: (mode: MapMode) => void;
  problems: boolean;
  problemCount: number;
  onProblems: () => void;
};

export function MapTools({ mode, onMode, problems, problemCount, onProblems }: ToolsProps) {
  return (
    <div className="map-ov map-tools">
      <div className="seg" role="group" aria-label="Modo do mapa">
        <button type="button" aria-pressed={mode === "structure"} onClick={() => onMode("structure")}>
          Estrutura
        </button>
        <button type="button" aria-pressed={mode === "paths"} onClick={() => onMode("paths")}>
          Caminhos
        </button>
      </div>
      {problemCount > 0 && (
        <button type="button" className="chip" aria-pressed={problems} onClick={onProblems}>
          Pontos de atenção <b>{problemCount}</b>
        </button>
      )}
    </div>
  );
}

type ZoomProps = { label: string; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void };

export function ZoomControls({ label, onZoomIn, onZoomOut, onFit }: ZoomProps) {
  return (
    <div className="map-ov zoom-ui">
      <button type="button" className="icon-btn" aria-label="Afastar" onClick={onZoomOut}>
        −
      </button>
      <span className="zl" aria-live="polite">
        {label}
      </span>
      <button type="button" className="icon-btn" aria-label="Aproximar" onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="btn btn-quiet" onClick={onFit}>
        Ajustar
      </button>
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="map-ov map-legend" aria-label="Legenda">
      <span>
        <i className="lg-dot" />
        sugerida
      </span>
      <span>
        <i className="lg-line" />
        confirmada
      </span>
      <span>
        <i className="lg-cav" />
        com ressalva
      </span>
      <span>
        <i className="lg-rej" />
        rejeitada
      </span>
      <span>
        <i className="lg-ring" />
        anel: cobertura
      </span>
      <span>
        <i className="lg-attn">!</i>
        atenção
      </span>
    </div>
  );
}

export function FocusBar({ table, neighbours, onClear }: { table: string; neighbours: number; onClear: () => void }) {
  return (
    <div className="map-ov focus-bar" role="status">
      <span>
        Destacando <b className="font-mono">{table}</b> e {plural(neighbours, "vizinha", "vizinhas")}
      </span>
      <button type="button" className="btn" onClick={onClear}>
        Limpar destaque
      </button>
    </div>
  );
}

type PathsProps = { model: MapModel; state: PathState; onChange: (state: PathState) => void };

export const PathsCard = forwardRef<HTMLDivElement, PathsProps>(function PathsCard({ model, state, onChange }, ref) {
  const keys = model.tables.map((t) => t.key);
  const paths = findPaths(state.from, state.to, model.relations);
  const select = (value: string, label: string, field: "from" | "to") => (
    <select className="select" aria-label={label} value={value} onChange={(event) => onChange({ ...state, [field]: event.target.value, pick: 0 })}>
      {keys.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </select>
  );
  return (
    <div ref={ref} className="map-ov paths-card">
      <p className="eyebrow eyebrow-ab">Caminhos</p>
      <h2>Como uma tabela chega a outra</h2>
      <div className="paths-q">
        De {select(state.from, "Tabela de partida", "from")} para {select(state.to, "Tabela de chegada", "to")}
      </div>
      {state.from === state.to && <p className="small-note">Escolha duas tabelas diferentes.</p>}
      {state.from !== state.to && paths.length === 0 && <p className="small-note">Nenhum caminho com as relações atuais. Relações rejeitadas não contam.</p>}
      {paths.length > 0 && (
        <div className="paths-list" role="group" aria-label={`${plural(paths.length, "caminho possível", "caminhos possíveis")}`}>
          {paths.map((path, index) => (
            <PathOption key={path.map((r) => r.id).join("-")} from={state.from} path={path} pressed={index === state.pick} onPick={() => onChange({ ...state, pick: index })} />
          ))}
        </div>
      )}
      {paths.length > 1 && (
        <p className="small-note">Caminhos diferentes podem levar a respostas diferentes. A comparação dos resultados de cada caminho ainda não é calculada.</p>
      )}
    </div>
  );
});

function PathOption({ from, path, pressed, onPick }: { from: string; path: Relationship[]; pressed: boolean; onPick: () => void }) {
  const nodes = pathTables(from, path);
  return (
    <button type="button" className="path-opt" aria-pressed={pressed} onClick={onPick}>
      <span className="route">
        {nodes.map((node, index) => (
          <span key={`${node}-${index}`}>
            {index > 0 && <i aria-hidden> → </i>}
            {pressed && (
              <span className="route-step" aria-hidden>
                {index + 1}
              </span>
            )}
            {node}
          </span>
        ))}
      </span>
      <span className="role">
        {path.length === 1 ? "direto" : `via ${plural(path.length - 1, "tabela", "tabelas")}`} · {path.map((r) => `${r.from.column} = ${r.to.column}`).join(" → ")}
      </span>
      {pressed && (
        <span className="path-steps">
          {path.map((r) => {
            const effect = r.evidence.join_effect;
            const forward = nodes.indexOf(r.from.dataset_key) < nodes.indexOf(r.to.dataset_key);
            return (
              <span key={r.id}>
                {forward ? `${r.from.dataset_key} → ${r.to.dataset_key}` : `${r.to.dataset_key} → ${r.from.dataset_key}`}: cobertura {formatPercent(r.evidence.match.match_ratio)}
                {forward
                  ? effect
                    ? effect.extra_rows > 0
                      ? ` · +${formatCount(effect.extra_rows)} linhas na junção`
                      : " · nenhuma linha a mais"
                    : ""
                  : " · cada linha se expande em várias (1 para muitos)"}
              </span>
            );
          })}
        </span>
      )}
      <span className="path-tags">
        {pathStandings(path).map((standing) => (
          <span key={standing.key} className={`tagx ${standing.key === "authorized" ? "in" : standing.key === "risk" || standing.key === "review" ? "rep" : standing.key === "structural" ? "" : "pos"}`}>
            {standing.label}
          </span>
        ))}
      </span>
    </button>
  );
}
