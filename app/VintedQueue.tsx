"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import type { ItemGroup, Photo, VintedStatus } from "@/lib/types";
import { formatVintedCategoryPath, resolveVintedCategory } from "@/lib/vinted/category-map";
import type { VintedPrepared } from "@/lib/vinted/prepare";

interface StoredListing {
  sku: string;
  vintedStatus: VintedStatus;
  vintedTitle: string | null;
  vintedListingUrl: string | null;
  ebayTitle: string | null;
  publishedOnEbay: boolean;
  publishedOnVinted: boolean;
  prepared: VintedPrepared | null;
}

interface ReviewEvent {
  id: string;
  platform: string;
  externalEventId: string;
  sku: string | null;
  title: string | null;
  detectedAt: string;
  detail: string | null;
  status: string;
}

interface QueueItem {
  sku: string;
  vintedStatus: VintedStatus;
  vintedListingUrl: string | null;
  publishedOnEbay: boolean;
  fields: VintedPrepared;
  photos: Photo[];
}

const VINTED_NEW_ITEM = "https://www.vinted.com/items/new";

function withVintedCategory(fields: VintedPrepared): VintedPrepared {
  const current = { ...fields, vintedCategory: fields.vintedCategory || "" };
  if (current.vintedCategory) return current;
  const match = resolveVintedCategory({
    title: current.title,
    brand: current.brand,
    bucket: current.category,
  });
  return {
    ...current,
    vintedCategory: match ? formatVintedCategoryPath(match.path) : "",
  };
}

function workspaceFromStorage(): { workMode: "store" | "client"; clientId: string | null } {
  try {
    const workMode = window.localStorage.getItem("workMode") === "client" ? "client" : "store";
    const clientId = window.localStorage.getItem("selectedClientId");
    return { workMode, clientId: workMode === "client" ? clientId : null };
  } catch {
    return { workMode: "store", clientId: null };
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  );
}

