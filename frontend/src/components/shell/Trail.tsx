"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type TrailItem = { label: string; href?: string };

const TrailContext = createContext<{ items: TrailItem[]; setItems: (items: TrailItem[]) => void } | null>(null);

export function TrailProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrailItem[]>([]);
  return <TrailContext.Provider value={{ items, setItems }}>{children}</TrailContext.Provider>;
}

export function useTrail(items: TrailItem[]) {
  const setItems = useContext(TrailContext)?.setItems;
  const serialized = JSON.stringify(items);
  useEffect(() => {
    setItems?.(JSON.parse(serialized) as TrailItem[]);
  }, [setItems, serialized]);
}

export function Trail() {
  const context = useContext(TrailContext);
  const items = context?.items ?? [];
  return (
    <nav aria-label="Rastro da investigação" className="flex h-(--trail-h) items-center gap-2 overflow-hidden border-b border-rule bg-paper px-5 font-mono text-[12.5px] whitespace-nowrap text-ink-3">
      <span className="mr-1 text-[11px] tracking-[0.12em] uppercase">Rastro</span>
      <ol className="flex items-center gap-2">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="opacity-50">›</span>}
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "font-medium text-ink" : undefined} aria-current={last ? "location" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
