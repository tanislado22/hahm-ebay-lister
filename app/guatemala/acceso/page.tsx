"use client";

import { useEffect, useState } from "react";
import { guatemalaRequest } from "../request";
import { ReturnHomeBar, UnsavedChangesProvider, useUnsavedChanges } from "../return-home";
import "../inventario/inventory.css";
import "../panel/panel.css";

interface StaffAccount {
  id: string;
  username: string;
  status: "activo" | "pendiente" | "desactivado";
  createdAt: string;
  canCorrectLots?: boolean;
  canVoidLots?: boolean;
  canManageExpenses?: boolean;
}

const STATUS_LABEL = {
  activo: "Activo",
  pendiente: "Invitación pendiente",
  desactivado: "Desactivado",
};

export default function OwnerStaffPage() {
  return (
    <UnsavedChangesProvider>
      <OwnerStaffScreen />
    </UnsavedChangesProvider>
  );
}

function OwnerStaffScreen() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState<{ username: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useUnsavedChanges(username.trim() !== "" || password !== "");

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
    setNotice("");
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "desactivar",
      accountId: account.id,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo desactivar la cuenta.");
      return;
    }
    setError("");
    await load();
  }

  async function savePermissions(
    account: StaffAccount,
    canCorrectLots: boolean,
    canVoidLots: boolean,
    canManageExpenses: boolean
  ) {
    setError("");
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "permisos",
      accountId: account.id,
      canCorrectLots,
      canVoidLots,
      canManageExpenses,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudieron guardar los permisos.");
      return;
    }
    await load();
  }

  async function reactivate(account: StaffAccount) {
    if (
      !window.confirm(
        `¿Reactivar la cuenta de ${account.username}? Conservará su usuario y contraseña, pero deberá iniciar sesión otra vez.`
      )
    ) {
      return;
    }
    setNotice("");
    setError("");
    const response = await guatemalaRequest("/api/markets/guatemala/staff", {
      action: "reactivar",
      accountId: account.id,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; username?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo reactivar la cuenta.");
      return;
    }
    setNotice(
      `La cuenta ${body.username || account.username} volvió a estar activa. El encargado debe iniciar sesión de nuevo.`
    );
    await load();
  }

  return (
    <main className="wrap gt-access">
      <ReturnHomeBar role="propietario" />
      <header>
        <h1>Administrar encargados</h1>
        <p>
          Crea, invita o desactiva cuentas solo de Tienda Guatemala. El encargado no entra aquí: inicia sesión en su
          propia pantalla. La contraseña no se guarda en texto plano y no vuelve a mostrarse.
        </p>
        <p>
          <a className="btn btn-ghost" href="/guatemala/entrada">
            Iniciar sesión como encargado
          </a>
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
        {notice ? (
          <p className="note" role="status">
            {notice}
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
              {account.status === "activo" ? (
                <span>
                  <label>
                    <input
                      type="checkbox"
                      checked={account.canCorrectLots === true}
                      onChange={(event) =>
                        void savePermissions(
                          account,
                          event.target.checked,
                          account.canVoidLots === true,
                          account.canManageExpenses === true
                        )
                      }
                    />
                    Corregir lotes
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={account.canVoidLots === true}
                      onChange={(event) =>
                        void savePermissions(
                          account,
                          account.canCorrectLots === true,
                          event.target.checked,
                          account.canManageExpenses === true
                        )
                      }
                    />
                    Anular lotes
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={account.canManageExpenses === true}
                      onChange={(event) =>
                        void savePermissions(
                          account,
                          account.canCorrectLots === true,
                          account.canVoidLots === true,
                          event.target.checked
                        )
                      }
                    />
                    Gastos y recuperaciones
                  </label>
                </span>
              ) : null}
              {account.status === "desactivado" ? (
                <button type="button" className="btn btn-primary" onClick={() => void reactivate(account)}>
                  Reactivar
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => void deactivate(account)}>
                  Desactivar
                </button>
              )}
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
