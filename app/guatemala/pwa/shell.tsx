"use client";

import { useEffect, useState } from "react";
import { STAFF_OFFLINE_NOTICE, STAFF_UPDATE_NOTICE } from "@/lib/markets/guatemala-pwa";
import "./install-state";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function StaffAppShell() {
  const online = useOnlineStatus();
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let hadController = Boolean(navigator.serviceWorker.controller);
    const onController = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    let registration: ServiceWorkerRegistration | null = null;
    const refresh = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    void navigator.serviceWorker
      .register("/guatemala/sw.js", { scope: "/guatemala/", updateViaCache: "none" })
      .then((next) => {
        registration = next;
        refresh();
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (online && !updateReady) return null;

  return (
    <div className="gt-app-notices">
      {online ? null : (
        <p className="note note-error" role="alert">
          {STAFF_OFFLINE_NOTICE}
        </p>
      )}
      {updateReady ? (
        <p className="note" role="status">
          {STAFF_UPDATE_NOTICE}{" "}
          <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </p>
      ) : null}
    </div>
  );
}
