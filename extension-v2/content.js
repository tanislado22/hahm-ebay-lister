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

async function loadMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension could not reach your app.");
  return response.body;
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
  fillField("Title", ["title", "what are you selling", "tell buyers"], item.title, log);
  fillField(
    "Description",
    ["description", "describe your item", "describe"],
    descriptionWithSku(item.description, item.sku),
    log
  );
  log.push("Sell was not pressed.");
}

function mountPanel() {
  if (!/\/items\/new/.test(location.pathname)) return;
  if (document.querySelector(".vinted-assist-v2")) return;
  const panel = document.createElement("aside");
  panel.className = "vinted-assist vinted-assist-v2";
  panel.innerHTML = `
    <strong>Listing Writer Vinted V2</strong>
    <p>Fills the title and description, including the SKU. It does not upload photos or press Sell.</p>
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
