const TARGET_BYTES = 2 * 1024 * 1024;
const HARD_MAX_BYTES = 7 * 1024 * 1024;
const JPEG_QUALITIES = [0.92, 0.9, 0.88, 0.86];

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

function norm(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isClickable(el) {
  if (!el || el.closest?.(".vinted-assist-v2")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
}

function isFieldRow(el) {
  const rect = el.getBoundingClientRect();
  return rect.height >= 20 && rect.height <= 140 && rect.width >= 40 && rect.width <= 900;
}

function findTrigger(aliases) {
  const wanted = aliases.map(norm);
  const tested = [...document.querySelectorAll("[data-testid]")].find((el) => {
    const id = norm(el.getAttribute("data-testid") || "").replace(/[_-]+/g, " ");
    return wanted.some((alias) => id === alias || id.includes(` ${alias}`) || id.includes(`${alias} `));
  });
  if (tested) {
    const button = [tested, ...tested.querySelectorAll("button, [role='button'], [role='combobox']")].find(
      (el) => isClickable(el) && isFieldRow(el)
    );
    if (button) return button;
  }
  return (
    [...document.querySelectorAll("button, [role='button'], [role='combobox']")].find((node) => {
      if (!isClickable(node) || !isFieldRow(node)) return false;
      const text = norm(clean(node.innerText || node.getAttribute("aria-label") || "").split("\n")[0]);
      return wanted.includes(text);
    }) || null
  );
}

function fieldShows(aliases, value) {
  const trigger = findTrigger(aliases);
  if (!trigger) return false;
  const wanted = norm(value);
  if (!wanted) return false;
  return clean(trigger.innerText || "")
    .split(/[\n,]/)
    .slice(0, 4)
    .map(norm)
    .includes(wanted);
}

function activeSurface() {
  const surfaces = [...document.querySelectorAll("[role='dialog'], [role='listbox'], [role='menu']")].filter(isClickable);
  return surfaces.length ? surfaces[surfaces.length - 1] : null;
}

function collectOptions() {
  const surface = activeSurface();
  const selector = surface
    ? "[role='option'], [role='radio'], [role='menuitem'], [role='menuitemradio'], [role='button'], button, li, [tabindex='0']"
    : "[role='option'], [role='radio'], [role='menuitem'], [role='menuitemradio'], [role='button']";
  const blocked = new Set([
    "done",
    "save",
    "apply",
    "cancel",
    "close",
    "back",
    "sell",
    "create a brand",
    "use as brand",
    "list without brand",
    "no brand",
  ]);
  const seen = new Set();
  const options = [];
  for (const node of (surface || document).querySelectorAll(selector)) {
    if (!isClickable(node)) continue;
    const text = clean(node.innerText || node.getAttribute("aria-label") || "").split("\n")[0];
    const key = norm(text);
    if (!key || key.length > 60 || blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    options.push({ el: node, text, key });
  }
  return options;
}

function matchOption(candidates) {
  for (const candidate of candidates.map(norm).filter(Boolean)) {
    const match = collectOptions().find((option) => option.key === candidate);
    if (match) return match;
  }
  return null;
}

async function waitForOptions(timeout) {
  const deadline = Date.now() + timeout;
  let options = [];
  while (Date.now() < deadline) {
    options = collectOptions();
    if (options.length > 0) return options;
    await sleep(200);
  }
  return options;
}

function closeSurface() {
  const done = [...document.querySelectorAll("button")].find((el) => {
    if (!isClickable(el)) return false;
    const text = norm(el.innerText || "");
    return text === "done" || text === "save" || text === "apply";
  });
  if (done) {
    done.click();
    return;
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

function sizeCandidates(saved) {
  const value = norm(saved);
  const aliases = {
    xs: ["xs", "extra small"],
    s: ["s", "small"],
    m: ["m", "medium"],
    l: ["l", "large"],
    xl: ["xl", "extra large"],
    xxl: ["xxl", "2xl"],
    "2xl": ["2xl", "xxl"],
  };
  return aliases[value] || [value];
}

function conditionCandidates(saved) {
  const value = norm(saved);
  const groups = [
    [["new with tags"], ["new with tags", "new"]],
    [["new without tags"], ["new without tags", "like new"]],
    [["new"], ["new"]],
    [["pre-owned excellent", "excellent", "pre-owned very good", "very good"], ["very good"]],
    [["pre-owned good", "good"], ["good"]],
    [["pre-owned fair", "fair", "satisfactory"], ["satisfactory"]],
  ];
  for (const [from, to] of groups) {
    if (from.includes(value)) return to;
  }
  return value ? [value] : [];
}

async function searchAndMatch(query) {
  const surface = activeSurface();
  const input = surface
    ? [...surface.querySelectorAll("input")].find((el) => isClickable(el) && el.type !== "file" && el.type !== "checkbox")
    : null;
  if (!input) return null;
  input.focus();
  setNativeValue(input, query);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const match = matchOption([query]);
    if (match) return match;
    await sleep(200);
  }
  return null;
}

async function selectMenu(label, aliases, saved, candidates, log, options = {}) {
  const value = clean(saved);
  if (!value) {
    log.push(`${label}: nothing saved. Select it yourself.`);
    return;
  }
  const trigger = findTrigger(aliases);
  if (!trigger) {
    log.push(`${label}: menu was not found. Select it yourself.`);
    return;
  }
  if (fieldShows(aliases, value) || candidates.some((candidate) => fieldShows(aliases, candidate))) {
    log.push(`${label}: selected ${value}.`);
    return;
  }
  trigger.click();
  const loaded = await waitForOptions(options.timeout || 8000);
  if (loaded.length === 0) {
    closeSurface();
    log.push(`${label}: options did not load. Select it yourself.`);
    return;
  }
  let match = matchOption(candidates);
  if (!match && options.search) match = await searchAndMatch(value);
  if (!match) {
    closeSurface();
    log.push(`${label}: ${value} was not in Vinted's list. Select it yourself.`);
    return;
  }
  match.el.click();
  await sleep(400);
  if (activeSurface()) closeSurface();
  await sleep(300);
  const kept = fieldShows(aliases, match.text) || fieldShows(aliases, value);
  if (!kept) {
    log.push(`${label}: ${match.text} was clicked but Vinted did not keep it. Select it yourself.`);
    return;
  }
  log.push(`${label}: selected ${match.text}.`);
}

async function selectColors(saved, log) {
  const colors = String(saved || "")
    .split(",")
    .map(clean)
    .filter(Boolean);
  if (colors.length === 0) {
    log.push("Color: nothing saved. Select it yourself.");
    return;
  }
  const aliases = ["color", "colour", "colors", "colours"];
  const trigger = findTrigger(aliases);
  if (!trigger) {
    log.push("Color: menu was not found. Select it yourself.");
    return;
  }
  const pending = colors.filter((color) => !fieldShows(aliases, color));
  if (pending.length === 0) {
    log.push(`Color: selected ${colors.join(", ")}.`);
    return;
  }
  trigger.click();
  const loaded = await waitForOptions(8000);
  if (loaded.length === 0) {
    closeSurface();
    log.push("Color: options did not load. Select it yourself.");
    return;
  }
  const missing = [];
  const chosen = [];
  for (const color of pending) {
    const match = matchOption([color]);
    if (!match) {
      missing.push(color);
      continue;
    }
    match.el.click();
    chosen.push(match.text);
    await sleep(250);
  }
  if (activeSurface()) closeSurface();
  await sleep(300);
  for (const color of chosen) {
    if (fieldShows(aliases, color)) log.push(`Color: selected ${color}.`);
    else log.push(`Color: ${color} was clicked but Vinted did not keep it. Select it yourself.`);
  }
  for (const color of missing) log.push(`Color: ${color} was not in Vinted's list. Select it yourself.`);
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function base64ToBlob(data, mediaType) {
  const binary = atob(data);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([buffer], { type: mediaType || "image/jpeg" });
}

function photoKey(data) {
  return `${data.length}:${data.slice(0, 80)}:${data.slice(-80)}`;
}

async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(blob);
  }
}

function fittedSize(width, height, maxLongEdge) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renderJpeg(bitmap, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) reject(new Error("Could not prepare the photo."));
        else resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function optimizePhoto(blob) {
  if (blob.size <= TARGET_BYTES) return { blob, compressed: false };
  const bitmap = await decodeImage(blob);
  try {
    let maxLongEdge = Math.max(bitmap.width, bitmap.height);
    let bestSafe = null;
    while (maxLongEdge >= 1200) {
      const size = fittedSize(bitmap.width, bitmap.height, maxLongEdge);
      let safeAtThisSize = null;
      for (const quality of JPEG_QUALITIES) {
        const jpeg = await renderJpeg(bitmap, size.width, size.height, quality);
        if (jpeg.size <= TARGET_BYTES) return { blob: jpeg, compressed: true };
        if (jpeg.size <= HARD_MAX_BYTES && !safeAtThisSize) safeAtThisSize = jpeg;
      }
      if (safeAtThisSize) bestSafe = safeAtThisSize;
      const longEdge = Math.max(size.width, size.height);
      const nextEdge = Math.round(longEdge * 0.8);
      if (nextEdge >= longEdge || nextEdge < 1200) break;
      if (nextEdge < 1800 && bestSafe) break;
      maxLongEdge = nextEdge;
    }
    if (!bestSafe || bestSafe.size > HARD_MAX_BYTES) {
      throw new Error("Could not reduce it below Vinted's 9 MB limit.");
    }
    return { blob: bestSafe, compressed: true };
  } finally {
    bitmap.close();
  }
}

function fileInput() {
  return [...document.querySelectorAll('input[type="file"]')].find((el) => {
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    return !accept || accept.includes("image");
  });
}

function srcOf(img) {
  return img.currentSrc || img.src || "";
}

function previewImages() {
  return [...document.querySelectorAll("img")].filter((img) => {
    if (img.closest(".vinted-assist-v2")) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 56 || rect.height < 56) return false;
    const src = srcOf(img);
    return Boolean(src) && !src.startsWith("data:image/svg");
  });
}

async function waitUntilVintedAccepts(before) {
  const deadline = Date.now() + 45000;
  let stableSrc = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const img = previewImages().find((candidate) => {
      const src = srcOf(candidate);
      return !before.has(src) && src.startsWith("https:") && candidate.naturalWidth > 0;
    });
    const src = img ? srcOf(img) : "";
    if (src && src === stableSrc && Date.now() - stableSince >= 3000) return true;
    if (src !== stableSrc) {
      stableSrc = src;
      stableSince = src ? Date.now() : 0;
    }
    await sleep(200);
  }
  return false;
}

function uploadName(name, index, compressed) {
  const base = String(name || `photo-${index + 1}`).replace(/\.[^.]+$/, "");
  if (compressed) return `${base}.jpg`;
  return name || `${base}.jpg`;
}

async function loadMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension could not reach your app.");
  return response.body;
}

