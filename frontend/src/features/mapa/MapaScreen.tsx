"use client";

import "./mapa-canvas.css";
import "./mapa-panel.css";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTrail, type TrailItem } from "@/components/shell/Trail";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/ScreenStates";
import { SidePanel } from "@/components/ui/SidePanel";
import { useToast } from "@/components/ui/Toast";
import { formatCount, plural } from "@/lib/format";
import { useDatasets, useDiscoverRelationships, useRelationships, useVersions } from "@/lib/queries";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { MapCanvas, type Selection } from "./components/MapCanvas";
import { MapList } from "./components/MapList";
import { RelationPanel } from "./components/RelationPanel";
import { FieldPanel, RecordPanel, TablePanel } from "./components/TablePanels";
import { TYPE_WORDS } from "./components/FieldIcon";
import { relationLabel } from "./model/evidence";
import { buildMapModel, standingOf, type MapModel } from "./model/graph";

type RecordEntry = { table: string; rowId: number; values: Record<string, string | null>; line: number };

const STATE_WORDS: Record<string, string> = { suggested: "sugerida", confirmed: "confirmada", caveat: "confirmada com ressalva", rejected: "rejeitada", review: "para reavaliar" };

function parseSelection(params: URLSearchParams, model: MapModel | null): Selection {
  const relation = params.get("relacao");
  if (relation) return { kind: "rel", id: relation };
  const table = params.get("tabela");
  if (table && model?.byKey.has(table)) return { kind: "table", key: table };
  const field = params.get("campo");
  if (field && model) {
    const dot = field.indexOf(".");
    const key = field.slice(0, dot);
    const column = field.slice(dot + 1);
    if (dot > 0 && model.byKey.get(key)?.columns.some((c) => c.key === column)) return { kind: "field", key, column };
  }
  return null;
}

function recordTitle(entry: RecordEntry) {
  return entry.values.nome ?? `${entry.table} · linha ${entry.line}`;
}

