"use client";

import { useEffect, useRef, useState } from "react";
import { guatemalaRequest } from "../request";
import { useUnsavedChanges } from "../return-home";
import { formatStoredQuetzales, guatemalaInventoryStatusLabel, quetzalPriceText } from "@/lib/markets/guatemala-inventory";
import { STAFF_SALE_NOT_SAVED, acceptedSaleUpdate, saleMayBeSubmitted } from "@/lib/markets/guatemala-pwa";
import {
  GARMENT_QR_SPEC,
  QR_MESSAGES,
  beginSale,
  beginScan,
  cameraFailureMessage,
  cameraMayRetry,
  garmentQrText,
  readScannedLabel,
  releaseScan,
  scanLotLabel,
  scanSaleDecision,
  type ScanGarment,
  type ScanLock,
} from "@/lib/markets/guatemala-qr";
import { changeDueLabel, prepareSalePayment, saleMayBeConfirmed, type SalePaymentMethod } from "@/lib/markets/guatemala-sale-payment";
import { useOnlineStatus } from "../pwa/shell";
import type { Html5Qrcode } from "html5-qrcode";
import { SaleTender } from "../inventario/tender";
import "../inventario/inventory.css";

type SavedSale = {
  chargedPriceGtq: string;
  paymentMethod: SalePaymentMethod | null;
  changeGtq: string | null;
};

const scanConfig = {
  fps: 8,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
    const size = Math.max(140, edge);
    return {
      width: Math.min(size, viewfinderWidth),
      height: Math.min(size, viewfinderHeight),
    };
  },
};

