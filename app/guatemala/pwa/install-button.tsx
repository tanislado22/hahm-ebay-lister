"use client";

import { useEffect, useState } from "react";
import {
  STAFF_IOS_INSTALL,
  STAFF_MANUAL_INSTALL,
  installSurface,
  isIosDevice,
  type InstallSurface,
} from "@/lib/markets/guatemala-pwa";
import { currentInstallPrompt, promptInstall, subscribeInstallPrompt } from "./install-state";

function standaloneDisplay(): boolean {
  const browser = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || browser.standalone === true;
}

export function InstallAppButton() {
  const [surface, setSurface] = useState<InstallSurface>("manual");
  const [steps, setSteps] = useState("");

  useEffect(() => {
    const sync = () => {
      const next = installSurface({
        standalone: standaloneDisplay(),
        ios: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
        canPrompt: currentInstallPrompt() != null,
      });
      setSurface(next);
      if (next === "installed" || next === "prompt") setSteps("");
    };
    sync();
    return subscribeInstallPrompt(sync);
  }, []);

  if (surface === "installed") return null;

  return (
    <div className="gt-install">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          if (surface === "prompt") {
            void promptInstall();
            return;
          }
          setSteps(surface === "ios" ? STAFF_IOS_INSTALL : STAFF_MANUAL_INSTALL);
        }}
      >
        Instalar aplicación
      </button>
      {steps ? (
        <p className="note" role="status">
          {steps}
        </p>
      ) : null}
    </div>
  );
}
