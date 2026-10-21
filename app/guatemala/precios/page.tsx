import { Suspense } from "react";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { PriceGuideScreen } from "./screen";

export default function GuatemalaPriceGuidePage() {
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <ReturnHomeBar role="propietario" />
            <p>Cargando la tabla de precios…</p>
          </main>
        }
      >
        <PriceGuideScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
