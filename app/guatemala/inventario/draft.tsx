"use client";

import { useState } from "react";
import { applyRotatedPhoto, photoRevision, rotatePhotoClockwise } from "@/lib/photos/rotate";
import { RotatePhotoButton } from "../../RotatePhotoButton";
import {
  GUATEMALA_CONDITION_CHOICES,
  GUATEMALA_INVENTORY_MESSAGES,
  UNPUBLISHED_ITEM_TYPES,
  prepareDraftUpdate,
  prepareUnpublishedItem,
  type InventoryPhoto,
} from "@/lib/markets/guatemala-inventory";
import { REGISTRATION_MESSAGES, skuFromRegistrationScan } from "@/lib/markets/guatemala-registration";
import {
  SALE_ADVICE_MESSAGES,
  priceIsBelowMinimum,
  quetzalLabel,
  saleAdviceGaps,
  supportPhotoSuggestions,
  type QuotedSalePrice,
} from "@/lib/markets/guatemala-sale-advice";
import { garmentQrText } from "@/lib/markets/guatemala-qr";
import { RegistrationQrCamera } from "../escanear/qr-camera";
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
  showCosts = false,
}: {
  clientId: string;
  lots: { id: string; lotNumber: number; name: string }[];
  request: StoreRequest;
  showCosts?: boolean;
  onCreated: (sku: string) => void;
  onSearchExisting: (sku: string) => void;
}) {
  const [sku, setSku] = useState("");
  const [itemType, setItemType] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [individualCost, setIndividualCost] = useState("");
  const [price, setPrice] = useState("");
  const [lotId, setLotId] = useState("");
  const [error, setError] = useState("");
  const [labelNote, setLabelNote] = useState("");
  const [existing, setExisting] = useState<ExistingSku | null>(null);
  const [saving, setSaving] = useState(false);
  const [readingPhotos, setReadingPhotos] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [garmentPhoto, setGarmentPhoto] = useState<{ mediaType: string; data: string } | null>(null);
  const [labelPhoto, setLabelPhoto] = useState<{ mediaType: string; data: string } | null>(null);
  const [advice, setAdvice] = useState<QuotedSalePrice | null>(null);
  const dirty = Boolean(sku || itemType || brand || size || condition || individualCost || price || lotId || cameraOn || garmentPhoto || labelPhoto);
  useUnsavedChanges(dirty && !saving);
  const belowMinimum = priceIsBelowMinimum(price, advice?.minimumGtq ?? null);

  async function warnIfSkuExists(value: string) {
    const trimmed = value.trim();
    if (!trimmed || !clientId) {
      setExisting(null);
      return;
    }
    try {
      const response = await request(
        `/api/markets/guatemala/inventory/qr?clientId=${encodeURIComponent(clientId)}&sku=${encodeURIComponent(trimmed)}`
      );
      const body = (await response.json()) as {
        ok?: boolean;
        choice?: "one" | "many";
        garment?: ExistingSku;
        garments?: ExistingSku[];
      };
      if (!response.ok || !body.ok) {
        setExisting(null);
        return;
      }
      const found = body.choice === "many" ? body.garments?.[0] : body.garment;
      setExisting(found?.sku ? found : { id: "", sku: trimmed, title: "" });
      setError(REGISTRATION_MESSAGES.already);
    } catch {
      setError(GUATEMALA_INVENTORY_MESSAGES.retry);
    }
  }

  async function fillSku(raw: string) {
    setCameraOn(false);
    const scan = skuFromRegistrationScan(raw);
    if (!scan.ok) {
      setError(scan.error);
      return;
    }
    if (scan.kind === "item") {
      try {
        const response = await request(
          `/api/markets/guatemala/inventory/qr?clientId=${encodeURIComponent(clientId)}&codigo=${encodeURIComponent(garmentQrText(scan.itemId))}`
        );
        const body = (await response.json()) as { ok?: boolean; garment?: ExistingSku };
        if (response.ok && body.ok && body.garment?.sku) {
          setSku(body.garment.sku);
          setExisting(body.garment);
          setError(REGISTRATION_MESSAGES.already);
          return;
        }
      } catch {
        setError(GUATEMALA_INVENTORY_MESSAGES.retry);
        return;
      }
      setError(REGISTRATION_MESSAGES.already);
      return;
    }
    setSku(scan.sku);
    setError("");
    setExisting(null);
    await warnIfSkuExists(scan.sku);
  }

  async function identifyFromPhotos(current: { itemType: string; brand: string; size: string; condition: string }) {
    const images = [garmentPhoto, labelPhoto].filter((photo): photo is { mediaType: string; data: string } => Boolean(photo));
    if (images.length === 0) return current;
    setReadingPhotos(true);
    setLabelNote("");
    try {
      const response = await request("/api/markets/guatemala/publicar/preparar", { images });
      const body = (await response.json()) as {
        ok?: boolean;
        listing?: { itemType?: string; title?: string; brand?: string; size?: string; condition?: string };
      };
      if (!response.ok || !body.ok || !body.listing) {
        setLabelNote(SALE_ADVICE_MESSAGES.labelUnread);
        return current;
      }
      const suggestions = supportPhotoSuggestions(body.listing);
      const next = {
        itemType: current.itemType || suggestions.itemType,
        brand: current.brand || suggestions.brand,
        size: current.size || suggestions.size,
        condition: current.condition || suggestions.condition,
      };
      setItemType(next.itemType);
      setBrand(next.brand);
      setSize(next.size);
      setCondition(next.condition);
      setLabelNote(suggestions.labelReadable ? "" : SALE_ADVICE_MESSAGES.labelUnread);
      return next;
    } catch {
      setLabelNote(SALE_ADVICE_MESSAGES.labelUnread);
      return current;
    } finally {
      setReadingPhotos(false);
    }
  }

  async function suggestPrice() {
    if (suggesting || saving) return;
    setSuggesting(true);
    setAdvice(null);
    try {
      const identified = await identifyFromPhotos({ itemType, brand, size, condition });
      const gaps = saleAdviceGaps(identified);
      if (gaps.length > 0) {
        setAdvice({ status: "waiting", minimumGtq: null, recommendedGtq: null, notice: gaps.join(" ") });
        return;
      }
      const response = await request("/api/markets/guatemala/sale-advice", {
        clientId,
        itemType: identified.itemType,
        brand: identified.brand,
        condition: identified.condition,
        lotId,
        individualCost: showCosts ? individualCost : undefined,
      });
      const body = (await response.json()) as { ok?: boolean; advice?: QuotedSalePrice };
      if (!response.ok || !body.ok || !body.advice) {
        setAdvice({
          status: "need-settings",
          minimumGtq: null,
          recommendedGtq: null,
          notice: "No se pudo calcular el precio. Inténtalo de nuevo.",
        });
        return;
      }
      const quote = body.advice;
      setAdvice(
        showCosts
          ? quote
          : {
              status: quote.status,
              minimumGtq: quote.minimumGtq,
              recommendedGtq: quote.recommendedGtq,
              notice: quote.notice,
            }
      );
    } catch {
      setAdvice({
        status: "need-settings",
        minimumGtq: null,
        recommendedGtq: null,
        notice: "No se pudo calcular el precio. Inténtalo de nuevo.",
      });
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (saving) return;
    if (existing) {
      setError(REGISTRATION_MESSAGES.already);
      return;
    }
    const prepared = prepareUnpublishedItem({ clientId, sku, itemType, brand, size, condition, price, lotId });
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
        brand: prepared.item.brand,
        size: prepared.item.size,
        condition: prepared.item.condition,
        price: prepared.item.priceGtq,
        lotId: prepared.item.lotId,
        cost: showCosts ? individualCost : undefined,
        supportPhotos: [garmentPhoto && { role: "prenda", ...garmentPhoto }, labelPhoto && { role: "etiqueta", ...labelPhoto }].filter(
          (entry) => entry
        ),
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
      <h3>Agregar artículo sin foto</h3>
      <p className="gt-expense-note">
        Queda en el inventario como disponible y sin publicar. Las fotos de la prenda y de la etiqueta son internas y no salen en el catálogo. El lote es opcional.
      </p>
      <label>
        SKU
        <input
          value={sku}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setSku(event.target.value);
            setExisting(null);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void warnIfSkuExists(event.currentTarget.value);
          }}
          onBlur={(event) => void warnIfSkuExists(event.currentTarget.value)}
        />
      </label>
      <div className="gt-inventory-actions">
        <button type="button" className="btn btn-primary" onClick={() => setCameraOn(true)}>
          Escanear SKU
        </button>
      </div>
      <p>Puedes escribir el SKU o usar un lector. El artículo se guarda al pulsar Guardar.</p>
      <RegistrationQrCamera active={cameraOn} onCode={(text) => void fillSku(text)} onClose={() => setCameraOn(false)} />
      <SupportPhotoField
        legend="Foto de la prenda"
        photo={garmentPhoto}
        onPhoto={setGarmentPhoto}
        onError={setError}
      />
      <SupportPhotoField
        legend="Foto de la etiqueta"
        photo={labelPhoto}
        onPhoto={setLabelPhoto}
        onError={setError}
      />
      {readingPhotos ? <p role="status">Leyendo la prenda y la etiqueta…</p> : null}
      {labelNote ? <p className="note">{labelNote}</p> : null}
      <p className="gt-expense-note">Si la etiqueta falta o no se lee, escribe la marca y la talla.</p>
      <div className="gt-inventory-actions">
        <button type="button" className="btn btn-primary" onClick={() => void suggestPrice()} disabled={suggesting || saving}>
          {suggesting ? "Calculando…" : "Sugerir precio"}
        </button>
      </div>
      <SaleAdvicePanel advice={advice} showCosts={showCosts} onUse={setPrice} />
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
        Marca
        <input value={brand} placeholder="Opcional" onChange={(event) => setBrand(event.target.value)} />
      </label>
      <label>
        Talla
        <input value={size} placeholder="Opcional" onChange={(event) => setSize(event.target.value)} />
      </label>
      <label>
        Estado de la prenda
        <select value={condition} onChange={(event) => setCondition(event.target.value)}>
          <option value="">Confirma el estado</option>
          {GUATEMALA_CONDITION_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {showCosts ? (
        <label>
          Costo individual
          <div className="gt-sale-price">
            <span aria-hidden="true">Q</span>
            <input
              id="costo-individual"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Si esta prenda tiene el suyo"
              value={individualCost}
              onChange={(event) => setIndividualCost(event.target.value)}
            />
          </div>
        </label>
      ) : null}
      <label>
        Lote
        <select value={lotId} onChange={(event) => setLotId(event.target.value)}>
          <option value="">Sin lote</option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              Lote {lot.lotNumber} · {lot.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="precio-venta">Precio de venta</label>
      <div className="gt-sale-price">
        <span aria-hidden="true">Q</span>
        <input
          id="precio-venta"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      {belowMinimum ? (
        <p className="note note-error" role="alert">
          {SALE_ADVICE_MESSAGES.belowMinimum}
        </p>
      ) : null}
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
      <p className="gt-expense-note">Puedes guardar el artículo sin esas fotos.</p>
      <div className="gt-inventory-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || Boolean(existing)}>
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
  const [savedPhotoRevision, setSavedPhotoRevision] = useState(() => photoRevision(item.photos));
  const [rotatingId, setRotatingId] = useState("");
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
    photoRevision(photos) !== savedPhotoRevision;
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

  async function rotatePhoto(photo: InventoryPhoto) {
    if (rotatingId || saving) return;
    setRotatingId(photo.id);
    setError("");
    try {
      const rotated = await rotatePhotoClockwise(photo);
      const next = applyRotatedPhoto(photos, photo.id, { mediaType: rotated.mediaType, data: rotated.data });
      setPhotos(next);
      await save(false, next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo rotar la foto.");
    } finally {
      setRotatingId("");
    }
  }

  async function save(publish: boolean, nextPhotos = photos) {
    if (saving) return;
    const prepared = prepareDraftUpdate({
      title,
      description,
      brand,
      size,
      condition,
      price,
      photos: nextPhotos,
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
      setSavedPhotoRevision(photoRevision(nextPhotos));
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
          <figure key={photo.id}>
            <img src={`data:${photo.mediaType};base64,${photo.data}`} alt="" />
            <RotatePhotoButton busy={rotatingId === photo.id} onRotate={() => void rotatePhoto(photo)} />
          </figure>
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

function SupportPhotoField({
  legend,
  photo,
  onPhoto,
  onError,
}: {
  legend: string;
  photo: { mediaType: string; data: string } | null;
  onPhoto: (photo: { mediaType: string; data: string } | null) => void;
  onError: (message: string) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="gt-inventory-actions">
        <label className="btn btn-primary">
          Tomar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void chooseOptionalPhoto(file, onPhoto, onError);
            }}
          />
        </label>
        <label className="btn">
          Elegir imagen
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void chooseOptionalPhoto(file, onPhoto, onError);
            }}
          />
        </label>
      </div>
      {photo ? (
        <div className="gt-photo-search-preview">
          <img src={`data:${photo.mediaType};base64,${photo.data}`} alt="" />
          <button type="button" className="btn" onClick={() => onPhoto(null)}>
            Quitar foto
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}

function SaleAdvicePanel({
  advice,
  showCosts,
  onUse,
}: {
  advice: QuotedSalePrice | null;
  showCosts: boolean;
  onUse: (price: string) => void;
}) {
  if (!advice) return null;
  const cost =
    showCosts && advice.costGtq
      ? advice.costSource === "individual"
        ? `Costo usado: ${quetzalLabel(advice.costGtq)} de esta prenda.`
        : `Costo usado: ${quetzalLabel(advice.costGtq)}, promedio del lote.`
      : "";
  return (
    <section className="gt-price-advice" aria-label="Precio sugerido">
      {cost ? <p>{cost}</p> : null}
      {showCosts && advice.costSource === "lot" && advice.costGtq ? (
        <p>Los gastos del lote ya están en ese costo y no se suman otra vez.</p>
      ) : null}
      {showCosts && advice.expenseShareGtq ? <p>Gastos de la tienda por prenda: {quetzalLabel(advice.expenseShareGtq)}</p> : null}
      {advice.status === "ready" && advice.recommendedGtq != null ? (
        <p>Precio sugerido {quetzalLabel(advice.recommendedGtq)}</p>
      ) : null}
      {advice.notice ? <p>{advice.notice}</p> : null}
      {advice.minimumGtq != null ? <p>Precio mínimo {quetzalLabel(advice.minimumGtq)}</p> : null}
      {showCosts && advice.status === "ready" && advice.recommendedGtq != null && advice.profitGtq ? (
        <p>
          Ganancia estimada a {quetzalLabel(advice.recommendedGtq)}: {quetzalLabel(advice.profitGtq)}
        </p>
      ) : null}
      {advice.status === "ready" && advice.recommendedGtq != null ? (
        <button type="button" className="btn btn-primary" onClick={() => onUse(advice.recommendedGtq!.toFixed(2))}>
          Usar precio sugerido
        </button>
      ) : null}
    </section>
  );
}

async function chooseOptionalPhoto(
  file: File | undefined,
  setPhoto: (photo: { mediaType: string; data: string } | null) => void,
  setError: (message: string) => void
) {
  if (!file) return;
  const next = await shrinkPhoto(file);
  if (!next?.data) {
    setError("No se pudo leer esa foto. Prueba con otra.");
    return;
  }
  setPhoto({ mediaType: next.mediaType, data: next.data });
  setError("");
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
