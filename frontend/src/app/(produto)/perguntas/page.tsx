import type { Metadata } from "next";
import { PerguntasScreen } from "@/features/perguntas/PerguntasScreen";

export const metadata: Metadata = { title: "Perguntas" };

export default function PerguntasPage() {
  return <PerguntasScreen />;
}
