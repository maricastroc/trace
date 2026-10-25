"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
};

export function SidePanel({ open, onClose, eyebrow, title, sub, children }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const frame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
      className={`fixed top-[calc(var(--bar-h)+var(--trail-h))] right-0 bottom-0 z-20 flex w-(--panel-w) flex-col border-l border-rule-2 bg-sheet shadow-[-30px_0_60px_-48px_rgba(18,20,25,0.45)] duration-500 ease-trace-out ${open ? "visible translate-x-0 transition-transform" : "invisible translate-x-[102%] transition-[transform,visibility]"}`}
    >
      <header className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1.5 border-b border-rule px-7 pt-5 pb-4">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 ref={heading} id={titleId} tabIndex={-1} className="mt-1.5 font-display text-[30px] leading-[1.08] font-bold tracking-[-0.025em] outline-none">
            {title}
          </h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar painel" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {sub && <p className="col-span-2 font-mono text-[13.5px] text-ink-2">{sub}</p>}
      </header>
      <div className="grid flex-1 auto-rows-max content-start gap-6 overflow-x-hidden overflow-y-auto px-7 pt-6 pb-10">{children}</div>
    </aside>
  );
}
