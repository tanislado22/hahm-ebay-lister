import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { InventoryScreen } from "../../inventario/screen";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export default async function StaffInventoryPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <Suspense
      fallback={
        <main>
          <p>Cargando inventario…</p>
        </main>
      }
    >
      <InventoryScreen
        lockedClientId={session.clientId}
        basePath="/guatemala/panel/inventario"
        reportsPath="/guatemala/panel/reportes"
        expensesPath="/guatemala/panel/gastos"
      />
    </Suspense>
  );
}
