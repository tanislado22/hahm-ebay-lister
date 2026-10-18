import { Suspense } from "react";
import { ExpensesScreen } from "./screen";

export default function GuatemalaExpensesPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <p>Cargando gastos…</p>
        </main>
      }
    >
      <ExpensesScreen />
    </Suspense>
  );
}
