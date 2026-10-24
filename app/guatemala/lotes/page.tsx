import { Suspense } from "react";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { LotsScreen } from "./screen";

export default function GuatemalaLotsPage() {
  return (
    <UnsavedChangesProvider>
      <Suspense fallback={<main className="wrap"><ReturnHomeBar role="propietario" /><p>Cargando lotes…</p></main>}>
        <LotsScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
