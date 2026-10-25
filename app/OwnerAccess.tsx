"use client";

import { FormEvent, ReactNode, createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { readAccessCode, rememberAccessCode } from "@/lib/api-client";
import { ownerAccessMessage } from "@/lib/owner-access-messages";
import { REJECTED_OWNER_CODE } from "@/lib/owner-code";

type Phase = "checking" | "signed-in" | "signed-out";

const AccessLostContext = createContext<(message: string) => void>(() => undefined);

export function useOwnerAccessLost(): (message: string) => void {
  return useContext(AccessLostContext);
}

export function OwnerAccess({ nextHref, children }: { nextHref?: string; children?: ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const probe = await requestSession(controller.signal);
        if (controller.signal.aborted) return;
        if (probe.ok) {
          setPhase("signed-in");
          setMessage("");
          return;
        }
        if (probe.code === "SESSION_EXPIRED") {
          setMessage(ownerAccessMessage(probe.status, probe.code));
        }
        const saved = readAccessCode();
        if (saved) {
          const exchanged = await requestSession(controller.signal, saved);
          if (controller.signal.aborted) return;
          if (exchanged.ok) {
            setPhase("signed-in");
            setMessage("");
            return;
          }
          setMessage(ownerAccessMessage(exchanged.status, exchanged.code));
        }
        setPhase("signed-out");
      } catch {
        if (controller.signal.aborted) return;
        setMessage("No se pudo comprobar el acceso del propietario.");
        setPhase("signed-out");
      }
    })();
    return () => controller.abort();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const entered = code.trim();
    if (!entered) {
      setMessage("Escribe el código de acceso del propietario.");
      return;
    }
    if (entered === REJECTED_OWNER_CODE) {
      setMessage("Ese valor de prueba no es una credencial válida.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestSession(undefined, entered);
      if (result.ok) {
        if (result.remember) rememberAccessCode(entered);
        setCode("");
        setMessage("");
        setPhase("signed-in");
        return;
      }
      setMessage(ownerAccessMessage(result.status, result.code));
    } catch {
      setMessage("No se pudo comprobar el acceso del propietario.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "checking") {
    return <p className="note">Comprobando el acceso del propietario…</p>;
  }

  if (phase === "signed-in") {
    return (
      <AccessLostContext.Provider
        value={(notice) => {
          setMessage(notice);
          setPhase("signed-out");
        }}
      >
        {nextHref && pathname !== nextHref ? (
          <section className="panel">
            <p>Acceso del propietario activo en este navegador.</p>
            <p>
              <a className="btn btn-primary" href={nextHref} style={{ marginLeft: 0 }}>
                Abrir vínculos de eBay
              </a>
            </p>
          </section>
        ) : null}
        {children}
      </AccessLostContext.Provider>
    );
  }

  return (
    <section className="panel">
      <h2>Acceso del propietario</h2>
      <p>Entra en este navegador. Visitar la página principal no crea el acceso por sí sola.</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <div className="field">
          <label htmlFor="owner-access-code">Código de acceso</label>
          <input
            id="owner-access-code"
            name="owner-access-code"
            type="password"
            autoComplete="current-password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            style={{
              font: "inherit",
              color: "var(--color-ink)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding: "0.6rem 0.7rem",
              width: "min(100%, 28rem)",
            }}
          />
        </div>
        {message ? (
          <p className="note note-error" role="alert">
            {message}
          </p>
        ) : null}
        <p>
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginLeft: 0 }}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </p>
      </form>
      <details>
        <summary>No tengo el código de acceso</summary>
        <p>
          Vercel no vuelve a mostrar APP_SECRET. Crea la variable OWNER_RECOVERY_CODE con un código nuevo, en el
          entorno de esta página, y redespliega sin cambiar APP_SECRET. Entra aquí con ese código: abre la misma
          sesión durante 14 días. Conserva el código, porque no queda guardado en este navegador.
        </p>
      </details>
    </section>
  );
}

async function requestSession(
  signal: AbortSignal | undefined,
  code?: string
): Promise<{ ok: boolean; status: number; code?: string; remember?: boolean }> {
  const headers: Record<string, string> = {};
  const init: RequestInit = {
    method: code === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    signal,
  };
  if (code !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ code });
  }
  const response = await fetch("/api/owner-session", init);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; remember?: boolean } | null;
  return {
    ok: response.ok && body?.ok === true,
    status: response.status,
    code: body?.code,
    remember: body?.remember === true,
  };
}
