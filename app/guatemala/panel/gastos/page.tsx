import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ExpensesScreen } from "../../gastos/screen";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export default async function StaffExpensesPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <Suspense
      fallback={
        <main>
          <p>Cargando gastos…</p>
        </main>
      }
    >
      <ExpensesScreen
        lockedClientId={session.clientId}
        basePath="/guatemala/panel/gastos"
        inventoryPath="/guatemala/panel/inventario"
        reportsPath="/guatemala/panel/reportes"
      />
    </Suspense>
  );
}
