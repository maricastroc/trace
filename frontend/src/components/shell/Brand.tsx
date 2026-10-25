import Link from "next/link";

export function Brand() {
  return (
    <Link href="/mapa" className="inline-flex items-center gap-2.5 text-ink no-underline" aria-label="Trace, ir para o mapa">
      <svg viewBox="0 0 30 30" className="size-[30px]" aria-hidden>
        <circle cx="12" cy="15" r="8" fill="var(--a)" />
        <circle cx="18" cy="15" r="8" fill="var(--b)" style={{ mixBlendMode: "multiply" }} />
        <path d="M15 1.5v6M15 22.5v6M1.5 15h3M25.5 15h3" stroke="var(--ink)" strokeWidth="1.3" />
      </svg>
      <span className="font-display text-[23px] leading-none font-bold tracking-[-0.03em] max-[560px]:sr-only">Trace</span>
    </Link>
  );
}
