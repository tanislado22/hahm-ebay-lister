import { Suspense } from "react";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { ExpensesScreen } from "./screen";

export default function GuatemalaExpensesPage() {
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <ReturnHomeBar role="propietario" />
            <p>Cargando gastos…</p>
          </main>
        }
      >
        <ExpensesScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
