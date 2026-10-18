import { describe, expect, it } from "vitest";
import { publicCatalogCards, publicCatalogDetail } from "@/lib/markets/guatemala-catalog";
import { runInventorySave, type InventoryRepository } from "@/lib/markets/guatemala-inventory-store";
import type { StoredInventoryItem } from "@/lib/markets/guatemala-inventory";
import {
  changePublication,
  DISCARD_PUBLICATION_PROMPT,
  emptyPublicationDraft,
  isolatedPublicationSku,
  publicationDraftAfterDiscard,
  publicationResultIsCurrent,
  publishReviewBlockers,
  staffCanConfirmPublish,
  type PublicationDraft,
  type StaffPublicationItem,
} from "@/lib/markets/guatemala-publish";

const photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const CLIENT = "client-guatemala";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT,
    sourceGroupId: "borrador-1",
    sku: "prueba-publicar-abc12345",
    title: "Polo de prueba",
    description: "Prenda aislada para comprobar la publicación.",
    brand: "Arrow",
    size: "M",
    condition: "GOOD",
    price: "80.00",
    photos: [{ mediaType: "image/jpeg", data: photo }],
    ...overrides,
  };
}

function memoryRepository(): InventoryRepository & { items: StoredInventoryItem[] } {
  const items: StoredInventoryItem[] = [];
  return {
    items,
    async findBySource(clientId, sourceGroupId) {
      return items.find((item) => item.clientId === clientId && item.sourceGroupId === sourceGroupId) ?? null;
    },
    async findBySku(clientId, sku) {
      return items.find((item) => item.clientId === clientId && item.sku === sku) ?? null;
    },
    async insert(item) {
      const clash = items.some(
        (stored) =>
          stored.clientId === item.clientId &&
          (stored.sku === item.sku || stored.sourceGroupId === item.sourceGroupId)
      );
      if (clash) return null;
      const stored: StoredInventoryItem = {
        ...item,
        id: `stored-${items.length + 1}`,
        status: "disponible",
        photos: item.photos.map((entry) => ({ ...entry })),
      };
      items.push(stored);
      return stored;
    },
  };
}

