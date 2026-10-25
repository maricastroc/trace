import type { MapColumn } from "../model/graph";

const PATHS = {
  key: <path d="M6.5 9.5a3 3 0 1 1 2.6-1.5L15 14m-2.2-2.2L14 10.6m-3.4-.8l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  link: (
    <path
      d="M7 11l4-4M6 8.5L4.6 9.9a2.5 2.5 0 0 0 3.5 3.5L9.5 12M12 9.5l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L8.5 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  date: (
    <>
      <rect x="3" y="4.5" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8h12M6.5 3v3M11.5 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  number: <path d="M7 3.5L5.5 14.5M12.5 3.5L11 14.5M3.5 7h12M3 11h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  text: (
    <path
      d="M3 13.5L6.5 4.5l3.5 9M4.3 10.5h4.4M12 9.2c.5-.6 1.2-.9 2-.9 1.2 0 2 .8 2 2v3.2m0-2.2c-.6-.4-1.3-.6-2-.6-1.1 0-1.9.6-1.9 1.5s.7 1.4 1.6 1.4c1 0 2.3-.8 2.3-2.3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export const TYPE_WORDS: Record<string, string> = { identifier: "identificador", text: "texto", number: "número", date: "data" };

export function FieldIcon({ column, size = 20 }: { column: Pick<MapColumn, "role" | "type">; size?: number }) {
  const name = column.role === "key" ? "key" : column.role === "fk" ? "link" : column.type === "date" ? "date" : column.type === "number" ? "number" : "text";
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
