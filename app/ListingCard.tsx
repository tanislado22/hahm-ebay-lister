"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SIZE_REQUIRED_CATEGORIES } from "@/lib/categories";
import { apiPost } from "@/lib/api-client";
import {
  formatGuatemalaMoment,
  formatQuetzales,
} from "@/lib/markets/guatemala";
import { coerceGuatemalaCompReport, guatemalaCompReportIsCurrent, guatemalaPriceIfEmpty, unavailableGuatemalaCompReport } from "@/lib/markets/guatemala-price-match";
import "./guatemala-card.css";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import type { GuatemalaCompReport, ItemGroup, ListingResult, Photo } from "@/lib/types";
import { optimizePhotoCopy } from "@/lib/vinted/optimize-photo";
import { buildStoredZip, vintedPhotoFileName, vintedPhotoZipName } from "@/lib/vinted/photo-zip";

const TITLE_LIMIT = 80;

// eBay's pre-owned condition tiers, matching the values the model returns.
const CONDITIONS: { value: string; label: string }[] = [
  { value: "NEW_WITH_TAGS", label: "New with tags" },
  { value: "NEW_NO_TAGS", label: "New without tags" },
  { value: "EXCELLENT", label: "Pre-owned · Excellent" },
  { value: "VERY_GOOD", label: "Pre-owned · Very good" },
  { value: "GOOD", label: "Pre-owned · Good" },
  { value: "FAIR", label: "Pre-owned · Fair" },
];

