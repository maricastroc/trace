"use client";

import { useEffect, useId, useRef, useState } from "react";

export function SyntheticNotice({ notice }: { notice: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button ref={button} type="button" className="tag-synthetic hover:border-ink-3" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        dados sintéticos
      </button>
      {open && (
        <div ref={box} id={id} role="note" className="absolute top-[calc(100%+8px)] right-0 z-40 w-[min(340px,calc(100vw-32px))] max-[560px]:fixed max-[560px]:inset-x-4 max-[560px]:top-16 max-[560px]:w-auto rounded-xl border border-rule-2 bg-sheet p-4 text-[14px] leading-relaxed text-ink-2 shadow-[0_30px_60px_-30px_rgba(18,20,25,0.45)]">
          {notice}
        </div>
      )}
    </div>
  );
}
