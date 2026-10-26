import type { Metadata } from "next";
import { Suspense } from "react";
import { ComparacoesScreen } from "@/features/comparacoes/ComparacoesScreen";

export const metadata: Metadata = { title: "Comparações" };

export default function ComparacoesPage() {
  return (
    <Suspense>
      <ComparacoesScreen />
    </Suspense>
  );
}