async function attachPhotos(item, log) {
  const photoCount = item.photoCount || 0;
  if (!photoCount) {
    log.push("Photos: this item has no saved photos. Upload them yourself.");
    return;
  }
  const input = fileInput();
  if (!input) {
    log.push("Photos: no file selector was found. Upload them yourself.");
    return;
  }

  const seen = new Set();
  let accepted = 0;
  for (let index = 0; index < photoCount; index += 1) {
    const label = `Photo ${index + 1}`;
    let body;
    try {
      body = await loadMessage({
        type: "load-photo",
        index,
        sku: item.sku,
        updatedAt: item.updatedAt,
      });
    } catch (error) {
      log.push(`${label}: failed. ${error.message} Upload this photo and any remaining photos yourself.`);
      break;
    }
    if (body.sku && body.sku !== item.sku) {
      log.push(`${label}: failed. It belongs to SKU ${body.sku}, not ${item.sku}. Upload the photos yourself.`);
      break;
    }
    const raw = String(body.photo?.data || "");
    if (!raw) {
      log.push(`${label}: failed. The saved photo is empty. Upload this photo and any remaining photos yourself.`);
      break;
    }
    const key = photoKey(raw);
    if (seen.has(key)) {
      log.push(`${label}: skipped. This photo is a duplicate.`);
      continue;
    }
    seen.add(key);

    let prepared;
    let originalSize = 0;
    try {
      const source = base64ToBlob(raw, body.photo.mediaType);
      originalSize = source.size;
      prepared = await optimizePhoto(source);
    } catch (error) {
      log.push(`${label}: failed. ${error.message} Upload this photo and any remaining photos yourself.`);
      break;
    }
    log.push(
      prepared.compressed
        ? `${label}: ${formatMb(originalSize)} → ${formatMb(prepared.blob.size)}`
        : `${label}: ${formatMb(prepared.blob.size)}, sent unchanged.`
    );

    const before = new Set(previewImages().map(srcOf));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([prepared.blob], uploadName(body.photo.name, index, prepared.compressed), {
        type: prepared.compressed ? "image/jpeg" : prepared.blob.type || body.photo.mediaType || "image/jpeg",
        lastModified: Date.now(),
      })
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const received = await waitUntilVintedAccepts(before);
    if (!received) {
      log.push(`${label}: Vinted did not accept it. Upload this photo and any remaining photos yourself.`);
      break;
    }
    input.value = "";
    accepted += 1;
    log.push(`${label}: accepted by Vinted`);
  }
  log.push(`Photos: Vinted accepted ${accepted} of ${photoCount}.`);
}

