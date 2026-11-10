"use client";

import { useEffect, useRef, useState } from "react";
import { formatStoredQuetzales, quetzalPriceText } from "@/lib/markets/guatemala-inventory";
import { scanLotLabel, scanSaleDecision } from "@/lib/markets/guatemala-qr";
import {
  QUANTITY_MESSAGES,
  pieceCount,
  quantityStockMessage,
  type QuantityGroupView,
} from "@/lib/markets/guatemala-quantity";
import { STAFF_SALE_NOT_SAVED, saleMayBeSubmitted } from "@/lib/markets/guatemala-pwa";
import { prepareSalePayment, saleMayBeConfirmed, type SalePaymentMethod } from "@/lib/markets/guatemala-sale-payment";
import { SaleTender } from "./tender";

type Request = (path: string, body?: unknown) => Promise<Response>;

type SkuPick = { id: string; sku: string; title: string; lotLabel: string; status: string };

export function QuantityGroupPanel({
  clientId,
  lots,
  request,
  onClose,
}: {
  clientId: string;
  lots: { id: string; lotNumber: number; name: string }[];
  request: Request;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [groups, setGroups] = useState<QuantityGroupView[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    void loadGroups(clientId, requestRef.current, setGroups);
  }, [clientId]);

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await request("/api/markets/guatemala/quantity-groups", {
        clientId,
        name,
        lotId,
        quantity,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo crear el grupo.");
        return;
      }
      setName("");
      setQuantity("");
      setNotice("Grupo creado. Las piezas quedan en ese lote y no se sumaron otra vez.");
      await loadGroups(clientId, request, setGroups);
    } catch {
      setError("No se pudo crear el grupo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Crear grupo por cantidad</h2>
      <p>Sirve para ropa sin sticker, foto ni SKU. Si esas piezas ya están en el conteo del lote, el grupo solo las organiza.</p>
      <form className="gt-sale-box" onSubmit={(event) => void createGroup(event)}>
        <label htmlFor="group-name">
          Nombre del grupo
          <input id="group-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ropa de bebé · Lote 1" />
        </label>
        <label htmlFor="group-lot">
          Lote
          <select id="group-lot" value={lotId} onChange={(event) => setLotId(event.target.value)}>
            <option value="">Selecciona el lote</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                Lote {lot.lotNumber} · {lot.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="group-quantity">
          Cantidad inicial
          <input id="group-quantity" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="100" />
        </label>
        {error ? <p className="note note-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="gt-inventory-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Guardando…" : "Guardar grupo"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </form>
      {groups.length > 0 ? (
        <div>
          <h3>Grupos</h3>
          {groups.map((group) => (
            <p key={group.id}>
              {group.name} · {group.lotNumber != null ? `Lote ${group.lotNumber}` : "Sin lote"} · {group.available} disponibles
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function QuantitySalePanel({
  clientId,
  request,
  initialItems,
  onClose,
  onSaved,
}: {
  clientId: string;
  request: Request;
  initialItems: SkuPick[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<QuantityGroupView[]>([]);
  const [lines, setLines] = useState<{ groupId: string; quantity: string }[]>([]);
  const [items, setItems] = useState<SkuPick[]>(initialItems);
  const [skuDraft, setSkuDraft] = useState("");
  const [choices, setChoices] = useState<SkuPick[]>([]);
  const [chargedDraft, setChargedDraft] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>("efectivo");
  const [cashDraft, setCashDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestIdRef = useRef("");

  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    void loadGroups(clientId, requestRef.current, setGroups);
  }, [clientId]);

  const chargedPrice = quetzalPriceText(chargedDraft);
  const prepared = chargedPrice
    ? prepareSalePayment({ method: paymentMethod, chargedPrice, cashReceived: cashDraft })
    : null;
  const stockError = lines
    .map((line) => {
      const group = groups.find((candidate) => candidate.id === line.groupId);
      const quantity = pieceCount(line.quantity);
      if (!group) return QUANTITY_MESSAGES.groupMissing;
      if (!quantity) return QUANTITY_MESSAGES.quantityRequired;
      return quantity > group.available ? quantityStockMessage(group.name, group.available) : "";
    })
    .find(Boolean);
  const ready =
    !stockError &&
    prepared != null &&
    saleMayBeConfirmed(prepared) &&
    (lines.some((line) => pieceCount(line.quantity)) || items.length > 0);

  function addGroup(groupId: string) {
    if (!groupId || lines.some((line) => line.groupId === groupId)) return;
    setLines((current) => [...current, { groupId, quantity: "1" }]);
  }

  async function searchSku(event: React.FormEvent) {
    event.preventDefault();
    const sku = skuDraft.trim();
    if (!sku) return;
    setError("");
    setChoices([]);
    const response = await request(
      `/api/markets/guatemala/inventory/qr?clientId=${encodeURIComponent(clientId)}&sku=${encodeURIComponent(sku)}`
    );
    const body = (await response.json()) as {
      ok?: boolean;
      error?: string;
      choice?: "one" | "many";
      garment?: { id: string; sku: string; title: string; status: string; lotNumber: number | null; lotName: string | null };
      garments?: { id: string; sku: string; title: string; status: string; lotNumber: number | null; lotName: string | null }[];
    };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se encontró la prenda.");
      return;
    }
    const found = body.choice === "many" ? body.garments ?? [] : body.garment ? [body.garment] : [];
    const picks = found.map((garment) => ({
      id: garment.id,
      sku: garment.sku,
      title: garment.title,
      lotLabel: scanLotLabel(garment.lotNumber, garment.lotName),
      status: garment.status,
    }));
    if (picks.length > 1) {
      setChoices(picks);
      return;
    }
    addSku(picks[0]);
  }

  function addSku(pick: SkuPick | undefined) {
    if (!pick) return;
    const decision = scanSaleDecision(pick.status);
    if (!decision.canSell) {
      setError(decision.message);
      return;
    }
    setChoices([]);
    setSkuDraft("");
    setError("");
    setItems((current) => (current.some((item) => item.id === pick.id) ? current : [...current, pick]));
  }

  async function save() {
    if (savingRef.current || !ready || !prepared?.ok) return;
    const gate = saleMayBeSubmitted(navigator.onLine);
    if (!gate.ok) {
      setError(gate.error);
      return;
    }
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await request("/api/markets/guatemala/quantity-sales", {
        clientId,
        requestId: requestIdRef.current,
        chargedPrice,
        paymentMethod: prepared.payment.method,
        cashReceived: prepared.payment.cashReceivedGtq,
        pieceLines: lines
          .map((line) => ({ groupId: line.groupId, quantity: pieceCount(line.quantity) }))
          .filter((line) => line.quantity),
        itemIds: items.map((item) => item.id),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; chargedPriceGtq?: string };
      if (!response.ok || !body.ok || !body.chargedPriceGtq) {
        setError(body.error || STAFF_SALE_NOT_SAVED);
        return;
      }
      setNotice(`Venta registrada por ${formatStoredQuetzales(body.chargedPriceGtq)}.`);
      setLines([]);
      setItems([]);
      requestIdRef.current = "";
      await loadGroups(clientId, request, setGroups);
      onSaved();
    } catch {
      setError(STAFF_SALE_NOT_SAVED);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Vender por cantidad</h2>
      <p>Puedes cobrar piezas de uno o más grupos y prendas con SKU en una sola venta. Escanear o armar la venta no la guarda.</p>
      {groups.length === 0 ? <p>Todavía no hay grupos por cantidad.</p> : null}
      <label htmlFor="sale-group">
        Grupo
        <select id="sale-group" defaultValue="" onChange={(event) => addGroup(event.target.value)}>
          <option value="">Agregar grupo</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {group.available} disponibles
            </option>
          ))}
        </select>
      </label>
      {lines.map((line) => {
        const group = groups.find((candidate) => candidate.id === line.groupId);
        if (!group) return null;
        const quantity = pieceCount(line.quantity);
        const over = quantity != null && quantity > group.available;
        return (
          <div key={line.groupId} className="gt-sale-box">
            <p>{group.name}</p>
            <p>{quantityStockMessage(group.name, group.available)}</p>
            <label>
              Cantidad vendida
              <input
                inputMode="numeric"
                value={line.quantity}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((item) => (item.groupId === line.groupId ? { ...item, quantity: event.target.value } : item))
                  )
                }
              />
            </label>
            {over ? <p className="note note-error" role="alert">{quantityStockMessage(group.name, group.available)}</p> : null}
            <button type="button" className="btn btn-ghost" onClick={() => setLines((current) => current.filter((item) => item.groupId !== line.groupId))}>
              Quitar grupo
            </button>
          </div>
        );
      })}
      <form className="gt-inventory-search" onSubmit={(event) => void searchSku(event)}>
        <label htmlFor="ticket-sku">Agregar prenda con SKU</label>
        <input id="ticket-sku" value={skuDraft} onChange={(event) => setSkuDraft(event.target.value)} autoComplete="off" />
        <button type="submit" className="btn btn-ghost">Buscar</button>
      </form>
      {choices.length > 1 ? (
        <div className="gt-scan-choices">
          {choices.map((choice) => (
            <button key={choice.id} type="button" className="btn btn-ghost gt-scan-choice" onClick={() => addSku(choice)}>
              {choice.title || "Prenda sin título"} · SKU {choice.sku} · {choice.lotLabel}
            </button>
          ))}
        </div>
      ) : null}
      {items.map((item) => (
        <p key={item.id}>
          SKU {item.sku} · {item.title || "Prenda sin título"} · {item.lotLabel}{" "}
          <button type="button" className="btn btn-ghost" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}>
            Quitar
          </button>
        </p>
      ))}
      <label htmlFor="ticket-total">Total cobrado</label>
      <div className="gt-sale-price">
        <span aria-hidden="true">Q</span>
        <input
          id="ticket-total"
          inputMode="decimal"
          autoComplete="off"
          value={chargedDraft}
          onChange={(event) => setChargedDraft(event.target.value)}
          placeholder="0.00"
        />
      </div>
      <SaleTender
        chargedPrice={chargedPrice}
        method={paymentMethod}
        cashDraft={cashDraft}
        onCashDraft={setCashDraft}
        onMethod={setPaymentMethod}
      />
      {stockError ? <p className="note note-error" role="alert">{stockError}</p> : null}
      {error ? <p className="note note-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="gt-inventory-actions">
        <button type="button" className="btn btn-primary" disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </section>
  );
}

async function loadGroups(clientId: string, request: Request, setGroups: (groups: QuantityGroupView[]) => void) {
  const response = await request(`/api/markets/guatemala/quantity-groups?clientId=${encodeURIComponent(clientId)}`);
  const body = (await response.json()) as { ok?: boolean; groups?: QuantityGroupView[] };
  if (response.ok && body.ok) setGroups(body.groups ?? []);
}
