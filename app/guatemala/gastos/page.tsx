import { Suspense } from "react";
import { cookies } from "next/headers";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { OWNER_COOKIE, ownerSessionValid } from "@/lib/owner-session";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { ExpensesScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function GuatemalaExpensesPage() {
  const jar = await cookies();
  const owner = ownerSessionValid(jar.get(OWNER_COOKIE)?.value);
  const session = owner ? null : await staffSessionFromToken(jar.get(STAFF_COOKIE)?.value);
  if (session && !session.canManageExpenses) {
    return (
      <main className="wrap">
        <h1>Gastos</h1>
        <p>No puedes ver ni registrar gastos o recuperaciones.</p>
      </main>
    );
  }
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