describe("publicación del encargado", () => {
  it("exige revisar y conserva los datos cuando falta el precio", () => {
    const draft = { sku: "410", title: "Camisa", price: "", photoCount: 1 };
    expect(staffCanConfirmPublish("datos")).toBe(false);
    expect(staffCanConfirmPublish("revision")).toBe(true);
    expect(publishReviewBlockers(draft)).toContain("Escribe un precio válido en quetzales.");
    expect(draft).toEqual({ sku: "410", title: "Camisa", price: "", photoCount: 1 });
  });

  it("descarta solo la preparación actual y deja fuera una consulta pendiente", () => {
    const draft: PublicationDraft = {
      sku: "prueba-publicar-abc12345",
      title: "Polo de prueba",
      description: "Texto",
      brand: "Arrow",
      size: "M",
      condition: "GOOD",
      price: "80.00",
      priceNote: "Precio orientativo",
      skuNote: "Ese SKU está libre.",
      itemType: "polo",
      category: "ropa",
      photoCount: 2,
    };
    expect(DISCARD_PUBLICATION_PROMPT).toBe("¿Descartar este artículo y empezar de nuevo?");
    expect(publicationDraftAfterDiscard(draft, false)).toEqual(draft);
    expect(publicationDraftAfterDiscard(draft, true)).toEqual(emptyPublicationDraft());
    expect(publicationResultIsCurrent(3, 4)).toBe(false);
    expect(publicationResultIsCurrent(4, 4)).toBe(true);
  });

  it("guarda una sola vez, atribuye al encargado y la muestra en el catálogo", async () => {
    const repository = memoryRepository();
    const actor = { role: "encargado" as const, accountId: "cuenta-oseas", username: "oseaspacheco" };
    const saved = await runInventorySave(repository, payload(), async () => true, actor);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.action).toBe("created");
    expect(saved.item.status).toBe("disponible");
    expect(saved.item.createdBy).toMatchObject({ role: "encargado", username: "oseaspacheco" });

    const again = await runInventorySave(
      repository,
      payload({ price: "10.00", title: "Otro título" }),
      async () => true,
      actor
    );
    expect(again.ok && again.action).toBe("already_saved");
    expect(repository.items).toHaveLength(1);
    expect(repository.items[0]?.title).toBe("Polo de prueba");
    expect(repository.items[0]?.priceGtq).toBe("80.00");
    expect(repository.items[0]?.createdBy?.username).toBe("oseaspacheco");

    const cards = publicCatalogCards(
      repository.items.map((item) => ({ ...item, sales: [] })),
      CLIENT
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sku).toBe("prueba-publicar-abc12345");
    expect(JSON.stringify(cards)).not.toMatch(/createdBy|username|oseaspacheco|costGtq/);
    expect(isolatedPublicationSku("prueba-publicar-abc12345")).toBe(true);
    expect(isolatedPublicationSku("3001")).toBe(false);
  });

  it("retira, corrige y vuelve a publicar el mismo SKU, y no ofrece una prenda vendida", () => {
    const actor = { role: "encargado" as const, accountId: "cuenta-oseas", username: "oseaspacheco" };
    const now = new Date("2026-10-18T20:00:00.000Z");
    let item: StaffPublicationItem = {
      id: "prenda-1",
      clientId: CLIENT,
      sku: "prueba-publicar-abc12345",
      title: "Polo de prueba",
      description: "Texto inicial",
      brand: "Arrow",
      size: "M",
      condition: "GOOD",
      priceGtq: "80.00",
      status: "disponible",
      photoCount: 1,
      sold: false,
    };
    const source = (current: StaffPublicationItem) => ({
      id: current.id,
      clientId: current.clientId,
      sku: current.sku,
      title: current.title,
      description: current.description,
      brand: current.brand,
      size: current.size,
      condition: current.condition,
      priceGtq: current.priceGtq,
      status: current.status,
      photos: [{ id: "foto", mediaType: "image/jpeg", data: photo }],
      sales: [],
    });
    const visible = (current: StaffPublicationItem) => publicCatalogCards([source(current)], CLIENT);
    const direct = (current: StaffPublicationItem) => publicCatalogDetail([source(current)], CLIENT, current.id);
    expect(visible(item)).toHaveLength(1);
    expect(direct(item)?.sku).toBe(item.sku);

    const withdrawn = changePublication(item, CLIENT, "retirar", null, actor, now);
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    item = withdrawn.item;
    expect(item.status).toBe("retirada");
    expect(item.id).toBe("prenda-1");
    expect(item.sku).toBe("prueba-publicar-abc12345");
    expect(withdrawn.event?.actor.username).toBe("oseaspacheco");
    expect(withdrawn.event?.at).toBe(now.toISOString());
    expect(visible(item)).toHaveLength(0);
    expect(direct(item)).toBeNull();
    const withdrawnAgain = changePublication(item, CLIENT, "retirar", null, actor, now);
    expect(withdrawnAgain.ok).toBe(true);
    if (withdrawnAgain.ok) expect(withdrawnAgain.event).toBeNull();

    const corrected = changePublication(
      item,
      CLIENT,
      "corregir",
      {
        title: "Polo corregido",
        description: "Texto corregido",
        brand: "Arrow",
        size: "L",
        condition: "VERY_GOOD",
        priceGtq: "90.00",
        photoCount: 2,
      },
      actor,
      now
    );
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    item = corrected.item;
    expect(item.id).toBe("prenda-1");
    expect(item.sku).toBe("prueba-publicar-abc12345");
    expect(item.title).toBe("Polo corregido");
    expect(item.priceGtq).toBe("90.00");
    expect(item.status).toBe("retirada");
    expect(visible(item)).toHaveLength(0);
    expect(direct(item)).toBeNull();

    const republished = changePublication(item, CLIENT, "republicar", null, actor, now);
    expect(republished.ok).toBe(true);
    if (!republished.ok) return;
    item = republished.item;
    expect(item.status).toBe("disponible");
    expect(item.sku).toBe("prueba-publicar-abc12345");
    expect(visible(item)[0]?.title).toBe("Polo corregido");
    expect(visible(item)[0]?.priceGtq).toBe("90.00");
    expect(direct(item)?.title).toBe("Polo corregido");
    expect(JSON.stringify(direct(item))).not.toMatch(/oseaspacheco|username|actor/);
    const republishedAgain = changePublication(item, CLIENT, "republicar", null, actor, now);
    expect(republishedAgain.ok).toBe(true);
    if (republishedAgain.ok) expect(republishedAgain.event).toBeNull();

    const soldItem = { ...item, status: "vendida" as const, sold: true };
    expect(changePublication(soldItem, CLIENT, "republicar", null, actor, now)).toMatchObject({ ok: false, status: 409 });
    expect(changePublication(soldItem, CLIENT, "retirar", null, actor, now)).toMatchObject({ ok: false, status: 409 });
    expect(changePublication(soldItem, CLIENT, "corregir", {
      title: "Otra",
      description: "",
      brand: "",
      size: "",
      condition: "",
      priceGtq: "10.00",
      photoCount: 1,
    }, actor, now)).toMatchObject({ ok: false, status: 409 });
    expect(visible(soldItem)).toHaveLength(0);
    expect(direct(soldItem)).toBeNull();
    expect(changePublication(item, "otro-cliente", "retirar", null, actor, now)).toMatchObject({ ok: false, status: 404 });
  });
});
