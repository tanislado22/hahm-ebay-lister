"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../../request";
import {
  GUATEMALA_CONDITION_CHOICES,
  GUATEMALA_INVENTORY_MESSAGES,
  guatemalaConditionLabel,
} from "@/lib/markets/guatemala-inventory";
import { PUBLICATION_MESSAGES, publishReviewBlockers, staffCanConfirmPublish } from "@/lib/markets/guatemala-publish";

interface DraftPhoto {
  id: string;
  mediaType: string;
  data: string;
}

interface LoadedItem {
  id: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  status: string;
  photos: DraftPhoto[];
}

export function CorrectScreen({ clientId }: { clientId: string }) {
  const params = useSearchParams();
  const itemId = params.get("id") ?? "";
  const saving = useRef(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [step, setStep] = useState<"datos" | "revision">("datos");
  const [sold, setSold] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    void (async () => {
      const response = await guatemalaRequest(
        `/api/markets/guatemala/inventory/${encodeURIComponent(itemId)}?clientId=${encodeURIComponent(clientId)}`,
        undefined,
        { actor: "encargado" }
      );
      const body = (await response.json()) as { ok?: boolean; error?: string; item?: LoadedItem };
      if (cancelled) return;
      if (!response.ok || !body.ok || !body.item) {
        setError(body.error || "No se pudo abrir la prenda.");
        return;
      }
      const item = body.item;
      setSku(item.sku);
      setTitle(item.title || "");
      setDescription(item.description || "");
      setBrand(item.brand || "");
      setSize(item.size || "");
      setCondition(item.condition || "");
      setPrice(item.priceGtq || "");
      setStatus(item.status);
      setPhotos(item.photos || []);
      setSold(item.status === "vendida");
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, itemId]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= 8) break;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setError("Usa fotos JPG, PNG o WebP.");
        continue;
      }
      const photo = await shrinkPhoto(file);
      if (photo) next.push(photo);
    }
    setPhotos(next);
    setStep("datos");
  }

  async function save(republish: boolean) {
    if (saving.current || sold) return;
    if (republish && !staffCanConfirmPublish(step)) return;
    const blockers = publishReviewBlockers({ sku, title, price, photoCount: photos.length });
    if (blockers.length) {
      setError(blockers[0]);
      setStep("datos");
      return;
    }
    saving.current = true;
    setPending(republish ? "Publicando…" : "Guardando…");
    setError("");
    setNotice("");
    const payload = { itemId, title, description, brand, size, condition, price, photos };
    try {
      const corrected = await guatemalaRequest("/api/markets/guatemala/publicar/corregir", payload, { actor: "encargado" });
      const correctedBody = (await corrected.json()) as { ok?: boolean; error?: string; message?: string; item?: { sku?: string; status?: string } };
      if (!corrected.ok || !correctedBody.ok) {
        setError(correctedBody.error || PUBLICATION_MESSAGES.retry);
        return;
      }
      if (correctedBody.item?.sku) setSku(correctedBody.item.sku);
      if (!republish) {
        setNotice(correctedBody.message || PUBLICATION_MESSAGES.corrected);
        setStep("datos");
        if (correctedBody.item?.status) setStatus(correctedBody.item.status);
        return;
      }
      const published = await guatemalaRequest("/api/markets/guatemala/publicar/republicar", { itemId }, { actor: "encargado" });
      const publishedBody = (await published.json()) as { ok?: boolean; error?: string; message?: string; item?: { status?: string } };
      if (!published.ok || !publishedBody.ok) {
        setError(publishedBody.error || PUBLICATION_MESSAGES.retry);
        setNotice("La corrección sí quedó guardada.");
        return;
      }
      setStatus(publishedBody.item?.status || "disponible");
      setNotice(publishedBody.message || PUBLICATION_MESSAGES.republished);
      setStep("datos");
    } catch {
      setError(PUBLICATION_MESSAGES.retry);
    } finally {
      saving.current = false;
      setPending("");
    }
  }

  if (!itemId) {
    return (
      <main className="gt-publish">
        <h1>Corregir artículo</h1>
        <p>Abre la prenda desde el inventario.</p>
        <a className="btn btn-ghost" href="/guatemala/panel/inventario">Volver al inventario</a>
      </main>
    );
  }

  if (!loaded) {
    return (
      <main className="gt-publish">
        <h1>Corregir artículo</h1>
        {error ? <p className="note note-error" role="alert">{error}</p> : <p>Cargando la prenda…</p>}
        <a className="btn btn-ghost" href="/guatemala/panel/inventario">Volver al inventario</a>
      </main>
    );
  }

  if (sold) {
    return (
      <main className="gt-publish">
        <h1>Corregir artículo</h1>
        <p className="note note-error" role="alert">{PUBLICATION_MESSAGES.sold}</p>
        <a className="btn btn-ghost" href={`/guatemala/panel/inventario?item=${encodeURIComponent(itemId)}`}>Volver al inventario</a>
      </main>
    );
  }

  return (
    <main className="gt-publish">
      <h1>Corregir artículo</h1>
      <p>SKU {sku || "…"}. El SKU no cambia. Los cambios quedan en la misma prenda.</p>
      {error ? <p className="note note-error" role="alert">{error}</p> : null}
      {notice ? <p className="note" role="status">{notice}</p> : null}
      {pending ? <p role="status">{pending}</p> : null}
      {step === "revision" ? (
        <section className="panel gt-publish-review">
          <h2>Revisar antes de publicar</h2>
          <div className="gt-publish-photos">
            {photos.map((photo, index) => (
              <img key={photo.id} src={photoUrl(photo)} alt={index === 0 ? "Foto de portada" : `Foto ${index + 1}`} />
            ))}
          </div>
          <dl>
            <div><dt>SKU</dt><dd>{sku}</dd></div>
            <div><dt>Título</dt><dd>{title.trim()}</dd></div>
            <div><dt>Descripción</dt><dd>{description.trim() || "Sin descripción"}</dd></div>
            <div><dt>Marca</dt><dd>{brand.trim() || "Sin marca"}</dd></div>
            <div><dt>Talla</dt><dd>{size.trim() || "Sin talla"}</dd></div>
            <div><dt>Condición</dt><dd>{guatemalaConditionLabel(condition) || "Sin condición"}</dd></div>
            <div><dt>Precio</dt><dd>Q{price}</dd></div>
          </dl>
          <div className="gt-publish-actions">
            <button type="button" className="btn btn-ghost" disabled={Boolean(pending)} onClick={() => setStep("datos")}>Corregir</button>
            <button type="button" className="btn btn-primary" disabled={Boolean(pending)} onClick={() => void save(true)}>
              {pending ? "Publicando…" : "Volver a publicar"}
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <label className="gt-publish-upload">
            Agregar fotos
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          </label>
          <div className="gt-publish-photos">
            {photos.map((photo, index) => (
              <figure key={photo.id}>
                <img src={photoUrl(photo)} alt={index === 0 ? "Foto de portada" : `Foto ${index + 1}`} />
                <button type="button" onClick={() => { setPhotos((current) => current.filter((entry) => entry.id !== photo.id)); setStep("datos"); }}>Quitar</button>
              </figure>
            ))}
          </div>
          <label>Título<input value={title} onChange={(event) => { setTitle(event.target.value); setStep("datos"); }} /></label>
          <label>Descripción<textarea rows={5} value={description} onChange={(event) => { setDescription(event.target.value); setStep("datos"); }} /></label>
          <label>Marca<input value={brand} onChange={(event) => { setBrand(event.target.value); setStep("datos"); }} /></label>
          <label>Talla<input value={size} onChange={(event) => { setSize(event.target.value); setStep("datos"); }} /></label>
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
            <input inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); setStep("datos"); }} />
          </label>
          <button type="button" className="btn btn-primary" disabled={Boolean(pending)} onClick={() => void save(false)}>
            Guardar corrección
          </button>
          {status === "retirada" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(pending)}
              onClick={() => {
                const blockers = publishReviewBlockers({ sku, title, price, photoCount: photos.length });
                if (blockers.length) {
                  setError(blockers[0]);
                  return;
                }
                setError("");
                setStep("revision");
              }}
            >
              Revisar y volver a publicar
            </button>
          ) : null}
          {photos.length === 0 ? <p>{GUATEMALA_INVENTORY_MESSAGES.photosRequired}</p> : null}
          <a className="btn btn-ghost" href={`/guatemala/panel/inventario?item=${encodeURIComponent(itemId)}`}>Volver al inventario</a>
        </section>
      )}
    </main>
  );
}

function photoUrl(photo: DraftPhoto): string {
  return photo.data.startsWith("data:") ? photo.data : `data:${photo.mediaType};base64,${photo.data}`;
}

async function shrinkPhoto(file: File): Promise<DraftPhoto | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
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
