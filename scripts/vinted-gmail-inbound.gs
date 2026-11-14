/**
 * Lee ventas confirmadas de Vinted, Poshmark y Depop y las envía solo al endpoint de la aplicación.
 * No envía, reenvía, modifica ni elimina correos. No cambia etiquetas ni el estado de lectura,
 * así que Nifty puede seguir usando el buzón sin interferencia.
 * Este archivo no cambia DRY_RUN a false.
 *
 * Permisos que debe pedir Google:
 * - Ver tus mensajes y ajustes de Gmail (gmail.readonly).
 * - Conectarse a un servicio externo (el endpoint de Vercel).
 * Si aparece "enviar" o "eliminar permanentemente", no lo aceptes: el manifiesto no está activo.
 *
 * Actualizar el proyecto
 * 1. En Configuración del proyecto, activa "Mostrar el archivo de manifiesto appsscript.json".
 * 2. No sustituyas appsscript.json si Gmail API ya está en Servicios y los permisos
 *    siguen siendo solo lectura y conexión externa.
 * 3. Sustituye Code.gs por este archivo y guarda.
 * 4. En el editor, abre Servicios y comprueba que aparece Gmail API.
 *    Si no está, pulsa + y añade Gmail API.
 * 5. Abre https://myaccount.google.com/permissions y quita el acceso de este proyecto
 *    si lo autorizaste antes. Así desaparece el permiso amplio anterior.
 * 6. En Propiedades de la secuencia de comandos:
 *      APP_URL          https://hahm-ebay-lister-tau-one.vercel.app/api/vinted/inbound
 *      INBOUND_SECRET   el mismo valor que VINTED_INBOUND_SECRET en Vercel
 *      DRY_RUN          true
 *    APP_URL es un alias de producción del proyecto hahm-ebay-lister, el mismo
 *    despliegue que hahm-ebay-lister-ebay-lister3.vercel.app y que Lotes.
 *    No uses www.variedadessanandres.com: esa dirección no acepta /api.
 *    No escribas el secreto en este archivo.
 * 7. Si BASELINED todavía no es true, ejecuta baselineExistingSales una sola vez.
 *    Si ya existe, no lo vuelvas a ejecutar: no hace falta cambiar ACTIVATED_AT.
 * 8. Ejecuta previewVintedSale. Usa dryRun, no envía Telegram y no marca correos.
 * 9. El activador de checkVintedSales cada 10 minutos se crea solo después de confirmar
 *    la publicación. DRY_RUN debe ser exactamente false para guardar ventas.
 *    Mientras sea true, el correo se revisa y no se registra en el lote.
 * 10. Poshmark y Depop se buscan otra vez en los últimos 14 días, aunque ACTIVATED_AT
 *    sea posterior. El correo con “You just sold” o SKU 3053 entra aunque la lista
 *    general ya tenga 50 mensajes. El cuerpo se lee con GmailApp; la API de Gmail
 *    a menudo deja body.data vacío y por eso el servidor veía textChars 0.
 *    Sustituye Code.gs por este archivo. No hace falta borrar MARKETPLACE_REPLAY.
 */

var ALLOWED_URL = "https://hahm-ebay-lister-tau-one.vercel.app/api/vinted/inbound";
var REPLAY_DONE = "full-body";
var TEXT_LIMIT = 100000;

function checkVintedSales() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("BASELINED") !== "true") {
      baselineExistingSales();
      return;
    }
    var activatedAt = Date.parse(props.getProperty("ACTIVATED_AT") || "");
    if (!activatedAt) {
      Logger.log("Falta ACTIVATED_AT. Ejecuta baselineExistingSales.");
      return;
    }
    var dryRun = isDryRun_();
    var replay = !dryRun && props.getProperty("MARKETPLACE_REPLAY") !== REPLAY_DONE;
    var retryLeft = false;
    var skip = loadIdSet_(dryRun ? "DRY_SEEN" : "PROCESSED");
    var found = listCandidateIds_(activatedAt);
    Logger.log("Busqueda reservada: " + found.targeted + " correos con You just sold o SKU 3053. El limite de 50 no los recorta. Revisados: " + found.ids.length + ".");
    found.ids.forEach(function (id) {
      var email = readMessage_(id);
      if (!email) return;
      var recentMarketplace = isRecentMarketplace_(email);
      if (skip[id] && !(replay && recentMarketplace && found.priority[id])) return;
      if (email.receivedMs < activatedAt && !recentMarketplace) return;
      var result = postSale_(email, dryRun);
      Logger.log(JSON.stringify({
        messageId: id,
        priority: found.priority[id] === true,
        bodySource: email.bodySource,
        subjectHas3053: /3053/.test(email.subject + "\n" + email.text + "\n" + email.html),
        localTextChars: email.text.length,
        localHtmlChars: email.html.length,
        dryRun: dryRun,
        status: result.status,
        body: result.body,
      }));
      if (dryRun && result.status === 200 && result.body && result.body.dryRun === true) {
        rememberId_("DRY_SEEN", id);
      }
      if (shouldRetryIgnoredSale_(email, result)) retryLeft = true;
      if (!dryRun && result.settled && !shouldRetryIgnoredSale_(email, result)) rememberId_("PROCESSED", id);
    });
    if (replay && scriptConfig_() && !retryLeft) props.setProperty("MARKETPLACE_REPLAY", REPLAY_DONE);
  } finally {
    lock.releaseLock();
  }
}

