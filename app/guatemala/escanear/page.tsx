import { Suspense } from "react";
import { UnsavedChangesProvider } from "../return-home";
import { OwnerScan } from "./owner";

export const dynamic = "force-dynamic";

export default function OwnerScanPage() {
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <p>Cargando escáner…</p>
          </main>
        }
      >
        <OwnerScan />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
