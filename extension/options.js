const appUrl = document.getElementById("appUrl");
const appSecret = document.getElementById("appSecret");
const status = document.getElementById("status");

chrome.storage.local.get(["appUrl", "appSecret"], (saved) => {
  appUrl.value = saved.appUrl || "";
  appSecret.value = saved.appSecret || "";
});

document.getElementById("save").addEventListener("click", async () => {
  const url = appUrl.value.trim().replace(/\/$/, "");
  const secret = appSecret.value.trim();
  if (!url || !secret) {
    status.textContent = "Enter the app URL and the access code.";
    return;
  }
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    status.textContent = "That app URL is not valid.";
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    status.textContent = "Chrome needs permission to read that site.";
    return;
  }
  await chrome.storage.local.set({ appUrl: url, appSecret: secret });
  status.textContent = "Saved. Open Vinted’s sell page and use Fill Ready Nike item.";
});
