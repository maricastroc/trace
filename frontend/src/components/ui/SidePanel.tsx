"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onEscape?: () => void;
  eyebrow?: ReactNode;
  eyebrowClassName?: string;
  title: ReactNode;
  sub?: ReactNode;
  back?: { label: string; onClick: () => void };
  focusKey?: string;
  children: ReactNode;
};

export function SidePanel({ open, onClose, onEscape, eyebrow, eyebrowClassName, title, sub, back, focusKey, children }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    body.current?.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, focusKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) (onEscape ?? onClose)();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, onEscape]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
      className={`fixed top-[calc(var(--bar-h)+var(--trail-h))] right-0 bottom-0 z-20 flex w-(--panel-w) flex-col border-l border-rule-2 bg-sheet shadow-[-30px_0_60px_-48px_rgba(18,20,25,0.45)] duration-500 ease-trace-out ${open ? "visible translate-x-0 transition-transform" : "invisible translate-x-[102%] transition-[transform,visibility]"}`}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b border-rule px-7 pt-5 pb-4 max-[900px]:px-5">
        <div className="min-w-0">
          {back && (
            <button type="button" className="btn-link mb-2 text-[13.5px]" onClick={back.onClick}>
              ← {back.label}
            </button>
          )}
          {eyebrow && <p className={`eyebrow ${eyebrowClassName ?? ""}`}>{eyebrow}</p>}
          <h2 ref={heading} id={titleId} tabIndex={-1} className="mt-1.5 font-display text-[30px] leading-[1.08] font-bold tracking-[-0.025em] [overflow-wrap:anywhere] outline-none max-[900px]:text-[25px]">
            {title}
          </h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar painel" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {sub && <p className="col-span-2 font-mono text-[13.5px] text-ink-2 [overflow-wrap:anywhere]">{sub}</p>}
      </header>
      <div ref={body} className="grid flex-1 auto-rows-max grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-x-hidden overflow-y-auto px-7 pt-6 pb-10 max-[900px]:px-5">
        {children}
      </div>
    </aside>
  );
}
