"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/guatemala/sesion", { method: "DELETE" });
    window.location.href = "/guatemala/entrada";
  }

  return (
    <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
      Cerrar sesión
    </button>
  );
}