function baselineExistingSales() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("BASELINED") === "true" && props.getProperty("ACTIVATED_AT")) {
    Logger.log("La línea base ya existe. ACTIVATED_AT=" + props.getProperty("ACTIVATED_AT"));
    return;
  }
  var activatedAt = new Date();
  props.setProperty("ACTIVATED_AT", activatedAt.toISOString());
  props.setProperty("BASELINED", "true");
  if (!props.getProperty("DRY_RUN")) props.setProperty("DRY_RUN", "true");
  Logger.log("Línea base lista. No se leyeron ni modificaron correos. ACTIVATED_AT=" + activatedAt.toISOString());
}

/**
 * Vista previa de una venta nueva de Vinted. Siempre usa dryRun.
 * No envía Telegram, no marca el correo y no cambia ACTIVATED_AT, BASELINED ni DRY_RUN.
 */
function previewVintedSale() {
  var activatedAt = Date.parse(PropertiesService.getScriptProperties().getProperty("ACTIVATED_AT") || "");
  if (!activatedAt) {
    Logger.log("No hay ACTIVATED_AT. Ejecuta baselineExistingSales. No se modificó nada.");
    return;
  }
  var ids = listCandidateIds_(activatedAt).ids;
  var checked = 0;
  for (var i = 0; i < ids.length && checked < 20; i++) {
    var email = readMessage_(ids[i]);
    if (!email || email.receivedMs < activatedAt) continue;
    checked++;
    var result = postSale_(email, true);
    var body = result.body || {};
    if (result.status !== 200 || body.ok !== true || body.dryRun !== true || body.status !== "would_send" || body.platform !== "vinted") {
      Logger.log("Omitido: " + email.subject + " | " + (body.reason || body.status || result.status));
      continue;
    }
    Logger.log("Asunto: " + email.subject);
    Logger.log("Fecha: " + new Date(email.receivedMs).toISOString());
    Logger.log("Plataforma: VINTED");
    Logger.log("Título: " + (body.title || ""));
    Logger.log("SKU: " + (body.sku || "NO ENCONTRADO"));
    Logger.log("Mensaje exacto que se enviaría a Telegram:");
    Logger.log(body.message || "(el servidor no devolvió el mensaje)");
    Logger.log("dryRun: true. Telegram no enviado. Correo no marcado. ACTIVATED_AT, BASELINED y DRY_RUN sin cambios.");
    return;
  }
  Logger.log("No hay una venta nueva de Vinted desde la activación. Revisados: " + checked + ". No se envió Telegram ni se marcó ningún correo.");
}

function postSale_(email, dryRun) {
  var config = scriptConfig_();
  if (!config) return { status: 0, body: { ok: false, error: "Missing script properties" }, settled: false };
  var response = UrlFetchApp.fetch(config.url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + config.secret },
    muteHttpExceptions: true,
    followRedirects: false,
    validateHttpsCertificates: true,
    payload: JSON.stringify({
      messageId: email.id,
      from: email.from,
      subject: email.subject,
      text: email.text,
      html: email.html,
      date: new Date(email.receivedMs).toISOString(),
      dryRun: dryRun === true,
    }),
  });
  var status = response.getResponseCode();
  if (status >= 300 && status < 400) {
    Logger.log("La aplicación respondió con una redirección y no se siguió.");
    return { status: status, body: { ok: false, error: "Redirect blocked" }, settled: false };
  }
  var body = {};
  try {
    body = JSON.parse(response.getContentText() || "{}");
  } catch (error) {
    body = { ok: false, error: "Invalid response" };
  }
  return { status: status, body: body, settled: isSettled_(status, body) };
}

