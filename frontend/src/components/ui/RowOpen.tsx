import type { ReactNode } from "react";

type Props = { id?: string; label: string; pressed?: boolean; onOpen: () => void; children: ReactNode };

export function RowOpen({ id, label, pressed, onOpen, children }: Props) {
  return (
    <button
      type="button"
      id={id}
      className="row-open"
      aria-label={label}
      aria-pressed={pressed}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {children}
    </button>
  );
}
