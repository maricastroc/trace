import type { ReactNode } from "react";

export function UnderConstruction({ children }: { children: ReactNode }) {
  return (
    <p className="flex max-w-[72ch] flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[15.5px] leading-relaxed text-ink-2">
      <span className="rounded-full bg-ab-wash px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-[0.08em] text-ab uppercase">em construção</span>
      <span>{children}</span>
    </p>
  );
}
