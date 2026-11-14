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
 * 2. Sustituye appsscript.json por scripts/vinted-gmail-appsscript.json.
 * 3. Sustituye Code.gs por este archivo y guarda ambos.
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
 *    sea posterior. Sustituye Code.gs por este archivo para que esa búsqueda quede activa.
 */

var ALLOWED_URL = "https://hahm-ebay-lister-tau-one.vercel.app/api/vinted/inbound";

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
    var replay = !dryRun && props.getProperty("MARKETPLACE_REPLAY") !== "done";
    var retryLeft = false;
    var skip = loadIdSet_(dryRun ? "DRY_SEEN" : "PROCESSED");
    listCandidateIds_(activatedAt).forEach(function (id) {
      var email = readMessage_(id);
      if (!email) return;
      var recentMarketplace = isRecentMarketplace_(email);
      if (skip[id] && !(replay && recentMarketplace)) return;
      if (email.receivedMs < activatedAt && !recentMarketplace) return;
      var result = postSale_(email, dryRun);
      Logger.log(JSON.stringify({
        messageId: id,
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
    if (replay && scriptConfig_() && !retryLeft) props.setProperty("MARKETPLACE_REPLAY", "done");
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
  var ids = listCandidateIds_(activatedAt);
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
  var ids = [];
  collectIds_(vintedSearchQuery_(activatedAt), ids);
  collectIds_(recentMarketplaceQuery_(), ids);
  return ids.slice(0, 50);
}

function collectIds_(query, ids) {
  var pageToken = "";
  for (var page = 0; page < 3 && ids.length < 50; page++) {
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
  var message = Gmail.Users.Messages.get("me", id, { format: "full" });
  if (!message) return null;
  var bodies = { "text/plain": "", "text/html": "" };
  collectText_(message.payload, bodies);
  return {
    id: message.id,
    from: headerValue_(message, "from"),
    subject: headerValue_(message, "subject"),
    text: String(bodies["text/plain"] || "").slice(0, 100000),
    html: String(bodies["text/html"] || "").slice(0, 100000),
    receivedMs: Number(message.internalDate || "0"),
  };
}

function collectText_(part, found) {
  if (!part) return;
  var type = String(part.mimeType || "");
  if ((type === "text/plain" || type === "text/html") && part.body && part.body.data) {
    var piece = decodeBase64Url_(part.body.data);
    if (piece) found[type] = found[type] ? found[type] + "\n" + piece : piece;
  }
  var parts = part.parts || [];
  for (var i = 0; i < parts.length; i++) collectText_(parts[i], found);
}

function headerValue_(message, name) {
  var headers = (message.payload && message.payload.headers) || [];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i].name || "").toLowerCase() === name) return headers[i].value || "";
  }
  return "";
}

function decodeBase64Url_(data) {
  try {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString("UTF-8");
  } catch (error) {
    return "";
  }
}

function shouldRetryIgnoredSale_(email, result) {
  var body = result.body || {};
  if (body.ignored !== true) return false;
  var haystack = String(email.subject || "") + "\n" + String(email.text || "") + "\n" + String(email.html || "");
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
