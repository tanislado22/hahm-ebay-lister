const APP_URL = "https://hahm-ebay-lister-tau-one.vercel.app";

const appUrl = document.getElementById("appUrl");
const appSecret = document.getElementById("appSecret");
const status = document.getElementById("status");

appUrl.value = APP_URL;

chrome.storage.local.get(["appSecret"], (saved) => {
  appSecret.value = saved.appSecret || "";
});

document.getElementById("save").addEventListener("click", async () => {
  const secret = appSecret.value.trim();
  if (!secret) {
    status.textContent = "Enter the access code.";
    return;
  }
  const origin = new URL(APP_URL).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    status.textContent = "Chrome needs permission to read that site.";
    return;
  }
  await chrome.storage.local.set({ appUrl: APP_URL, appSecret: secret });
  status.textContent = "Saved. Open Vinted’s sell page and use Fill Ready Vinted item.";
});
