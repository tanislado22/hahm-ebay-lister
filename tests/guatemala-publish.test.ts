import { describe, expect, it } from "vitest";
import { publicCatalogCards } from "@/lib/markets/guatemala-catalog";
import { runInventorySave, type InventoryRepository } from "@/lib/markets/guatemala-inventory-store";
import type { StoredInventoryItem } from "@/lib/markets/guatemala-inventory";
import {
  isolatedPublicationSku,
  publishReviewBlockers,
  staffCanConfirmPublish,
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
});
