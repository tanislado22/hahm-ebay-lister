import { describe, expect, it } from "vitest";
import { publicCatalogCards, type CatalogSourceItem } from "@/lib/markets/guatemala-catalog";
import { applyGuatemalaSale } from "@/lib/markets/guatemala-inventory";
import { lotArticleCounts } from "@/lib/markets/guatemala-lots";
import {
  applyWorkspaceArchive,
  planWorkspaceArchive,
  workspacePublicationConfirmed,
  type WorkspaceArchivePublication,
} from "@/lib/markets/guatemala-workspace-archive";

const TIENDA = "tienda-guatemala";
const LOTE = "lote-1";

function publication(
  partial: Partial<WorkspaceArchivePublication> & Pick<WorkspaceArchivePublication, "sourceGroupId" | "sku">
): WorkspaceArchivePublication {
  return {
    clientId: TIENDA,
    priceGtq: "40.00",
    lotId: LOTE,
    status: "disponible",
    published: true,
    photoCount: 2,
    sales: [],
    ...partial,
  };
}

function catalogItem(item: WorkspaceArchivePublication): CatalogSourceItem {
  return {
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
    published: item.published,
    photos:
      item.photoCount > 0
        ? [{ id: `${item.sourceGroupId}-foto`, mediaType: "image/jpeg", data: "foto" }]
        : [],
    sales: item.sales,
  };
}

