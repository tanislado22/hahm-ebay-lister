export const SALE_SYNC_INTERVAL = "una vez al día";
export const SALE_SYNC_CRON = "0 13 * * *";
export const PRO_SYNC_CRON = "*/15 * * * *";
export const HISTORY_FLOOR_MS = 730 * 24 * 60 * 60 * 1000;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WATCH_MS = 2 * 24 * 60 * 60 * 1000;

export const FINANCES_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.finances";
export const NOTIFICATION_SCOPE = "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription";

export function nextOrderWindow(input: { now: number; cursorEnd: number | null; phase: "backfill" | "watch" }): {
  start: string;
  end: string;
  nextCursorEnd: number | null;
  phase: "backfill" | "watch";
  caughtUp: boolean;
} {
  if (input.phase === "watch") {
    return {
      start: new Date(input.now - WATCH_MS).toISOString(),
      end: new Date(input.now).toISOString(),
      nextCursorEnd: null,
      phase: "watch",
      caughtUp: true,
    };
  }
  const end = input.cursorEnd ?? input.now;
  const floor = input.now - HISTORY_FLOOR_MS;
  const start = Math.max(floor, end - WINDOW_MS);
  const caughtUp = start <= floor;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    nextCursorEnd: caughtUp ? null : start,
    phase: caughtUp ? "watch" : "backfill",
    caughtUp,
  };
}

export function recentOrderWindow(now: number): { start: string; end: string } {
  return {
    start: new Date(now - WATCH_MS).toISOString(),
    end: new Date(now).toISOString(),
  };
}

export function readsRecentOrdersDuring(phase: "backfill" | "watch"): boolean {
  return phase === "backfill";
}

export function feeGapFromStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `Falta el permiso ${FINANCES_SCOPE}. Las comisiones y el envío pagado por ti no están en el pedido y no se tomaron como cero.`;
  }
  if (status === 429 || status === 503) return "eBay limitó la consulta de comisiones. Se reintentará en la siguiente pasada.";
  return "";
}

function successSource(source: string): string {
  if (source === "cron") return "la tarea programada";
  if (source === "manual") return "el botón Actualizar ventas de eBay";
  if (source === "notification") return "una notificación de eBay";
  return "un origen no registrado";
}

export function describeSaleSync(input: {
  cronSecretSet: boolean;
  notificationTokenSet: boolean;
  lastSuccessAt: string | null;
  lastSource: string;
  lastSaved: number;
  salesStored: number;
  lastError: string;
  feeNote: string;
}): { active: false; lines: string[] } {
  const lines = [
    input.lastSuccessAt
      ? `Última consulta correcta: ${input.lastSuccessAt}. La hizo ${successSource(input.lastSource)}. Ventas guardadas en esta cuenta: ${input.salesStored}. En esa pasada se procesaron ${input.lastSaved}. Esa fecha solo describe la última consulta.`
      : "No hay una consulta correcta registrada. El código y las variables de entorno no significan que la consulta se esté ejecutando.",
  ];
  if (input.lastSuccessAt && input.lastSource === "manual") {
    lines.push("La tarea programada todavía no tiene una ejecución correcta propia.");
  }
  if (input.lastSuccessAt && input.lastSource === "cron") {
    lines.push("Esa ejecución programada sí ocurrió. No garantiza por sí sola la siguiente.");
  }
  if (input.lastError) lines.push(`Último error: ${input.lastError}`);
  lines.push(
    `La consulta de respaldo en Vercel está programada ${SALE_SYNC_INTERVAL} (${SALE_SYNC_CRON}, 13:00 UTC). No depende de una pestaña abierta ni del botón.`,
    "El plan Hobby de Vercel solo permite tareas una vez al día. El plan Pro cuesta 20 USD al mes, antes de impuestos, y permite cada 15 minutos. No se contrató ningún plan.",
    `Para cada 15 minutos sin cambiar de plan, un programador externo puede llamar a /api/cron/ebay-sales con el encabezado Authorization: Bearer y el valor de CRON_SECRET. La expresión de Pro sería ${PRO_SYNC_CRON}.`,
    input.cronSecretSet
      ? "CRON_SECRET está presente en este proceso. Eso no demuestra que Vercel haya ejecutado la tarea."
      : "Falta CRON_SECRET en Vercel. Sin esa variable la tarea programada responde no autorizada.",
    input.notificationTokenSet
      ? "EBAY_NOTIFICATION_VERIFICATION_TOKEN está presente. Las notificaciones no están listas hasta que Preparar notificaciones confirme que ORDER_CONFIRMATION quedó suscrita y activa."
      : "Falta EBAY_NOTIFICATION_VERIFICATION_TOKEN en Vercel. Sin esa variable eBay no puede validar el destino.",
    `Las comisiones salen de Sell Finances (${FINANCES_SCOPE}). El consentimiento ya lo pide, junto con ${NOTIFICATION_SCOPE}. Hasta volver a autorizar la cuenta, la comisión queda pendiente y la ganancia se muestra provisional. No se usa cero en su lugar.`,
  );
  if (input.feeNote) lines.push(input.feeNote);
  return { active: false, lines };
}