export function ScanScreen({
  clientId,
  actor,
}: {
  clientId: string;
  actor: "encargado" | "propietario";
}) {
  const online = useOnlineStatus();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const ticketRef = useRef(0);
  const lockRef = useRef<ScanLock>(releaseScan());
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanError, setScanError] = useState("");
  const [saleError, setSaleError] = useState("");
  const [skuDraft, setSkuDraft] = useState("");
  const [choices, setChoices] = useState<ScanGarment[]>([]);
  const [garment, setGarment] = useState<ScanGarment | null>(null);
  const [saved, setSaved] = useState<SavedSale | null>(null);
  const [chargedDraft, setChargedDraft] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>("efectivo");
  const [cashDraft, setCashDraft] = useState("");
  const [saleStep, setSaleStep] = useState<"form" | "confirm" | null>(null);
  const [savingSale, setSavingSale] = useState(false);
  const chargedPrice = quetzalPriceText(chargedDraft);
  const preparedPayment = chargedPrice
    ? prepareSalePayment({ method: paymentMethod, chargedPrice, cashReceived: cashDraft })
    : null;
  const saleReady = preparedPayment != null && saleMayBeConfirmed(preparedPayment);
  const decision = garment ? scanSaleDecision(garment.status) : null;
  const dirty = Boolean(
    garment &&
      decision?.canSell &&
      !saved &&
      (saleStep === "confirm" || chargedDraft.trim() !== garment.priceGtq.trim() || cashDraft.trim() !== "" || savingSale)
  );
  useUnsavedChanges(dirty);

  useEffect(() => {
    return () => {
      ticketRef.current += 1;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) void scanner.stop().catch(() => undefined);
    };
  }, []);

  async function releaseCamera() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // The camera was already off.
    }
    try {
      scanner.clear();
    } catch {
      // The view was already removed.
    }
  }

  function markLive(live: boolean) {
    document.getElementById("gt-qr-reader")?.classList.toggle("is-live", live);
  }

  async function stopCamera() {
    ticketRef.current += 1;
    setCameraOn(false);
    markLive(false);
    await releaseCamera();
  }

  async function openCamera(ticket: number, facingMode: "environment" | "user") {
    const { Html5Qrcode } = await import("html5-qrcode");
    if (ticket !== ticketRef.current) return;
    const scanner = new Html5Qrcode("gt-qr-reader", { verbose: false, useBarCodeDetectorIfSupported: true });
    scannerRef.current = scanner;
    try {
      await scanner.start({ facingMode }, scanConfig, (decoded) => void onDecoded(decoded), () => undefined);
    } finally {
      if (ticket !== ticketRef.current) {
        try {
          if (scanner.isScanning) await scanner.stop();
        } catch {
          // A newer scan already replaced this camera.
        }
        try {
          scanner.clear();
        } catch {
          // The view was already removed.
        }
        if (scannerRef.current === scanner) scannerRef.current = null;
      }
    }
  }

  async function startCamera() {
    setCameraError("");
    setScanError("");
    const ticket = ticketRef.current + 1;
    ticketRef.current = ticket;
    await releaseCamera();
    if (ticket !== ticketRef.current) return;
    if (!window.isSecureContext) {
      setCameraError(QR_MESSAGES.cameraInsecure);
      setCameraOn(false);
      return;
    }
    setCameraOn(true);
    markLive(true);
    try {
      await openCamera(ticket, "environment");
    } catch (error) {
      if (ticket !== ticketRef.current) return;
      await releaseCamera();
      if (!cameraMayRetry(error)) {
        setCameraOn(false);
        markLive(false);
        setCameraError(cameraFailureMessage(error));
        return;
      }
      try {
        await openCamera(ticket, "user");
      } catch (again) {
        if (ticket !== ticketRef.current) return;
        setCameraOn(false);
        markLive(false);
        setCameraError(cameraFailureMessage(again));
        await releaseCamera();
      }
    }
  }

  async function load(query: { codigo?: string; sku?: string }, releaseOnError: boolean) {
    const params = new URLSearchParams({ clientId });
    if (query.codigo) params.set("codigo", query.codigo);
    if (query.sku) params.set("sku", query.sku);
    try {
      const response = await guatemalaRequest(
        `/api/markets/guatemala/inventory/qr?${params.toString()}`,
        undefined,
        actor === "encargado" ? { actor: "encargado" } : undefined
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        choice?: "one" | "many";
        garment?: ScanGarment;
        garments?: ScanGarment[];
      };
      if (!response.ok || !body.ok) {
        if (releaseOnError) lockRef.current = releaseScan();
        setGarment(null);
        setChoices([]);
        setSaved(null);
        setScanError(body.error || "No se pudo buscar la prenda.");
        return;
      }
      if (body.choice === "many") {
        setGarment(null);
        setSaved(null);
        setSaleStep(null);
        setChoices(body.garments ?? []);
        setScanError("");
        return;
      }
      if (!body.garment) {
        if (releaseOnError) lockRef.current = releaseScan();
        setScanError(QR_MESSAGES.unknownCode);
        return;
      }
      lockRef.current = { code: body.garment.id, saving: false };
      setChoices([]);
      setSaved(null);
      setGarment(body.garment);
      setChargedDraft(body.garment.priceGtq);
      setPaymentMethod("efectivo");
      setCashDraft("");
      setSaleStep(scanSaleDecision(body.garment.status).canSell ? "form" : null);
      setSaleError("");
      setScanError("");
    } catch {
      if (releaseOnError) lockRef.current = releaseScan();
      setScanError("No se pudo buscar la prenda.");
    }
  }

  async function onDecoded(text: string) {
    const read = readScannedLabel(text);
    if (!read.ok) {
      setScanError(read.error);
      return;
    }
    const lockKey = read.kind === "code" ? read.itemId : `sku:${read.sku}`;
    const next = beginScan(lockRef.current, lockKey);
    if (!next) return;
    lockRef.current = next;
    window.setTimeout(() => {
      void stopCamera().then(() =>
        load(read.kind === "code" ? { codigo: garmentQrText(read.itemId) } : { sku: read.sku }, true)
      );
    }, 0);
  }

  async function searchSku(event: React.FormEvent) {
    event.preventDefault();
    const sku = skuDraft.trim();
    if (!sku || lockRef.current.saving) return;
    await stopCamera();
    lockRef.current = { code: `sku:${sku}`, saving: false };
    await load({ sku }, true);
  }

  async function chooseGarment(itemId: string) {
    if (lockRef.current.saving) return;
    lockRef.current = { code: itemId, saving: false };
    await load({ codigo: garmentQrText(itemId) }, true);
  }

  async function confirmSale() {
    if (!garment || !chargedPrice || !preparedPayment) return;
    if (!preparedPayment.ok) {
      setSaleError(preparedPayment.error);
      return;
    }
    const gate = saleMayBeSubmitted(navigator.onLine);
    if (!gate.ok) {
      setSaleError(gate.error);
      return;
    }
    const next = beginSale(lockRef.current);
    if (!next) return;
    lockRef.current = next;
    setSavingSale(true);
    setSaleError("");
    try {
      const response = await guatemalaRequest(
        `/api/markets/guatemala/inventory/${encodeURIComponent(garment.id)}/sale`,
        {
          clientId,
          chargedPrice,
          paymentMethod: preparedPayment.payment.method,
          cashReceived: preparedPayment.payment.cashReceivedGtq,
        },
        actor === "encargado" ? { actor: "encargado" } : undefined
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        item?: { sku: string; status: string; priceGtq: string; sale: SavedSale | null };
      };
      const savedItem = acceptedSaleUpdate(response.ok, body);
      if (!savedItem || !savedItem.sale) {
        if (response.status === 409) await load({ codigo: garmentQrText(garment.id) }, false);
        setSaleError(body.error || STAFF_SALE_NOT_SAVED);
        return;
      }
      setGarment({
        ...garment,
        sku: savedItem.sku,
        status: savedItem.status,
        priceGtq: savedItem.priceGtq,
      });
      setSaved(savedItem.sale);
      setSaleStep(null);
    } catch {
      setSaleError(STAFF_SALE_NOT_SAVED);
    } finally {
      lockRef.current = { code: garment.id, saving: false };
      setSavingSale(false);
    }
  }

  async function scanNext() {
    lockRef.current = releaseScan();
    setGarment(null);
    setChoices([]);
    setSaved(null);
    setSaleError("");
    setScanError("");
    setSaleStep(null);
    await startCamera();
  }

  async function closeScanner() {
    lockRef.current = releaseScan();
    setGarment(null);
    setChoices([]);
    setSaved(null);
    setSaleError("");
    setScanError("");
    setSaleStep(null);
    await stopCamera();
  }

  const showingResult = Boolean(garment || choices.length > 0 || saved);

  return (
    <main className="wrap gt-scan">
      <header>
        <h1>Escanear QR</h1>
        <p>{GARMENT_QR_SPEC}</p>
      </header>
      {cameraError ? (
        <p className="note note-error" role="alert">
          {cameraError}
        </p>
      ) : null}
      {scanError ? (
        <p className="note note-error" role="alert">
          {scanError}
        </p>
      ) : null}
      <div className="gt-inventory-actions">
        {cameraOn ? null : (
          <button type="button" className="btn btn-primary" onClick={() => void startCamera()}>
            Escanear QR
          </button>
        )}
        {cameraOn || showingResult ? (
          <button type="button" className="btn btn-ghost" onClick={() => void closeScanner()}>
            Cerrar
          </button>
        ) : null}
      </div>
      <div id="gt-qr-reader" className={cameraOn ? "gt-qr-reader is-live" : "gt-qr-reader"} />
      {cameraOn ? <p>Apunta la cámara trasera al QR de la etiqueta. Cerrar apaga la cámara.</p> : null}
      <form className="gt-inventory-search" onSubmit={(event) => void searchSku(event)}>
        <label htmlFor="scan-sku">Buscar por SKU</label>
        <input
          id="scan-sku"
          value={skuDraft}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setSkuDraft(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={savingSale}>
          Buscar
        </button>
      </form>
      {choices.length > 1 ? (
        <section className="panel">
          <h2>Hay varias prendas con ese SKU</h2>
          <p>Elige la prenda. Cada una muestra su lote.</p>
          <div className="gt-scan-choices">
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="btn btn-ghost gt-scan-choice"
                onClick={() => void chooseGarment(choice.id)}
              >
                {choice.title || "Prenda sin título"} · SKU {choice.sku} · {scanLotLabel(choice.lotNumber, choice.lotName)} ·{" "}
                {formatStoredQuetzales(choice.priceGtq)} · {guatemalaInventoryStatusLabel(choice.status, choice.published)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {garment ? (
        <section className="panel" aria-live="polite">
          {garment.photo ? (
            <img
              className="gt-scan-photo"
              alt={garment.title || garment.sku}
              src={`data:${garment.photo.mediaType};base64,${garment.photo.data}`}
            />
          ) : (
            <p className="gt-scan-missing-photo">Sin foto</p>
          )}
          <h2>{garment.title || "Prenda sin título"}</h2>
          <p>SKU {garment.sku}</p>
          <p>{scanLotLabel(garment.lotNumber, garment.lotName)}</p>
          <p>Precio {formatStoredQuetzales(garment.priceGtq)}</p>
          <p>{guatemalaInventoryStatusLabel(garment.status, garment.published)}</p>
          <p className="note">Etiqueta: {garmentQrText(garment.id)}</p>
          {decision && !decision.canSell ? (
            <p className="note note-error" role="alert">
              {decision.message}
            </p>
          ) : null}
          {saved ? (
            <div className="gt-sale-box" role="status">
              <h3>Venta registrada</h3>
              <p>Precio cobrado {formatStoredQuetzales(saved.chargedPriceGtq)}</p>
              {saved.paymentMethod === "efectivo" && saved.changeGtq != null ? <p>{changeDueLabel(saved.changeGtq)}</p> : null}
              {saved.paymentMethod === "transferencia" ? <p>Transferencia</p> : null}
              <button type="button" className="btn btn-primary" onClick={() => void scanNext()}>
                Escanear siguiente
              </button>
            </div>
          ) : null}
          {decision?.canSell && !saved && saleStep === "form" ? (
            <form
              className="gt-sale-box"
              onSubmit={(event) => {
                event.preventDefault();
                const gate = saleMayBeSubmitted(navigator.onLine);
                if (!gate.ok) {
                  setSaleError(gate.error);
                  return;
                }
                if (!chargedPrice || !preparedPayment?.ok) {
                  setSaleError(preparedPayment && !preparedPayment.ok ? preparedPayment.error : "Escribe un precio cobrado mayor que cero.");
                  return;
                }
                setSaleError("");
                setSaleStep("confirm");
              }}
            >
              <h3>Registrar venta</h3>
              <p>Escanear no vende la prenda. Revisa el precio y confirma.</p>
              <label htmlFor="charged-price">Precio cobrado</label>
              <div className="gt-sale-price">
                <span aria-hidden="true">Q</span>
                <input
                  id="charged-price"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="0.00"
                  value={chargedDraft}
                  onChange={(event) => setChargedDraft(event.target.value)}
                />
              </div>
              <SaleTender
                chargedPrice={chargedPrice}
                method={paymentMethod}
                cashDraft={cashDraft}
                onCashDraft={setCashDraft}
                onMethod={setPaymentMethod}
              />
              {saleError ? (
                <p className="note note-error" role="alert">
                  {saleError}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary" disabled={!saleReady || !online}>
                Registrar venta
              </button>
            </form>
          ) : null}
          {decision?.canSell && !saved && saleStep === "confirm" && chargedPrice ? (
            <div className="gt-sale-box">
              <h3>Resumen de la venta</h3>
              <p>SKU {garment.sku}</p>
              <p>Precio {formatStoredQuetzales(garment.priceGtq)}</p>
              <p>Precio cobrado {formatStoredQuetzales(chargedPrice)}</p>
              <SaleTender
                chargedPrice={chargedPrice}
                method={paymentMethod}
                cashDraft={cashDraft}
                onCashDraft={setCashDraft}
                onMethod={setPaymentMethod}
              />
              {saleError ? (
                <p className="note note-error" role="alert">
                  {saleError}
                </p>
              ) : null}
              <div className="gt-inventory-actions">
                <button type="button" className="btn btn-primary" disabled={savingSale || !online || !saleReady} onClick={() => void confirmSale()}>
                  {savingSale ? "Guardando…" : "Confirmar venta"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={savingSale} onClick={() => setSaleStep("form")}>
                  Volver
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