export function MapaScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const compact = useMediaQuery("(max-width: 979px)");
  const datasets = useDatasets();
  const relationships = useRelationships();
  const versionIds = useMemo(() => datasets.data?.data.flatMap((d) => (d.latest_version ? [d.latest_version.id] : [])) ?? [], [datasets.data]);
  const versions = useVersions(versionIds);
  const discover = useDiscoverRelationships();
  const [focusTable, setFocusTable] = useState<string | null>(null);
  const [recordState, setRecordState] = useState<{ key: string; items: RecordEntry[] }>({ key: "", items: [] });

  const ready = datasets.isSuccess && relationships.isSuccess && !versions.pending;
  const model = useMemo(
    () => (ready ? buildMapModel(datasets.data.data, versions.data, relationships.data.data) : null),
    [ready, datasets.data, versions.data, relationships.data],
  );

  const selection = parseSelection(params, model);
  const selectionKey = selection ? JSON.stringify(selection) : "";
  const records = useMemo(() => (recordState.key === selectionKey ? recordState.items : []), [recordState, selectionKey]);
  const top = records[records.length - 1] ?? null;
  const panelOpen = selection !== null;

  const go = useCallback((query: string) => router.push(query ? `/mapa?${query}` : "/mapa", { scroll: false }), [router]);
  const selectRelation = useCallback((id: string) => go(`relacao=${encodeURIComponent(id)}`), [go]);
  const openTable = useCallback((key: string) => go(`tabela=${encodeURIComponent(key)}`), [go]);
  const openField = useCallback((key: string, column: string) => go(`campo=${encodeURIComponent(`${key}.${column}`)}`), [go]);
  const close = useCallback(() => go(""), [go]);
  const focus = useCallback(
    (key: string | null) => {
      setFocusTable(key);
      if (key && selection?.kind === "rel") close();
    },
    [selection?.kind, close],
  );
  const openRecord = useCallback(
    (table: string, rowId: number, values: Record<string, string | null>, line: number) =>
      setRecordState({ key: selectionKey, items: [...records, { table, rowId, values, line }] }),
    [selectionKey, records],
  );
  const popRecord = useCallback(() => setRecordState({ key: selectionKey, items: records.slice(0, -1) }), [selectionKey, records]);
  const background = useCallback(() => {
    if (selection) close();
    else if (focusTable) setFocusTable(null);
  }, [selection, focusTable, close]);
  const clearAll = useCallback(() => {
    setFocusTable(null);
    if (selection) close();
  }, [selection, close]);

  useEffect(() => {
    if (selection || !focusTable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFocusTable(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, focusTable]);

  const relation = selection?.kind === "rel" ? (model?.relations.find((r) => r.id === selection.id) ?? null) : null;
  const selectedTable = selection && selection.kind !== "rel" ? (model?.byKey.get(selection.key) ?? null) : null;
  const selectedColumn = selection?.kind === "field" ? (selectedTable?.columns.find((c) => c.key === selection.column) ?? null) : null;
  const recordTable = top ? (model?.byKey.get(top.table) ?? null) : null;

  const trail: TrailItem[] = [{ label: "Mapa", href: "/mapa" }];
  if (selection?.kind === "rel") trail.push({ label: relation ? relationLabel(relation) : "relação", href: `/mapa?relacao=${encodeURIComponent(selection.id)}` });
  if (selection?.kind === "table") trail.push({ label: selection.key, href: `/mapa?tabela=${encodeURIComponent(selection.key)}` });
  if (selection?.kind === "field") trail.push({ label: selection.key, href: `/mapa?tabela=${encodeURIComponent(selection.key)}` }, { label: `${selection.key}.${selection.column}` });
  if (!selection && focusTable) trail.push({ label: `vizinhança de ${focusTable}` });
  for (const entry of records) trail.push({ label: recordTitle(entry) });
  useTrail(trail);

  const runDiscover = () => {
    const before = new Set(model?.relations.map((r) => r.id) ?? []);
    discover.mutate(undefined, {
      onSuccess: (response) => {
        const fresh = response.data.filter((r) => !before.has(r.id)).length;
        toast(fresh ? `${plural(fresh, "relação nova encontrada", "relações novas encontradas")}.` : "Nenhuma relação nova. As decisões existentes foram mantidas.");
      },
      onError: (error) => toast(error.message),
    });
  };

  const failure = datasets.error ?? relationships.error ?? versions.error;
  if (failure) {
    return (
      <div className="mx-auto grid max-w-[760px] gap-4 px-8 py-16">
        <h1 className="sr-only">Mapa</h1>
        <ErrorBlock
          error={failure}
          onRetry={() => {
            datasets.refetch();
            relationships.refetch();
            versions.refetch();
          }}
        />
      </div>
    );
  }
  if (!model) {
    return (
      <div className="mx-auto max-w-[1240px] px-8 py-16">
        <h1 className="sr-only">Mapa</h1>
        <LoadingBlock label="Carregando tabelas e relações" />
      </div>
    );
  }
  if (!model.tables.length) {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-16">
        <h1 className="mb-4 font-display text-[36px] font-bold tracking-[-0.03em]">Mapa</h1>
        <EmptyBlock title="Nenhuma tabela neste espaço.">Troque de cenário no menu ao lado do logo para ver dados de demonstração.</EmptyBlock>
      </div>
    );
  }

  let panel: { eyebrow: string; eyebrowClassName?: string; title: string; sub?: string; body: React.ReactNode } | null = null;
  if (top && recordTable) {
    panel = {
      eyebrow: `Registro · ${recordTable.file} · linha ${top.line}`,
      title: recordTitle(top),
      sub: top.values.id !== undefined ? `${top.table}.id = ${top.values.id ?? "vazio"}` : undefined,
      body: <RecordPanel key={`${top.table}-${top.rowId}`} table={recordTable} values={top.values} model={model} onOpenRecord={openRecord} />,
    };
  } else if (selection?.kind === "rel") {
    panel = {
      eyebrow: relation ? `Relação ${STATE_WORDS[standingOf(relation)]}` : "Relação",
      eyebrowClassName: "eyebrow-ab",
      title: relation ? `${relation.from.dataset_key} → ${relation.to.dataset_key}` : "Relação",
      sub: relation ? `${relation.from.dataset_key}.${relation.from.column} = ${relation.to.dataset_key}.${relation.to.column}` : undefined,
      body: (
        <RelationPanel
          key={selection.id}
          id={selection.id}
          listed={relation}
          model={model}
          onSelectRelation={selectRelation}
          onFocusTable={focus}
          onOpenTable={openTable}
          onOpenRecord={openRecord}
        />
      ),
    };
  } else if (selection?.kind === "table" && selectedTable) {
    panel = {
      eyebrow: `Tabela · ${selectedTable.file} · versão ${selectedTable.versionNumber}`,
      title: selectedTable.key,
      sub: `${plural(selectedTable.rows, "linha", "linhas")} · ${plural(selectedTable.columns.length, "campo", "campos")}`,
      body: <TablePanel key={selectedTable.key} table={selectedTable} model={model} onOpenField={openField} onSelectRelation={selectRelation} onFocusTable={focus} onOpenRecord={openRecord} />,
    };
  } else if (selection?.kind === "field" && selectedTable && selectedColumn) {
    const p = selectedColumn.profile;
    panel = {
      eyebrow: `Campo · ${selectedTable.key}`,
      title: selectedColumn.key,
      sub: `${TYPE_WORDS[selectedColumn.type] ?? selectedColumn.type} · ${formatCount(p.non_null)} valores · ${formatCount(p.distinct)} diferentes${p.nulls ? ` · ${plural(p.nulls, "vazio", "vazios")}` : ""}`,
      body: <FieldPanel key={`${selectedTable.key}.${selectedColumn.key}`} table={selectedTable} column={selectedColumn} model={model} onSelectRelation={selectRelation} onOpenRecord={openRecord} />,
    };
  }

  const previous = records.length > 1 ? recordTitle(records[records.length - 2]) : relation ? relationLabel(relation) : selection?.kind === "field" ? `${selection.key}.${selection.column}` : (selection?.kind === "table" ? selection.key : "voltar");

  return (
    <div className={`mapa ${panelOpen ? "panel-open" : ""}`}>
      {compact ? (
        <MapList model={model} discovering={discover.isPending} onDiscover={runDiscover} onSelectRelation={selectRelation} onOpenTable={openTable} onOpenField={openField} />
      ) : (
        <MapCanvas
          model={model}
          selection={selection}
          focusTable={focusTable}
          panelOpen={panelOpen}
          discovering={discover.isPending}
          onDiscover={runDiscover}
          onSelectRelation={selectRelation}
          onOpenTable={openTable}
          onOpenField={openField}
          onFocusTable={focus}
          onBackground={background}
          onClearAll={clearAll}
        />
      )}
      <SidePanel
        open={panel !== null}
        onClose={close}
        onEscape={records.length ? popRecord : close}
        eyebrow={panel?.eyebrow}
        eyebrowClassName={panel?.eyebrowClassName}
        title={panel?.title ?? ""}
        sub={panel?.sub}
        back={records.length ? { label: previous, onClick: popRecord } : undefined}
        focusKey={`${selectionKey}|${records.length}`}
      >
        {panel?.body}
      </SidePanel>
    </div>
  );
}