function listCandidateIds_(activatedAt) {
  var priority = [];
  collectIds_(targetedSaleQuery_(), priority, 100);
  var ids = priority.slice();
  collectIds_(vintedSearchQuery_(activatedAt), ids, 50);
  collectIds_(recentMarketplaceQuery_(), ids, 50);
  var prioritySet = {};
  var rest = [];
  for (var p = 0; p < priority.length; p++) prioritySet[priority[p]] = true;
  for (var i = 0; i < ids.length; i++) {
    if (!prioritySet[ids[i]]) rest.push(ids[i]);
  }
  var chosen = priority.concat(rest);
  var cap = Math.max(50, priority.length);
  if (chosen.length > cap) chosen = chosen.slice(0, cap);
  return { ids: chosen, priority: prioritySet, targeted: priority.length };
}

function collectIds_(query, ids, cap) {
  var pageToken = "";
  var limit = cap || 50;
  for (var page = 0; page < 5 && ids.length < limit; page++) {
    var args = { q: query, maxResults: 20 };
    if (pageToken) args.pageToken = pageToken;
    var listed = Gmail.Users.Messages.list("me", args);
    var messages = (listed && listed.messages) || [];
    for (var i = 0; i < messages.length; i++) {
      var id = messages[i].id;
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    pageToken = (listed && listed.nextPageToken) || "";
    if (!pageToken || !messages.length) break;
  }
}

function readMessage_(id) {
  var read = readWithGmailApp_(id);
  if (read.text.length < 80 && read.html.length < 80) {
    var api = readWithGmailApi_(id);
    var apiLonger = api.text.length > read.text.length || api.html.length > read.html.length;
    read.text = longerText_(read.text, api.text);
    read.html = longerText_(read.html, api.html);
    read.from = read.from || api.from;
    read.subject = read.subject || api.subject;
    read.receivedMs = read.receivedMs || api.receivedMs;
    read.snippetChars = api.snippetChars;
    if (apiLonger) read.bodySource = "api";
  }
  if (read.text.length < 80 && read.html.length < 80) {
    var raw = readRawBodies_(id);
    var before = read.text.length + read.html.length;
    read.text = longerText_(read.text, raw.text);
    read.html = longerText_(read.html, raw.html);
    if (read.text.length + read.html.length > before) read.bodySource = "raw";
  }
  if (!read.text && !read.html) read.bodySource = "empty";
  return {
    id: id,
    from: read.from,
    subject: read.subject,
    text: read.text.slice(0, TEXT_LIMIT),
    html: shrinkHtml_(read.html),
    receivedMs: read.receivedMs,
    snippetChars: read.snippetChars || 0,
    bodySource: read.bodySource,
  };
}

function readWithGmailApp_(id) {
  var read = { from: "", subject: "", text: "", html: "", receivedMs: 0, snippetChars: 0, bodySource: "empty" };
  try {
    var gmail = GmailApp.getMessageById(id);
    if (!gmail) return read;
    read.from = gmail.getFrom() || "";
    read.subject = gmail.getSubject() || "";
    read.text = gmail.getPlainBody() || "";
    read.html = gmail.getBody() || "";
    read.receivedMs = gmail.getDate() ? gmail.getDate().getTime() : 0;
    if (read.text || read.html) read.bodySource = "gmailapp";
  } catch (error) {
    read.bodySource = "empty";
  }
  return read;
}

function readWithGmailApi_(id) {
  var read = { from: "", subject: "", text: "", html: "", receivedMs: 0, snippetChars: 0 };
  try {
    var message = Gmail.Users.Messages.get("me", id, { format: "full" });
    if (!message) return read;
    var bodies = { "text/plain": "", "text/html": "" };
    collectText_(message.payload, bodies, id);
    read.text = bodies["text/plain"];
    read.html = bodies["text/html"];
    read.from = headerValue_(message, "from");
    read.subject = headerValue_(message, "subject");
    read.receivedMs = Number(message.internalDate || "0");
    read.snippetChars = message.snippet ? String(message.snippet).length : 0;
  } catch (error) {
    return read;
  }
  return read;
}

function readRawBodies_(id) {
  try {
    var gmail = GmailApp.getMessageById(id);
    if (!gmail) return { text: "", html: "" };
    return mimeBodies_(gmail.getRawContent() || "");
  } catch (error) {
    return { text: "", html: "" };
  }
}

function longerText_(primary, secondary) {
  var first = String(primary || "");
  var second = String(secondary || "");
  return second.length > first.length ? second : first;
}

function shrinkHtml_(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\sdata:[^"'\s>]{80,}/gi, "")
    .slice(0, TEXT_LIMIT);
}

function collectText_(part, found, messageId) {
  if (!part) return;
  var type = partMime_(part);
  if (type === "text/plain" || type === "text/html") {
    var piece = partBody_(part, messageId);
    if (piece) found[type] = found[type] ? found[type] + "\n" + piece : piece;
  }
  var parts = part.parts || [];
  for (var i = 0; i < parts.length; i++) collectText_(parts[i], found, messageId);
}

function partMime_(part) {
  var type = String(part.mimeType || "").toLowerCase().split(";")[0].trim();
  if (type === "text/plain" || type === "text/html") return type;
  var headers = part.headers || [];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i].name || "").toLowerCase() !== "content-type") continue;
    var header = String(headers[i].value || "").toLowerCase().split(";")[0].trim();
    if (header === "text/plain" || header === "text/html") return header;
  }
  return type;
}

