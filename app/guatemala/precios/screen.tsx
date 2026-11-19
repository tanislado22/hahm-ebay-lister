"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { ReturnHomeBar, useUnsavedChanges } from "../return-home";
import { GARMENT_KIND_CHOICES, storePriceProposal } from "@/lib/markets/guatemala-price-match";
import type { StorePriceGuide } from "@/lib/markets/guatemala-price-match";
import type { PricingSettingsInput } from "@/lib/markets/guatemala-sale-advice";

interface GuideRow extends StorePriceGuide {
  id: string;
}

const EMPTY = {
  scope: "general" as "general" | "brand",
  brand: "",
  garment: "polo",
  condition: "nuevo",
  priceGtq: "",
  lowGtq: "",
  highGtq: "",
  adjustmentGtq: "",
  comparableBrands: "",
};

const EMPTY_SETTINGS = {
  monthlySalaryGtq: "",
  otherMonthlyExpensesGtq: "",
  expectedMonthlySales: "",
  minimumProfitGtq: "",
};

export function PriceGuideScreen() {
  const params = useSearchParams();
  const clientId = params.get("clientId") ?? "";
  const requestedGarment = params.get("garment") ?? "";
  const requestedCondition = params.get("condition") === "usado" ? "usado" : params.get("condition") === "nuevo" ? "nuevo" : "";
  const [guides, setGuides] = useState<GuideRow[]>([]);
  const [form, setForm] = useState({
    ...EMPTY,
    garment: GARMENT_KIND_CHOICES.some((choice) => choice.key === requestedGarment) ? requestedGarment : EMPTY.garment,
    condition: requestedCondition || EMPTY.condition,
  });
  const [savedForm, setSavedForm] = useState(form);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState(EMPTY_SETTINGS);
  const [savedPricing, setSavedPricing] = useState(EMPTY_SETTINGS);
  const [pricingError, setPricingError] = useState("");
  const [pricingNotice, setPricingNotice] = useState("");
  useUnsavedChanges(JSON.stringify(form) !== JSON.stringify(savedForm) || JSON.stringify(pricing) !== JSON.stringify(savedPricing));

  async function load() {
    if (!clientId) {
      setLoading(false);
      setError("Falta la tienda.");
      return;
    }
    const [response, pricingResponse] = await Promise.all([
      guatemalaRequest(`/api/markets/guatemala/price-guides?clientId=${encodeURIComponent(clientId)}`),
      guatemalaRequest(`/api/markets/guatemala/pricing-settings?clientId=${encodeURIComponent(clientId)}`),
    ]);
    const pricingBody = (await pricingResponse.json()) as { ok?: boolean; settings?: PricingSettingsInput | null };
    if (pricingResponse.ok && pricingBody.ok && pricingBody.settings) {
      const next = {
        monthlySalaryGtq: pricingBody.settings.monthlySalaryGtq,
        otherMonthlyExpensesGtq: pricingBody.settings.otherMonthlyExpensesGtq,
        expectedMonthlySales: String(pricingBody.settings.expectedMonthlySales),
        minimumProfitGtq: pricingBody.settings.minimumProfitGtq,
      };
      setPricing(next);
      setSavedPricing(next);
    }
    const data = (await response.json()) as { ok?: boolean; guides?: GuideRow[]; error?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudo cargar la tabla de precios.");
    } else {
      setGuides(data.guides ?? []);
      setError("");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // The table belongs to the selected Guatemala client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const proposal =
    requestedGarment && requestedCondition
      ? storePriceProposal(
          {
            itemType: requestedGarment,
            condition: requestedCondition === "usado" ? "GOOD" : "NEW_WITH_TAGS",
          },
          guides
        )
      : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await guatemalaRequest("/api/markets/guatemala/price-guides", {
      clientId,
      scope: form.scope,
      brand: form.brand,
      garment: form.garment,
      condition: form.condition,
      priceGtq: form.scope === "general" ? Number(form.priceGtq) : null,
      lowGtq: form.scope === "general" && form.lowGtq !== "" ? Number(form.lowGtq) : null,
      highGtq: form.scope === "general" && form.highGtq !== "" ? Number(form.highGtq) : null,
      adjustmentGtq: form.scope === "brand" && form.adjustmentGtq !== "" ? Number(form.adjustmentGtq) : null,
      comparableBrands: form.scope === "brand" ? form.comparableBrands : "",
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudo guardar la regla.");
      return;
    }
    const next = { ...EMPTY, garment: form.garment, condition: form.condition };
    setForm(next);
    setSavedForm(next);
    await load();
  }

  async function savePricing(event: FormEvent) {
    event.preventDefault();
    setPricingError("");
    setPricingNotice("");
    const response = await guatemalaRequest("/api/markets/guatemala/pricing-settings", {
      clientId,
      monthlySalaryGtq: pricing.monthlySalaryGtq,
      otherMonthlyExpensesGtq: pricing.otherMonthlyExpensesGtq,
      expectedMonthlySales: pricing.expectedMonthlySales,
      minimumProfitGtq: pricing.minimumProfitGtq,
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; expenseShareGtq?: string | null };
    if (!response.ok || !data.ok) {
      setPricingError(data.error || "No se pudo guardar la configuración.");
      return;
    }
    setSavedPricing(pricing);
    setPricingNotice(
      data.expenseShareGtq ? `Cada prenda carga ${data.expenseShareGtq} quetzales de gastos de la tienda.` : "Configuración guardada."
    );
  }

  async function remove(id: string) {
    const response = await guatemalaRequest("/api/markets/guatemala/price-guides", {
      action: "delete",
      clientId,
      id,
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudo quitar la regla.");
      return;
    }
    await load();
  }

  return (
    <main className="wrap">
      <ReturnHomeBar role="propietario" />
      <h1>Estimaciones de Tienda Guatemala</h1>
      <p>
        Primero se usan anuncios reales. Si no alcanzan, entra el precio general del tipo de prenda y la condición.
        Un ajuste de marca solo se aplica cuando lo guardas. La cifra se llama estimación de la tienda y no es un
        precio comprobado del mercado.
      </p>
      <form onSubmit={(event) => void savePricing(event)} style={{ display: "grid", gap: "0.6rem", maxWidth: "36rem" }}>
        <h2>Gastos para el precio mínimo</h2>
        <p>
          El sueldo y los demás gastos del mes se dividen entre las prendas que esperas vender. Esa parte se suma al
          costo y a la ganancia mínima, y el resultado se redondea hacia arriba.
        </p>
        <label>
          Sueldo mensual
          <input value={pricing.monthlySalaryGtq} inputMode="decimal" onChange={(event) => setPricing({ ...pricing, monthlySalaryGtq: event.target.value })} required />
        </label>
        <label>
          Demás gastos mensuales
          <input value={pricing.otherMonthlyExpensesGtq} inputMode="decimal" onChange={(event) => setPricing({ ...pricing, otherMonthlyExpensesGtq: event.target.value })} required />
        </label>
        <label>
          Prendas que esperas vender al mes
          <input value={pricing.expectedMonthlySales} inputMode="numeric" onChange={(event) => setPricing({ ...pricing, expectedMonthlySales: event.target.value })} required />
        </label>
        <label>
          Ganancia mínima por prenda
          <input value={pricing.minimumProfitGtq} inputMode="decimal" onChange={(event) => setPricing({ ...pricing, minimumProfitGtq: event.target.value })} required />
        </label>
        {pricingError ? <p>{pricingError}</p> : null}
        {pricingNotice ? <p>{pricingNotice}</p> : null}
        <button className="btn btn-primary" type="submit">Guardar configuración</button>
      </form>
      {error && <p>{error}</p>}
      {!loading && proposal && (
        <section>
          <h2>Propuesta</h2>
          <p>
            Define el precio general de {proposal.label}. No hay un importe inicial. El ajuste por marca es opcional
            y no hace falta una regla por cada marca.
          </p>
        </section>
      )}
      <form onSubmit={(event) => void save(event)} style={{ display: "grid", gap: "0.6rem", maxWidth: "36rem" }}>
        <label>
          Qué quieres guardar
          <select
            value={form.scope}
            onChange={(event) => setForm({ ...form, scope: event.target.value === "brand" ? "brand" : "general" })}
          >
            <option value="general">Precio general por tipo y condición</option>
            <option value="brand">Ajuste de una marca</option>
          </select>
        </label>
        {form.scope === "brand" && (
          <label>
            Marca
            <input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} required />
          </label>
        )}
        <label>
          Tipo
          <select value={form.garment} onChange={(event) => setForm({ ...form, garment: event.target.value })}>
            {GARMENT_KIND_CHOICES.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Condición
          <select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })}>
            <option value="nuevo">Nueva</option>
            <option value="usado">Usada</option>
          </select>
        </label>
        {form.scope === "general" ? (
          <>
          <label>
            Precio general en quetzales
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.priceGtq}
              onChange={(event) => setForm({ ...form, priceGtq: event.target.value })}
              required
            />
          </label>
          <label>
            Precio más bajo del rango
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.lowGtq}
              onChange={(event) => setForm({ ...form, lowGtq: event.target.value })}
              placeholder="Opcional"
            />
          </label>
          <label>
            Precio más alto del rango
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.highGtq}
              onChange={(event) => setForm({ ...form, highGtq: event.target.value })}
              placeholder="Opcional"
            />
          </label>
          </>
        ) : (
          <>
            <label>
              Ajuste en quetzales
              <input
                type="number"
                step="0.01"
                value={form.adjustmentGtq}
                onChange={(event) => setForm({ ...form, adjustmentGtq: event.target.value })}
                placeholder="Por ejemplo 10 o -10"
              />
            </label>
            <label>
              Marcas comparables, separadas por coma
              <input
                value={form.comparableBrands}
                onChange={(event) => setForm({ ...form, comparableBrands: event.target.value })}
                placeholder="Solo si hay una razón para compararlas"
              />
            </label>
          </>
        )}
        <button className="btn btn-primary" type="submit">
          Guardar regla
        </button>
      </form>
      {loading ? (
        <p>Cargando…</p>
      ) : (
        <ul>
          {guides.map((guide) => (
            <li key={guide.id}>
              {guideLabel(guide)}
              <button type="button" onClick={() => void remove(guide.id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function guideLabel(guide: StorePriceGuide): string {
  const kind = GARMENT_KIND_CHOICES.find((choice) => choice.key === guide.garment)?.label ?? guide.garment;
  const condition = guide.condition === "nuevo" ? "nueva" : "usada";
  if (guide.scope === "general" && guide.priceGtq != null) {
    const range =
      guide.lowGtq != null && guide.highGtq != null ? ` · rango Q${guide.lowGtq.toFixed(2)} a Q${guide.highGtq.toFixed(2)}` : "";
    return `${kind} · ${condition} · precio general · Q${guide.priceGtq.toFixed(2)}${range}`;
  }
  const adjustment =
    guide.adjustmentGtq == null
      ? "sin ajuste"
      : `ajuste ${guide.adjustmentGtq > 0 ? "+" : ""}Q${guide.adjustmentGtq.toFixed(2)}`;
  const peers = guide.comparableBrands.length > 0 ? ` · comparables: ${guide.comparableBrands.join(", ")}` : "";
  return `${kind} · ${condition} · ${guide.brand || "marca"} · ${adjustment}${peers}`;
}
