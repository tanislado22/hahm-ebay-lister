"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { ReturnHomeBar, useUnsavedChanges } from "../return-home";
import type { PricingSettingsInput } from "@/lib/markets/guatemala-sale-advice";
import "../gastos/expenses.css";

const EMPTY = {
  monthlySalaryGtq: "",
  otherMonthlyExpensesGtq: "",
  expectedMonthlySales: "",
  minimumProfitGtq: "",
};

export function PricingSettingsScreen() {
  const params = useSearchParams();
  const clientId = params.get("clientId") ?? "";
  const [form, setForm] = useState(EMPTY);
  const [saved, setSaved] = useState(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useUnsavedChanges(JSON.stringify(form) !== JSON.stringify(saved));

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      setError("Falta la tienda.");
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const response = await guatemalaRequest(
          `/api/markets/guatemala/pricing-settings?clientId=${encodeURIComponent(clientId)}`
        );
        const body = (await response.json()) as { ok?: boolean; error?: string; settings?: PricingSettingsInput | null };
        if (cancel) return;
        if (!response.ok || !body.ok) {
          setError(body.error || "No se pudo cargar la configuración.");
          return;
        }
        if (body.settings) {
          const next = {
            monthlySalaryGtq: body.settings.monthlySalaryGtq,
            otherMonthlyExpensesGtq: body.settings.otherMonthlyExpensesGtq,
            expectedMonthlySales: String(body.settings.expectedMonthlySales),
            minimumProfitGtq: body.settings.minimumProfitGtq,
          };
          setForm(next);
          setSaved(next);
        }
        setError("");
      } catch {
        if (!cancel) setError("No se pudo cargar la configuración.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [clientId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const response = await guatemalaRequest("/api/markets/guatemala/pricing-settings", {
      clientId,
      monthlySalaryGtq: form.monthlySalaryGtq,
      otherMonthlyExpensesGtq: form.otherMonthlyExpensesGtq,
      expectedMonthlySales: form.expectedMonthlySales,
      minimumProfitGtq: form.minimumProfitGtq,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; expenseShareGtq?: string | null };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo guardar la configuración.");
      return;
    }
    setSaved(form);
    setNotice(
      body.expenseShareGtq
        ? `Cada prenda suma Q${body.expenseShareGtq} del sueldo del encargado. El pago real se registra en Gastos y no se suma otra vez.`
        : "Configuración guardada."
    );
  }

  return (
    <main className="wrap">
      <ReturnHomeBar role="propietario" />
      <h1>Configurar precios</h1>
      <p>
        El sueldo mensual del encargado se divide entre las prendas que estimas vender. Esa parte se suma al costo
        de la prenda y a la ganancia mínima. El pago real del sueldo se anota una sola vez en Gastos y no entra otra
        vez en este cálculo. Los gastos del lote ya están dentro del costo de la prenda.
      </p>
      {loading ? <p>Cargando…</p> : null}
      <form className="gt-expense-form" onSubmit={(event) => void save(event)}>
        <label>
          Sueldo mensual del encargado
          <input
            inputMode="decimal"
            value={form.monthlySalaryGtq}
            onChange={(event) => setForm({ ...form, monthlySalaryGtq: event.target.value })}
            required
          />
        </label>
        <label>
          Demás gastos mensuales
          <input
            inputMode="decimal"
            value={form.otherMonthlyExpensesGtq}
            onChange={(event) => setForm({ ...form, otherMonthlyExpensesGtq: event.target.value })}
            required
          />
        </label>
        <label>
          Prendas estimadas al mes
          <input
            inputMode="numeric"
            min={1}
            value={form.expectedMonthlySales}
            onChange={(event) => setForm({ ...form, expectedMonthlySales: event.target.value })}
            required
          />
        </label>
        <label>
          Ganancia mínima por prenda
          <input
            inputMode="decimal"
            value={form.minimumProfitGtq}
            onChange={(event) => setForm({ ...form, minimumProfitGtq: event.target.value })}
            required
          />
        </label>
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
        <button className="btn btn-primary" type="submit">
          Guardar configuración
        </button>
      </form>
    </main>
  );
}
