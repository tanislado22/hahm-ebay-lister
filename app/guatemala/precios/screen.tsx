"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { GARMENT_KIND_CHOICES } from "@/lib/markets/guatemala-price-match";
import type { StorePriceGuide } from "@/lib/markets/guatemala-price-match";

interface GuideRow extends StorePriceGuide {
  id: string;
}

const EMPTY = { brand: "", garment: "polo", condition: "nuevo", priceGtq: "", comparableBrands: "" };

export function PriceGuideScreen() {
  const params = useSearchParams();
  const clientId = params.get("clientId") ?? "";
  const [guides, setGuides] = useState<GuideRow[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!clientId) {
      setLoading(false);
      setError("Falta la tienda.");
      return;
    }
    const response = await guatemalaRequest(`/api/markets/guatemala/price-guides?clientId=${encodeURIComponent(clientId)}`);
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

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await guatemalaRequest("/api/markets/guatemala/price-guides", {
      clientId,
      brand: form.brand,
      garment: form.garment,
      condition: form.condition,
      priceGtq: Number(form.priceGtq),
      comparableBrands: form.comparableBrands,
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudo guardar la regla.");
      return;
    }
    setForm(EMPTY);
    await load();
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
      <h1>Estimaciones de Tienda Guatemala</h1>
      <p>
        Esta tabla se usa solo cuando no hay al menos tres anuncios relevantes. El precio se identifica como
        estimación de la tienda y no crea enlaces.
      </p>
      {error && <p>{error}</p>}
      <form onSubmit={(event) => void save(event)} style={{ display: "grid", gap: "0.6rem", maxWidth: "36rem" }}>
        <label>
          Marca
          <input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} required />
        </label>
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
        <label>
          Precio en quetzales
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
          Marcas comparables, separadas por coma
          <input
            value={form.comparableBrands}
            onChange={(event) => setForm({ ...form, comparableBrands: event.target.value })}
            placeholder="Solo si hay una razón para compararlas"
          />
        </label>
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
              {guide.brand} · {guide.garment} · {guide.condition} · Q{guide.priceGtq.toFixed(2)}
              {guide.comparableBrands.length > 0 ? ` · comparables: ${guide.comparableBrands.join(", ")}` : ""}
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
