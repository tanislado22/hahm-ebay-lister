import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { PublishScreen } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Publicar artículo · Tienda Guatemala",
};

export default async function PublishPage() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await staffSessionFromToken(token);
  if (!session) redirect("/guatemala/entrada");
  return <PublishScreen clientId={session.clientId} />;
}
