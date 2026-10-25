"use client";

import { useCallback, useState } from "react";
import { useTrail } from "@/components/shell/Trail";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { SidePanel } from "@/components/ui/SidePanel";
import { StatePill } from "@/components/ui/StatePill";
import { formatCount, formatPercent, plural } from "@/lib/format";
import { useDatasets, useRelationships, useVersion } from "@/lib/queries";
import type { DatasetSummary } from "@/lib/types";
import { UnderConstruction } from "@/features/shared/UnderConstruction";

const TYPE_WORDS: Record<string, string> = { identifier: "identificador", text: "texto", number: "número", date: "data" };

function DatasetPanelBody({ dataset }: { dataset: DatasetSummary }) {
  const version = useVersion(dataset.latest_version?.id ?? null);
  if (version.isPending) return <LoadingBlock label="Carregando colunas" />;
  if (version.isError) return <ErrorBlock error={version.error} onRetry={() => version.refetch()} />;
  const columns = version.data.data.columns;
  return (
    <section>
      <h3 className="eyebrow mb-3">Campos · {columns.length}</h3>
      <ul className="grid gap-2">
        {columns.map((column) => (
          <li key={column.key} className="grid gap-0.5 rounded-xl border border-rule bg-sheet px-3.5 py-2.5">
            <span className="font-mono text-[14.5px] font-medium">{column.key}</span>
            <span className="text-[13.5px] text-ink-2">
              {TYPE_WORDS[column.type] ?? column.type} · {plural(column.profile.distinct, "valor distinto", "valores distintos")}
              {column.profile.nulls > 0 ? ` · ${plural(column.profile.nulls, "vazio", "vazios")}` : ""}
              {column.profile.unique ? " · único" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MapaScreen() {
  useTrail([{ label: "Mapa" }]);
  const datasets = useDatasets();
  const relationships = useRelationships();
  const [selected, setSelected] = useState<DatasetSummary | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const show = (table: DatasetSummary) => {
    setSelected(table);
    setOpen(true);
  };

  const tables = datasets.data?.data ?? [];
  const rels = relationships.data?.data ?? [];
  const pending = rels.filter((r) => r.status === "suggested").length;

  return (
    <div className="mx-auto grid max-w-[1240px] gap-10 px-8 pt-9 pb-24">
      <header className="grid gap-2">
        <p className="eyebrow eyebrow-ab">Mapa{datasets.isSuccess ? ` · ${plural(tables.length, "tabela", "tabelas")}` : ""}</p>
        <h1 className="font-display text-[clamp(30px,3.2vw,44px)] leading-[1.08] font-bold tracking-[-0.03em]">
          {pending > 0 ? `${plural(pending, "relação aguarda", "relações aguardam")} sua decisão` : "Tabelas e relações"}
        </h1>
        <UnderConstruction>A visualização interativa das conexões, com zoom, foco e evidências em camadas, chega na próxima etapa. Abaixo, as tabelas e relações reais deste cenário.</UnderConstruction>
      </header>

      <section aria-labelledby="mapa-tabelas" className="grid gap-4">
        <h2 id="mapa-tabelas" className="eyebrow">
          Tabelas
        </h2>
        {datasets.isPending && <LoadingBlock label="Carregando tabelas" />}
        {datasets.isError && <ErrorBlock error={datasets.error} onRetry={() => datasets.refetch()} />}
        {datasets.isSuccess && tables.length === 0 && <EmptyBlock title="Nenhuma tabela neste espaço." />}
        {tables.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6">
            {tables.map((table) => (
              <li key={table.id}>
                <button type="button" onClick={() => show(table)} className="sheet-card grid w-full gap-1.5 px-5 pt-4 pb-5 text-left hover:border-ink-3" aria-haspopup="dialog">
                  <span className="font-display text-[28px] leading-none font-bold tracking-[-0.03em]">{table.key}</span>
                  <span className="text-[14.5px] text-ink-2">
                    <b className="font-mono text-[18px] font-semibold text-ink">{formatCount(table.latest_version?.row_count)}</b> linhas · {plural(table.latest_version?.column_count ?? 0, "campo", "campos")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mapa-relacoes" className="grid gap-4">
        <h2 id="mapa-relacoes" className="eyebrow">
          Relações sugeridas e decididas
        </h2>
        {relationships.isPending && <LoadingBlock label="Carregando relações" />}
        {relationships.isError && <ErrorBlock error={relationships.error} onRetry={() => relationships.refetch()} />}
        {relationships.isSuccess && rels.length === 0 && <EmptyBlock title="Nenhuma relação encontrada pela descoberta automática." />}
        {rels.length > 0 && (
          <ul className="grid max-w-[860px] gap-2">
            {rels.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-rule bg-sheet px-4 py-3">
                <span className="font-mono text-[14px]">
                  {r.from.dataset_key}.{r.from.column} → {r.to.dataset_key}.{r.to.column}
                </span>
                <StatePill status={r.status} />
                <span className="text-[14px] text-ink-2">
                  cobertura {formatPercent(r.evidence.match.match_ratio)}
                  {r.cardinality_label ? ` · ${r.cardinality_label}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SidePanel open={open} onClose={close} eyebrow="Tabela" title={selected?.key ?? ""} sub={selected ? `${selected.latest_version?.source_filename ?? ""} · versão ${selected.latest_version?.number ?? "—"}` : undefined}>
        {selected && <DatasetPanelBody dataset={selected} />}
      </SidePanel>
    </div>
  );
}
