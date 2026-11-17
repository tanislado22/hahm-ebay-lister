"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { QR_MESSAGES, cameraFailureMessage, cameraMayRetry } from "@/lib/markets/guatemala-qr";

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

export function RegistrationQrCamera({
  active,
  onCode,
  onClose,
}: {
  active: boolean;
  onCode: (text: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const ticketRef = useRef(0);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
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
      ticketRef.current += 1;
      void releaseCamera();
      return;
    }
    const ticket = ticketRef.current + 1;
    ticketRef.current = ticket;
    void start(ticket);
    return () => {
      ticketRef.current += 1;
    };
    // start reads the latest ticket and ignores stale cameras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function markLive(live: boolean) {
    document.getElementById("gt-register-qr-reader")?.classList.toggle("is-live", live);
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
    const scanner = new Html5Qrcode("gt-register-qr-reader", { verbose: false, useBarCodeDetectorIfSupported: true });
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode },
        scanConfig,
        (decoded) => {
          if (ticket !== ticketRef.current) return;
          ticketRef.current += 1;
          void releaseCamera().then(() => onCodeRef.current(decoded));
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
      setCameraError(QR_MESSAGES.cameraInsecure);
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
      <div id="gt-register-qr-reader" className="gt-qr-reader" />
      {cameraError ? (
        <p className="note note-error" role="alert">
          {cameraError} Puedes escribir el SKU.
        </p>
      ) : active ? (
        <p>Apunta la cámara al QR del SKU. Si no abre, escribe el SKU.</p>
      ) : null}
      {active ? (
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cerrar cámara
        </button>
      ) : null}
    </div>
  );
}
