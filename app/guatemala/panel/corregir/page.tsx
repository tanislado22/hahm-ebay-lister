import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { CorrectScreen } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Corregir artículo · Tienda Guatemala",
};

export default async function CorrectPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return (
    <Suspense fallback={<p>Cargando la prenda…</p>}>
      <CorrectScreen clientId={session.clientId} />
    </Suspense>
  );
}
