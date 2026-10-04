function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function visible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.height < 120;
}

function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function findField(aliases) {
  const fields = [...document.querySelectorAll("input, textarea")].filter(visible);
  for (const alias of aliases) {
    const wanted = alias.toLowerCase();
    const match = fields.find((el) => {
      const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      if (placeholder.includes(wanted) || aria.includes(wanted) || name === wanted) return true;
      const id = el.id;
      if (!id) return false;
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      return Boolean(label && clean(label.textContent).toLowerCase().includes(wanted));
    });
    if (match && match.type !== "file") return match;
  }
  return null;
}

function base64ToBlob(data, mediaType) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType || "image/jpeg" });
}

async function loadMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension could not reach your app.");
  return response.body;
}

async function attachPhotos(photoCount, log) {
  if (!photoCount) {
    log.push("Photos: this Ready item has no saved photos.");
    return;
  }
  const input = [...document.querySelectorAll('input[type="file"]')].find((el) => {
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    return !accept || accept.includes("image");
  });
  if (!input) {
    log.push("Photos: no file selector was found on this page.");
    return;
  }
  const transfer = new DataTransfer();
  for (let index = 0; index < photoCount; index += 1) {
    const body = await loadMessage({ type: "load-photo", index });
    const photo = body.photo;
    transfer.items.add(new File([base64ToBlob(photo.data, photo.mediaType)], photo.name, { type: photo.mediaType }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(600);
  const kept = input.files?.length || 0;
  if (kept === photoCount) log.push(`Photos: attached ${kept} file(s) to the selector.`);
  else log.push(`Photos: the page did not keep the files (${kept} of ${photoCount}). Upload them yourself.`);
}

function descriptionWithSku(description, sku) {
  const body = String(description || "").replace(/\s+$/u, "");
  const code = String(sku || "").trim();
  if (!code) return body;
  const line = `SKU: ${code}`;
  if (!body || body === line || body.endsWith(`\n${line}`)) return body || line;
  return `${body}\n${line}`;
}

function fillText(label, aliases, value, log) {
  if (!value) {
    log.push(`${label}: nothing saved to fill.`);
    return;
  }
  const field = findField(aliases);
  if (!field) {
    log.push(`${label}: field not found.`);
    return;
  }
  field.focus();
  setNativeValue(field, value);
  log.push(`${label}: filled.`);
}

async function fillNikeItem(log) {
  const item = await loadMessage({ type: "load-assist" });
  log.push(`SKU ${item.sku}`);
  await attachPhotos(item.photoCount || 0, log);
  fillText("Title", ["title", "what are you selling", "tell buyers"], item.title, log);
  fillText(
    "Description",
    ["description", "describe your item", "describe"],
    descriptionWithSku(item.description, item.sku),
    log
  );
  if (item.sku) log.push(`Description: added SKU: ${item.sku}`);
  log.push("Sell was not pressed. Choose the Vinted category yourself.");
}

function mountPanel() {
  if (!/\/items\/new/.test(location.pathname)) return;
  if (document.querySelector(".vinted-assist")) return;
  const panel = document.createElement("aside");
  panel.className = "vinted-assist";
  panel.innerHTML = `
    <strong>Listing Writer assist</strong>
    <p>Fills the current Ready Vinted item. It does not press Sell.</p>
    <button type="button" id="vinted-assist-fill">Fill Ready Vinted item</button>
    <pre id="vinted-assist-log"></pre>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#vinted-assist-fill").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const output = panel.querySelector("#vinted-assist-log");
    button.disabled = true;
    const log = [];
    output.textContent = "Working…";
    try {
      await fillNikeItem(log);
    } catch (error) {
      log.push(error.message);
    } finally {
      output.textContent = log.join("\n");
      button.disabled = false;
    }
  });
}

mountPanel();
