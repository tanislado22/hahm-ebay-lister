import { catalogPublicState, type CatalogSourceItem } from "@/lib/markets/guatemala-catalog";
import type { InventoryItemStatus } from "@/lib/markets/guatemala-inventory";

export const WORKSPACE_ARCHIVE_MESSAGES = {
  none: "No hay fichas con la publicación confirmada en el catálogo. Los borradores y las publicaciones pendientes o fallidas siguen en el área de trabajo.",
  notConfirmed: "Esta ficha no tiene la publicación confirmada. Sigue en el área de trabajo.",
  one: "Ficha archivada. La prenda sigue en el inventario, en el catálogo y en su lote.",
  many: (count: number) =>
    `${count} fichas archivadas. Las prendas siguen en el inventario, en el catálogo y en su lote.`,
  failed: "No se pudo archivar. Las fichas siguen en el área de trabajo.",
} as const;

export function workspaceArchiveMessage(count: number): string {
  if (count <= 0) return WORKSPACE_ARCHIVE_MESSAGES.none;
  if (count === 1) return WORKSPACE_ARCHIVE_MESSAGES.one;
  return WORKSPACE_ARCHIVE_MESSAGES.many(count);
}

export interface WorkspaceArchiveJob {
  id: string;
}

export interface WorkspaceArchiveSale {
  isTest: boolean;
  voidedAt: string | null;
}

// A workspace card may leave only when the same prenda is already confirmed in the catalog.
// Drafts, pending or failed publications, and garments saved without photos stay out.
export interface WorkspaceArchivePublication {
  sourceGroupId: string;
  clientId: string;
  sku: string;
  priceGtq: string;
  lotId: string | null;
  status: InventoryItemStatus;
  published: boolean;
  photoCount: number;
  sales: WorkspaceArchiveSale[];
}

export function workspacePublicationConfirmed(
  item: WorkspaceArchivePublication,
  clientId: string
): boolean {
  if (item.clientId !== clientId || item.published !== true || item.photoCount < 1) return false;
  const source: CatalogSourceItem = {
    id: item.sourceGroupId,
    clientId: item.clientId,
    sku: item.sku,
    title: item.sku,
    description: "",
    brand: "",
    size: "",
    condition: "",
    priceGtq: item.priceGtq,
    status: item.status,
    published: true,
    photos: [{ id: `${item.sourceGroupId}-foto`, mediaType: "image/jpeg", data: "foto" }],
    sales: item.sales,
  };
  return catalogPublicState(source, clientId) !== "oculto";
}

export function planWorkspaceArchive(input: {
  clientId: string;
  jobs: readonly WorkspaceArchiveJob[];
  publications: readonly WorkspaceArchivePublication[];
  jobId?: string;
}): { archivedIds: string[]; keptJobIds: string[] } {
  const confirmed = new Set(
    input.publications
      .filter((item) => workspacePublicationConfirmed(item, input.clientId))
      .map((item) => item.sourceGroupId)
  );
  const requested = input.jobId?.trim() ?? "";
  const pool = requested ? input.jobs.filter((job) => job.id === requested) : input.jobs;
  const archivedIds = pool.filter((job) => confirmed.has(job.id)).map((job) => job.id);
  const archived = new Set(archivedIds);
  return {
    archivedIds,
    keptJobIds: input.jobs.filter((job) => !archived.has(job.id)).map((job) => job.id),
  };
}

export function applyWorkspaceArchive<TJob extends { id: string }>(
  jobs: readonly TJob[],
  archivedIds: readonly string[]
): TJob[] {
  const archived = new Set(archivedIds);
  return jobs.filter((job) => !archived.has(job.id));
}