function partBody_(part, messageId) {
  var body = part.body || {};
  if (body.data) {
    var inline = decodeBase64Url_(body.data);
    if (inline) return inline;
  }
  if (!body.attachmentId || !messageId) return "";
  try {
    var file = Gmail.Users.Messages.Attachments.get("me", messageId, body.attachmentId);
    return decodeBase64Url_(file && file.data);
  } catch (error) {
    return "";
  }
}

function mimeBodies_(raw) {
  var found = { "text/plain": "", "text/html": "" };
  readMime_(String(raw || ""), found);
  return { text: found["text/plain"], html: found["text/html"] };
}

function readMime_(raw, found) {
  var split = splitHeaders_(raw);
  var type = header_(split.headers, "content-type");
  var mime = type.split(";")[0].trim().toLowerCase();
  var encoding = header_(split.headers, "content-transfer-encoding").toLowerCase();
  if (mime === "text/plain" || mime === "text/html") {
    var decoded = decodeTransfer_(split.body, encoding);
    if (decoded) found[mime] = found[mime] ? found[mime] + "\n" + decoded : decoded;
    return;
  }
  var boundary = boundaryOf_(type);
  if (!boundary) return;
  var marker = "--" + boundary;
  var chunks = split.body.split(marker);
  for (var i = 0; i < chunks.length; i++) {
    var chunk = String(chunks[i] || "").replace(/^\r?\n/, "");
    if (!chunk || chunk.indexOf("--") === 0) continue;
    readMime_(chunk, found);
  }
}

function splitHeaders_(raw) {
  var text = String(raw || "");
  var match = text.match(/\r?\n\r?\n/);
  if (!match) return { headers: "", body: text };
  return { headers: text.slice(0, match.index), body: text.slice(match.index + match[0].length) };
}

function header_(headers, name) {
  var lines = String(headers || "").replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  var prefix = name.toLowerCase() + ":";
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().indexOf(prefix) === 0) return lines[i].slice(prefix.length).trim();
  }
  return "";
}

function boundaryOf_(contentType) {
  var match = String(contentType || "").match(/boundary="?([^";\r\n]+)"?/i);
  return match ? match[1] : "";
}

function decodeTransfer_(content, encoding) {
  var body = String(content || "").replace(/\s+$/, "");
  if (encoding.indexOf("base64") >= 0) return decodeBase64Url_(body);
  if (encoding.indexOf("quoted-printable") >= 0) return decodeQuotedPrintable_(body);
  return body;
}

function decodeQuotedPrintable_(input) {
  var soft = String(input || "").replace(/=\r?\n/g, "");
  var bytes = [];
  for (var i = 0; i < soft.length; i++) {
    if (soft.charAt(i) === "=" && /^[0-9A-F]{2}/i.test(soft.substr(i + 1, 2))) {
      bytes.push(parseInt(soft.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(soft.charCodeAt(i) & 255);
    }
  }
  try {
    return Utilities.newBlob(bytes).getDataAsString("UTF-8");
  } catch (error) {
    return "";
  }
}

function headerValue_(message, name) {
  var headers = (message.payload && message.payload.headers) || [];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i].name || "").toLowerCase() === name) return headers[i].value || "";
  }
  return "";
}

