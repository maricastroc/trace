import type { ReactNode } from "react";
import type { ApiError } from "@/lib/api";

export function LoadingBlock({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-3 text-[16px] text-ink-2">
      <span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-ab" />
      {label}…
    </p>
  );
}

export function ErrorBlock({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  return (
    <div role="alert" className="grid max-w-[620px] gap-3 rounded-2xl border border-[color:var(--b)] bg-sheet p-5">
      <p className="eyebrow eyebrow-b">Não foi possível carregar</p>
      <p className="text-[15.5px] leading-relaxed text-ink-2">{error?.message ?? "Erro desconhecido."}</p>
      {onRetry && (
        <button type="button" className="btn justify-self-start" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid max-w-[620px] gap-2 rounded-2xl border border-dashed border-rule-2 bg-sheet p-5">
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <div className="text-[15px] leading-relaxed text-ink-2">{children}</div>}
    </div>
  );
}
