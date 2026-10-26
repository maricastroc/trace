"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type PopOption = {
  id: string;
  label: string;
  hint?: string;
  value?: ReactNode;
  unavailable?: string;
  selected?: boolean;
  section?: string;
  onSelect: () => void;
};

type Props = {
  title: string;
  options: PopOption[];
  anchor: HTMLElement;
  container: HTMLElement;
  onClose: (refocus: boolean) => void;
  footer?: ReactNode;
};

const FILTER_FROM = 12;

export function TokenPopover({ title, options, anchor, container, onClose, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const shown = useMemo(() => {
    const text = filter.trim().toLocaleLowerCase("pt-BR");
    if (!text) return options;
    return options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLocaleLowerCase("pt-BR").includes(text));
  }, [options, filter]);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const width = ref.current?.offsetWidth ?? 460;
      setPosition({ left: Math.max(0, Math.min(a.left - c.left, c.width - width)), top: a.bottom - c.top + 10 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, container]);

  useEffect(() => {
    const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    if (options.length > FILTER_FROM) filterRef.current?.focus();
    else (items().find((item) => item.getAttribute("aria-selected") === "true") ?? items()[0])?.focus();
  }, [options.length]);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [anchor, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      (items[Math.min(items.length - 1, index + 1)] ?? items[0])?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0 && filterRef.current) filterRef.current.focus();
      else items[Math.max(0, index - 1)]?.focus();
    } else if (event.key === "Enter" && document.activeElement === filterRef.current && items.length > 0) {
      event.preventDefault();
      items[0].click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") {
      onClose(false);
    }
  };

  const sections: { name: string | undefined; items: PopOption[] }[] = [];
  for (const option of shown) {
    const last = sections[sections.length - 1];
    if (last && last.name === option.section) last.items.push(option);
    else sections.push({ name: option.section, items: [option] });
  }

  return (
    <div ref={ref} className="pop" style={position ?? { left: 0, top: 0, opacity: 0 }} onKeyDown={onKeyDown}>
      <h4>{title}</h4>
      {options.length > FILTER_FROM && (
        <input
          ref={filterRef}
          type="search"
          className="pop-filter"
          placeholder={`Filtrar ${options.length} opções`}
          aria-label={`Filtrar: ${title.toLocaleLowerCase("pt-BR")}`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <div className="pop-list">
        {sections.map((section, i) => (
          <div key={`${section.name ?? "s"}-${i}`}>
            {section.name && <h5>{section.name}</h5>}
            <ul role="listbox" aria-label={section.name ?? title}>
              {section.items.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.selected === true}
                    aria-disabled={option.unavailable ? true : undefined}
                    onClick={() => {
                      if (option.unavailable) return;
                      option.onSelect();
                      onClose(true);
                    }}
                  >
                    <span className="ol">{option.label}</span>
                    {option.hint && <span className="os">{option.hint}</span>}
                    {option.unavailable ? <span className="on na">{option.unavailable}</span> : option.value !== undefined ? <span className="on">{option.value}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {shown.length === 0 && <p className="pop-foot">Nenhuma opção com esse texto.</p>}
      </div>
      {footer && <div className="pop-foot">{footer}</div>}
    </div>
  );
}
