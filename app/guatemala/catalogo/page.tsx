import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogScreen } from "./screen";

export const metadata: Metadata = {
  title: "Catálogo · Tienda Guatemala",
  description: "Prendas disponibles de Tienda Guatemala.",
};

export default function GuatemalaCatalogPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <p>Cargando catálogo…</p>
        </main>
      }
    >
      <CatalogScreen />
    </Suspense>
  );
}
