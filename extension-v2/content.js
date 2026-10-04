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

function labelFor(el) {
  if (el.id) {
    const linked = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (linked) return linked;
  }
  return el.closest("label");
}

function findField(aliases) {
  const fields = [...document.querySelectorAll("input, textarea")].filter(
    (el) => visible(el) && el.type !== "file" && el.type !== "radio" && el.type !== "checkbox"
  );
  for (const alias of aliases) {
    const wanted = alias.toLowerCase();
    const match = fields.find((el) => {
      const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      if (placeholder.includes(wanted) || aria.includes(wanted) || name === wanted) return true;
      const text = clean(labelFor(el)?.textContent).toLowerCase();
      return text === wanted || text.startsWith(`${wanted} `);
    });
    if (match) return match;
  }
  return null;
}

function clickChoice(value) {
  const wanted = clean(value).toLowerCase();
  if (!wanted) return false;
  const inputs = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
  const match = inputs.find((input) => {
    const text = clean(labelFor(input)?.textContent).toLowerCase();
    return text === wanted;
  });
  if (!match) return false;
  match.click();
  return true;
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

function fileInput() {
  return [...document.querySelectorAll('input[type="file"]')].find((el) => {
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    return !accept || accept.includes("image");
  });
}

async function attachPhotos(item, log) {
  const input = fileInput();
  if (!input) {
    log.push("Photos: no file selector was found on this page.");
    return;
  }
  const transfer = new DataTransfer();
  const photoCount = item.photoCount || 0;
  for (let index = 0; index < photoCount; index += 1) {
    const body = await loadMessage({
      type: "load-photo",
      index,
      sku: item.sku,
      updatedAt: item.updatedAt,
    });
    if (body.sku && body.sku !== item.sku) {
      throw new Error(`Photo ${index + 1} belongs to SKU ${body.sku}, not ${item.sku}.`);
    }
    const photo = body.photo;
    transfer.items.add(new File([base64ToBlob(photo.data, photo.mediaType)], photo.name, { type: photo.mediaType }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(600);
  const kept = input.files?.length || 0;
  if (!photoCount) log.push("Photos: cleared. This item has no saved photos.");
  else if (kept === photoCount) log.push(`Photos: attached ${kept} file(s) for SKU ${item.sku}.`);
  else log.push(`Photos: the page kept ${kept} of ${photoCount}. Upload them yourself.`);
}

function fillField(label, aliases, value, log) {
  const field = findField(aliases);
  if (!field) {
    log.push(`${label}: field not found.`);
    return;
  }
  field.focus();
  setNativeValue(field, value || "");
  log.push(value ? `${label}: filled.` : `${label}: cleared.`);
}

async function fillReadyItem(log) {
  const item = await loadMessage({ type: "load-ready" });
  log.push(`SKU ${item.sku}`);
  await attachPhotos(item, log);
  fillField("Title", ["title", "what are you selling", "tell buyers"], item.title, log);
  fillField("Description", ["description", "describe your item", "describe"], item.description, log);
  fillField("Price", ["price"], item.price, log);
  fillField("Brand", ["brand"], item.brand, log);
  fillField("Category", ["category"], item.category, log);
  fillField("Size", ["size"], item.size, log);
  if (!clickChoice(item.condition)) fillField("Condition", ["condition"], item.condition, log);
  else log.push("Condition: selected.");
  const colors = String(item.color || "").split(",").map((part) => part.trim()).filter(Boolean);
  const selectedColors = colors.filter((color) => clickChoice(color));
  if (selectedColors.length === colors.length && colors.length > 0) log.push("Color: selected.");
  else fillField("Color", ["color", "colour"], item.color, log);
  log.push("Sell was not pressed.");
}

function mountPanel() {
  if (!/\/items\/new/.test(location.pathname)) return;
  if (document.querySelector(".vinted-assist-v2")) return;
  const panel = document.createElement("aside");
  panel.className = "vinted-assist vinted-assist-v2";
  panel.innerHTML = `
    <strong>Listing Writer Vinted V2</strong>
    <p>Fills the one item you just prepared. It does not press Sell.</p>
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
      await fillReadyItem(log);
    } catch (error) {
      log.push(error.message);
    } finally {
      output.textContent = log.join("\n");
      button.disabled = false;
    }
  });
}

mountPanel();
