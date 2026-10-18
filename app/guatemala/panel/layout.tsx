import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";
import { LogoutButton } from "./logout";
import "./panel.css";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  let session: Awaited<ReturnType<typeof staffSessionFromToken>> = null;
  try {
    session = await staffSessionFromToken(token);
  } catch {
    return (
      <main className="wrap">
        <p className="note note-error" role="alert">
          No se pudo comprobar tu sesión. Inténtalo de nuevo.
        </p>
      </main>
    );
  }
  if (!session) redirect("/guatemala/entrada");

  return (
    <div className="wrap gt-staff">
      <nav className="gt-staff-nav" aria-label="Encargado">
        <a className="btn btn-primary" href="/guatemala/panel/publicar">
          Publicar artículo
        </a>
        <a className="btn btn-primary" href="/guatemala/panel/inventario">
          Inventario
        </a>
        <a className="btn btn-primary" href="/guatemala/panel/reportes">
          Reportes de ventas
        </a>
        <a className="btn btn-primary" href="/guatemala/panel/gastos">
          Gastos
        </a>
        <LogoutButton />
      </nav>
      {children}
    </div>
  );
}
