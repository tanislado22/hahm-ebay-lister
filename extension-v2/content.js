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

function clickChoice(value) {
  const wanted = clean(value).toLowerCase();
  if (!wanted) return false;
  const inputs = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
  const match = inputs.find((input) => clean(labelFor(input)?.textContent).toLowerCase() === wanted);
  if (!match) return false;
  match.click();
  return true;
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
  fillField("Brand", ["brand"], item.brand, log);
  fillField("Category", ["category"], item.category, log);
  fillField("Size", ["size"], item.size, log);
  if (!clickChoice(item.condition)) fillField("Condition", ["condition"], item.condition, log);
  else log.push("Condition: selected.");
  const colors = String(item.color || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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

mountPanel();
