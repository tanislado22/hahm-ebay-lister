import { readActiveListPage, readEbayItem, readEbayUserId } from "@/lib/archive/ebay-read";
import {
  applyListPage,
  blankRun,
  completeDetail,
  DETAIL_BATCH,
  failDetail,
  rememberNotice,
  shouldContinueRun,
  type ImportProgress,
} from "@/lib/archive/import-progress";
import { configError, missingEbayConfig } from "@/lib/archive/trading-error";
import type { LocalRecord } from "@/lib/archive/link";
import { loadImportRun, loadLinkCandidates, saveImportedArticle, saveImportRun } from "@/lib/archive/store";

export interface ImportStepResult {
  ok: boolean;
  status: "running" | "done" | "error";
  retryable: boolean;
  found: number;
  imported: number;
  existing: number;
  errors: ImportProgress["errors"];
  notices: string[];
  pending: number;
  page: number;
  totalPages: number | null;
  totalEntries: number | null;
  detail: string;
  missing: string[];
  error?: string;
}

function present(run: ImportProgress, extra?: { retryable?: boolean; missing?: string[]; error?: string }): ImportStepResult {
  return {
    ok: run.status !== "error" || Boolean(extra?.retryable),
    status: run.status,
    retryable: Boolean(extra?.retryable),
    found: run.found,
    imported: run.imported,
    existing: run.existing,
    errors: run.errors,
    notices: run.notices,
    pending: run.pendingIds.length,
    page: run.listPage,
    totalPages: run.totalPages,
    totalEntries: run.totalEntries,
    detail: extra?.error || run.detail,
    missing: extra?.missing || [],
    error: extra?.error,
  };
}

export async function advanceArchiveImport(input: {
  accessToken: string;
  accountKey: string;
  mode: "sample" | "all";
}): Promise<ImportStepResult> {
  const missing = missingEbayConfig();
  if (missing.length) {
    const run = blankRun(input.mode);
    run.status = "error";
    run.detail = configError(missing);
    return present(run, { missing, error: run.detail });
  }

  const stored = await loadImportRun(input.accountKey, input.mode);
  let run = shouldContinueRun(stored, input.mode) && stored ? stored : blankRun(input.mode);
  if (stored?.ebayUserId && !run.ebayUserId) run.ebayUserId = stored.ebayUserId;
  if (run.status === "error" && run.listComplete && run.pendingIds.length === 0 && run.failedIds.length > 0) {
    run = { ...run, status: "running", pendingIds: run.failedIds, failedIds: [], attempts: {}, errors: [], detail: "Reintentando los anuncios que fallaron." };
  } else if (run.status === "error") {
    run = { ...run, status: "running" };
  }

  if (!run.ebayUserId) {
    const user = await readEbayUserId(input.accessToken);
    if (!user.ok) {
      if (user.config) {
        run.status = "error";
        run.detail = user.message;
        await saveImportRun(input.accountKey, run);
        return present(run, { missing: user.missing, error: user.message });
      }
      run.detail = user.message;
      if (!user.retryable) run.detail = `${user.message} Se continúa sin el identificador de la cuenta.`;
      if (user.retryable) {
        await saveImportRun(input.accountKey, run);
        return present(run, { retryable: true, error: user.message });
      }
    } else if (user.userId) {
      run.ebayUserId = user.userId;
    }
  }

  if (!run.listComplete) {
    const page = await readActiveListPage(input.accessToken, run.listPage + 1);
    if (!page.ok) {
      run.detail = page.message;
      if (!page.retryable) run.status = "error";
      await saveImportRun(input.accountKey, run);
      return present(run, { retryable: page.retryable, missing: page.missing, error: page.message });
    }
    const applied = applyListPage(run, {
      pageNumber: run.listPage + 1,
      totalPages: page.page?.pages ?? null,
      totalEntries: page.page?.entries ?? null,
      itemIds: page.page?.items.map((item) => item.itemId) ?? [],
      truncated: Boolean(page.page?.truncated),
    });
    run = applied.run;
    await saveImportRun(input.accountKey, run);
    if (applied.problem) return present(run, { retryable: true, error: run.detail });
    return present(run);
  }

  const batch = run.pendingIds.slice(0, DETAIL_BATCH);
  if (!batch.length) {
    run.status = run.errors.length && run.failedIds.length === run.found ? "error" : "done";
    if (run.status === "done" && run.mode === "sample" && !run.detail.includes("Prueba")) {
      run.detail = "Prueba terminada. Puedes importar todos los anuncios activos.";
    }
    await saveImportRun(input.accountKey, run);
    return present(run);
  }

  let locals: LocalRecord[] = [];
  try {
    locals = await loadLinkCandidates(input.accountKey);
  } catch (error) {
    run.detail = error instanceof Error ? error.message : "No se pudieron leer los registros locales.";
    await saveImportRun(input.accountKey, run);
    return present(run, { retryable: true, error: run.detail });
  }

  for (const itemId of batch) {
    const detail = await readEbayItem(input.accessToken, itemId);
    if (!detail.ok) {
      if (detail.retryable || detail.config) {
        run.detail = detail.message;
        if (detail.config) run.status = "error";
        await saveImportRun(input.accountKey, run);
        return present(run, { retryable: detail.retryable, missing: detail.missing, error: detail.message });
      }
      run = failDetail(run, itemId, detail.message, false);
      continue;
    }
    if (!detail.item) {
      run = failDetail(run, itemId, "eBay no devolvió ese anuncio.", false);
      continue;
    }
    try {
      const saved = await saveImportedArticle({
        accountKey: input.accountKey,
        ebayUserId: run.ebayUserId,
        detail: detail.item,
        locals,
      });
      run = rememberNotice(completeDetail(run, itemId, saved.kind), saved.note);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el artículo.";
      run = failDetail(run, itemId, message, true);
    }
  }

  if (run.listComplete && run.pendingIds.length === 0 && run.status === "running") {
    run.status = "done";
    if (run.mode === "sample") run.detail = "Prueba terminada. Puedes importar todos los anuncios activos.";
    else if (!run.detail) run.detail = "Importación terminada.";
  }
  await saveImportRun(input.accountKey, run);
  return present(run);
}