describe("archivado del área de trabajo de Tienda Guatemala", () => {
  const published = Array.from({ length: 24 }, (_, index) =>
    publication({
      sourceGroupId: `publicada-${index + 1}`,
      sku: `P${index + 1}`,
      priceGtq: `${20 + index}.00`,
    })
  );
  const sold = publication({
    sourceGroupId: "vendida-1",
    sku: "V1",
    status: "vendida",
    priceGtq: "55.00",
    sales: [{ isTest: false, voidedAt: null }],
  });
  const pending = publication({
    sourceGroupId: "pendiente-1",
    sku: "PEN1",
    published: false,
  });
  const failed = publication({
    sourceGroupId: "fallida-1",
    sku: "FALL1",
    published: false,
    photoCount: 1,
  });
  const withdrawn = publication({
    sourceGroupId: "retirada-1",
    sku: "RET1",
    status: "retirada",
  });
  const withoutPhoto = publication({
    sourceGroupId: "sin-foto-1",
    sku: "SF1",
    published: false,
    photoCount: 0,
    priceGtq: "18.00",
  });
  const withoutPhotoPublished = publication({
    sourceGroupId: "sin-foto-2",
    sku: "SF2",
    published: true,
    photoCount: 0,
    priceGtq: "19.00",
  });
  const otherStore = publication({
    sourceGroupId: "ajena-1",
    sku: "AJ1",
    clientId: "otra-tienda",
  });
  const publications = [
    ...published,
    sold,
    pending,
    failed,
    withdrawn,
    withoutPhoto,
    withoutPhotoPublished,
    otherStore,
  ];
  const jobs = [
    ...published.map((item) => ({ id: item.sourceGroupId })),
    { id: sold.sourceGroupId },
    { id: pending.sourceGroupId },
    { id: failed.sourceGroupId },
    { id: withdrawn.sourceGroupId },
    { id: "borrador-1" },
    { id: withoutPhoto.sourceGroupId },
    { id: withoutPhotoPublished.sourceGroupId },
  ];

  it("archiva una ficha publicada y deja el resto del área de trabajo", () => {
    const plan = planWorkspaceArchive({
      clientId: TIENDA,
      jobs,
      publications,
      jobId: "publicada-3",
    });
    expect(plan.archivedIds).toEqual(["publicada-3"]);
    const remaining = applyWorkspaceArchive(jobs, plan.archivedIds);
    expect(remaining.map((job) => job.id)).toContain("publicada-1");
    expect(remaining.map((job) => job.id)).toContain("borrador-1");
    expect(remaining.map((job) => job.id)).not.toContain("publicada-3");
    expect(publications.find((item) => item.sourceGroupId === "publicada-3")).toMatchObject({
      sku: "P3",
      priceGtq: "22.00",
      lotId: LOTE,
      status: "disponible",
      photoCount: 2,
    });
  });

  it("archiva todas las publicadas confirmadas, de cualquier cantidad, sin elegirlas una por una", () => {
    const beforeItems = publications.map((item) => ({ ...item, sales: item.sales.map((sale) => ({ ...sale })) }));
    const beforeCatalog = publicCatalogCards(publications.map(catalogItem), TIENDA).map((card) => card.sku);
    const beforeLot = lotArticleCounts(publications, LOTE);
    const plan = planWorkspaceArchive({ clientId: TIENDA, jobs, publications });
    expect(plan.archivedIds).toHaveLength(25);
    expect(plan.archivedIds).toEqual([...published.map((item) => item.sourceGroupId), sold.sourceGroupId]);
    const remaining = applyWorkspaceArchive(jobs, plan.archivedIds);
    expect(remaining.map((job) => job.id)).toEqual([
      pending.sourceGroupId,
      failed.sourceGroupId,
      withdrawn.sourceGroupId,
      "borrador-1",
      withoutPhoto.sourceGroupId,
      withoutPhotoPublished.sourceGroupId,
    ]);
    expect(publications).toEqual(beforeItems);
    expect(publicCatalogCards(publications.map(catalogItem), TIENDA).map((card) => card.sku)).toEqual(beforeCatalog);
    expect(lotArticleCounts(publications, LOTE)).toEqual(beforeLot);
    expect(beforeLot.registered).toBe(publications.filter((item) => item.lotId === LOTE).length);
    expect(publications.filter((item) => item.photoCount === 0).map((item) => item.sku)).toEqual(["SF1", "SF2"]);
    expect(workspacePublicationConfirmed(withoutPhoto, TIENDA)).toBe(false);
    expect(workspacePublicationConfirmed(withoutPhotoPublished, TIENDA)).toBe(false);
    expect(workspacePublicationConfirmed(pending, TIENDA)).toBe(false);
    expect(workspacePublicationConfirmed(failed, TIENDA)).toBe(false);

    const available = publications.find((item) => item.sourceGroupId === "publicada-1");
    expect(available).toBeTruthy();
    const sale = applyGuatemalaSale(
      {
        items: [
          {
            id: "inventario-publicada-1",
            clientId: TIENDA,
            sku: available?.sku ?? "",
            priceGtq: available?.priceGtq ?? "",
            status: "disponible",
            photos: [{ id: "foto", mediaType: "image/jpeg", data: "foto" }],
          },
        ],
        sales: [],
      },
      {
        clientId: TIENDA,
        itemId: "inventario-publicada-1",
        chargedPrice: "25",
        clientAllowed: true,
        soldBy: { role: "encargado", accountId: "cuenta", username: "ana" },
      }
    );
    expect(sale.result.ok).toBe(true);
    if (sale.result.ok) {
      expect(sale.result.sale.sku).toBe("P1");
      expect(sale.result.sale.publishedPriceGtq).toBe("20.00");
      expect(sale.book.items[0]?.status).toBe("vendida");
    }
    expect(lotArticleCounts(publications, LOTE)).toEqual(beforeLot);
    expect(publicCatalogCards(publications.map(catalogItem), TIENDA).some((card) => card.sku === "P1")).toBe(true);
  });

  it("no archiva un borrador ni una publicación pendiente cuando se pide una sola ficha", () => {
    expect(
      planWorkspaceArchive({ clientId: TIENDA, jobs, publications, jobId: "borrador-1" }).archivedIds
    ).toEqual([]);
    expect(
      planWorkspaceArchive({ clientId: TIENDA, jobs, publications, jobId: "pendiente-1" }).archivedIds
    ).toEqual([]);
    expect(
      planWorkspaceArchive({ clientId: TIENDA, jobs, publications, jobId: "sin-foto-1" }).archivedIds
    ).toEqual([]);
  });
});
