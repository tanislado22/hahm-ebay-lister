"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { ReturnHomeBar, useUnsavedChanges } from "../return-home";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import {
  GUATEMALA_EXPENSE_CATEGORIES,
  GUATEMALA_EXPENSE_MESSAGES,
  expenseCategoryLabel,
  formatSignedQuetzales,
  guatemalaTodayKey,
  prepareExpense,
  sumExpenseAmounts,
  type ExpenseCategory,
  type StoredExpense,
} from "@/lib/markets/guatemala-expenses";
import {
  GUATEMALA_RECOVERY_MESSAGES,
  prepareRecovery,
  type StoredRecovery,
} from "@/lib/markets/guatemala-recoveries";
import { formatGuatemalaCivilDate, parseCivilDate, parseSalesReportPeriod, type SalesReportPeriod } from "@/lib/markets/guatemala-sales-report";
import "../inventario/inventory.css";
import "../reportes/report.css";
import "./expenses.css";

interface ExpensePayload {
  timezone: string;
  fromLabel: string;
  toLabel: string;
  totalGtq: string;
  expenses: StoredExpense[];
}

interface RecoveryPayload {
  expensesGtq: string;
  recoveredGtq: string;
  pendingGtq: string;
  recoveries: StoredRecovery[];
}

const PERIODS: { id: SalesReportPeriod; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "rango", label: "Rango" },
];

const EMPTY_FORM = {
  spentOn: "",
  category: "" as ExpenseCategory | "",
  description: "",
  amount: "",
  payee: "",
  includedInGarmentCost: false,
};