export function VintedQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [reviews, setReviews] = useState<ReviewEvent[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<{ workMode: "store" | "client"; clientId: string | null } | null>(null);

  useEffect(() => {
    setWorkspace(workspaceFromStorage());
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ workMode: workspace.workMode });
        if (workspace.clientId) params.set("clientId", workspace.clientId);
        const [listingRes, jobRes, reviewRes] = await Promise.all([
          apiGet(`/api/vinted/listings?${params.toString()}`),
          fetch(`/api/jobs?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          apiGet("/api/sale-events?status=needs_review"),
        ]);
        const listingJson = await listingRes.json();
        if (!listingRes.ok || !listingJson.ok) {
          throw new Error(listingJson.error || "Could not load the Vinted queue.");
        }
        const jobJson = jobRes.ok ? await jobRes.json() : { jobs: [] };
        const photosBySku = new Map<string, Photo[]>();
        for (const job of jobJson.jobs ?? []) {
          const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
          const group = data?.group as ItemGroup | undefined;
          if (!group?.sku) continue;
          const photos = Array.isArray(data.photos) ? (data.photos as Photo[]) : [];
          photosBySku.set(group.sku, photos);
        }
        const queue = (listingJson.listings as StoredListing[])
          .filter((listing) => listing.vintedStatus === "ready" || listing.vintedStatus === "published")
          .map((listing) => ({
            sku: listing.sku,
            vintedStatus: listing.vintedStatus,
            vintedListingUrl: listing.vintedListingUrl,
            publishedOnEbay: listing.publishedOnEbay,
            fields: withVintedCategory(
              listing.prepared ?? {
                sku: listing.sku,
                title: listing.vintedTitle || listing.ebayTitle || "",
                description: "",
                brand: "",
                category: "",
                vintedCategory: "",
                size: "",
                color: "",
                condition: "",
                price: "",
              }
            ),
            photos: photosBySku.get(listing.sku) ?? [],
          }))
          .sort((a, b) => {
            if (a.vintedStatus === b.vintedStatus) return a.sku.localeCompare(b.sku);
            return a.vintedStatus === "ready" ? -1 : 1;
          });
        setItems(queue);
        setIndex(0);
        if (reviewRes.ok) {
          const reviewJson = await reviewRes.json();
          setReviews(Array.isArray(reviewJson.events) ? reviewJson.events : []);
        }
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError((loadError as Error).message);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [workspace]);

  const current = items[index];
  useEffect(() => {
    setUrl(current?.vintedListingUrl ?? "");
  }, [current?.sku, current?.vintedListingUrl]);

  const updateCurrent = (patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const saveReady = async () => {
    if (!current || !workspace) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost("/api/vinted/status", {
        workMode: workspace.workMode,
        clientId: workspace.clientId,
        sku: current.sku,
        vintedStatus: "ready",
        prepared: current.fields,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save the Vinted fields.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const markPublished = async () => {
    if (!current || !workspace) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost("/api/vinted/status", {
        workMode: workspace.workMode,
        clientId: workspace.clientId,
        sku: current.sku,
        vintedStatus: "published",
        vintedListingUrl: url.trim(),
        vintedTitle: current.fields.title,
        prepared: current.fields,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not mark this item published.");
      const nextItems = items.map((item, i) =>
        i === index
          ? {
              ...item,
              vintedStatus: "published" as const,
              vintedListingUrl: url.trim() || item.vintedListingUrl,
            }
          : item
      );
      setItems(nextItems);
      const nextReady = nextItems.findIndex((item, i) => i > index && item.vintedStatus === "ready");
      if (nextReady >= 0) setIndex(nextReady);
    } catch (markError) {
      setError((markError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="result-head">
        <h3>Vinted queue</h3>
        <a className="btn btn-ghost" href="/">
          ← Back to listings
        </a>
      </div>
      <p className="field-hint">
        Work one item at a time. Vinted category is the path the assist extension tries to select.
        It is separate from the source category. Opening Vinted does not publish anything.
      </p>
      {loading && <p>Loading prepared items…</p>}
      {error && (
        <p className="note note-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && <p>No items are Ready or Published for Vinted yet.</p>}
      {current && (
        <article className="listing-card">
          <header className="listing-card-head">
            <div className="listing-card-title">
              <strong>
                <span className="sku-tag">{current.sku}</span>
                {current.fields.title}
              </strong>
              <span className="platform-badges">
                <span>eBay: {current.publishedOnEbay ? "Published" : "Not Published"}</span>
                <span>
                  Vinted: {current.vintedStatus === "published" ? "Published" : "Ready"}
                </span>
                <span>
                  {index + 1} / {items.length}
                </span>
              </span>
            </div>
          </header>
          {current.photos.length > 0 && (
            <div className="thumbs" aria-label="Item photos">
              {current.photos.map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.id} src={photo.previewUrl} alt="" />
              ))}
            </div>
          )}
          <div className="vinted-fields">
            {(
              [
                ["title", "Title"],
                ["description", "Description"],
                ["brand", "Brand"],
                ["vintedCategory", "Vinted category"],
                ["category", "Source category"],
                ["size", "Size"],
                ["color", "Color"],
                ["condition", "Condition"],
                ["price", "Price"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                {key === "description" ? (
                  <textarea
                    rows={5}
                    value={current.fields[key]}
                    onChange={(event) =>
                      updateCurrent({ fields: { ...current.fields, [key]: event.target.value } })
                    }
                  />
                ) : (
                  <input
                    value={current.fields[key]}
                    onChange={(event) =>
                      updateCurrent({ fields: { ...current.fields, [key]: event.target.value } })
                    }
                  />
                )}
                <CopyButton text={current.fields[key]} label={label} />
              </label>
            ))}
          </div>
          <div className="post-row">
            <button type="button" className="btn btn-ghost" onClick={() => void saveReady()} disabled={busy || current.vintedStatus === "published"}>
              Save fields
            </button>
            <a className="btn btn-primary" href={VINTED_NEW_ITEM} target="_blank" rel="noopener noreferrer">
              Prepare/Open for Vinted
            </a>
            <label>
              Vinted listing URL
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.vinted.com/items/…"
              />
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => void markPublished()} disabled={busy}>
              Mark as Published
            </button>
            <div className="result-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setIndex((n) => Math.max(0, n - 1))} disabled={index === 0}>
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIndex((n) => Math.min(items.length - 1, n + 1))}
                disabled={index >= items.length - 1}
              >
                Next →
              </button>
            </div>
          </div>
        </article>
      )}

      <h3>Sale events needing review</h3>
      <p className="field-hint">
        These sales were not alerted because the SKU could not be matched safely. Nothing was
        removed from eBay or Vinted.
      </p>
      {error ? null : reviews.length === 0 ? (
        <p>No events waiting for review.</p>
      ) : (
        <ul className="review-list">
          {reviews.map((event) => (
            <li key={event.id}>
              <strong>{event.platform}</strong>
              {event.sku ? ` · SKU ${event.sku}` : ""}
              <div>{event.title || "No title"}</div>
              <div className="field-hint">{event.detail}</div>
              <div className="field-hint">{event.externalEventId}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
