import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { ScanScreen } from "../../escanear/screen";

export const dynamic = "force-dynamic";

export default async function StaffScanPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return <ScanScreen clientId={session.clientId} actor="encargado" />;
}
