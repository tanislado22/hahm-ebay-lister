import { Suspense } from "react";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { InventoryScreen } from "./screen";

export default function GuatemalaInventoryPage() {
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <ReturnHomeBar role="propietario" />
            <p>Cargando inventario…</p>
          </main>
        }
      >
        <InventoryScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
