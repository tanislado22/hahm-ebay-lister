import { quetzalPriceText, type SaleActor } from "@/lib/markets/guatemala-inventory";
import { civilDateKey, parseCivilDate } from "@/lib/markets/guatemala-sales-report";

export const GUATEMALA_RECOVERY_MESSAGES = {
  dateInvalid: "Elige la fecha de la recuperación.",
  descriptionLong: "La descripción es demasiado larga.",
  amountInvalid: "Escribe un monto mayor que cero.",
  saved: "Recuperación registrada.",
  loadFailed: "No se pudo cargar la recuperación de gastos.",
  retry: "No se pudo guardar la recuperación. Inténtalo de nuevo.",
} as const;

const DESCRIPTION_MAX = 500;

export interface PreparedRecovery {
  recoveredOn: string;
  description: string;
  amountGtq: string;
}

export interface StoredRecovery extends PreparedRecovery {
  id: string;
  clientId: string;
  recordedByRole: SaleActor["role"] | null;
  recordedByUsername: string | null;
  createdAt: string;
}

export function prepareRecovery(input: {
  recoveredOn?: unknown;
  description?: unknown;
  amount?: unknown;
}): { ok: true; recovery: PreparedRecovery } | { ok: false; status: 400; error: string } {
  const recovered = parseCivilDate(typeof input.recoveredOn === "string" ? input.recoveredOn : "");
  if (!recovered) return { ok: false, status: 400, error: GUATEMALA_RECOVERY_MESSAGES.dateInvalid };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, status: 400, error: GUATEMALA_RECOVERY_MESSAGES.descriptionLong };
  }
  const amountGtq = quetzalPriceText(input.amount);
  if (!amountGtq) return { ok: false, status: 400, error: GUATEMALA_RECOVERY_MESSAGES.amountInvalid };
  return {
    ok: true,
    recovery: {
      recoveredOn: civilDateKey(recovered),
      description,
      amountGtq,
    },
  };
}
