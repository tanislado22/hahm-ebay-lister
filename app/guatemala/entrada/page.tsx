"use client";

import { useState } from "react";
import "../inventario/inventory.css";
import "../panel/panel.css";

export default function StaffEntryPage() {
  const [mode, setMode] = useState<"entrar" | "invitar">("entrar");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(mode === "entrar" ? "/api/guatemala/sesion" : "/api/guatemala/invitacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "entrar" ? { username, password } : { username, code, password }
        ),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(response.status === 429 ? "Demasiados intentos. Espera un minuto." : body.error || "No se pudo entrar.");
        return;
      }
      window.location.href = "/guatemala/panel";
    } catch {
      setError("No se pudo entrar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="wrap gt-entry">
      <header>
        <h1>Iniciar sesión como encargado</h1>
        <p>
          Esta pantalla es solo para entrar con tu usuario de Tienda Guatemala. No administra cuentas ni pide el código del
          propietario.
        </p>
      </header>
      <section className="panel">
        <div className="gt-inventory-filters" role="group" aria-label="Forma de entrada">
          <button type="button" className="gt-filter" aria-pressed={mode === "entrar"} onClick={() => setMode("entrar")}>
            Ya tengo cuenta
          </button>
          <button type="button" className="gt-filter" aria-pressed={mode === "invitar"} onClick={() => setMode("invitar")}>
            Tengo una invitación
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Usuario
            <input
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          {mode === "invitar" ? (
            <label>
              Código de invitación
              <input
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            Contraseña
            <input
              type="password"
              autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {mode === "invitar" ? <p>Elige una contraseña de al menos 10 caracteres.</p> : null}
          {error ? (
            <p className="note note-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Entrando…" : mode === "entrar" ? "Entrar" : "Crear contraseña y entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
