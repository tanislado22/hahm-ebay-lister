"use client";

import { useState } from "react";
import { formatGuatemalaMoment } from "@/lib/markets/guatemala";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import type { PurgeCounts, PurgeGarment } from "@/lib/markets/guatemala-purge";
import { useUnsavedChanges } from "../return-home";

export function PurgePanel({
  clientId,
  request,
}: {
  clientId: string;
  request: (path: string, body?: unknown) => Promise<Response>;
}) {
  const [open, setOpen] = useState(false);
  const [garments, setGarments] = useState<PurgeGarment[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [plan, setPlan] = useState<PurgeGarment[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [typed, setTyped] = useState("");
  const [counts, setCounts] = useState<PurgeCounts | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useUnsavedChanges(open && (chosen.length > 0 || typed.trim() !== "" || plan !== null));

  async function loadChoices() {
    setBusy(true);
    setError("");
    setDone("");
    setPlan(null);
    try {
      const response = await request("/api/markets/guatemala/inventory/purge", {
        clientId,
        action: "revisar",
        itemIds: [],
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; garments?: PurgeGarment[] };
      if (!response.ok || !body.ok || !body.garments) {
        setError(body.error || "No se pudo revisar el inventario.");
        return;
      }
      setGarments(body.garments);
      setChosen(body.garments.filter((garment) => garment.suggested).map((garment) => garment.id));
      setOpen(true);
    } catch {
      setError("No se pudo revisar el inventario.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewChosen() {
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/markets/guatemala/inventory/purge", {
        clientId,
        action: "revisar",
        itemIds: chosen,
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        garments?: PurgeGarment[];
        confirmText?: string;
        counts?: PurgeCounts;
      };
      if (!response.ok || !body.ok || !body.garments || !body.counts) {
        setError(body.error || "No se pudo preparar el resumen.");
        return;
      }
      setPlan(body.garments);
      setConfirmText(body.confirmText || "");
      setCounts(body.counts);
      setTyped("");
    } catch {
      setError("No se pudo preparar el resumen.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!counts || typed !== confirmText) return;
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/markets/guatemala/inventory/purge", {
        clientId,
        action: "confirmar",
        itemIds: chosen,
        confirmText: typed,
        expected: counts,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; removed?: PurgeGarment[] };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se eliminó nada.");
        setPlan(null);
        return;
      }
      setDone(`Se eliminaron ${body.removed?.length ?? 0} prendas de Tienda Guatemala.`);
      setPlan(null);
      setOpen(false);
    } catch {
      setError("No se eliminó nada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gt-sale-box" aria-labelledby="purge-heading">
      <h3 id="purge-heading">Eliminar artículos de prueba</h3>
      <p>Solo el propietario puede hacerlo. No borra My Store ni otras tiendas.</p>
      {done ? <p>{done}</p> : null}
      {error ? <p className="note note-error" role="alert">{error}</p> : null}
      {!open ? (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void loadChoices()}>
          {busy ? "Revisando…" : "Revisar qué se puede eliminar"}
        </button>
      ) : (
        <>
          {garments.map((garment) => (
            <label key={garment.id} className="gt-inventory-search">
              <input
                type="checkbox"
                checked={chosen.includes(garment.id)}
                onChange={(event) => {
                  setPlan(null);
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, garment.id]
                      : current.filter((id) => id !== garment.id)
                  );
                }}
              />
              {` SKU ${garment.sku} · ${garment.title || "Prenda sin título"} · ${garment.status}${garment.suggested ? " · prueba" : ""}`}
            </label>
          ))}
          <div className="gt-inventory-actions">
            <button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => void reviewChosen()}>
              Ver resumen
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {plan && counts ? (
        <div>
          <h3>Esto se eliminaría</h3>
          <p>
            {counts.garments} prendas, {counts.photos} fotos, {counts.sales} ventas y {counts.corrections} registros de historial.
          </p>
          {plan.map((garment) => (
            <div key={garment.id}>
              <p>
                SKU {garment.sku}. {garment.title || "Prenda sin título"}. {garment.status}. Precio publicado{" "}
                {formatStoredQuetzales(garment.priceGtq)}. {garment.photos.length} fotos.
              </p>
              {garment.sales.map((sale) => (
                <p key={sale.id}>
                  Venta {sale.isTest ? "de prueba" : "real"}
                  {sale.voidedAt ? ", anulada" : ""}. Publicado {formatStoredQuetzales(sale.publishedPriceGtq)}. Cobrado{" "}
                  {formatStoredQuetzales(sale.currentChargedPriceGtq || sale.chargedPriceGtq)}.{" "}
                  {formatGuatemalaMoment(sale.soldAt)}. Registrada por{" "}
                  {sale.soldByRole === "encargado" && sale.soldByUsername
                    ? sale.soldByUsername
                    : sale.soldByRole === "propietario"
                      ? "Propietario"
                      : "sin autor guardado"}
                  .
                </p>
              ))}
              {garment.corrections.map((correction) => (
                <p key={correction.id}>
                  Historial {correction.action}. Antes {formatStoredQuetzales(correction.previousChargedPriceGtq)}
                  {correction.newChargedPriceGtq
                    ? `. Ahora ${formatStoredQuetzales(correction.newChargedPriceGtq)}`
                    : ". Venta anulada"}
                  . {formatGuatemalaMoment(correction.createdAt)}. Motivo: {correction.reason}.
                </p>
              ))}
              {garment.sales.length === 0 ? <p>Sin ventas.</p> : null}
            </div>
          ))}
          <p>Para confirmar, escribe exactamente: {confirmText}</p>
          <input
            type="text"
            value={typed}
            autoComplete="off"
            aria-label="Texto de confirmación"
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="gt-inventory-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || typed !== confirmText}
              onClick={() => void confirm()}
            >
              {busy ? "Eliminando…" : "Confirmar eliminación"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
