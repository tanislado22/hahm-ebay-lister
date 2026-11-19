"use client";

import { useEffect, useRef, useState } from "react";
import { guatemalaRequest } from "../../request";
import { useUnsavedChanges } from "../../return-home";
import { guatemalaPriceIfEmpty } from "@/lib/markets/guatemala-price-match";
import {
  GUATEMALA_CONDITION_CHOICES,
  GUATEMALA_INVENTORY_MESSAGES,
  formatStoredQuetzales,
  guatemalaConditionLabel,
  quetzalPriceText,
} from "@/lib/markets/guatemala-inventory";
import {
  DISCARD_PUBLICATION_PROMPT,
  emptyPublicationDraft,
  publicationResultIsCurrent,
  publishReviewBlockers,
  staffCanConfirmPublish,
  type PublishStep,
} from "@/lib/markets/guatemala-publish";
import type { GuatemalaCompReport } from "@/lib/types";
import { applyRotatedPhoto, rotatePhotoClockwise } from "@/lib/photos/rotate";
import { RotatePhotoButton } from "../../../RotatePhotoButton";
import { RegistrationQrCamera } from "../../escanear/qr-camera";
import {
  applyRegistrationScan,
  REGISTRATION_MESSAGES,
  registrationFormShouldClear,
} from "@/lib/markets/guatemala-registration";
import { garmentQrText, scanLotLabel } from "@/lib/markets/guatemala-qr";

interface DraftPhoto {
  id: string;
  mediaType: string;
  data: string;
}

interface PreparedListing {
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  itemType: string;
  category: string;
}

const MAX_PHOTOS = 8;

