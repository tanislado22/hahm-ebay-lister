import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LotsScreen } from "../../lotes/screen";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export default async function StaffLotsPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <Suspense fallback={<p>Cargando lotes…</p>}>
      <LotsScreen lockedClientId={session.clientId} inventoryPath="/guatemala/panel/inventario" />
    </Suspense>
  );
}