function decodeBase64Url_(data) {
  if (!data) return "";
  var source = String(data).replace(/\s/g, "");
  try {
    var padded = source.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    return Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString("UTF-8");
  } catch (error) {
    try {
      return Utilities.newBlob(Utilities.base64DecodeWebSafe(source)).getDataAsString("UTF-8");
    } catch (ignored) {
      return "";
    }
  }
}

function shouldRetryIgnoredSale_(email, result) {
  var text = String(email.text || "").trim();
  var html = String(email.html || "").trim();
  if (!text && !html && Number(email.snippetChars || 0) > 0) return true;
  var body = result.body || {};
  if (body.ignored !== true) return false;
  var haystack = String(email.subject || "") + "\n" + text + "\n" + html;
  return /you just sold/i.test(haystack) || /\bSKU[: \t#]+[A-Za-z0-9]/i.test(haystack);
}

function isSettled_(status, body) {
  if (status !== 200 || !body || body.ok !== true) return false;
  if (body.dryRun === true) return false;
  if (body.status === "needs_review") return false;
  return body.ignored === true || body.suppressed === true || body.duplicate === true || body.status === "sent";
}

function isDryRun_() {
  return String(PropertiesService.getScriptProperties().getProperty("DRY_RUN") || "true").toLowerCase() !== "false";
}

function scriptConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty("APP_URL") || "").trim();
  var secret = String(props.getProperty("INBOUND_SECRET") || "").trim();
  if (url !== ALLOWED_URL || !secret) {
    Logger.log("APP_URL debe ser exactamente el endpoint de Production y INBOUND_SECRET debe existir.");
    return null;
  }
  return { url: ALLOWED_URL, secret: secret };
}

function vintedSearchQuery_(activatedAt) {
  var day = Utilities.formatDate(new Date(activatedAt - 86400000), "America/New_York", "yyyy/MM/dd");
  return "after:" + day + " (" + mailboxSaleQuery_() + ")";
}

function isRecentMarketplace_(email) {
  var from = String(email.from || "");
  if (!/poshmark\.com/i.test(from) && !/depop\.com/i.test(from)) return false;
  return email.receivedMs >= Date.now() - 14 * 86400000;
}

function recentMarketplaceQuery_() {
  var day = Utilities.formatDate(new Date(Date.now() - 14 * 86400000), "America/New_York", "yyyy/MM/dd");
  return "after:" + day + " (" + poshmarkDepopQuery_() + ")";
}

function targetedSaleQuery_() {
  var day = Utilities.formatDate(new Date(Date.now() - 14 * 86400000), "America/New_York", "yyyy/MM/dd");
  return "after:" + day + " ((from:poshmark.com (\"you just sold\" OR 3053)) OR (from:depop.com \"you just sold\"))";
}

function poshmarkDepopQuery_() {
  return "(from:poshmark.com (sale OR sold OR congrats OR \"ka-ching\" OR \"cha-ching\")) OR (from:depop.com (sold OR sale OR \"time to ship\"))";
}

function mailboxSaleQuery_() {
  return "(from:vinted.com (sold OR vendido OR vendiste)) OR " + poshmarkDepopQuery_();
}

function loadIdSet_(key) {
  var props = PropertiesService.getScriptProperties();
  var chunks = Number(props.getProperty(key + "_CHUNKS") || "0");
  var ids = {};
  for (var i = 0; i < chunks; i++) {
    String(props.getProperty(key + "_" + i) || "").split(",").forEach(function (id) {
      if (id) ids[id] = true;
    });
  }
  return ids;
}

function rememberId_(key, id) {
  if (!id || loadIdSet_(key)[id]) return;
  var props = PropertiesService.getScriptProperties();
  var chunks = Number(props.getProperty(key + "_CHUNKS") || "0");
  if (!chunks) {
    props.setProperty(key + "_0", id);
    props.setProperty(key + "_CHUNKS", "1");
    return;
  }
  var index = chunks - 1;
  var current = props.getProperty(key + "_" + index) || "";
  if ((current + "," + id).length > 8000) {
    props.setProperty(key + "_" + chunks, id);
    props.setProperty(key + "_CHUNKS", String(chunks + 1));
    return;
  }
  props.setProperty(key + "_" + index, current ? current + "," + id : id);
}
