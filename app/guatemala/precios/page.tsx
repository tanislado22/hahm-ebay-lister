import { Suspense } from "react";
import { PriceGuideScreen } from "./screen";

export default function GuatemalaPriceGuidePage() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <p>Cargando la tabla de precios…</p>
        </main>
      }
    >
      <PriceGuideScreen />
    </Suspense>
  );
}