function descriptionWithSku(description, sku) {
  const code = String(sku || "").trim();
  const lines = String(description || "").replace(/\s+$/u, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length > 0 && /^SKU:\s*\S+\s*$/u.test(lines[lines.length - 1].trim())) lines.pop();
  const body = lines.join("\n").replace(/\s+$/u, "");
  if (!code) return body;
  const line = `SKU: ${code}`;
  return body ? `${body}\n${line}` : line;
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
  fillField(
    "Description",
    ["description", "describe your item", "describe"],
    descriptionWithSku(item.description, item.sku),
    log
  );
  fillField("Price", ["price"], item.price, log);
  fillField("Category", ["category"], item.category, log);
  await selectMenu("Brand", ["brand"], item.brand, [item.brand], log, { search: true });
  await selectMenu("Size", ["size"], item.size, sizeCandidates(item.size), log, { timeout: 8000 });
  await selectMenu("Condition", ["condition"], item.condition, conditionCandidates(item.condition), log);
  await selectColors(item.color, log);
  log.push("Sell was not pressed.");
}

function mountPanel() {
  if (!/\/items\/new/.test(location.pathname)) return;
  if (document.querySelector(".vinted-assist-v2")) return;
  const panel = document.createElement("aside");
  panel.className = "vinted-assist vinted-assist-v2";
  panel.innerHTML = `
    <strong>Listing Writer Vinted V2</strong>
    <p>Fills the ready item and uploads its photos one at a time. It does not press Sell.</p>
    <button type="button" id="vinted-assist-fill">Fill Ready Vinted item</button>
    <pre id="vinted-assist-log"></pre>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#vinted-assist-fill").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const output = panel.querySelector("#vinted-assist-log");
    button.disabled = true;
    const lines = [];
    const log = {
      push(line) {
        lines.push(line);
        output.textContent = lines.join("\n");
      },
    };
    output.textContent = "Working…";
    try {
      await fillReadyItem(log);
    } catch (error) {
      log.push(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

const VINTED_SYNC_LIMIT = 10;

function onClosetPage() {
  const path = location.pathname;
  if (/\/items\/(?:new|\d+)/.test(path)) return false;
  return /\/member\/\d+/.test(path) || /\/wardrobe/.test(path);
}

function itemFromAnchor(anchor) {
  const href = anchor.href || anchor.getAttribute("href") || "";
  const match = String(href).match(/\/items\/(\d+)/i);
  if (!match) return null;
  let url;
  try {
    url = new URL(href, location.origin);
  } catch (error) {
    return null;
  }
  if (!/vinted\./i.test(url.hostname)) return null;
  url.hash = "";
  url.search = "";
  const image = anchor.querySelector("img");
  const title = clean(anchor.getAttribute("title") || image?.alt || anchor.innerText || "");
  const visible = `${title}\n${anchor.innerText || ""}`;
  const skuMatch = visible.match(/SKU:\s*([A-Za-z0-9][A-Za-z0-9-]{2,40})/i);
  return {
    vintedItemId: match[1],
    title: title.replace(/^SKU:\s*[A-Za-z0-9][A-Za-z0-9-]{2,40}\s*/i, "").trim(),
    url: url.toString(),
    photoUrl: image ? srcOf(image) : "",
    brand: "",
    size: "",
    listedSku: skuMatch ? skuMatch[1] : "",
  };
}

function harvestCloset(seen, batch) {
  let added = 0;
  document.querySelectorAll('a[href*="/items/"]').forEach((anchor) => {
    if (batch.length >= VINTED_SYNC_LIMIT) return;
    const item = itemFromAnchor(anchor);
    if (!item || seen.has(item.vintedItemId)) return;
    seen.add(item.vintedItemId);
    batch.push(item);
    added += 1;
  });
  return added;
}

async function syncCloset(resume, log) {
  const stored = await chrome.storage.local.get(["vintedInventorySeen"]);
  const seen = new Set(resume && Array.isArray(stored.vintedInventorySeen) ? stored.vintedInventorySeen : []);
  if (!resume) seen.clear();
  const batch = [];
  let quiet = 0;
  for (let step = 0; step < 12 && batch.length < VINTED_SYNC_LIMIT; step += 1) {
    const added = harvestCloset(seen, batch);
    log.push(`Recopiladas en esta pasada: ${batch.length}.`);
    if (!added) quiet += 1;
    else quiet = 0;
    if (quiet >= 2 || batch.length >= VINTED_SYNC_LIMIT) break;
    window.scrollBy(0, Math.max(500, window.innerHeight));
    await sleep(900);
  }
  await chrome.storage.local.set({ vintedInventorySeen: Array.from(seen) });
  if (!batch.length) {
    log.push("No aparecieron publicaciones nuevas. Puedes reanudar o importar un archivo.");
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "sync-inventory", items: batch });
  if (!response?.ok) throw new Error(response?.error || "No se pudo guardar la sincronización.");
  const body = response.body || {};
  log.push(`Enviadas: ${body.received || batch.length}. Nuevas: ${body.inserted || 0}. Verificadas conservadas: ${body.keptVerified || 0}.`);
  log.push("No se editó, retiró ni republicó ningún anuncio.");
}

function mountInventoryPanel() {
  if (!onClosetPage() || document.querySelector(".vinted-inventory-sync")) return;
  const panel = document.createElement("aside");
  panel.className = "vinted-assist vinted-assist-v2 vinted-inventory-sync";
  panel.innerHTML = `
    <strong>Sincronizar inventario Vinted</strong>
    <p>Lee hasta 10 publicaciones visibles de este perfil. No modifica anuncios.</p>
    <button type="button" id="vinted-sync-start">Sincronizar 10</button>
    <button type="button" id="vinted-sync-resume">Reanudar</button>
    <label>Importar archivo <input id="vinted-sync-file" type="file" accept=".csv,.json,text/csv,application/json"></label>
    <pre id="vinted-sync-log"></pre>
  `;
  document.body.appendChild(panel);
  const output = panel.querySelector("#vinted-sync-log");
  async function run(task) {
    const lines = [];
    const log = {
      push(line) {
        lines.push(line);
        output.textContent = lines.join("\n");
      },
    };
    panel.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    try {
      await task(log);
    } catch (error) {
      log.push(error.message);
    } finally {
      panel.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }
  panel.querySelector("#vinted-sync-start").addEventListener("click", () => run((log) => syncCloset(false, log)));
  panel.querySelector("#vinted-sync-resume").addEventListener("click", () => run((log) => syncCloset(true, log)));
  panel.querySelector("#vinted-sync-file").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    run(async (log) => {
      const text = await file.text();
      const response = await chrome.runtime.sendMessage({ type: "sync-inventory-file", text });
      if (!response?.ok) throw new Error(response?.error || "No se pudo importar el archivo.");
      log.push(`Importadas en esta prueba: ${response.body?.received || 0}.`);
    });
  });
}

mountPanel();
mountInventoryPanel();
