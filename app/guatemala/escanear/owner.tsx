"use client";

import { useSearchParams } from "next/navigation";
import { ReturnHomeBar } from "../return-home";
import { ScanScreen } from "./screen";

export function OwnerScan() {
  const clientId = useSearchParams().get("clientId") ?? "";
  if (!clientId) {
    return (
      <main className="wrap">
        <ReturnHomeBar role="propietario" />
        <p>Selecciona Tienda Guatemala para escanear.</p>
      </main>
    );
  }
  return (
    <>
      <ReturnHomeBar role="propietario" />
      <ScanScreen clientId={clientId} actor="propietario" />
    </>
  );
}
