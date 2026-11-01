export const SAMPLE_LIMIT = 10;
export const ACTIVE_PAGE_SIZE = 200;
export const DETAIL_BATCH = 3;
export const MAX_ITEM_ATTEMPTS = 3;

export interface ImportError {
  itemId: string;
  message: string;
}

export interface ImportProgress {
  mode: "sample" | "all";
  status: "running" | "done" | "error";
  ebayUserId: string;
  listPage: number;
  totalPages: number | null;
  totalEntries: number | null;
  listComplete: boolean;
  found: number;
  imported: number;
  existing: number;
  errors: ImportError[];
  notices: string[];
  pendingIds: string[];
  failedIds: string[];
  attempts: Record<string, number>;
  detail: string;
}

export function blankRun(mode: "sample" | "all"): ImportProgress {
  return {
    mode,
    status: "running",
    ebayUserId: "",
    listPage: 0,
    totalPages: null,
    totalEntries: null,
    listComplete: false,
    found: 0,
    imported: 0,
    existing: 0,
    errors: [],
    notices: [],
    pendingIds: [],
    failedIds: [],
    attempts: {},
    detail: "",
  };
}

export function shouldContinueRun(run: ImportProgress | null, mode: "sample" | "all"): boolean {
  if (!run || run.mode !== mode) return false;
  return run.status !== "done";
}

function appendUnique(current: string[], incoming: string[]): string[] {
  const seen = new Set(current);
  const next = [...current];
  for (const id of incoming) {
    const clean = id.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    next.push(clean);
  }
  return next;
}

function capNotes(values: string[]): string[] {
  return values.filter(Boolean).slice(-30);
}

export function applyListPage(
  run: ImportProgress,
  page: {
    pageNumber: number;
    totalPages: number | null;
    totalEntries: number | null;
    itemIds: string[];
    truncated: boolean;
  }
): { run: ImportProgress; problem: string | null } {
  if (page.truncated) {
    return {
      run: {
        ...run,
        status: "running",
        detail: "eBay cortó la página antes de entregarla completa. La importación sigue incompleta y no se marcó ningún anuncio como vendido o finalizado.",
      },
      problem: "truncated",
    };
  }
  const pendingIds = appendUnique(run.pendingIds, page.itemIds);
  const next: ImportProgress = {
    ...run,
    status: "running",
    listPage: page.pageNumber,
    totalPages: page.totalPages ?? run.totalPages,
    totalEntries: page.totalEntries ?? run.totalEntries,
    pendingIds,
    found: pendingIds.length,
    detail: "",
  };
  if (page.itemIds.length === 0 && page.pageNumber > 1) {
    next.listComplete = true;
    next.found = run.mode === "sample" ? Math.min(SAMPLE_LIMIT, run.found) : next.found;
    return { run: next, problem: null };
  }
  if (run.mode === "sample") {
    const selected = pendingIds.slice(0, SAMPLE_LIMIT);
    return {
      run: {
        ...next,
        pendingIds: selected,
        found: selected.length,
        listComplete: true,
        detail: selected.length
          ? page.totalEntries != null
            ? `eBay indica ${page.totalEntries} anuncios activos. Esta prueba guarda los primeros ${selected.length}.`
            : `Esta prueba guarda los primeros ${selected.length} anuncios activos.`
          : "eBay no devolvió anuncios activos en la primera página.",
      },
      problem: null,
    };
  }
  if (page.totalPages != null && page.pageNumber >= page.totalPages) {
    next.listComplete = true;
    return { run: next, problem: null };
  }
  if (page.totalPages == null && page.itemIds.length < ACTIVE_PAGE_SIZE) {
    next.listComplete = true;
    return { run: next, problem: null };
  }
  if (page.totalPages == null) {
    next.detail = "eBay no indicó el total de páginas. Se continúa con la página siguiente. No se marcó ningún anuncio como vendido o finalizado.";
  }
  return { run: next, problem: null };
}

export function rememberNotice(run: ImportProgress, note: string): ImportProgress {
  if (!note.trim()) return run;
  if (run.notices.includes(note)) return run;
  return { ...run, notices: capNotes([...run.notices, note]) };
}

export function completeDetail(run: ImportProgress, itemId: string, kind: "imported" | "existing"): ImportProgress {
  const pendingIds = run.pendingIds.filter((id) => id !== itemId);
  const next: ImportProgress = {
    ...run,
    pendingIds,
    imported: run.imported + (kind === "imported" ? 1 : 0),
    existing: run.existing + (kind === "existing" ? 1 : 0),
    status: "running",
  };
  if (next.listComplete && pendingIds.length === 0) {
    next.status = "done";
    if (!next.detail) {
      next.detail =
        next.mode === "sample"
          ? "Prueba terminada. Puedes importar todos los anuncios activos."
          : "Importación terminada.";
    }
  }
  return next;
}

export function failDetail(run: ImportProgress, itemId: string, message: string, retryable: boolean): ImportProgress {
  const attempts = { ...run.attempts, [itemId]: (run.attempts[itemId] ?? 0) + 1 };
  const giveUp = !retryable || attempts[itemId] >= MAX_ITEM_ATTEMPTS;
  if (!giveUp) {
    const pendingIds = [...run.pendingIds.filter((id) => id !== itemId), itemId];
    return {
      ...run,
      attempts,
      pendingIds,
      status: "running",
      detail: message,
    };
  }
  const pendingIds = run.pendingIds.filter((id) => id !== itemId);
  const errors = capErrors([...run.errors, { itemId, message }]);
  const next: ImportProgress = {
    ...run,
    attempts,
    pendingIds,
    failedIds: appendUnique(run.failedIds, [itemId]),
    errors,
    status: "running",
    detail: message,
  };
  if (next.listComplete && pendingIds.length === 0) next.status = errors.length ? "error" : "done";
  return next;
}

function capErrors(errors: ImportError[]): ImportError[] {
  return errors.slice(-30);
}

export function statusesForListingsMissingFromImport(): readonly never[] {
  return [];
}
