"use client";

import { useState } from "react";
import {
  GUATEMALA_CONDITION_CHOICES,
  GUATEMALA_INVENTORY_MESSAGES,
  UNPUBLISHED_ITEM_TYPES,
  prepareDraftUpdate,
  prepareUnpublishedItem,
  type InventoryPhoto,
} from "@/lib/markets/guatemala-inventory";
import { useUnsavedChanges } from "../return-home";
import "../gastos/expenses.css";

type StoreRequest = (path: string, body?: unknown) => Promise<Response>;

interface ExistingSku {
  id: string;
  sku: string;
  title: string;
}

const MAX_PHOTOS = 8;

export function QuickAddForm({
  clientId,
  lots,
  request,
  onCreated,
  onSearchExisting,
}: {
  clientId: string;
  lots: { id: string; lotNumber: number; name: string }[];
  request: StoreRequest;
  onCreated: (sku: string) => void;
  onSearchExisting: (sku: string) => void;
}) {
  const [sku, setSku] = useState("");
  const [itemType, setItemType] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [lotId, setLotId] = useState("");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<ExistingSku | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(sku || itemType || size || price || lotId);
  useUnsavedChanges(dirty && !saving);

  async function save() {
    if (saving) return;
    const prepared = prepareUnpublishedItem({ clientId, sku, itemType, size, price, lotId });
    if (!prepared.ok) {
      setExisting(null);
      setError(prepared.error);
      return;
    }
    setSaving(true);
    setError("");
    setExisting(null);
    try {
      const response = await request("/api/markets/guatemala/inventory/sin-fotos", {
        clientId,
        sku: prepared.item.sku,
        itemType: prepared.item.itemType,
        size: prepared.item.size,
        price: prepared.item.priceGtq,
        lotId: prepared.item.lotId,
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        existing?: ExistingSku | null;
        item?: { sku: string };
      };
      if (!response.ok || !body.ok) {
        setError(body.error || GUATEMALA_INVENTORY_MESSAGES.retry);
        setExisting(body.existing?.sku ? body.existing : null);
        return;
      }
      onCreated(body.item?.sku || prepared.item.sku);
    } catch {
      setError(GUATEMALA_INVENTORY_MESSAGES.retry);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="gt-sale-box gt-expense-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>Agregar sin fotos</h3>
      <p className="gt-expense-note">
        Queda en el inventario como disponible y sin publicar. No sale en el catálogo hasta que le agregues fotos y lo publiques.
      </p>
      {lots.length === 0 ? <p>Primero crea un lote de compra. El artículo tiene que quedar en un lote.</p> : null}
      <label>
        SKU
        <input value={sku} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(event) => setSku(event.target.value)} />
      </label>
      <label>
        Tipo de artículo
        <select value={itemType} onChange={(event) => setItemType(event.target.value)}>
          <option value="">Elige un tipo</option>
          {UNPUBLISHED_ITEM_TYPES.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Talla
        <input value={size} placeholder="Opcional" onChange={(event) => setSize(event.target.value)} />
      </label>
      <label>
        Precio
        <div className="gt-sale-price">
          <span aria-hidden="true">Q</span>
          <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
      </label>
      <label>
        Lote
        <select value={lotId} onChange={(event) => setLotId(event.target.value)}>
          <option value="">Elige un lote</option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              Lote {lot.lotNumber} · {lot.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="note note-error" role="alert">
          {error}
        </p>
      ) : null}
      {existing ? (
        <button type="button" className="btn btn-primary" onClick={() => onSearchExisting(existing.sku)}>
          Buscar artículo existente
        </button>
      ) : null}
      <div className="gt-inventory-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || lots.length === 0}>
          {saving ? "Guardando…" : "Guardar sin publicar"}
        </button>
      </div>
    </form>
  );
}

export function UnpublishedEditor({
  clientId,
  item,
  request,
  onSaved,
}: {
  clientId: string;
  item: {
    id: string;
    sku: string;
    title: string;
    description: string;
    brand: string;
    size: string;
    condition: string;
    priceGtq: string;
    photos: InventoryPhoto[];
  };
  request: StoreRequest;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [brand, setBrand] = useState(item.brand);
  const [size, setSize] = useState(item.size);
  const [condition, setCondition] = useState(item.condition);
  const [price, setPrice] = useState(item.priceGtq);
  const [photos, setPhotos] = useState<InventoryPhoto[]>(item.photos);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty =
    title !== item.title ||
    description !== item.description ||
    brand !== item.brand ||
    size !== item.size ||
    condition !== item.condition ||
    price !== item.priceGtq ||
    photos.map((photo) => photo.id).join() !== item.photos.map((photo) => photo.id).join();
  useUnsavedChanges(dirty || saving);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_PHOTOS) break;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setError("Usa fotos JPG, PNG o WebP.");
        continue;
      }
      const photo = await shrinkPhoto(file);
      if (!photo) {
        setError("No se pudo leer una foto. Prueba con otra.");
        continue;
      }
      next.push(photo);
    }
    setPhotos(next);
  }

  async function save(publish: boolean) {
    if (saving) return;
    const prepared = prepareDraftUpdate({
      title,
      description,
      brand,
      size,
      condition,
      price,
      photos,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    if (publish && prepared.draft.photos.length === 0) {
      setError(GUATEMALA_INVENTORY_MESSAGES.photosRequired);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await request("/api/markets/guatemala/inventory/sin-fotos/completar", {
        clientId,
        itemId: item.id,
        publish,
        title: prepared.draft.title,
        description: prepared.draft.description,
        brand: prepared.draft.brand,
        size: prepared.draft.size,
        condition: prepared.draft.condition,
        price: prepared.draft.priceGtq,
        photos: prepared.draft.photos.map((photo) => ({ mediaType: photo.mediaType, data: photo.data })),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) {
        setError(body.error || GUATEMALA_INVENTORY_MESSAGES.retry);
        return;
      }
      setNotice(body.message || GUATEMALA_INVENTORY_MESSAGES.draftSaved);
      onSaved();
    } catch {
      setError(GUATEMALA_INVENTORY_MESSAGES.retry);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="gt-sale-box gt-expense-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <h3>Completar para publicar</h3>
      <p>SKU {item.sku}. Puedes guardar los cambios y publicar cuando ya tenga fotos.</p>
      <label>
        Fotos
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void addPhotos(event.target.files)} />
      </label>
      {photos.length === 0 ? <p>Todavía no tiene fotos.</p> : <p>{photos.length} foto{photos.length === 1 ? "" : "s"}</p>}
      <div className="gt-inventory-photos">
        {photos.map((photo) => (
          <img key={photo.id} src={`data:${photo.mediaType};base64,${photo.data}`} alt="" />
        ))}
      </div>
      {photos.length > 0 ? (
        <button type="button" className="btn btn-ghost" onClick={() => setPhotos([])}>
          Quitar fotos
        </button>
      ) : null}
      <label>
        Nombre
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Descripción
        <textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        Marca
        <input value={brand} onChange={(event) => setBrand(event.target.value)} />
      </label>
      <label>
        Talla
        <input value={size} onChange={(event) => setSize(event.target.value)} />
      </label>
      <label>
        Condición
        <select value={condition} onChange={(event) => setCondition(event.target.value)}>
          <option value="">Sin condición</option>
          {GUATEMALA_CONDITION_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Precio
        <div className="gt-sale-price">
          <span aria-hidden="true">Q</span>
          <input inputMode="decimal" autoComplete="off" value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
      </label>
      {error ? (
        <p className="note note-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="gt-inventory-actions">
        <button type="submit" className="btn btn-ghost" disabled={saving}>
          {saving ? "Guardando…" : "Guardar sin publicar"}
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save(true)}>
          {saving ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </form>
  );
}

async function shrinkPhoto(file: File): Promise<InventoryPhoto | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.72);
    const data = url.split(",")[1] ?? "";
    if (!data) return null;
    return { id: crypto.randomUUID(), mediaType: "image/jpeg", data };
  } catch {
    return null;
  }
}
