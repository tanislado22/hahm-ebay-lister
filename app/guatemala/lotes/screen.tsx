"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { ReturnHomeBar, useUnsavedChanges } from "../return-home";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import { guatemalaTodayKey } from "@/lib/markets/guatemala-expenses";
import {
  GUATEMALA_LOT_EXPENSE_CATEGORIES,
  GUATEMALA_LOT_MESSAGES,
  lotExpenseCategoryLabel,
  lotFieldEnterSubmits,
} from "@/lib/markets/guatemala-lots";
import "../inventario/inventory.css";

function keepEnterInNotes(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  const target = event.target;
  const field = target instanceof HTMLTextAreaElement ? "notes" : target instanceof HTMLButtonElement ? "save" : "line";
  if (lotFieldEnterSubmits(field)) return;
  event.preventDefault();
}

interface LotExpense {
  id: string;
  spentOn: string;
  category: string;
  description: string;
  amountGtq: string;
  payee: string;
  status: "activo" | "anulado";
  createdByUsername: string | null;
}

interface PurchaseLot {
  id: string;
  lotNumber: number;
  name: string;
  receivedOn: string;
  supplier: string;
  weightText: string;
  notes: string;
  sellableCount: number | null;
  status: "activo" | "anulado";
  totalGtq: string;
  averageLabel: string;
  registeredCount: number;
  availableCount: number;
  soldCount: number;
  createdByUsername: string | null;
  updatedByUsername: string | null;
  expenses: LotExpense[];
}

interface LotPermissions {
  write: boolean;
  correct: boolean;
  void: boolean;
  remove: boolean;
}

