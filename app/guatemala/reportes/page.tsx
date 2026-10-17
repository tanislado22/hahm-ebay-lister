import { Suspense } from "react";
import { SalesReportScreen } from "./screen";

export default function GuatemalaSalesReportPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <p>Cargando reportes…</p>
        </main>
      }
    >
      <SalesReportScreen />
    </Suspense>
  );
}
