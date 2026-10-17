import { describe, expect, it } from "vitest";
import {
  GUATEMALA_INVENTORY_MESSAGES,
  inventorySearchMatches,
  prepareInventorySave,
  quetzalPriceText,
  resolveInventoryInsert,
  type StoredInventoryItem,
} from "@/lib/markets/guatemala-inventory";
import { runInventorySave, type InventoryRepository } from "@/lib/markets/guatemala-inventory-store";
import { buildSku } from "@/lib/sku";

const photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    clientId: "client-guatemala",
    sourceGroupId: "group-1",
    sku: "3.001-A",
    title: "Camisa azul",
    description: "Camisa de algodón.",
    brand: "Nike",
    size: "M",
    condition: "GOOD",
    price: "30.50",
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

describe("inventario de Tienda Guatemala", () => {
  it("conserva el SKU 3.001-A como texto, con la foto y el precio", async () => {
    const repository = memoryRepository();
    const saved = await runInventorySave(repository, payload(), async () => true);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.action).toBe("created");
    expect(saved.item.sku).toBe("3.001-A");
    expect(typeof saved.item.sku).toBe("string");
    expect(buildSku("3.001", 0)).toBe("3.001-A");
    const typedWithoutSuffix = prepareInventorySave(payload({ sku: "3.001", sourceGroupId: "group-plain" }));
    expect(typedWithoutSuffix.ok).toBe(true);
    if (typedWithoutSuffix.ok) expect(typedWithoutSuffix.item.sku).toBe("3.001");
    expect(saved.item.priceGtq).toBe("30.50");
    expect(saved.item.photos[0]?.data).toBe(photo);
    expect(saved.item.status).toBe("disponible");

    const again = await runInventorySave(
      repository,
      payload({ price: "99.00", photos: [{ mediaType: "image/jpeg", data: "otra-foto" }] }),
      async () => true
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.action).toBe("already_saved");
    expect(repository.items).toHaveLength(1);
    expect(repository.items[0]?.sku).toBe("3.001-A");
    expect(repository.items[0]?.priceGtq).toBe("30.50");
    expect(repository.items[0]?.photos[0]?.data).toBe(photo);
  });

  it("rechaza el mismo SKU en otra prenda sin reemplazar la guardada", async () => {
    const repository = memoryRepository();
    await runInventorySave(repository, payload(), async () => true);
    const other = await runInventorySave(
      repository,
      payload({ sourceGroupId: "group-2", title: "Otra camisa", price: "15.00" }),
      async () => true
    );
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.status).toBe(409);
    expect(other.error).toContain("3.001-A");
    expect(repository.items).toHaveLength(1);
    expect(repository.items[0]?.title).toBe("Camisa azul");
    expect(repository.items[0]?.priceGtq).toBe("30.50");
  });

  it("separa el inventario de otro cliente", async () => {
    const repository = memoryRepository();
    await runInventorySave(repository, payload(), async () => true);
    const otherClient = await runInventorySave(
      repository,
      payload({ clientId: "otro-cliente", sourceGroupId: "group-9" }),
      async (clientId) => clientId === "client-guatemala" || clientId === "otro-cliente"
    );
    expect(otherClient.ok).toBe(true);
    expect(repository.items).toHaveLength(2);
    expect(repository.items.filter((item) => item.clientId === "client-guatemala")).toHaveLength(1);
  });

  it("exige SKU y un precio válido, y no guarda fuera de Tienda Guatemala", async () => {
    const repository = memoryRepository();
    const missingSku = await runInventorySave(repository, payload({ sku: "   " }), async () => true);
    const missingPrice = await runInventorySave(repository, payload({ price: "" }), async () => true);
    const blocked = await runInventorySave(repository, payload({ clientId: "my-store" }), async () => false);
    expect(missingSku).toMatchObject({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.skuRequired });
    expect(missingPrice).toMatchObject({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.priceInvalid });
    expect(blocked).toMatchObject({ ok: false, status: 403 });
    expect(repository.items).toHaveLength(0);
    expect(quetzalPriceText("30.50")).toBe("30.50");
    expect(quetzalPriceText(0)).toBeNull();
    expect(prepareInventorySave(payload()).ok).toBe(true);
  });

  it("encuentra la prenda por SKU o título y no cambia un artículo ya guardado", () => {
    const stored: StoredInventoryItem = {
      id: "stored-1",
      clientId: "client-guatemala",
      sourceGroupId: "group-1",
      sku: "3.001-A",
      title: "Camisa azul",
      description: "Camisa de algodón.",
      brand: "Nike",
      size: "M",
      condition: "GOOD",
      priceGtq: "30.50",
      photos: [{ id: "photo-1", mediaType: "image/jpeg", data: photo }],
      status: "disponible",
    };
    expect(inventorySearchMatches(stored, "3.001")).toBe(true);
    expect(inventorySearchMatches(stored, "camisa")).toBe(true);
    expect(inventorySearchMatches(stored, "pantalón")).toBe(false);
    const decision = resolveInventoryInsert(
      { ...stored, priceGtq: "10.00", photos: [{ id: "nueva", mediaType: "image/jpeg", data: "x" }] },
      stored,
      stored
    );
    expect(decision).toMatchObject({ action: "already_saved", item: stored });
    expect(stored.priceGtq).toBe("30.50");
    expect(stored.photos[0]?.data).toBe(photo);
  });
});