export function PublishScreen({ clientId = "" }: { clientId?: string }) {
  const draftId = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const priceTouched = useRef(false);
  const requestGeneration = useRef(0);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [rotatingId, setRotatingId] = useState("");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [itemType, setItemType] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [priceNote, setPriceNote] = useState("");
  const [skuNote, setSkuNote] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<PublishStep>("datos");
  const [pending, setPending] = useState("");
  const [publishedId, setPublishedId] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lots, setLots] = useState<{ id: string; lotNumber: number; name: string }[]>([]);
  const [lotId, setLotId] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [existing, setExisting] = useState<{ id: string; sku: string; title: string } | null>(null);
  const [existingChoices, setExistingChoices] = useState<
    { id: string; sku: string; title: string; lotNumber: number | null; lotName: string | null }[]
  >([]);
  const [savedNotice, setSavedNotice] = useState("");
  const skuTouched = useRef(false);

  useEffect(() => {
    if (!clientId) return;
    void guatemalaRequest(`/api/markets/guatemala/lots?clientId=${encodeURIComponent(clientId)}`, undefined, { actor: "encargado" })
      .then((response) => response.json())
      .then((body: { ok?: boolean; lots?: { id: string; lotNumber: number; name: string; status: string }[] }) => {
        if (!body.ok) return;
        setLots((body.lots ?? []).filter((lot) => lot.status !== "anulado").map((lot) => ({
          id: lot.id,
          lotNumber: lot.lotNumber,
          name: lot.name,
        })));
      })
      .catch(() => setLots([]));
  }, [clientId]);

  async function chooseLot(nextLotId: string) {
    setLotId(nextLotId);
    setStep("datos");
    if (!nextLotId) return;
    const response = await guatemalaRequest(
      `/api/markets/guatemala/lots?clientId=${encodeURIComponent(clientId)}&skuLote=${encodeURIComponent(nextLotId)}`,
      undefined,
      { actor: "encargado" }
    );
    const body = (await response.json()) as { ok?: boolean; sku?: string; note?: string };
    if (!response.ok || !body.ok || !body.sku) return;
    setSkuNote(body.note || "Revisa el SKU antes de guardar.");
    if (!skuTouched.current) setSku(body.sku);
  }

  function keepDraft() {
    setStep("datos");
  }

  function discardDraft() {
    if (saving.current) return;
    clearRegistrationForm();
  }

  function clearRegistrationForm() {
    const blank = emptyPublicationDraft();
    requestGeneration.current += 1;
    draftId.current = crypto.randomUUID();
    priceTouched.current = false;
    setPhotos([]);
    setSku(blank.sku);
    skuTouched.current = false;
    setLotId("");
    setTitle(blank.title);
    setDescription(blank.description);
    setBrand(blank.brand);
    setSize(blank.size);
    setCondition(blank.condition);
    setItemType(blank.itemType);
    setCategory(blank.category);
    setPrice(blank.price);
    setPriceNote(blank.priceNote);
    setSkuNote(blank.skuNote);
    setError("");
    setPending("");
    setStep("datos");
    setConfirmDiscard(false);
    setCameraOn(false);
    setExisting(null);
    setExistingChoices([]);
  }

  async function rotatePhoto(photo: DraftPhoto) {
    if (rotatingId) return;
    setRotatingId(photo.id);
    setError("");
    try {
      const rotated = await rotatePhotoClockwise(photo);
      setPhotos((current) => applyRotatedPhoto(current, photo.id, { mediaType: rotated.mediaType, data: rotated.data }));
      setStep("datos");
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo rotar la foto.");
    } finally {
      setRotatingId("");
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const ticket = requestGeneration.current;
    setError("");
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      if (next.length >= MAX_PHOTOS) break;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setError("Usa fotos JPG, PNG o WebP.");
        continue;
      }
      const photo = await shrinkPhoto(file);
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      if (!photo) {
        setError("No se pudo leer una foto. Prueba con otra.");
        continue;
      }
      next.push(photo);
    }
    if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
    setPhotos(next);
    if (step === "revision") setStep("datos");
  }

  async function checkSku(): Promise<boolean> {
    const ticket = requestGeneration.current;
    const trimmed = sku.trim();
    setSkuNote("");
    if (!trimmed) {
      setError(GUATEMALA_INVENTORY_MESSAGES.skuRequired);
      return false;
    }
    const response = await guatemalaRequest(
      `/api/markets/guatemala/publicar?sku=${encodeURIComponent(trimmed)}`,
      undefined,
      { actor: "encargado" }
    );
    if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return false;
    const body = (await response.json()) as { ok?: boolean; available?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo comprobar el SKU.");
      return false;
    }
    if (!body.available) {
      setSkuNote(GUATEMALA_INVENTORY_MESSAGES.skuInUse);
      setError(body.error || GUATEMALA_INVENTORY_MESSAGES.skuInUse);
      await findExisting({ sku: trimmed }, false);
      return false;
    }
    setSkuNote("Ese SKU está libre.");
    return true;
  }

  async function prepare() {
    const ticket = requestGeneration.current;
    if (photos.length === 0) {
      setError(GUATEMALA_INVENTORY_MESSAGES.photosRequired);
      return;
    }
    setPending("Preparando la prenda…");
    setError("");
    try {
      const response = await guatemalaRequest(
        "/api/markets/guatemala/publicar/preparar",
        { images: photos.map((photo) => ({ mediaType: photo.mediaType, data: photo.data })) },
        { actor: "encargado" }
      );
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      const body = (await response.json()) as { ok?: boolean; error?: string; listing?: PreparedListing };
      if (!response.ok || !body.ok || !body.listing) {
        setError(body.error || "No se pudo preparar la prenda. Las fotos y el SKU siguen aquí.");
        return;
      }
      setTitle((current) => current.trim() || body.listing?.title || "");
      setDescription((current) => current.trim() || body.listing?.description || "");
      setBrand((current) => current.trim() || body.listing?.brand || "");
      setSize((current) => current.trim() || body.listing?.size || "");
      setCondition((current) => current || knownCondition(body.listing?.condition || ""));
      setItemType(body.listing.itemType || "");
      setCategory(body.listing.category || "");
      setStep("datos");
      await suggestPrice(
        {
          title: body.listing.title,
          brand: body.listing.brand,
          condition: body.listing.condition,
          size: body.listing.size,
          itemType: body.listing.itemType,
          category: body.listing.category,
        },
        ticket
      );
    } catch {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) {
        setError("No se pudo preparar la prenda. Las fotos y el SKU siguen aquí.");
      }
    } finally {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) setPending("");
    }
  }

  async function suggestPrice(
    listing: {
      title: string;
      brand: string;
      condition: string;
      size: string;
      itemType: string;
      category: string;
    },
    ticket = requestGeneration.current
  ) {
    try {
      const response = await guatemalaRequest(
        "/api/markets/guatemala/publicar/precio",
        {
          listing: {
            title: listing.title,
            brand: listing.brand,
            condition: listing.condition,
            size: listing.size,
            item_type: listing.itemType,
            category: listing.category,
          },
        },
        { actor: "encargado" }
      );
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      const report = (await response.json()) as GuatemalaCompReport;
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      if (!report?.ok) {
        setPriceNote("No se pudo consultar el precio. Escríbelo en quetzales.");
        return;
      }
      setPriceNote(report.message || "");
      if (priceTouched.current) return;
      const next = guatemalaPriceIfEmpty(price, report.suggestedPrice);
      if (typeof next === "number" && next > 0) setPrice(next.toFixed(2));
    } catch {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) {
        setPriceNote("No se pudo consultar el precio. Escríbelo en quetzales.");
      }
    }
  }

  async function review() {
    const ticket = requestGeneration.current;
    setError("");
    const blockers = publishReviewBlockers({ sku, title, price, photoCount: photos.length });
    if (blockers.length) {
      setError(blockers[0]);
      return;
    }
    setPending("Comprobando el SKU…");
    try {
      const free = await checkSku();
      if (!publicationResultIsCurrent(ticket, requestGeneration.current) || !free) return;
      setStep("revision");
    } catch {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) {
        setError("No se pudo comprobar el SKU. Los datos siguen aquí.");
      }
    } finally {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) setPending("");
    }
  }

  async function onQr(text: string) {
    setCameraOn(false);
    setSavedNotice("");
    const applied = applyRegistrationScan(
      { sku, lotId, title, description, brand, size, condition, price },
      text
    );
    if (!applied.ok) {
      setSkuNote(applied.error);
      setError(applied.error);
      return;
    }
    setError("");
    setSkuNote("");
    if (applied.scan.kind === "sku") {
      skuTouched.current = true;
      setSku(applied.form.sku);
      setLotId(applied.form.lotId);
      await findExisting({ sku: applied.form.sku }, true);
      return;
    }
    await findExisting({ codigo: garmentQrText(applied.scan.itemId) }, true);
  }

  async function findExisting(query: { codigo?: string; sku?: string }, openAlone: boolean) {
    const params = new URLSearchParams({ clientId });
    if (query.codigo) params.set("codigo", query.codigo);
    if (query.sku) params.set("sku", query.sku);
    const response = await guatemalaRequest(
      `/api/markets/guatemala/inventory/qr?${params.toString()}`,
      undefined,
      { actor: "encargado" }
    );
    const body = (await response.json()) as {
      ok?: boolean;
      choice?: "one" | "many";
      garment?: { id: string; sku: string; title: string };
      garments?: { id: string; sku: string; title: string; lotNumber: number | null; lotName: string | null }[];
    };
    if (!response.ok || !body.ok) {
      setExisting(null);
      setExistingChoices([]);
      return;
    }
    if (body.choice === "many") {
      setExisting(null);
      setExistingChoices(body.garments ?? []);
      setError(REGISTRATION_MESSAGES.already);
      return;
    }
    const garment = body.garment;
    if (!garment?.id) return;
    const otherData = Boolean(
      photos.length ||
        title.trim() ||
        description.trim() ||
        brand.trim() ||
        size.trim() ||
        condition.trim() ||
        price.trim() ||
        lotId
    );
    if (openAlone && !otherData) {
      window.location.assign(`/guatemala/panel/inventario?item=${encodeURIComponent(garment.id)}`);
      return;
    }
    setExisting({ id: garment.id, sku: garment.sku, title: garment.title });
    setExistingChoices([]);
    setError(REGISTRATION_MESSAGES.already);
  }

  async function saveWithoutPhotos(thenScan: boolean) {
    if (photos.length > 0) return;
    if (saving.current || existing || existingChoices.length > 0) {
      if (existing || existingChoices.length > 0) setError(REGISTRATION_MESSAGES.already);
      return;
    }
    saving.current = true;
    setPending(thenScan ? "Guardando…" : "Guardando…");
    setError("");
    try {
      const response = await guatemalaRequest(
        "/api/markets/guatemala/inventory/sin-fotos",
        {
          registro: true,
          clientId,
          sku,
          title,
          description,
          brand,
          size,
          condition,
          price,
          lotId: lotId || null,
        },
        { actor: "encargado" }
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        existing?: { id: string; sku: string; title: string } | null;
      };
      if (!response.ok || !body.ok) {
        setError(body.error || GUATEMALA_INVENTORY_MESSAGES.retry);
        if (body.existing?.id) setExisting(body.existing);
        return;
      }
      if (!registrationFormShouldClear(true)) return;
      clearRegistrationForm();
      setSavedNotice(thenScan ? REGISTRATION_MESSAGES.scanNext : body.message || REGISTRATION_MESSAGES.saved);
      if (thenScan) setCameraOn(true);
    } catch {
      setError(GUATEMALA_INVENTORY_MESSAGES.retry);
    } finally {
      saving.current = false;
      setPending("");
    }
  }

  async function publish(thenScan = false) {
    const ticket = requestGeneration.current;
    if (!staffCanConfirmPublish(step) || saving.current) return;
    const blockers = publishReviewBlockers({ sku, title, price, photoCount: photos.length });
    if (blockers.length) {
      setError(blockers[0]);
      setStep("datos");
      return;
    }
    saving.current = true;
    setPending("Publicando…");
    setError("");
    try {
      const response = await guatemalaRequest(
        "/api/markets/guatemala/publicar",
        {
          sourceGroupId: draftId.current,
          sku: sku.trim(),
          title: title.trim(),
          description,
          brand,
          size,
          condition,
          price,
          photos,
          lotId: lotId || undefined,
        },
        { actor: "encargado" }
      );
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      const body = (await response.json()) as { ok?: boolean; error?: string; item?: { id?: string } };
      if (!publicationResultIsCurrent(ticket, requestGeneration.current)) return;
      if (!response.ok || !body.ok || !body.item?.id) {
        setError(body.error || GUATEMALA_INVENTORY_MESSAGES.retry);
        return;
      }
      if (thenScan && registrationFormShouldClear(true)) {
        clearRegistrationForm();
        setSavedNotice(REGISTRATION_MESSAGES.scanNext);
        setCameraOn(true);
        return;
      }
      setPublishedId(body.item.id);
      setStep("publicado");
    } catch {
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) setError(GUATEMALA_INVENTORY_MESSAGES.retry);
    } finally {
      saving.current = false;
      if (publicationResultIsCurrent(ticket, requestGeneration.current)) setPending("");
    }
  }

  function discardControl() {
    if (confirmDiscard) {
      return (
        <div className="gt-publish-discard" role="alertdialog" aria-labelledby="discard-publication-title">
          <p id="discard-publication-title">{DISCARD_PUBLICATION_PROMPT}</p>
          <p>Solo se borra esta preparación. No se retira ni se elimina una prenda ya guardada.</p>
          <div className="gt-publish-actions">
            <button type="button" className="btn btn-primary" onClick={discardDraft} disabled={pending === "Publicando…"}>
              Descartar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDiscard(false)} disabled={pending === "Publicando…"}>
              Cancelar
            </button>
          </div>
        </div>
      );
    }
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setConfirmDiscard(true)} disabled={pending === "Publicando…"}>
        Descartar artículo
      </button>
    );
  }

  const publishDirty =
    step !== "publicado" &&
    (photos.length > 0 ||
      [sku, title, description, brand, size, condition, price, itemType, category].some((value) => value.trim() !== ""));
  useUnsavedChanges(publishDirty || pending === "Publicando…");

  if (step === "publicado" && publishedId) {
    return (
      <main>
        <h1>Artículo publicado</h1>
        <p className="note" role="status">
          La prenda quedó disponible. Recarga la tienda para verla.
        </p>
        <p>
          <a className="btn btn-primary" href={`https://www.variedadessanandres.com/prenda/${encodeURIComponent(publishedId)}`}>
            Ver en la tienda
          </a>
        </p>
        <p>
          <a className="btn btn-ghost" href="/guatemala/panel/inventario">
            Volver al inventario
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="gt-publish">
      <h1>Agregar artículo con foto</h1>
      <p>Escanea el QR o escribe el SKU. Con fotos se publica en el catálogo. Sin fotos queda en el inventario, se puede vender y no sale en el catálogo.</p>
      {savedNotice ? <p role="status">{savedNotice}</p> : null}
      {error ? (
        <p className="note note-error" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? <p role="status">{pending}</p> : null}

      {step === "revision" ? (
        <section className="panel gt-publish-review" aria-label="Revisión">
          <h2>Revisa antes de publicar</h2>
          <div className="gt-publish-photos">
            {photos.map((photo, index) => (
              <img key={photo.id} src={`data:${photo.mediaType};base64,${photo.data}`} alt={index === 0 ? "Foto de portada" : `Foto ${index + 1}`} />
            ))}
          </div>
          <dl>
            <div><dt>SKU</dt><dd>{sku.trim()}</dd></div>
            <div><dt>Título</dt><dd>{title.trim()}</dd></div>
            <div><dt>Descripción</dt><dd>{description.trim() || "Sin descripción"}</dd></div>
            <div><dt>Marca</dt><dd>{brand.trim() || "Sin marca"}</dd></div>
            <div><dt>Talla</dt><dd>{size.trim() || "Sin talla"}</dd></div>
            <div><dt>Condición</dt><dd>{guatemalaConditionLabel(condition) || "Sin condición"}</dd></div>
            <div><dt>Precio</dt><dd>{quetzalPriceText(price) ? formatStoredQuetzales(quetzalPriceText(price) || "") : price}</dd></div>
          </dl>
          <div className="gt-publish-actions">
            <button type="button" className="btn btn-ghost" onClick={keepDraft} disabled={Boolean(pending)}>
              Corregir
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={Boolean(pending)}>
              {pending ? "Publicando…" : "Publicar"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void publish(true)} disabled={Boolean(pending)}>
              {pending ? "Publicando…" : "Guardar y escanear siguiente"}
            </button>
          </div>
          {discardControl()}
        </section>
      ) : (
        <section className="panel">
          <label className="gt-publish-upload">
            Agregar fotos
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                void addPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <div className="gt-publish-photos">
            {photos.map((photo, index) => (
              <figure key={photo.id}>
                <img src={`data:${photo.mediaType};base64,${photo.data}`} alt={index === 0 ? "Foto de portada" : `Foto ${index + 1}`} />
                <RotatePhotoButton busy={rotatingId === photo.id} onRotate={() => void rotatePhoto(photo)} />
                <button
                  type="button"
                  onClick={() => {
                    setPhotos((current) => current.filter((entry) => entry.id !== photo.id));
                    setStep("datos");
                  }}
                >
                  Quitar
                </button>
              </figure>
            ))}
          </div>
          <p>{photos.length === 0 ? "Todavía no hay fotos." : `${photos.length} foto${photos.length === 1 ? "" : "s"}. La primera es la portada.`}</p>
          <label>
            Lote
            <select value={lotId} onChange={(event) => void chooseLot(event.target.value)}>
              <option value="">Sin lote</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>Lote {lot.lotNumber} · {lot.name}</option>
              ))}
            </select>
          </label>
          <label>
            SKU
            <input
              value={sku}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                skuTouched.current = true;
                setSku(event.target.value);
                setSkuNote("");
                setExisting(null);
                setExistingChoices([]);
                setSavedNotice("");
                setStep("datos");
              }}
            />
          </label>
          <div className="gt-publish-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setSavedNotice(""); setCameraOn(true); }}>
              Escanear QR
            </button>
          </div>
          <RegistrationQrCamera active={cameraOn} onCode={(text) => void onQr(text)} onClose={() => setCameraOn(false)} />
          {skuNote ? <p>{skuNote}</p> : null}
          {existing ? (
            <p>
              {REGISTRATION_MESSAGES.already}{" "}
              <a className="btn btn-primary" href={`/guatemala/panel/inventario?item=${encodeURIComponent(existing.id)}`}>
                Abrir ficha
              </a>
            </p>
          ) : null}
          {existingChoices.length > 0 ? (
            <div>
              <p>Este SKU está en varias prendas. Elige una ficha. No se creó otra y no se cambió el lote.</p>
              {existingChoices.map((choice) => (
                <a key={choice.id} className="btn btn-ghost" href={`/guatemala/panel/inventario?item=${encodeURIComponent(choice.id)}`}>
                  {choice.title || "Prenda"} · SKU {choice.sku} · {scanLotLabel(choice.lotNumber, choice.lotName)}
                </a>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => void checkSku()} disabled={Boolean(pending)}>
            Comprobar SKU
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void prepare()} disabled={Boolean(pending) || photos.length === 0}>
            Preparar redacción y precio
          </button>
          <label>
            Título
            <input value={title} onChange={(event) => { setTitle(event.target.value); setStep("datos"); }} />
          </label>
          <label>
            Descripción
            <textarea value={description} rows={5} onChange={(event) => { setDescription(event.target.value); setStep("datos"); }} />
          </label>
          <label>
            Marca
            <input value={brand} onChange={(event) => { setBrand(event.target.value); setStep("datos"); }} />
          </label>
          <label>
            Talla
            <input value={size} onChange={(event) => { setSize(event.target.value); setStep("datos"); }} />
          </label>
          <label>
            Condición
            <select value={condition} onChange={(event) => { setCondition(event.target.value); setStep("datos"); }}>
              <option value="">Sin condición</option>
              {GUATEMALA_CONDITION_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </select>
          </label>
          <label>
            Precio en quetzales
            <input
              inputMode="decimal"
              value={price}
              placeholder="Q"
              onChange={(event) => {
                priceTouched.current = true;
                setPrice(event.target.value);
                setStep("datos");
              }}
            />
          </label>
          {priceNote ? <p className="gt-publish-note">{priceNote}</p> : null}
          <button type="button" className="btn btn-primary" onClick={() => void review()} disabled={Boolean(pending)}>
            Revisar
          </button>
          {photos.length === 0 ? (
            <div className="gt-publish-actions">
              <button type="button" className="btn btn-primary" onClick={() => void saveWithoutPhotos(false)} disabled={Boolean(pending) || Boolean(existing) || existingChoices.length > 0}>
                {pending ? "Guardando…" : "Guardar en inventario"}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveWithoutPhotos(true)} disabled={Boolean(pending) || Boolean(existing) || existingChoices.length > 0}>
                Guardar y escanear siguiente
              </button>
            </div>
          ) : null}
          {discardControl()}
        </section>
      )}
    </main>
  );
}

function knownCondition(value: string): string {
  return GUATEMALA_CONDITION_CHOICES.some((choice) => choice.value === value) ? value : "";
}

async function shrinkPhoto(file: File): Promise<DraftPhoto | null> {
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
    return { id: crypto.randomUUID(), mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  } catch {
    return null;
  }
}
