import type { Metadata } from "next";
import { Suspense } from "react";
import { MapaScreen } from "@/features/mapa/MapaScreen";

export const metadata: Metadata = { title: "Mapa" };

export default function MapaPage() {
  return (
    <Suspense>
      <MapaScreen />
    </Suspense>
  );
}
