import type { Metadata } from "next";
import { MapaScreen } from "@/features/mapa/MapaScreen";

export const metadata: Metadata = { title: "Mapa" };

export default function MapaPage() {
  return <MapaScreen />;
}
