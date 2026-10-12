const APP_URL = "https://hahm-ebay-lister-tau-one.vercel.app";

async function settings() {
  const saved = await chrome.storage.local.get(["appSecret"]);
  const appSecret = String(saved.appSecret || "");
  if (!appSecret) {
    throw new Error("Open the extension settings and save your access code.");
  }
  return { appUrl: APP_URL, appSecret };
}

async function assistGet(query) {
  const { appUrl, appSecret } = await settings();
  const response = await fetch(`${appUrl}/api/vinted/assist?${query}`, {
    cache: "no-store",
    headers: {
      "x-app-secret": appSecret,
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.error || `Assist request failed (${response.status}).`);
  }
  return body;
}

async function syncInventory(payload) {
  const { appUrl, appSecret } = await settings();
  const response = await fetch(`${appUrl}/api/vinted/inventory/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-secret": appSecret,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.error || `Sync request failed (${response.status}).`);
  }
  return body;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync-inventory") {
    syncInventory({ items: message.items })
      .then((body) => sendResponse({ ok: true, body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "sync-inventory-file") {
    syncInventory({ text: String(message.text || "").slice(0, 200000) })
      .then((body) => sendResponse({ ok: true, body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== "load-ready" && message?.type !== "load-photo") return;
  const params = new URLSearchParams();
  params.set("t", String(Date.now()));
  if (message.sku) params.set("sku", String(message.sku));
  if (message.updatedAt) params.set("rev", String(message.updatedAt));
  if (message.type === "load-photo") params.set("photo", String(message.index));
  assistGet(params.toString())
    .then((body) => sendResponse({ ok: true, body }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
