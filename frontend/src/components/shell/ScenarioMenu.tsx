"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ScenarioSummary } from "@/lib/types";

type Props = {
  current: string | null;
  scenarios: ScenarioSummary[];
  busy: boolean;
  onSelect: (scenario: string) => void;
};

export function ScenarioMenu({ current, scenarios, busy, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = scenarios.find((s) => s.key === current)?.label ?? "Abrindo…";

  useEffect(() => {
    if (!open) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();

    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (scenario: string) => {
    setOpen(false);
    button.current?.focus();
    if (scenario !== current) onSelect(scenario);
  };

  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <button
        ref={button}
        type="button"
        className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[14.5px] font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy || scenarios.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sr-only">Cenário de demonstração: </span>
        <span className="truncate">{label}</span>
        <span aria-hidden className="text-ink-3">▾</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Cenários de demonstração"
          onKeyDown={onMenuKey}
          className="absolute top-[calc(100%+8px)] left-0 z-40 grid w-[min(360px,calc(100vw-32px))] max-[560px]:fixed max-[560px]:inset-x-4 max-[560px]:top-16 max-[560px]:w-auto gap-1 rounded-[14px] border border-rule-2 bg-sheet p-1.5 shadow-[0_30px_60px_-30px_rgba(18,20,25,0.45)]"
        >
          <p className="eyebrow px-2.5 pt-1.5 pb-1">Cenários de demonstração</p>
          {scenarios.map((scenario) => (
            <button
              key={scenario.key}
              type="button"
              role="menuitemradio"
              aria-checked={scenario.key === current}
              onClick={() => choose(scenario.key)}
              className="grid gap-0.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-paper focus-visible:bg-paper aria-checked:bg-a-wash"
            >
              <span className="text-[15px] font-semibold">{scenario.label}</span>
              <span className="text-[13.5px] leading-snug text-ink-2">{scenario.description}</span>
            </button>
          ))}
          <p className="px-2.5 pt-1 pb-1.5 text-[13px] leading-snug text-ink-3">Cada cenário tem seu próprio espaço, com dados e identificadores separados.</p>
        </div>
      )}
    </div>
  );
}
