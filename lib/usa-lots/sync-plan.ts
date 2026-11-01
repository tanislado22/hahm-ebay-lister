export const SALE_SYNC_INTERVAL = "cada 15 minutos";
export const SALE_SYNC_CRON = "*/15 * * * *";
export const HISTORY_FLOOR_MS = 730 * 24 * 60 * 60 * 1000;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WATCH_MS = 2 * 24 * 60 * 60 * 1000;

export const FINANCES_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.finances";

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

export function feeGapFromStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `Falta el permiso ${FINANCES_SCOPE}. Las comisiones y el envío pagado por ti no están en el pedido y no se tomaron como cero.`;
  }
  if (status === 429 || status === 503) return "eBay limitó la consulta de comisiones. Se reintentará en la siguiente pasada.";
  return "";
}

export function describeSaleSync(input: {
  cronSecretSet: boolean;
  notificationTokenSet: boolean;
  lastSuccessAt: string | null;
  lastError: string;
  feeNote: string;
}): { active: false; lines: string[] } {
  const lines = [
    `La consulta de respaldo está programada ${SALE_SYNC_INTERVAL} (${SALE_SYNC_CRON}) en vercel.json.`,
    input.cronSecretSet
      ? "CRON_SECRET está presente en este proceso. Aun así, Vercel solo ejecuta esa tarea si el proyecto publicado tiene Cron Jobs. En el plan Hobby el mínimo es una vez al día; cada 15 minutos requiere el plan Pro."
      : "Falta CRON_SECRET en este servidor. La sincronización programada no puede ejecutarse hasta configurar esa variable en Vercel.",
    input.lastSuccessAt
      ? `Última sincronización correcta: ${input.lastSuccessAt}.`
      : "Todavía no hay una sincronización correcta registrada. No está activa solo por existir el código.",
    "No depende de una pestaña abierta. Cada pasada lee una ventana de pedidos y continúa en la siguiente.",
    input.notificationTokenSet
      ? "El receptor de notificaciones tiene token de verificación. La suscripción en eBay hay que crearla en el portal; este programa no la da de alta solo."
      : "Falta EBAY_NOTIFICATION_VERIFICATION_TOKEN. Sin esa variable y sin una suscripción en el portal de eBay, las notificaciones no llegan. La consulta periódica es el respaldo.",
    `Las comisiones reales salen de Sell Finances. El permiso actual de la conexión no incluye ${FINANCES_SCOPE}. Hay que habilitarlo en la aplicación de eBay, añadirlo al consentimiento y volver a conectar la cuenta.`,
  ];
  if (input.feeNote) lines.push(input.feeNote);
  if (input.lastError) lines.push(`Último error: ${input.lastError}`);
  return { active: false, lines };
}