export function LotsScreen({
  lockedClientId,
  inventoryPath = "/guatemala/inventario",
}: {
  lockedClientId?: string;
  inventoryPath?: string;
} = {}) {
  const staffMode = Boolean(lockedClientId);
  const params = useSearchParams();
  const clientId = lockedClientId || params.get("clientId") || "";
  const [lots, setLots] = useState<PurchaseLot[]>([]);
  const [permissions, setPermissions] = useState<LotPermissions>({ write: false, correct: false, void: false, remove: false });
  const [showVoided, setShowVoided] = useState(false);
  const [note, setNote] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [lotForm, setLotForm] = useState({ name: "", receivedOn: "", lotNumber: "", supplier: "", weight: "", notes: "", sellableCount: "" });
  const [expenseForm, setExpenseForm] = useState({ spentOn: "", category: "", description: "", amount: "", payee: "" });
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editForm, setEditForm] = useState({ spentOn: "", category: "", description: "", amount: "", payee: "" });
  const [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false);

  function storeRequest(path: string, body?: unknown) {
    return guatemalaRequest(path, body, staffMode ? { actor: "encargado" } : undefined);
  }

  const dirty = creating
    ? Object.values(lotForm).some((value) => value.trim() !== "")
    : Boolean(editingExpenseId) || Object.values(expenseForm).some((value) => value.trim() !== "");
  useUnsavedChanges(dirty || saving);

  async function load() {
    if (!clientId) {
      setError("Selecciona Tienda Guatemala para ver sus lotes.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await storeRequest(`/api/markets/guatemala/lots?clientId=${encodeURIComponent(clientId)}`);
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        lots?: PurchaseLot[];
        note?: string;
        permissions?: LotPermissions;
      };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudieron cargar los lotes.");
        return;
      }
      setLots(body.lots ?? []);
      setNote(body.note || GUATEMALA_LOT_MESSAGES.notProfit);
      setPermissions(body.permissions ?? { write: false, correct: false, void: false, remove: false });
      setError("");
    } catch {
      setError("No se pudieron cargar los lotes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // The client id comes from the session or the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const selected = lots.find((lot) => lot.id === selectedId) ?? null;

  async function createLot(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "crear",
      clientId,
      name: lotForm.name,
      lotNumber: lotForm.lotNumber,
      receivedOn: lotForm.receivedOn,
      supplier: lotForm.supplier,
      weight: lotForm.weight,
      notes: lotForm.notes,
      sellableCount: lotForm.sellableCount,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string; lot?: PurchaseLot };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo guardar el lote.");
      return;
    }
    setCreating(false);
    setLotForm({ name: "", receivedOn: "", lotNumber: "", supplier: "", weight: "", notes: "", sellableCount: "" });
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.saved);
    if (body.lot) setSelectedId(body.lot.id);
    await load();
  }

  async function addExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "gasto",
      clientId,
      lotId: selected.id,
      requestId: id,
      spentOn: expenseForm.spentOn,
      category: expenseForm.category,
      description: expenseForm.description,
      amount: expenseForm.amount,
      payee: expenseForm.payee,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo guardar el gasto.");
      return;
    }
    setRequestId("");
    setExpenseForm({ spentOn: guatemalaTodayKey(), category: "", description: "", amount: "", payee: "" });
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.expenseSaved);
    await load();
  }

  async function correctCount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "corregir",
      clientId,
      lotId: selected.id,
      name: selected.name,
      receivedOn: selected.receivedOn,
      supplier: selected.supplier,
      weight: selected.weightText,
      notes: selected.notes,
      sellableCount: String(form.get("sellableCount") ?? ""),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo corregir el lote.");
      return;
    }
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.lotUpdated);
    await load();
  }

  async function correctExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!editingExpenseId) return;
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "corregir-gasto",
      clientId,
      expenseId: editingExpenseId,
      spentOn: editForm.spentOn,
      category: editForm.category,
      description: editForm.description,
      amount: editForm.amount,
      payee: editForm.payee,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo corregir el gasto.");
      return;
    }
    setEditingExpenseId("");
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.expenseUpdated);
    await load();
  }

  async function voidLot() {
    if (!selected) return;
    if (!window.confirm("¿Anular este lote? Su número no se volverá a usar.")) return;
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "anular",
      clientId,
      lotId: selected.id,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo anular el lote.");
      return;
    }
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.lotVoided);
    await load();
  }

  async function deleteEmptyLot() {
    if (!selected || !permissions.remove) return;
    const confirmed = window.confirm(
      `¿Eliminar definitivamente el lote ${selected.lotNumber}, «${selected.name}»? Solo se borra si nunca tuvo artículos, gastos, ventas ni SKU. El número quedará libre.`
    );
    if (!confirmed) return;
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "eliminar",
      clientId,
      lotId: selected.id,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo eliminar el lote.");
      return;
    }
    setSelectedId("");
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.lotDeleted);
    await load();
  }

  async function voidExpense(expenseId: string) {
    if (!window.confirm("¿Anular este gasto? Dejará de sumar al lote y al registro de gastos.")) return;
    setSaving(true);
    const response = await storeRequest("/api/markets/guatemala/lots", {
      action: "anular-gasto",
      clientId,
      expenseId,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    setSaving(false);
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo anular el gasto.");
      return;
    }
    setNotice(body.message || GUATEMALA_LOT_MESSAGES.expenseVoidedNotice);
    await load();
  }

  return (
    <main className="wrap gt-inventory">
      {staffMode ? null : <ReturnHomeBar role="propietario" />}
      <header>
        <h1>Lotes de compra</h1>
        <p>Costos de compra de Tienda Guatemala. El precio de venta de cada prenda no cambia al agregar gastos.</p>
      </header>
      {note ? <p className="note" role="status">{note}</p> : null}
      {error ? <p className="note note-error" role="alert">{error}</p> : null}
      {notice ? <p className="note" role="status">{notice}</p> : null}
      {loading ? <p>Cargando lotes…</p> : null}
      <p>
        <a className="btn btn-ghost" href={staffMode ? inventoryPath : `${inventoryPath}?clientId=${encodeURIComponent(clientId)}`}>
          Inventario
        </a>
      </p>
      {permissions.write ? (
        <p>
          <button type="button" className="btn btn-primary" onClick={() => {
            setCreating((open) => !open);
            setLotForm((form) => ({ ...form, receivedOn: form.receivedOn || guatemalaTodayKey() }));
          }}>
            Nuevo lote
          </button>
        </p>
      ) : null}
      {creating ? (
        <form className="panel gt-lot-form" onKeyDown={keepEnterInNotes} onSubmit={(event) => void createLot(event)}>
          <label>
            <span>Nombre</span>
            <input value={lotForm.name} onChange={(event) => setLotForm({ ...lotForm, name: event.target.value })} required />
          </label>
          <label>
            <span>Fecha</span>
            <input type="date" value={lotForm.receivedOn} onChange={(event) => setLotForm({ ...lotForm, receivedOn: event.target.value })} required />
          </label>
          <label>
            <span>Número de lote</span>
            <input inputMode="numeric" value={lotForm.lotNumber} onChange={(event) => setLotForm({ ...lotForm, lotNumber: event.target.value })} />
            <span className="gt-lot-hint">Opcional. Si lo dejas vacío, se usa el siguiente número libre.</span>
          </label>
          <label>
            <span>Proveedor</span>
            <input value={lotForm.supplier} onChange={(event) => setLotForm({ ...lotForm, supplier: event.target.value })} />
            <span className="gt-lot-hint">Opcional.</span>
          </label>
          <label>
            <span>Peso</span>
            <input value={lotForm.weight} onChange={(event) => setLotForm({ ...lotForm, weight: event.target.value })} placeholder="Por ejemplo 25.4" />
            <span className="gt-lot-hint">Opcional.</span>
          </label>
          <label>
            <span>Cantidad vendible</span>
            <input inputMode="numeric" value={lotForm.sellableCount} onChange={(event) => setLotForm({ ...lotForm, sellableCount: event.target.value })} />
            <span className="gt-lot-hint">Opcional. Puede quedar pendiente hasta terminar el conteo.</span>
          </label>
          <label className="gt-lot-notes">
            <span>Notas</span>
            <textarea value={lotForm.notes} onChange={(event) => setLotForm({ ...lotForm, notes: event.target.value })} rows={5} />
          </label>
          <div className="gt-lot-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar lote"}</button>
          </div>
        </form>
      ) : null}
      <div className="gt-inventory-filters" role="group" aria-label="Lotes">
        <button
          type="button"
          className="gt-filter"
          aria-pressed={showVoided}
          onClick={() => {
            setShowVoided((open) => !open);
            if (showVoided && selected?.status === "anulado") setSelectedId("");
          }}
        >
          Ver anulados
        </button>
        {lots.filter((lot) => showVoided || lot.status === "activo").map((lot) => (
          <button key={lot.id} type="button" className="gt-filter" aria-pressed={lot.id === selectedId} onClick={() => {
            setSelectedId(lot.id);
            setEditingExpenseId("");
            setExpenseForm((form) => ({ ...form, spentOn: form.spentOn || guatemalaTodayKey() }));
          }}>
            Lote {lot.lotNumber} · {lot.name}{lot.status === "anulado" ? " · anulado" : ""}
          </button>
        ))}
      </div>
      {selected ? (
        <section className="panel">
          <h2>Lote {selected.lotNumber}: {selected.name}</h2>
          <p>{selected.receivedOn}{selected.supplier ? ` · ${selected.supplier}` : ""}{selected.weightText ? ` · ${selected.weightText}` : ""}</p>
          {selected.createdByUsername ? <p>Creado por {selected.createdByUsername}</p> : null}
          {selected.updatedByUsername ? <p>Último cambio por {selected.updatedByUsername}</p> : null}
          <p>Total invertido hasta hoy {formatStoredQuetzales(selected.totalGtq)}</p>
          <p>Costo promedio por prenda {selected.averageLabel}</p>
          <p>Cantidad vendible {selected.sellableCount ?? "Pendiente de conteo"}</p>
          <p>Registrados {selected.registeredCount} · Disponibles {selected.availableCount} · Vendidos {selected.soldCount}</p>
          {selected.status === "anulado" ? <p>Lote anulado. El número se conserva.</p> : null}
          {selected.notes ? <p className="gt-lot-saved-notes">{selected.notes}</p> : null}
          {permissions.void && selected.status === "activo" ? (
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void voidLot()}>Anular lote</button>
          ) : null}
          {permissions.remove ? (
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void deleteEmptyLot()}>
              Eliminar lote vacío
            </button>
          ) : null}
          {permissions.correct && selected.status === "activo" ? (
            <form onSubmit={(event) => void correctCount(event)}>
              <label>
                Corregir cantidad vendible
                <input name="sellableCount" inputMode="numeric" defaultValue={selected.sellableCount ?? ""} placeholder="Pendiente si lo dejas vacío" />
              </label>
              <button className="btn btn-ghost" type="submit" disabled={saving}>Guardar conteo</button>
            </form>
          ) : null}
          <h3>Gastos</h3>
          {selected.expenses.length === 0 ? <p>Este lote todavía no tiene gastos.</p> : null}
          {selected.expenses.map((expense) => (
            <article key={expense.id}>
              <p>{expense.spentOn} · {lotExpenseCategoryLabel(expense.category)} · {formatStoredQuetzales(expense.amountGtq)}</p>
              <p>{expense.description}{expense.payee ? ` · ${expense.payee}` : ""}</p>
              {expense.createdByUsername ? <p>Registrado por {expense.createdByUsername}</p> : null}
              {expense.status === "anulado" ? <p>Anulado</p> : null}
              {permissions.correct && expense.status === "activo" ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={() => {
                    setEditingExpenseId(expense.id);
                    setEditForm({
                      spentOn: expense.spentOn,
                      category: expense.category,
                      description: expense.description,
                      amount: expense.amountGtq,
                      payee: expense.payee,
                    });
                  }}
                >
                  Corregir gasto
                </button>
              ) : null}
              {permissions.void && expense.status === "activo" ? (
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void voidExpense(expense.id)}>Anular gasto</button>
              ) : null}
              {editingExpenseId === expense.id ? (
                <form onSubmit={(event) => void correctExpense(event)}>
                  <label>Fecha<input type="date" value={editForm.spentOn} onChange={(event) => setEditForm({ ...editForm, spentOn: event.target.value })} required /></label>
                  <label>
                    Categoría
                    <select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} required>
                      {GUATEMALA_LOT_EXPENSE_CATEGORIES.map((category) => (
                        <option key={category.id} value={category.id}>{category.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>Descripción<input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} required /></label>
                  <label>Monto en quetzales<input inputMode="decimal" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} required /></label>
                  <label>Persona pagada, opcional<input value={editForm.payee} onChange={(event) => setEditForm({ ...editForm, payee: event.target.value })} /></label>
                  <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar corrección"}</button>
                </form>
              ) : null}
            </article>
          ))}
          {permissions.write && selected.status === "activo" ? (
            <form onSubmit={(event) => void addExpense(event)}>
              <h3>Agregar gasto</h3>
              <label>Fecha<input type="date" value={expenseForm.spentOn} onChange={(event) => setExpenseForm({ ...expenseForm, spentOn: event.target.value })} required /></label>
              <label>
                Categoría
                <select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })} required>
                  <option value="">Elige</option>
                  {GUATEMALA_LOT_EXPENSE_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label>Descripción<input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} required /></label>
              <label>Monto en quetzales<input inputMode="decimal" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} required /></label>
              <label>Persona pagada, opcional<input value={expenseForm.payee} onChange={(event) => setExpenseForm({ ...expenseForm, payee: event.target.value })} /></label>
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Agregar gasto"}</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
