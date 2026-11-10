"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import {
  PRICE_QR_MESSAGES,
  PRICE_QR_SPEC,
  cameraMayRetry,
  priceCameraFailureMessage,
  takePriceScan,
  type PriceScanMemory,
} from "@/lib/markets/guatemala-qr";
import { pricedTicket, type PricedPieceLine } from "@/lib/markets/guatemala-skuless";

const scanConfig = {
  fps: 8,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
    const size = Math.max(140, edge);
    return { width: Math.min(size, viewfinderWidth), height: Math.min(size, viewfinderHeight) };
  },
};

export function PriceQrScanner({
  lines,
  disabled,
  onAdd,
  onRemove,
}: {
  lines: readonly PricedPieceLine[];
  disabled: boolean;
  onAdd: (priceGtq: string) => void;
  onRemove: (priceGtq: string) => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const ticketRef = useRef(0);
  const memoryRef = useRef<PriceScanMemory | null>(null);
  const onAddRef = useRef(onAdd);
  const disabledRef = useRef(disabled);
  onAddRef.current = onAdd;
  disabledRef.current = disabled;
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanError, setScanError] = useState("");
  const summary = pricedTicket(lines);

  useEffect(() => {
    return () => {
      ticketRef.current += 1;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) void scanner.stop().catch(() => undefined);
    };
  }, []);

  function markLive(live: boolean) {
    document.getElementById("gt-price-qr-reader")?.classList.toggle("is-live", live);
  }

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

  async function stopCamera() {
    ticketRef.current += 1;
    memoryRef.current = null;
    setCameraOn(false);
    markLive(false);
    await releaseCamera();
  }

  async function openCamera(ticket: number, facingMode: "environment" | "user") {
    const { Html5Qrcode } = await import("html5-qrcode");
    if (ticket !== ticketRef.current) return;
    const scanner = new Html5Qrcode("gt-price-qr-reader", { verbose: false, useBarCodeDetectorIfSupported: true });
    scannerRef.current = scanner;
    try {
      await scanner.start({ facingMode }, scanConfig, (decoded) => onDecoded(decoded), () => undefined);
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
      setCameraError(PRICE_QR_MESSAGES.cameraInsecure);
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
        setCameraError(priceCameraFailureMessage(error));
        return;
      }
      try {
        await openCamera(ticket, "user");
      } catch (again) {
        if (ticket !== ticketRef.current) return;
        setCameraOn(false);
        markLive(false);
        setCameraError(priceCameraFailureMessage(again));
        await releaseCamera();
      }
    }
  }

  function onDecoded(text: string) {
    const taken = takePriceScan(memoryRef.current, text, Date.now());
    memoryRef.current = taken.memory;
    if (disabledRef.current) return;
    if (taken.error) {
      setScanError(taken.error);
      return;
    }
    if (!taken.priceGtq) return;
    setScanError("");
    onAddRef.current(taken.priceGtq);
  }

  return (
    <div>
      <h3>Escanear QR de precio</h3>
      <p>{PRICE_QR_SPEC}</p>
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
        {cameraOn ? (
          <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void stopCamera()}>
            Cerrar cámara
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void startCamera()}>
            Escanear QR de precio
          </button>
        )}
      </div>
      <div id="gt-price-qr-reader" className={cameraOn ? "gt-qr-reader is-live" : "gt-qr-reader"} />
      {cameraOn ? <p>Apunta la cámara trasera al QR del precio. Cerrar cámara la apaga.</p> : null}
      {lines.map((line) => (
        <div key={line.priceGtq} className="gt-sale-box">
          <p>
            {formatStoredQuetzales(line.priceGtq)} · {line.pieces} {line.pieces === 1 ? "pieza" : "piezas"}
          </p>
          <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => onRemove(line.priceGtq)}>
            Quitar pieza
          </button>
        </div>
      ))}
      {summary.pieces > 0 ? (
        <>
          <p className="gt-inventory-count">
            {summary.pieces} {summary.pieces === 1 ? "pieza" : "piezas"}
          </p>
          <p className="gt-report-total">Total a cobrar {formatStoredQuetzales(summary.totalGtq)}</p>
        </>
      ) : null}
    </div>
  );
}
