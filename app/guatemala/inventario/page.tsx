import { Suspense } from "react";
import { InventoryScreen } from "./screen";

export default function GuatemalaInventoryPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <p>Cargando inventario…</p>
        </main>
      }
    >
      <InventoryScreen />
    </Suspense>
  );
}
