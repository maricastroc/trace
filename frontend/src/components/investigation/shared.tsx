import type { ReactNode } from "react";
import type { ApiError } from "@/lib/api";
import { formatCount } from "@/lib/format";
import type { PageMeta, SourceRow } from "@/lib/types";

export function Block({ title, children, aside, className = "" }: { title: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Loading({ label = "Carregando dados da linhagem…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-[16px] text-ink-2" role="status">
      <span aria-hidden className="pulse-dot inline-block size-2 rounded-full bg-ink" />
      {label}
    </p>
  );
}

export function Failure({ error }: { error: Error | null }) {
  return (
    <p className="border-l-[3px] border-[#b4321f] py-1 pl-3 text-[16px] text-[#8f2a1a]" role="alert">
      {(error as ApiError | null)?.message ?? "Não foi possível carregar esta parte da investigação."}
    </p>
  );
}

export function Pager({ meta, onChange }: { meta: PageMeta; onChange: (page: number) => void }) {
  if (meta.total <= meta.per_page) return null;
  const from = (meta.page - 1) * meta.per_page + 1;
  const to = Math.min(meta.page * meta.per_page, meta.total);
  return (
    <nav aria-label="Paginação" className="numerals flex items-center gap-3 text-[15px] text-ink-2">
      <span>
        {formatCount(from)}–{formatCount(to)} de {formatCount(meta.total)}
      </span>
      <button type="button" disabled={meta.page <= 1} onClick={() => onChange(meta.page - 1)} className="rounded-full border border-ink/25 px-3 py-0.5 hover:border-ink disabled:opacity-35" aria-label="Página anterior">
        ←
      </button>
      <button type="button" disabled={meta.page >= meta.last_page} onClick={() => onChange(meta.page + 1)} className="rounded-full border border-ink/25 px-3 py-0.5 hover:border-ink disabled:opacity-35" aria-label="Próxima página">
        →
      </button>
    </nav>
  );
}

export function rowName(row: SourceRow) {
  return row.values.id ?? `linha ${row.line_number}`;
}

export function ValuesTable({ row, emphasize = [] }: { row: SourceRow; emphasize?: string[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,max-content)_1fr] gap-x-6 gap-y-1 font-mono text-[15px]">
      {Object.entries(row.values).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className={emphasize.includes(key) ? "text-ink" : "text-ink-2"}>{key}</dt>
          <dd className={`numerals ${emphasize.includes(key) ? "font-semibold text-ink" : "text-ink"}`}>{value ?? <span className="text-[#8f2a1a]">vazio</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RecordButton({ onClick, children, accent }: { onClick: () => void; children: ReactNode; accent?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full rounded-[3px] border-l-[3px] py-2.5 pr-2 pl-3.5 text-left transition-colors hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04]"
      style={{ borderColor: accent ?? "rgba(17,17,16,.2)" }}
    >
      {children}
    </button>
  );
}