export function ExpensesScreen({
  lockedClientId,
  basePath = "/guatemala/gastos",
  inventoryPath = "/guatemala/inventario",
  reportsPath = "/guatemala/reportes",
  allowFinances = false,
}: {
  lockedClientId?: string;
  basePath?: string;
  inventoryPath?: string;
  reportsPath?: string;
  allowFinances?: boolean;
} = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const staffMode = Boolean(lockedClientId);
  const showFinances = !staffMode || allowFinances;
  const clientId = lockedClientId || params.get("clientId") || "";
  function storeRequest(path: string, body?: unknown) {
    return guatemalaRequest(path, body, staffMode ? { actor: "encargado" } : undefined);
  }
  const period = parseSalesReportPeriod(params.get("periodo"));
  const from = params.get("desde") ?? "";
  const to = params.get("hasta") ?? "";
  const [payload, setPayload] = useState<ExpensePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formBaseline, setFormBaseline] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryPayload | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryForm, setRecoveryForm] = useState({ recoveredOn: "", description: "", amount: "" });
  const [recoveryBaseline, setRecoveryBaseline] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();

    async function load(signal: AbortSignal) {
      if (!clientId) {
        setPayload(null);
        setError("Selecciona Tienda Guatemala para ver sus gastos.");
        setLoading(false);
        return;
      }
      if (period === "rango" && (!from || !to)) {
        setPayload(null);
        setError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const search = new URLSearchParams({ clientId, periodo: period });
        if (period === "rango") {
          search.set("desde", from);
          search.set("hasta", to);
        }
        const response = await storeRequest(`/api/markets/guatemala/expenses?${search.toString()}`);
        const body = (await response.json()) as ExpensePayload & { ok?: boolean; error?: string };
        if (signal.aborted) return;
        if (!response.ok || !body.ok) {
          setPayload(null);
          setError(body.error || GUATEMALA_EXPENSE_MESSAGES.loadFailed);
          return;
        }
        setPayload(body);
      } catch {
        if (!signal.aborted) {
          setPayload(null);
          setError(GUATEMALA_EXPENSE_MESSAGES.loadFailed);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
  }, [clientId, period, from, to]);

  useEffect(() => {
    if (!showFinances || !clientId) {
      setRecovery(null);
      return;
    }
    const controller = new AbortController();
    void loadRecovery(controller.signal);
    return () => controller.abort();

    async function loadRecovery(signal: AbortSignal) {
      try {
        const response = await storeRequest(
          `/api/markets/guatemala/expenses/recoveries?clientId=${encodeURIComponent(clientId)}`
        );
        const body = (await response.json()) as RecoveryPayload & { ok?: boolean; error?: string };
        if (signal.aborted) return;
        if (!response.ok || !body.ok) {
          setRecovery(null);
          setError(body.error || GUATEMALA_RECOVERY_MESSAGES.loadFailed);
          return;
        }
        setRecovery(body);
      } catch {
        if (!signal.aborted) setError(GUATEMALA_RECOVERY_MESSAGES.loadFailed);
      }
    }
  }, [clientId, showFinances]);

  function updatePeriod(next: { periodo?: SalesReportPeriod; desde?: string; hasta?: string }) {
    const search = new URLSearchParams({ periodo: next.periodo ?? period });
    if (!staffMode) search.set("clientId", clientId);
    const nextFrom = next.desde ?? from;
    const nextTo = next.hasta ?? to;
    if (nextFrom) search.set("desde", nextFrom);
    if (nextTo) search.set("hasta", nextTo);
    router.replace(`${basePath}?${search.toString()}`);
  }

  function rememberForm(next: typeof EMPTY_FORM) {
    setForm(next);
    setFormBaseline(JSON.stringify(next));
  }

  function openCreate() {
    setEditingId(null);
    rememberForm({ ...EMPTY_FORM, spentOn: guatemalaTodayKey() });
    setFormError("");
    setPendingDeleteId(null);
    setRecoveryOpen(false);
    setFormOpen(true);
  }

  function openRecovery() {
    const next = { recoveredOn: guatemalaTodayKey(), description: "", amount: "" };
    setRecoveryForm(next);
    setRecoveryBaseline(JSON.stringify(next));
    setRecoveryError("");
    setFormOpen(false);
    setRecoveryOpen(true);
  }

  function closeRecovery() {
    setRecoveryOpen(false);
    setRecoveryError("");
  }

  function openEdit(expense: StoredExpense) {
    setEditingId(expense.id);
    rememberForm({
      spentOn: expense.spentOn,
      category: expense.category,
      description: expense.description,
      amount: expense.amountGtq,
      payee: expense.payee,
      includedInGarmentCost: expense.includedInGarmentCost,
    });
    setFormError("");
    setPendingDeleteId(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
  }

  async function saveExpense() {
    if (savingRef.current) return;
    const prepared = prepareExpense({
      spentOn: form.spentOn,
      category: form.category,
      description: form.description,
      amount: form.amount,
      payee: form.payee,
      includedInGarmentCost: form.category === "fotografias" && form.includedInGarmentCost,
    });
    if (!prepared.ok) {
      setFormError(prepared.error);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      const path = editingId
        ? `/api/markets/guatemala/expenses/${encodeURIComponent(editingId)}`
        : "/api/markets/guatemala/expenses";
      const response = await storeRequest(path, {
        clientId,
        spentOn: prepared.expense.spentOn,
        category: prepared.expense.category,
        description: prepared.expense.description,
        amount: prepared.expense.amountGtq,
        payee: prepared.expense.payee,
        includedInGarmentCost: prepared.expense.includedInGarmentCost,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) {
        setFormError(body.error || GUATEMALA_EXPENSE_MESSAGES.retry);
        return;
      }
      setNotice(body.message || (editingId ? GUATEMALA_EXPENSE_MESSAGES.updated : GUATEMALA_EXPENSE_MESSAGES.saved));
      closeForm();
      await reload();
    } catch {
      setFormError(GUATEMALA_EXPENSE_MESSAGES.retry);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reload() {
    const search = new URLSearchParams({ clientId, periodo: period });
    if (period === "rango") {
      search.set("desde", from);
      search.set("hasta", to);
    }
    const response = await storeRequest(`/api/markets/guatemala/expenses?${search.toString()}`);
    const body = (await response.json()) as ExpensePayload & { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || GUATEMALA_EXPENSE_MESSAGES.loadFailed);
      return;
    }
    setPayload(body);
    setError("");
    if (showFinances) await refreshRecovery();
  }

  async function refreshRecovery() {
    const response = await storeRequest(
      `/api/markets/guatemala/expenses/recoveries?clientId=${encodeURIComponent(clientId)}`
    );
    const body = (await response.json()) as RecoveryPayload & { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || GUATEMALA_RECOVERY_MESSAGES.loadFailed);
      return;
    }
    setRecovery(body);
  }

  async function saveRecovery() {
    if (savingRef.current) return;
    const prepared = prepareRecovery(recoveryForm);
    if (!prepared.ok) {
      setRecoveryError(prepared.error);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setRecoveryError("");
    try {
      const response = await storeRequest("/api/markets/guatemala/expenses/recoveries", {
        clientId,
        recoveredOn: prepared.recovery.recoveredOn,
        description: prepared.recovery.description,
        amount: prepared.recovery.amountGtq,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) {
        setRecoveryError(body.error || GUATEMALA_RECOVERY_MESSAGES.retry);
        return;
      }
      await refreshRecovery();
      setNotice(body.message || GUATEMALA_RECOVERY_MESSAGES.saved);
      closeRecovery();
    } catch {
      setRecoveryError(GUATEMALA_RECOVERY_MESSAGES.retry);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function confirmDelete(expense: StoredExpense) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await storeRequest(
        `/api/markets/guatemala/expenses/${encodeURIComponent(expense.id)}/eliminar`,
        { clientId }
      );
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo eliminar el gasto.");
        return;
      }
      setPendingDeleteId(null);
      setNotice(body.message || GUATEMALA_EXPENSE_MESSAGES.deleted);
      await reload();
    } catch {
      setError("No se pudo eliminar el gasto.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function expenseDateLabel(value: string): string {
    const parsed = parseCivilDate(value);
    return parsed ? formatGuatemalaCivilDate(parsed) : value;
  }

  const listedTotal = payload ? sumExpenseAmounts(payload.expenses) : null;
  const withClient = (path: string) => (staffMode ? path : `${path}?clientId=${encodeURIComponent(clientId)}`);
  useUnsavedChanges(
    (formOpen && JSON.stringify(form) !== formBaseline) ||
      (recoveryOpen && JSON.stringify(recoveryForm) !== recoveryBaseline)
  );

  return (
    <main className="wrap gt-inventory gt-report gt-expenses">
      {staffMode ? null : <ReturnHomeBar role="propietario" />}
      <header>
        <h1>Gastos</h1>
        <p>Gastos de Tienda Guatemala. Quedan guardados para este cliente y no se mezclan con otras tiendas.</p>
      </header>
      {showFinances ? (
        <section className="panel" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">Recuperación de gastos</h2>
          <p className="gt-expense-note">
            Estos totales suman todos los gastos guardados. Los gastos de cada lote ya están incluidos una sola vez.
            La recuperación se anota cuando apartas el dinero: no se descuenta de las ventas, no se guarda como otro gasto
            y no se resta otra vez en la ganancia.
          </p>
          {recovery ? (
            <div className="gt-recovery-totals">
              <p>Total de gastos {formatStoredQuetzales(recovery.expensesGtq)}</p>
              <p>Total recuperado {formatStoredQuetzales(recovery.recoveredGtq)}</p>
              <p>Pendiente de recuperar {formatSignedQuetzales(recovery.pendingGtq)}</p>
            </div>
          ) : null}
          {!recoveryOpen ? (
            <div className="gt-inventory-actions">
              <button type="button" className="btn btn-primary" onClick={openRecovery}>
                Registrar recuperación
              </button>
            </div>
          ) : (
            <form
              className="gt-sale-box gt-expense-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRecovery();
              }}
            >
              <h3>Registrar recuperación</h3>
              <label>
                Fecha
                <input
                  type="date"
                  required
                  value={recoveryForm.recoveredOn}
                  onChange={(event) => setRecoveryForm((current) => ({ ...current, recoveredOn: event.target.value }))}
                />
              </label>
              <label>
                Descripción
                <input
                  type="text"
                  value={recoveryForm.description}
                  placeholder="Opcional"
                  onChange={(event) => setRecoveryForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <p className="gt-expense-note">Opcional. Por ejemplo, apartado de caja.</p>
              <label>
                Monto
                <div className="gt-sale-price">
                  <span aria-hidden="true">Q</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    required
                    value={recoveryForm.amount}
                    onChange={(event) => setRecoveryForm((current) => ({ ...current, amount: event.target.value }))}
                  />
                </div>
              </label>
              {recoveryError ? (
                <p className="note note-error" role="alert">
                  {recoveryError}
                </p>
              ) : null}
              <div className="gt-inventory-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar recuperación"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={closeRecovery}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
          {recovery && recovery.recoveries.length > 0 ? (
            <div className="gt-expense-list">
              <h3>Historial de recuperaciones</h3>
              {recovery.recoveries.map((entry) => (
                <article key={entry.id} className="gt-expense-card">
                  <p className="gt-inventory-meta">{expenseDateLabel(entry.recoveredOn)}</p>
                  {entry.description ? <p>{entry.description}</p> : null}
                  <p className="gt-expense-amount">{formatStoredQuetzales(entry.amountGtq)}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="panel">
        <div className="gt-inventory-filters" role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="gt-filter"
              aria-pressed={period === option.id}
              onClick={() => updatePeriod({ periodo: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === "rango" ? (
          <div className="gt-report-range">
            <label>
              Desde
              <input type="date" value={from} onChange={(event) => updatePeriod({ desde: event.target.value })} />
            </label>
            <label>
              Hasta
              <input type="date" value={to} onChange={(event) => updatePeriod({ hasta: event.target.value })} />
            </label>
          </div>
        ) : null}
        {error ? (
          <p className="note note-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="gt-expense-note">{notice}</p> : null}
        {loading ? <p>Cargando gastos…</p> : null}
        {!formOpen ? (
          <div className="gt-inventory-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              Registrar gasto
            </button>
          </div>
        ) : (
          <form
            className="gt-sale-box gt-expense-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveExpense();
            }}
          >
            <h2>{editingId ? "Editar gasto" : "Registrar gasto"}</h2>
            <label>
              Fecha del gasto
              <input
                type="date"
                required
                value={form.spentOn}
                onChange={(event) => setForm((current) => ({ ...current, spentOn: event.target.value }))}
              />
            </label>
            <p className="gt-expense-note">La fecha usa el calendario de Guatemala.</p>
            <label>
              Categoría
              <select
                required
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value as ExpenseCategory | "",
                    includedInGarmentCost:
                      event.target.value === "fotografias" ? current.includedInGarmentCost : false,
                  }))
                }
              >
                <option value="">Elige una categoría</option>
                {GUATEMALA_EXPENSE_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Descripción
              <textarea
                required
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label>
              Monto
              <div className="gt-sale-price">
                <span aria-hidden="true">Q</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  required
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                />
              </div>
            </label>
            <label>
              Persona a quien se pagó
              <input
                type="text"
                value={form.payee}
                autoComplete="name"
                onChange={(event) => setForm((current) => ({ ...current, payee: event.target.value }))}
              />
            </label>
            <p className="gt-expense-note">Opcional.</p>
            {form.category === "fotografias" ? (
              <label className="gt-expense-check">
                <input
                  type="checkbox"
                  checked={form.includedInGarmentCost}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, includedInGarmentCost: event.target.checked }))
                  }
                />
                <span>Este pago ya está incluido en el costo de una prenda</span>
              </label>
            ) : null}
            {formError ? (
              <p className="note note-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="gt-inventory-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar gasto"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={closeForm}>
                Cancelar
              </button>
            </div>
          </form>
        )}
        {payload ? (
          <>
            <p className="gt-report-dates">
              Consultado: {payload.fromLabel} al {payload.toLabel}. Zona horaria {payload.timezone}.
            </p>
            {listedTotal ? (
              <p className="gt-report-total">
                {showFinances ? "Gastos de este período" : "Total de gastos"} {formatStoredQuetzales(listedTotal)}
              </p>
            ) : null}
            {payload.expenses.length === 0 ? <p>No hay gastos en este período.</p> : null}
            <div className="gt-expense-list">
              {payload.expenses.map((expense) => (
                <article key={expense.id} className="gt-expense-card">
                  <p className="gt-inventory-meta">{expenseDateLabel(expense.spentOn)}</p>
                  <h2>{expenseCategoryLabel(expense.category)}</h2>
                  <p>{expense.description}</p>
                  <p className="gt-expense-amount">{formatStoredQuetzales(expense.amountGtq)}</p>
                  {expense.payee ? <p>Pagado a {expense.payee}</p> : null}
                  {expense.includedInGarmentCost ? (
                    <p className="gt-expense-note">Incluido en el costo de una prenda. No se resta otra vez en la ganancia.</p>
                  ) : null}
                  {expense.recordedByRole === "encargado" && expense.recordedByUsername ? (
                    <p className="gt-inventory-meta">Registrado por {expense.recordedByUsername}</p>
                  ) : null}
                  {expense.lotExpenseId ? (
                    <p className="gt-expense-note">Este gasto pertenece a un lote. Corrígelo o anúlalo en Lotes de compra para no contarlo dos veces.</p>
                  ) : pendingDeleteId === expense.id ? (
                    <div className="gt-sale-box">
                      <p>
                        ¿Eliminar este gasto de {formatStoredQuetzales(expense.amountGtq)} ({expense.description})?
                      </p>
                      <div className="gt-expense-actions">
                        <button
                          type="button"
                          className="btn btn-ghost danger"
                          disabled={saving}
                          onClick={() => void confirmDelete(expense)}
                        >
                          {saving ? "Eliminando…" : "Eliminar"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={saving}
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="gt-expense-actions">
                      <button type="button" className="btn btn-primary" onClick={() => openEdit(expense)}>
                        Editar
                      </button>
                      <button type="button" className="btn btn-ghost danger" onClick={() => setPendingDeleteId(expense.id)}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : null}
        <div className="gt-inventory-actions">
          <a className="btn btn-ghost" href={withClient(inventoryPath)}>
            Inventario
          </a>
          <a className="btn btn-ghost" href={withClient(reportsPath)}>
            Reportes de ventas
          </a>
        </div>
      </section>
    </main>
  );
}
