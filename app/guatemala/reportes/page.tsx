import { Suspense } from "react";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { SalesReportScreen } from "./screen";

export default function GuatemalaSalesReportPage() {
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <ReturnHomeBar role="propietario" />
            <p>Cargando reportes…</p>
          </main>
        }
      >
        <SalesReportScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
