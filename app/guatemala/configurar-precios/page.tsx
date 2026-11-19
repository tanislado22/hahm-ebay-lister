import { Suspense } from "react";
import { cookies } from "next/headers";
import { OWNER_COOKIE, ownerSessionValid } from "@/lib/owner-session";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { ReturnHomeBar, UnsavedChangesProvider } from "../return-home";
import { PricingSettingsScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function ConfigurePricesPage() {
  const jar = await cookies();
  const owner = ownerSessionValid(jar.get(OWNER_COOKIE)?.value);
  const session = owner ? null : await staffSessionFromToken(jar.get(STAFF_COOKIE)?.value);
  if (session) {
    return (
      <main className="wrap">
        <h1>Configurar precios</h1>
        <p>Solo el dueño puede configurar los precios.</p>
      </main>
    );
  }
  return (
    <UnsavedChangesProvider>
      <Suspense
        fallback={
          <main className="wrap">
            <ReturnHomeBar role="propietario" />
            <p>Cargando la configuración…</p>
          </main>
        }
      >
        <PricingSettingsScreen />
      </Suspense>
    </UnsavedChangesProvider>
  );
}
