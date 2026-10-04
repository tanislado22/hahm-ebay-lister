async function settings() {
  const saved = await chrome.storage.local.get(["appUrl", "appSecret"]);
  const appUrl = String(saved.appUrl || "").replace(/\/$/, "");
  const appSecret = String(saved.appSecret || "");
  if (!appUrl || !appSecret) {
    throw new Error("Open the extension settings and save your app URL and access code.");
  }
  return { appUrl, appSecret };
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "load-assist" && message?.type !== "load-photo") return;
  const params = new URLSearchParams();
  if (message.sku) params.set("sku", String(message.sku));
  if (message.type === "load-photo") params.set("photo", String(message.index));
  params.set("t", String(Date.now()));
  assistGet(params.toString())
    .then((body) => sendResponse({ ok: true, body }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
