"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import {
  QR_MESSAGES,
  cameraFailureMessage,
  cameraMayRetry,
  fichaForCharge,
  garmentQrText,
  readScannedLabel,
  scanLotLabel,
  takeGarmentScan,
  type GarmentScanMemory,
} from "@/lib/markets/guatemala-qr";

const scanConfig = {
  fps: 8,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
    const size = Math.max(140, edge);
    return { width: Math.min(size, viewfinderWidth), height: Math.min(size, viewfinderHeight) };
  },
};

export function SaleGarmentScanner({
  active,
  onText,
  onClose,
}: {
  active: boolean;
  onText: (text: string) => boolean;
  onClose: () => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const ticketRef = useRef(0);
  const memoryRef = useRef<GarmentScanMemory | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    return () => {
      ticketRef.current += 1;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) void scanner.stop().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      memoryRef.current = null;
      ticketRef.current += 1;
      void releaseCamera();
      markLive(false);
      return;
    }
    const ticket = ticketRef.current + 1;
    ticketRef.current = ticket;
    memoryRef.current = null;
    void start(ticket);
    return () => {
      ticketRef.current += 1;
    };
    // start reads the latest ticket and ignores a camera that was already replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function markLive(live: boolean) {
    document.getElementById("gt-sale-qr-reader")?.classList.toggle("is-live", live);
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

  async function openCamera(ticket: number, facingMode: "environment" | "user") {
    const { Html5Qrcode } = await import("html5-qrcode");
    if (ticket !== ticketRef.current) return;
    const scanner = new Html5Qrcode("gt-sale-qr-reader", { verbose: false, useBarCodeDetectorIfSupported: true });
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode },
        scanConfig,
        (decoded) => {
          if (ticket !== ticketRef.current) return;
          const taken = takeGarmentScan(memoryRef.current, decoded);
          if (!taken.text) return;
          if (!onTextRef.current(taken.text)) return;
          memoryRef.current = taken.memory;
        },
        () => undefined
      );
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

  async function start(ticket: number) {
    setCameraError("");
    await releaseCamera();
    if (ticket !== ticketRef.current) return;
    if (!window.isSecureContext) {
      setCameraError("La cámara solo funciona con la página en HTTPS. Ábrela con https o escribe el SKU.");
      markLive(false);
      return;
    }
    markLive(true);
    try {
      await openCamera(ticket, "environment");
    } catch (error) {
      if (ticket !== ticketRef.current) return;
      await releaseCamera();
      if (!cameraMayRetry(error)) {
        markLive(false);
        setCameraError(cameraFailureMessage(error));
        return;
      }
      try {
        await openCamera(ticket, "user");
      } catch (again) {
        if (ticket !== ticketRef.current) return;
        markLive(false);
        setCameraError(cameraFailureMessage(again));
        await releaseCamera();
      }
    }
  }

  return (
    <div>
      {cameraError ? (
        <p className="note note-error" role="alert">
          {cameraError}
        </p>
      ) : null}
      <div id="gt-sale-qr-reader" className={active ? "gt-qr-reader is-live" : "gt-qr-reader"} />
      {active && !cameraError ? <p>Apunta la cámara al QR de la prenda. Escanear la agrega a esta venta y no la guarda.</p> : null}
      <div className="gt-inventory-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cerrar cámara
        </button>
      </div>
    </div>
  );
}

type ChargeRequest = (path: string, body?: unknown) => Promise<Response>;

type ChargeGarment = {
  id: string;
  sku: string;
  title: string;
  status: string;
  lotNumber: number | null;
  lotName: string | null;
};

export function ChargeScanPanel({
  clientId,
  request,
  onOpen,
}: {
  clientId: string;
  request: ChargeRequest;
  onOpen: (itemId: string) => void;
}) {
  const lookupRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [notice, setNotice] = useState("");
  const [choices, setChoices] = useState<ChargeGarment[]>([]);

  function openGarment(garment: ChargeGarment) {
    const destination = fichaForCharge(garment);
    if (!destination.open) {
      setNotice(destination.notice);
      return;
    }
    setNotice("");
    setChoices([]);
    setCameraOn(false);
    onOpen(destination.itemId);
  }

  function onScannedText(text: string): boolean {
    if (lookupRef.current) return false;
    lookupRef.current = true;
    void lookup(text).finally(() => {
      lookupRef.current = false;
    });
    return true;
  }

  async function lookup(text: string) {
    const read = readScannedLabel(text);
    if (!read.ok) {
      setNotice(read.error);
      return;
    }
    const params = new URLSearchParams({ clientId });
    if (read.kind === "code") params.set("codigo", garmentQrText(read.itemId));
    else params.set("sku", read.sku);
    try {
      const response = await request(`/api/markets/guatemala/inventory/qr?${params.toString()}`);
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        choice?: "one" | "many";
        garment?: ChargeGarment;
        garments?: ChargeGarment[];
      };
      if (!response.ok || !body.ok) {
        setNotice(body.error || (read.kind === "code" ? QR_MESSAGES.unknownCode : QR_MESSAGES.unknownSku));
        return;
      }
      const found = body.choice === "many" ? body.garments ?? [] : body.garment ? [body.garment] : [];
      if (found.length > 1) {
        setChoices(found);
        setNotice("");
        setCameraOn(false);
        return;
      }
      const garment = found[0];
      if (!garment) {
        setNotice(read.kind === "code" ? QR_MESSAGES.unknownCode : QR_MESSAGES.unknownSku);
        return;
      }
      openGarment(garment);
    } catch {
      setNotice("No se pudo buscar la prenda.");
    }
  }

  return (
    <section className="panel" id="escanear-cobro">
      <h2>Escanear para cobrar</h2>
      <p>El QR busca la prenda por su SKU y abre la ficha. La venta se guarda al confirmar el cobro.</p>
      {cameraOn ? (
        <SaleGarmentScanner active onText={onScannedText} onClose={() => setCameraOn(false)} />
      ) : (
        <div className="gt-inventory-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNotice("");
              setCameraOn(true);
            }}
          >
            Escanear para cobrar
          </button>
        </div>
      )}
      {notice ? (
        <p className="note note-error" role="alert">
          {notice}
        </p>
      ) : null}
      {choices.length > 1 ? (
        <div className="gt-scan-choices">
          {choices.map((choice) => (
            <button key={choice.id} type="button" className="btn btn-ghost gt-scan-choice" onClick={() => openGarment(choice)}>
              {choice.title || "Prenda sin título"} · SKU {choice.sku} · {scanLotLabel(choice.lotNumber, choice.lotName)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
