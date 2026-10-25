import type { Metadata } from "next";
import { ComparacoesScreen } from "@/features/comparacoes/ComparacoesScreen";

export const metadata: Metadata = { title: "Comparações" };

export default function ComparacoesPage() {
  return <ComparacoesScreen />;
}
