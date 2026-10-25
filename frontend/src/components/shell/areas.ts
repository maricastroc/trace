export const AREAS = [
  { href: "/mapa", label: "Mapa" },
  { href: "/perguntas", label: "Perguntas" },
  { href: "/comparacoes", label: "Comparações" },
] as const;

export function isCurrentArea(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