function formatPrice(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n === undefined || Number.isNaN(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function priceToInput(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function CopyButton({
  text,
  label,
  idle,
  copiedText = "✓ Copied",
}: {
  text: string;
  label: string;
  idle?: string;
  copiedText?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? copiedText : idle ?? `📋 Copy ${label}`}
    </button>
  );
}

interface ListingCardProps {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRenameSku: (groupId: string, sku: string) => void;
  onRetry: (groupId: string) => void;
  onPost: (groupId: string) => void;
  onDraft: (groupId: string) => void;
  onReorderPhoto: (groupId: string, fromIndex: number, toIndex: number) => void;
onRemovePhoto: (photoId: string) => void;
onDelete: (groupId: string) => void;
onPrepareVinted: (groupId: string, sku: string) => void;
onMarkVintedPublished: (groupId: string, url: string) => void;
guatemala?: boolean;
inventoryClientId?: string;
}

export function ListingCard({
  group,
  photoById,
  ebayConnected,
  onEdit,
  onRenameSku,
  onRetry,
  onPost,
  onDraft,
  onReorderPhoto,
  onRemovePhoto,
  onDelete,
  onPrepareVinted,
  onMarkVintedPublished,
  guatemala = false,
  inventoryClientId,
}: ListingCardProps) {
  const [open, setOpen] = useState(true);
  const listing = group.listing;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<Photo | null>(null);
  const [preparingVintedPhotos, setPreparingVintedPhotos] = useState(false);
  const [vintedPhotoError, setVintedPhotoError] = useState<string | null>(null);
  const [savingInventory, setSavingInventory] = useState(false);
  const [inventoryNote, setInventoryNote] = useState("");
  const [inventoryError, setInventoryError] = useState(false);
  const savingInventoryRef = useRef(false);
  const priceTouched = useRef(false);
  const cover = photoById(group.photoIds[0]);
useEffect(() => {

  if (group.status === "done") {

    setOpen(true);

  }

}, [group.status]);
  const specifics = useMemo(() => {
    const entries = Object.entries(listing?.item_specifics ?? {});
    return entries.filter(([k, v]) => v && v.trim() !== "" && !k.startsWith("---"));
  }, [listing?.item_specifics]);

  const titleLen = listing?.title?.length ?? 0;

  const downloadVintedPhotos = async () => {
    const photos = group.photoIds
      .map((id) => photoById(id))
      .filter((photo): photo is Photo => Boolean(photo?.data));
    if (photos.length === 0) {
      setVintedPhotoError("This item has no photos to download.");
      return;
    }
    setPreparingVintedPhotos(true);
    setVintedPhotoError(null);
    try {
      const files = [];
      for (let index = 0; index < photos.length; index += 1) {
        const copy = await optimizePhotoCopy(photos[index].data, photos[index].mediaType);
        files.push({ name: vintedPhotoFileName(group.sku, index), data: copy });
      }
      const zip = buildStoredZip(files);
      const zipBuffer = new ArrayBuffer(zip.byteLength);
      new Uint8Array(zipBuffer).set(zip);
      const url = URL.createObjectURL(new Blob([zipBuffer], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = vintedPhotoZipName(group.sku);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      setVintedPhotoError((error as Error).message || "Could not prepare the photos.");
    } finally {
      setPreparingVintedPhotos(false);
    }
  };

  const saveToInventory = async () => {
    if (!guatemala || !listing || savingInventoryRef.current) return;
    savingInventoryRef.current = true;
    setSavingInventory(true);
    setInventoryNote("");
    setInventoryError(false);
    try {
      const photos = group.photoIds
        .map((id) => photoById(id))
        .filter((photo): photo is Photo => Boolean(photo?.data))
        .map((photo) => ({ mediaType: photo.mediaType, data: photo.data }));
      const response = await apiPost("/api/markets/guatemala/inventory", {
        clientId: inventoryClientId,
        sourceGroupId: group.id,
        sku: group.sku,
        title: listing.title,
        description: listing.description,
        brand: listing.brand ?? "",
        size: listing.size ?? "",
        condition: listing.condition ?? "",
        price: listing.suggested_price,
        photos,
      });
      const body = (await response.json()) as { ok?: boolean; action?: string; error?: string };
      if (!response.ok || !body.ok) {
        setInventoryError(true);
        setInventoryNote(body.error || "No se pudo guardar la prenda.");
        return;
      }
      setInventoryNote(
        body.action === "already_saved"
          ? GUATEMALA_INVENTORY_MESSAGES.already
          : GUATEMALA_INVENTORY_MESSAGES.saved
      );
    } catch {
      setInventoryError(true);
      setInventoryNote("No se pudo guardar la prenda.");
    } finally {
      savingInventoryRef.current = false;
      setSavingInventory(false);
    }
  };

  // eBay's size standardization blocks apparel/footwear listings that are
  // missing a Size, so flag those for the seller before they post.
  const sizeRequired = SIZE_REQUIRED_CATEGORIES.has(listing?.category ?? "");
  const sizeMissing = sizeRequired && !(listing?.size ?? "").trim();

  // Publishing refuses a missing/zero price (no more invented defaults), so
  // flag it here the same way size is flagged — before the seller hits Post.
  const priceNum =
    typeof listing?.suggested_price === "string"
      ? parseFloat(listing.suggested_price)
      : listing?.suggested_price;
  const priceMissing =
    group.status === "done" &&
    (priceNum === undefined || Number.isNaN(priceNum) || priceNum <= 0);

  type SoldCompsSummary = {

  sampleSize: number;

  low: number | null;

  high: number | null;

  average: number | null;

  median: number | null;
    items?: {

  itemId?: string;

  title?: string;

  soldPrice?: string;

  soldCurrency?: string;

  endedAt?: string;

  url?: string;

}[];

};

const [soldComps, setSoldComps] = useState<SoldCompsSummary | null>(null);

const [soldCompsLoading, setSoldCompsLoading] = useState(false);
const [soldCompsRequest, setSoldCompsRequest] = useState(0);
const [soldCompsError, setSoldCompsError] = useState<string | null>(null);
  const [showSoldItems, setShowSoldItems] = useState(false);
  const [localComps, setLocalComps] = useState<GuatemalaCompReport | null>(() =>
    coerceGuatemalaCompReport(group.guatemalaComps)
  );
  const garmentKey = [
    listing?.title ?? "",
    listing?.item_type ?? "",
    listing?.brand ?? "",
    listing?.condition ?? "",
    listing?.size ?? "",
    listing?.category ?? "",
  ].join("\n");
  const loadedGarmentKey = useRef<string | null>(null);
  useEffect(() => {
    if (group.status === "writing") {
      priceTouched.current = false;
      loadedGarmentKey.current = null;
    }
  }, [group.status]);
  useEffect(() => {
    if (!guatemala || group.status !== "done") return;
    const savedComps = coerceGuatemalaCompReport(group.guatemalaComps);
    const savedIsCurrent = savedComps != null && guatemalaCompReportIsCurrent(savedComps);
    if (loadedGarmentKey.current === garmentKey) return;
    loadedGarmentKey.current = garmentKey;
    if (savedIsCurrent && savedComps) {
      setLocalComps(savedComps);
      return;
    }
    const requestKey = garmentKey;
    void (async () => {
      try {
        const response = await apiPost("/api/markets/guatemala/comps", {
          clientId: inventoryClientId,
          listing: listing
            ? {
                title: listing.title,
                item_type: listing.item_type,
                brand: listing.brand,
                condition: listing.condition,
                size: listing.size,
                category: listing.category,
              }
            : {},
        });
        const data = (await response.json()) as GuatemalaCompReport;
        if (loadedGarmentKey.current !== requestKey) return;
        if (
          data?.ok &&
          (data.status === "ready" || data.status === "insufficient" || data.status === "unavailable")
        ) {
          setLocalComps(data);
        } else if (savedComps) {
          setLocalComps(savedComps);
        } else {
          setLocalComps(unavailableGuatemalaCompReport());
        }
      } catch {
        if (loadedGarmentKey.current === requestKey) {
          setLocalComps(savedComps ?? unavailableGuatemalaCompReport());
        }
      }
    })();
  }, [guatemala, group.status, group.guatemalaComps, inventoryClientId, garmentKey, listing]);
  useEffect(() => {
    if (!guatemala || priceTouched.current || !localComps) return;
    const suggested = localComps.suggestedPrice;
    if (suggested == null) return;
    const next = guatemalaPriceIfEmpty(listing?.suggested_price, suggested);
    if (next === listing?.suggested_price) return;
    onEdit(group.id, {
      suggested_price: next ?? undefined,
      currency: "GTQ",
      market: "guatemala",
    });
  }, [guatemala, localComps, listing?.suggested_price, group.id, onEdit]);
  useEffect(() => {
  if (guatemala) return;

  const handleSoldCompsAll = () => {

    setSoldCompsRequest((n) => n + 1);

  };

  window.addEventListener("sold-comps-all", handleSoldCompsAll);

  return () => {

    window.removeEventListener("sold-comps-all", handleSoldCompsAll);

  };

}, [guatemala]);
  const marketMedian =

  group.comps?.ok && group.comps.median !== undefined

    ? group.comps.median

    : null;

const soldMedian = soldComps?.median ?? null;

const recommendedPrice =

  soldMedian !== null && marketMedian !== null

    ? Math.floor(soldMedian * 0.7 + marketMedian * 0.3) + 0.99

    : marketMedian;
useEffect(() => {

  if (guatemala) return;

  if (soldMedian === null || recommendedPrice === null) return;

  onEdit(group.id, {

    suggested_price: recommendedPrice,

  });

}, [soldMedian, guatemala]);
useEffect(() => {
if (guatemala || soldCompsRequest === 0) return;


  const titleWords = (listing?.title ?? "").trim().split(/\s+/);

const garmentWords = titleWords.filter((word) =>

  /^(pants?|jeans?|joggers?|scrubs?|shirt|shirts|t-?shirt|tee|top|blouse|dress|shorts?|skirt|skort|jacket|coat|sweater|hoodie|sweatshirt|tank|polo|flannel|shoes?|sneakers?|boots?)$/i.test(word)

);

const audienceWord = titleWords.find((word) =>

  /^(women'?s?|men'?s?|girls?|boys?|kids?|youth|unisex)$/i.test(word)

);

const detailWords = titleWords

  .filter((word) =>

    /^(sheer|polka|dot|long|short|sleeve|sleeveless|floral|plaid|striped|silk|linen|cami)$/i.test(word)

  )

  .slice(0, 6);

const keyword = [

  listing?.brand,

  audienceWord,

  ...garmentWords.slice(0, 3),

  ...detailWords,

  listing?.size,

]

  .filter(Boolean)

  .join(" ");




  if (!keyword || group.status !== "done") {

    setSoldComps(null);

    setSoldCompsError(null);

    return;

  }

  let cancelled = false;

  async function loadSoldComps() {

    try {

      setSoldCompsLoading(true);

      setSoldCompsError(null);

    const response = await fetch(

  `/api/soldcomps?keyword=${encodeURIComponent(keyword)}&title=${encodeURIComponent(listing?.title ?? "")}&size=${encodeURIComponent(listing?.size ?? "")}`



);

      const data = await response.json();

      if (!response.ok) {

        throw new Error(data?.error || "SoldComps request failed");

      }

      if (!cancelled) {

        setSoldComps({

          sampleSize: data.sampleSize ?? 0,

          low: data.low ?? null,

          high: data.high ?? null,

          average: data.average ?? null,

          median: data.median ?? null,
          items: Array.isArray(data.items) ? data.items : [],



        });

      }

    } catch (error) {

      if (!cancelled) {

        setSoldComps(null);

        setSoldCompsError(

          error instanceof Error ? error.message : "SoldComps request failed"

        );

      }

    } finally {

      if (!cancelled) {

        setSoldCompsLoading(false);

      }

    }

  }

  loadSoldComps();

  return () => {

    cancelled = true;

  };

}, [soldCompsRequest, group.status, listing?.title, listing?.brand, listing?.size, guatemala]);

  return (
    <article className={`listing-card status-${group.status}`}>
      <header className="listing-card-head" onClick={() => setOpen((o) => !o)}>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="listing-cover" src={cover.previewUrl} alt="" />
        )}
        <div className="listing-card-title">
          <strong>
            {group.sku && <span className="sku-tag">{group.sku}</span>}
            {listing?.title || group.name}
          </strong>
          <span className="listing-card-sub">
            {group.status === "writing" && (
              <>
                <span className="spinner small" aria-hidden="true" />{" "}
                {guatemala ? "Escribiendo…" : "Writing…"}
              </>
            )}
            {group.status === "done" &&
              (priceMissing ? (
                <span style={{ color: "var(--color-danger)" }}>
                  {guatemala ? "⚠️ falta el precio" : "⚠️ needs a price"}
                </span>
              ) : (
                <>
                  ✅{" "}
                  {guatemala
                    ? formatQuetzales(Number(listing?.suggested_price))
                    : formatPrice(listing?.suggested_price)}{" "}
                  · {guatemala ? "lista" : "ready"}
                </>
              ))}
            {group.status === "error" && (
              <span style={{ color: "var(--color-danger)" }}>
                ⚠️ {group.error || "Failed"}
              </span>
            )}
            {group.status === "idle" && "Waiting…"}
          </span>
          <span className="platform-badges">
            <span>eBay: {group.postStatus === "posted" ? "Published" : "Not Published"}</span>
            <span>
              Vinted:{" "}
              {group.vintedStatus === "published"
                ? "Published"
                : group.vintedStatus === "ready"
                  ? "Ready"
                  : "Not Prepared"}
            </span>
          </span>
        </div>
        {group.status === "error" ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(group.id);
            }}
          >
            ↻ Retry
          </button>
        ) : (
          <span className="chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        )}
      </header>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", padding: "12px" }}>

  {group.photoIds.map((pid, i) => {

    const photo = photoById(pid);

    if (!photo) return null;

    return (

      <div

        key={pid}

        draggable={group.photoIds.length > 1}

        onDragStart={(e) => {

          setDragIndex(i);

          e.dataTransfer.effectAllowed = "move";

          e.dataTransfer.setData("text/plain", pid);

        }}

        onDragOver={(e) => {

          e.preventDefault();

          e.dataTransfer.dropEffect = "move";

        }}

        onDrop={(e) => {

          e.preventDefault();

          if (dragIndex !== null && dragIndex !== i) {

            onReorderPhoto(group.id, dragIndex, i);

          }

          setDragIndex(null);

        }}

        onDragEnd={() => setDragIndex(null)}

        style={{

          position: "relative",

          cursor: "grab",

          border: i === 0 ? "3px solid #333" : "1px solid #ccc",

          borderRadius: "8px",

          padding: "3px",

        }}

      >

        {/* eslint-disable-next-line @next/next/no-img-element */}

        <img

          src={photo.previewUrl}

          alt=""
          onClick={() => setZoomedPhoto(photo)}



          style={{

            width: "90px",

            height: "90px",

            objectFit: "contain",

            display: "block",

          }}

        />

        {i === 0 && (

          <span

            style={{

              position: "absolute",

              left: "4px",

              bottom: "4px",

              background: "white",

              padding: "2px 5px",

              borderRadius: "4px",

              fontSize: "11px",

              fontWeight: 700,

            }}

          >

            MAIN

          </span>

        )}

   {group.photoIds.length > 1 && (

  <button

    type="button"

    onClick={(e) => {

      e.stopPropagation();

      onRemovePhoto(pid);

    }}

    onMouseDown={(e) => e.stopPropagation()}

    draggable={false}

    title="Remove photo"

    style={{

      position: "absolute",

      top: "4px",

      right: "4px",

      width: "22px",

      height: "22px",

      borderRadius: "50%",

      border: "1px solid #ccc",

      background: "white",

      color: "red",

      cursor: "pointer",

      fontWeight: 700,

      fontSize: "16px",

      lineHeight: 1,

      zIndex: 2,

    }}

  >

    ×

  </button>

)}

  
      </div>

    );

  })}

</div>
{zoomedPhoto && (

  <div

    onClick={() => setZoomedPhoto(null)}

    style={{

      position: "fixed",

      inset: 0,

      background: "rgba(0,0,0,0.85)",

      display: "flex",

      alignItems: "center",

      justifyContent: "center",

      zIndex: 9999,

      cursor: "zoom-out",

    }}

  >

    <img

    src={`data:${zoomedPhoto.mediaType};base64,${zoomedPhoto.data}`}

      alt="Item photo enlarged"

      style={{

        maxWidth: "95vw",

        maxHeight: "95vh",

        objectFit: "contain",

      }}

    />

  </div>

)}


      {open && listing && group.status === "done" && (
        <div className="listing-card-body">
          <div className="result-field">
            <label>
              {guatemala ? "Título" : "Title"}
              <span className={`count${titleLen > (guatemala ? 120 : TITLE_LIMIT) ? " over" : ""}`}>
                {titleLen}/{guatemala ? 120 : TITLE_LIMIT}
              </span>
            </label>
            <input
              type="text"
              className="title-input"
              value={listing.title}
              onChange={(e) => onEdit(group.id, { title: e.target.value })}
            />
            <div className="copy-row">
              <CopyButton
                text={listing.title}
                label="title"
                idle={guatemala ? "Copiar título" : undefined}
                copiedText={guatemala ? "✓ Copiado" : undefined}
              />
            </div>
          </div>

          <div className={guatemala ? "meta-row gt-meta" : "meta-row"}>
            {/* SKU stays editable up until the item is posted, so a SKU fix
                never requires going back and re-writing listings (issue #30). */}
            <div className="stat editable">
              <label className="k" htmlFor={`sku-${group.id}`}>
                SKU
              </label>
              <input
                id={`sku-${group.id}`}
                type="text"
                inputMode="text"
                className="size-input"
                value={group.sku}
                disabled={group.postStatus === "posted"}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => onRenameSku(group.id, e.target.value)}
              />
            </div>
            <div className={`stat editable${priceMissing ? " needs-attention" : ""}`}>
              <label className="k" htmlFor={`price-${group.id}`}>
                {guatemala ? "Precio en quetzales" : "Price"}
              </label>
              <div className="price-input">
                <span aria-hidden="true">{guatemala ? "Q" : "$"}</span>
                <input
                  id={`price-${group.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={priceToInput(listing.suggested_price)}
                  onChange={(e) => {
                    priceTouched.current = true;
                    onEdit(group.id, {
                      suggested_price:
                        e.target.value === "" ? "" : Number(e.target.value),
                      ...(guatemala ? { currency: "GTQ", market: "guatemala" } : {}),
                    });
                  }}
                />
              </div>
              {!guatemala && group.comps?.ok && group.comps.median !== undefined && (
                <span className="comps-line" title={group.comps.basis}>
                  Market: {group.comps.count} similar active listings, $
                  {group.comps.low?.toFixed(0)}–${group.comps.high?.toFixed(0)}
                  {" · "}
                  <button
                    type="button"
                    className="comps-use"
                    onClick={() =>
                      onEdit(group.id, {
                        suggested_price:
                          group.comps!.listPrice ?? group.comps!.median,
                      })
                    }
                  >
                    {/* listPrice = median + the deployment's storewide markup */}
                    {group.comps.listPrice !== undefined
                      ? `use $${group.comps.listPrice.toFixed(2)} (median + markup)`
                      : `use median $${group.comps.median.toFixed(2)}`}
                  </button>
                </span>
              )}
             
{!guatemala && recommendedPrice !== null && (

  <span className="comps-line">

    Recommended: ${recommendedPrice.toFixed(2)}

  </span>

)}
              {!guatemala && soldCompsLoading && (

  <span className="comps-line">

    Sold: loading sold listings...

  </span>

)}

{!guatemala && soldCompsError && (

  <span className="comps-line">

    Sold: unavailable

  </span>

)}

{!guatemala && soldComps && !soldCompsLoading && !soldCompsError && (

 <>
  <span className="comps-line">

    Sold: {soldComps.sampleSize} sold listings

    {soldComps.low !== null && soldComps.high !== null

      ? `, $${soldComps.low.toFixed(2)}–$${soldComps.high.toFixed(2)}`

      : ""}

    {soldComps.average !== null

      ? `, avg $${soldComps.average.toFixed(2)}`

      : ""}

    {soldComps.median !== null

      ? `, median $${soldComps.median.toFixed(2)}`

      : ""}

  </span>
  {soldComps.items && soldComps.items.length > 0 && (

  <button

    type="button"

    className="comps-use"

    onClick={() => setShowSoldItems(!showSoldItems)}

  >

    {showSoldItems ? "Hide sold items" : "View sold items"}

  </button>

)}
{showSoldItems && soldComps.items && (

  <div>

    {soldComps.items.map((item, index) => (

      <div key={item.itemId ?? index}>

        {item.url ? (

          <a href={item.url} target="_blank" rel="noopener noreferrer">

            {item.title ?? "Sold item"}

          </a>

        ) : (

          <span>{item.title ?? "Sold item"}</span>

        )}

        {item.soldPrice ? ` — $${item.soldPrice}` : ""}

      </div>

    ))}

  </div>

)}
   </>
)}
   
            </div>
            <div className={guatemala ? "stat editable gt-condition" : "stat editable"}>
              <label className="k" htmlFor={`cond-${group.id}`}>
                {guatemala ? "Condición" : "Condition"}
              </label>
              <select
                id={`cond-${group.id}`}
                value={listing.condition ?? "GOOD"}
                onChange={(e) => onEdit(group.id, { condition: e.target.value })}
              >
                {/* Keep an unexpected model value selectable rather than losing it. */}
                {listing.condition &&
                  !CONDITIONS.some((c) => c.value === listing.condition) && (
                    <option value={listing.condition}>
                      {listing.condition.replace(/_/g, " ")}
                    </option>
                  )}
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {guatemala
                      ? ({
                          NEW_WITH_TAGS: "Nueva con etiqueta",
                          NEW_NO_TAGS: "Nueva sin etiqueta",
                          EXCELLENT: "Usada · Excelente",
                          VERY_GOOD: "Usada · Muy buena",
                          GOOD: "Usada · Buena",
                          FAIR: "Usada · Regular",
                        }[c.value] ?? c.label)
                      : c.label}
                  </option>
                ))}
              </select>
            </div>
            {listing.brand && (
              <div className={guatemala ? "stat gt-brand" : "stat"}>
                <div className="k">{guatemala ? "Marca" : "Brand"}</div>
                <div className="v">{listing.brand}</div>
              </div>
            )}
            {(sizeRequired || listing.size) && (
              <div className={`stat editable${sizeMissing ? " needs-attention" : ""}`}>
                <label className="k" htmlFor={`size-${group.id}`}>
                  {guatemala ? "Talla" : "Size"}
                </label>
                <input
                  id={`size-${group.id}`}
                  type="text"
                  className="size-input"
                  value={listing.size ?? ""}
                  placeholder={
                    guatemala ? "por ejemplo M, 32, 10" : sizeRequired ? "e.g. M, 32x34, 10.5" : "—"
                  }
                  onChange={(e) => onEdit(group.id, { size: e.target.value })}
                />
              </div>
            )}
          </div>

          {guatemala && (
            <div className="gt-price-note">
              <p>
                {localComps?.message ??
                  "Consultando precios anunciados en Megapaca y Econopaca."}
              </p>
              {localComps && Array.isArray(localComps.listed) && localComps.listed.length > 0 && (
                <ul>
                  {localComps.listed.map((item) => (
                    <li key={`${item.source}-${item.url}`}>
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.title}
                      </a>
                      {" · "}
                      {formatQuetzales(item.priceGtq)}
                      {" · "}
                      {item.sourceLabel}
                    </li>
                  ))}
                </ul>
              )}
              {localComps?.storeSales?.label && <p>{localComps.storeSales.label}</p>}
              {localComps?.storeSales?.median != null && Array.isArray(localComps.sold) && localComps.sold.length > 0 && (
                <ul>
                  {localComps.sold.map((sale) => (
                    <li key={`${sale.sku}-${sale.soldAt}`}>
                      {sale.title || sale.sku} · {formatQuetzales(sale.priceGtq)} ·{" "}
                      {formatGuatemalaMoment(sale.soldAt)}
                    </li>
                  ))}
                </ul>
              )}
              {localComps?.proposal && localComps.proposal.length > 0 && inventoryClientId && (
                <p>
                  <a
                    href={`/guatemala/precios?clientId=${encodeURIComponent(inventoryClientId)}&${localComps.proposal
                      .map((item) => `garment=${encodeURIComponent(item.garment)}&condition=${encodeURIComponent(item.condition)}`)
                      .join("&")}`}
                  >
                    Definir {localComps.proposal.map((item) => item.label).join(", ")}
                  </a>
                </p>
              )}
              {localComps && (
                <p>
                  Consultado: {formatGuatemalaMoment(localComps.queriedAt)} · America/Guatemala
                </p>
              )}
            </div>
          )}

          {sizeMissing && (
            <p className="size-warning" role="alert">
              {guatemala
                ? "No se ve la talla en la etiqueta. Revísala en la foto o mídela, y escríbela arriba."
                : "⚠️ No size found on the tag. eBay now blocks apparel listings without a standard size — check the photos or measure the item, then fill in Size above before posting."}
            </p>
          )}

          {priceMissing && (
            <p className="size-warning" role="alert">
              {guatemala
                ? "Escribe el precio en quetzales. No hay una comparación local que lo sugiera."
                : `⚠️ No price yet — the analysis couldn’t estimate one for this item. Set a price above before posting${
                    group.comps?.ok ? " (see the market check under Price)" : ""
                  }.`}
            </p>
          )}

          <div className="result-field">
            <label>{guatemala ? "Descripción" : "Description"}</label>
            <textarea
              value={listing.description}
              onChange={(e) => onEdit(group.id, { description: e.target.value })}
              rows={8}
            />
            <div className="copy-row">
              <CopyButton
                text={listing.description}
                label="description"
                idle={guatemala ? "Copiar descripción" : undefined}
                copiedText={guatemala ? "✓ Copiado" : undefined}
              />
            </div>
          </div>

          {specifics.length > 0 && (
            <details className="specifics-details">
              <summary>{specifics.length} item specifics</summary>
              <div className="specifics">
                {specifics.map(([k, v]) => (
                  <div className="row" key={k}>
                    <span className="k">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* eBay posting */}
          {guatemala ? (
            <>
              {group.status === "done" && listing ? (
                <div className="post-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingInventory}
                    onClick={() => void saveToInventory()}
                  >
                    {savingInventory ? "Guardando…" : "Guardar en inventario"}
                  </button>
                  {inventoryNote ? (
                    <p className={inventoryError ? "post-result err" : "post-result ok"} role="status">
                      {inventoryNote}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="post-hint">Esta prenda no se publica en eBay.</p>
            </>
          ) : group.postStatus === "posted" ? (
            <>
              <p className="post-result ok">
                ✅ Posted to eBay
                {group.listingId ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={`https://www.ebay.com/itm/${group.listingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View listing ↗
                    </a>
                  </>
                ) : null}
              </p>
              {(group.postWarnings ?? []).map((w) => (
                <p className="post-result warn" key={w}>
                  ⚠️ {w}
                </p>
              ))}
            </>
          ) : ebayConnected ? (
            <div className="post-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onPost(group.id)}
                disabled={group.postStatus === "posting"}
              >
                {group.postStatus === "posting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Posting to eBay…
                  </>
                ) : (
                  "🚀 Post this to eBay"
                )}
              </button>
              <button

  type="button"

  className="btn btn-ghost"

  onClick={() => onDraft(group.id)}

>

  📝 Draft Listing

</button>
              <button

  type="button"

  className="btn btn-ghost"

  onClick={() => setSoldCompsRequest((n) => n + 1)}

  disabled={soldCompsLoading}

>

  {soldCompsLoading ? "Loading Sold Comps..." : "Sold Comps"}

</button>
              {group.postStatus === "error" && group.postError && (
                <p className="post-result err">⚠️ {group.postError}</p>
              )}
            </div>
          ) : (
            <p className="post-hint">Connect eBay (top of page) to post this listing.</p>
          )}

          {!guatemala && group.status === "done" && listing && (
            <div className="post-row">
              <p className="post-result">
                Vinted:{" "}
                {group.vintedStatus === "published"
                  ? "Published"
                  : group.vintedStatus === "ready"
                    ? "Ready"
                    : "Not Prepared"}
                {group.vintedStatus === "published" && group.vintedListingUrl ? (
                  <>
                    {" "}
                    ·{" "}
                    <a href={group.vintedListingUrl} target="_blank" rel="noopener noreferrer">
                      View listing ↗
                    </a>
                  </>
                ) : null}
              </p>
              {group.vintedStatus !== "published" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onPrepareVinted(group.id, group.sku)}
                >
                  Prepare for Vinted
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={preparingVintedPhotos || group.photoIds.length === 0}
                onClick={() => void downloadVintedPhotos()}
              >
                {preparingVintedPhotos ? "Preparing photos…" : "Download Vinted Photos"}
              </button>
              {vintedPhotoError ? <p className="post-result err">{vintedPhotoError}</p> : null}
              {group.vintedStatus === "ready" && (
                <>
                  <a className="btn btn-ghost" href="/vinted">
                    Open Vinted queue
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const url = window.prompt(
                        "Paste the Vinted listing URL if you have it. Leave blank to mark published without a URL."
                      );
                      if (url === null) return;
                      onMarkVintedPublished(group.id, url.trim());
                    }}
                  >
                    Mark as Published
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <button

  type="button"

  className="btn btn-ghost"

  onClick={() => {

    if (window.confirm("Delete this item permanently?")) {

      onDelete(group.id);

    }

  }}

>

  {guatemala ? "Eliminar" : "🗑️ Delete"}

</button>
    </article>
  );
}
