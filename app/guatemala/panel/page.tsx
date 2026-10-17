import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export default async function StaffHomePage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <main>
      <h1>Tienda Guatemala</h1>
      <p>Hola, {session.username}. Desde aquí puedes ver el inventario, registrar ventas y consultar los reportes.</p>
    </main>
  );
}
