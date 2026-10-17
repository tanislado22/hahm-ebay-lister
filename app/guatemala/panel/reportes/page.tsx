import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SalesReportScreen } from "../../reportes/screen";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export default async function StaffReportsPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <Suspense
      fallback={
        <main>
          <p>Cargando reportes…</p>
        </main>
      }
    >
      <SalesReportScreen
        lockedClientId={session.clientId}
        basePath="/guatemala/panel/reportes"
        inventoryPath="/guatemala/panel/inventario"
      />
    </Suspense>
  );
}
