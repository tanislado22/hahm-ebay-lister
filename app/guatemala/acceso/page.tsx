"use client";

import { useEffect, useState } from "react";
import { guatemalaRequest } from "../request";
import "../inventario/inventory.css";
import "../panel/panel.css";

interface StaffAccount {
  id: string;
  username: string;
  status: "activo" | "pendiente" | "desactivado";
  createdAt: string;
}

const STATUS_LABEL = {
  activo: "Activo",
  pendiente: "Invitación pendiente",
  desactivado: "Desactivado",
};

export default function OwnerStaffPage() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{ username: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await guatemalaRequest("/api/markets/guatemala/staff");
      const body = (await response.json()) as { ok?: boolean; error?: string; accounts?: StaffAccount[] };
      if (!response.ok || !body.ok || !body.accounts) {
        setAccounts([]);
        setError(body.error || "No se pudieron cargar las cuentas.");
        return;
      }
      setAccounts(body.accounts);
    } catch {
      setAccounts([]);
      setError("No se pudieron cargar las cuentas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setInvite(null);
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "crear",
      username,
      password,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo crear la cuenta.");
      return;
    }
    setUsername("");
    setPassword("");
    await load();
  }

  async function inviteAccount() {
    setError("");
    setInvite(null);
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "invitar",
      username,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; username?: string; code?: string };
    if (!response.ok || !body.ok || !body.code || !body.username) {
      setError(body.error || "No se pudo crear la invitación.");
      return;
    }
    setInvite({ username: body.username, code: body.code });
    setUsername("");
    setPassword("");
    await load();
  }

  async function deactivate(account: StaffAccount) {
    if (!window.confirm(`¿Desactivar el acceso de ${account.username}? Sus sesiones abiertas dejarán de funcionar.`)) {
      return;
    }
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "desactivar",
      accountId: account.id,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo desactivar la cuenta.");
      return;
    }
    await load();
  }

  return (
    <main className="wrap gt-access">
      <header>
        <h1>Acceso del encargado</h1>
        <p>
          Crea o invita una cuenta solo para Tienda Guatemala. La contraseña no se guarda en texto plano y no vuelve a
          mostrarse.
        </p>
      </header>
      <section className="panel">
        <form onSubmit={(event) => void createAccount(event)}>
          <label>
            Usuario
            <input
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mínimo 10 caracteres"
            />
          </label>
          <div className="gt-inventory-actions">
            <button className="btn btn-primary" type="submit">
              Crear cuenta
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => void inviteAccount()}>
              Crear invitación
            </button>
          </div>
        </form>
        {invite ? (
          <p className="note">
            Invitación de {invite.username}. Entrégala una sola vez. Código:{" "}
            <span className="gt-invite-code">{invite.code}</span>
          </p>
        ) : null}
        {error ? (
          <p className="note note-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p>Cargando cuentas…</p> : null}
        <div>
          {accounts.map((account) => (
            <div key={account.id} className="gt-account-row">
              <span>
                <strong>{account.username}</strong>
                <br />
                {STATUS_LABEL[account.status]}
              </span>
              {account.status !== "desactivado" ? (
                <button type="button" className="btn btn-ghost" onClick={() => void deactivate(account)}>
                  Desactivar
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <a className="btn btn-ghost" href="/">
          Volver a las prendas
        </a>
      </section>
    </main>
  );
}
