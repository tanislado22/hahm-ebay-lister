"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";
import { getAnalysisModel, getSortModel } from "@/lib/model-preferences";
import { resizeImage } from "@/lib/resize";
import { buildSku } from "@/lib/sku";
import { chunkImagesForUpload } from "@/lib/uploadBatches";
import { EbayConnect } from "./EbayConnect";
import { ModelSelector } from "./ModelSelector";
import { ReviewBoard } from "./ReviewBoard";
import { ListingsView } from "./ListingsView";
import type {
  AnalyzeResponse,
  CompsSummary,
  ItemGroup,
  ListingResult,
  Photo,
  SortResponse,
} from "@/lib/types";

type Step = "upload" | "review" | "listings";
// Big batches are sorted in chunks of SORT_CHUNK photos per request — each
// chunk's thumbnail payload stays under Vercel's 4.5 MB body limit — then
// stitched back together with a merge check at every chunk boundary.
const MAX_PHOTOS = 300;
const SORT_CHUNK = 100;
const WRITE_CONCURRENCY = 3;
// eBay accepts at most 12 photos per listing. They ship to eBay in small
// batches (lib/uploadBatches.ts) before publish, so no single request ever
// nears Vercel's 4.5 MB body limit.
const MAX_PUBLISH_PHOTOS = 12;
// HTTP statuses worth waiting out and retrying: rate limits and transient
// platform errors.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}-${Math.random()}`;
}

// Parse a fetch response as JSON, but turn non-JSON error bodies (e.g. a 413
// "Request Entity Too Large" plain-text page) into a friendly message instead
// of a cryptic "Unexpected token" error. Callers pass a hint that fits their
// step — "sort fewer photos" advice on a posting error sent sellers down the
// wrong path.
async function readJson(
  res: Response,
  tooLargeHint = "Try again with fewer or smaller photos."
): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error(
        `That was too much photo data to send at once. ${tooLargeHint}`
      );
    }
    throw new Error(
      text.trim().slice(0, 140) || `Request failed (${res.status}).`
    );
  }
}

// Run async workers over items with a fixed concurrency limit.
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [binPrefix, setBinPrefix] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [manualGroups, setManualGroups] = useState<string[][]>([]);
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [sortProgress, setSortProgress] = useState<string | null>(null);
  // Where bin lettering starts — continues after SKUs already on eBay, so a
  // second batch from bin K31 gets K31-N… instead of colliding with K31-A.
  const [skuStart, setSkuStart] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [workMode, setWorkMode] = useState<"store" | "client">("store");
  const [clientName, setClientName] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
const saveClient = () => {

  const name = clientName.trim();

  if (!name) return;

  setClients((prev) => [

    ...prev,

    {

      id: crypto.randomUUID(),

      name,

      active: true,

    },

  ]);

  setClientName("");

};

  const clientsLoadedRef = useRef(false);
const selectedClientSaveReadyRef = useRef(false);
  const workModeSaveReadyRef = useRef(false);
  useEffect(() => {

    const savedClients = localStorage.getItem("savedClients");

    if (savedClients) {

      try {

        setClients(JSON.parse(savedClients));

      } catch {

        localStorage.removeItem("savedClients");

      }

    }
    const savedSelectedClientId = localStorage.getItem("selectedClientId");

if (savedSelectedClientId) {

  setSelectedClientId(savedSelectedClientId);

}
const savedWorkMode = localStorage.getItem("workMode");

if (savedWorkMode === "store" || savedWorkMode === "client") {

  setWorkMode(savedWorkMode);

}
    clientsLoadedRef.current = true;

  }, []);

 useEffect(() => {

  if (!clientsLoadedRef.current) return;

  localStorage.setItem("savedClients", JSON.stringify(clients));

  const saveClientsToDatabase = async () => {

    try {

      const response = await fetch("/api/clients", {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

        },

        body: JSON.stringify({ clients }),

      });

      if (!response.ok) {

        console.error("Failed to save clients to database");

      }

    } catch (error) {

      console.error("Failed to save clients to database:", error);

    }

  };

  saveClientsToDatabase();

}, [clients]);
  useEffect(() => {
if (!selectedClientSaveReadyRef.current) {

  selectedClientSaveReadyRef.current = true;

  return;

}
  if (selectedClientId) {

    localStorage.setItem("selectedClientId", selectedClientId);

  } else {

    localStorage.removeItem("selectedClientId");

  }

}, [selectedClientId]);

  useEffect(() => {
    if (!workModeSaveReadyRef.current) {



  workModeSaveReadyRef.current = true;



  return;



}

  localStorage.setItem("workMode", workMode);

}, [workMode]);
  const jobsLoadedKeyRef = useRef<string | null>(null);

  useEffect(() => {

    const clientId = workMode === "client" ? selectedClientId : null;

    if (workMode === "client" && !clientId) {

      jobsLoadedKeyRef.current = null;

      return;

    }

    const workspaceKey =

      workMode === "client" ? `client:${clientId}` : "store";

    const controller = new AbortController();

    const loadJobs = async () => {

      jobsLoadedKeyRef.current = null;

      try {

        const params = new URLSearchParams({

          workMode,

        });

        if (clientId) {

          params.set("clientId", clientId);

        }

        const response = await fetch(`/api/jobs?${params.toString()}`, {

          cache: "no-store",

          signal: controller.signal,

        });

        if (!response.ok) {

          throw new Error("Failed to load saved jobs");

        }

        const result = await response.json();

        const jobs = Array.isArray(result.jobs) ? result.jobs : [];

        const restoredGroups: ItemGroup[] = [];

        const restoredPhotos: Photo[] = [];

        const seenPhotoIds = new Set<string>();

        for (const job of jobs) {

          const data =

            typeof job.data === "string"

              ? JSON.parse(job.data)

              : job.data;

          if (!data?.group) continue;

          if (Array.isArray(data.group.photoIds) && data.group.photoIds.length > 0) {

  restoredGroups.push(data.group as ItemGroup);

}

          if (Array.isArray(data.photos)) {

            for (const photo of data.photos as Photo[]) {

              if (!seenPhotoIds.has(photo.id)) {

                seenPhotoIds.add(photo.id);

                restoredPhotos.push(photo);

              }

            }

          }

        }

        setGroups(restoredGroups);

        setPhotos(restoredPhotos);

        setManualGroups(restoredGroups.map((group) => group.photoIds));

        setOrphanIds([]);

        const hasFinishedListings = restoredGroups.some(

  (group) => group.status === "done" && group.listing

);

setStep(

  restoredGroups.length === 0

    ? "upload"

    : hasFinishedListings

      ? "listings"

      : "review"

);

        jobsLoadedKeyRef.current = workspaceKey;

      } catch (error) {

        if ((error as Error).name !== "AbortError") {

          console.error("Failed to restore jobs:", error);

        }

      }

    };

    loadJobs();

    return () => {

      controller.abort();

    };

  }, [workMode, selectedClientId]);
  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>();
    photos.forEach((p) => m.set(p.id, p));
    return m;
  }, [photos]);
  const photoById = useCallback((id: string) => photoMap.get(id), [photoMap]);

  // Latest groups, readable inside async workers without stale closures.
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
 useEffect(() => {

    const clientId = workMode === "client" ? selectedClientId : null;

    if (workMode === "client" && !clientId) return;

    const workspaceKey =

      workMode === "client" ? `client:${clientId}` : "store";

    if (jobsLoadedKeyRef.current !== workspaceKey) return;

    if (groups.length === 0) return;

    const timer = window.setTimeout(() => {

      const saveJobs = async () => {

        try {

          for (const group of groups) {

            const groupPhotos = photos.filter((photo) =>

              group.photoIds.includes(photo.id)

            );

            const response = await fetch("/api/jobs", {

              method: "POST",

              headers: {

                "Content-Type": "application/json",

              },

              body: JSON.stringify({

                id: group.id,

                workMode,

                clientId,

                data: {

                  group,

                  photos: groupPhotos,

                },

              }),

            });

            if (!response.ok) {

              throw new Error(`Failed to save job ${group.id}`);

            }

          }

        } catch (error) {

          console.error("Failed to save jobs:", error);

        }

      };

      saveJobs();

    }, 500);

    return () => {

      window.clearTimeout(timer);

    };

  }, [groups, photos, workMode, selectedClientId]);
  // Keep eBay connection status in sync (also after the connect bar updates).
  useEffect(() => {
    const check = () =>
      fetch("/api/ebay/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setEbayConnected(Boolean(d.connected)))
        .catch(() => setEbayConnected(false));
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ── Upload ──────────────────────────────────────────────
  const addFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setError("Those didn't look like photos. Use JPG, PNG, or WebP.");
      return;
    }
    try {
     const resized: Awaited<ReturnType<typeof resizeImage>>[] = [];

for (let i = 0; i < files.length; i += 3) {

  const batch = files.slice(i, i + 3);

  const batchResized = await Promise.all(batch.map(resizeImage));

  resized.push(...batchResized);

  await sleep(20);

}
      const newPhotos = resized.map((r) => ({ id: newId(), ...r }));

setPhotos((prev) =>

  [...prev, ...newPhotos].slice(0, MAX_PHOTOS)

);

setManualGroups((prev) => [

  ...prev,

  newPhotos.map((p) => p.id),

]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const addFilesToGroup = useCallback(async (groupId: string, fileList: FileList | null) => {

  if (!fileList || fileList.length === 0) return;

  setError(null);

  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));

  if (files.length === 0) {

    setError("Those didn't look like photos. Use JPG, PNG, or WebP.");

    return;

  }

  try {

    const resized: Awaited<ReturnType<typeof resizeImage>>[] = [];

    for (let i = 0; i < files.length; i += 3) {

      const batch = files.slice(i, i + 3);

      const batchResized = await Promise.all(batch.map(resizeImage));

      resized.push(...batchResized);

      await sleep(20);

    }

    const newPhotos = resized.map((r) => ({ id: newId(), ...r }));

    setPhotos((prev) =>

      [...prev, ...newPhotos].slice(0, MAX_PHOTOS)

    );

    setGroups((prev) =>

      prev.map((g) =>

        g.id === groupId

          ? { ...g, photoIds: [...g.photoIds, ...newPhotos.map((p) => p.id)] }

          : g

      )

    );

  } catch (e) {

    setError((e as Error).message);

  }

}, []);



  const removePhoto = (id: string) => {

  setPhotos((prev) => prev.filter((p) => p.id !== id));

  setManualGroups((prev) =>

    prev

      .map((group) => group.filter((photoId) => photoId !== id))

      .filter((group) => group.length > 0)

  );

};

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  // ── Sort ────────────────────────────────────────────────
  const sort = async () => {
    if (photos.length === 0) return;
    setSorting(true);
    setError(null);
    try {
      // Continue bin lettering after any SKUs already on eBay for this bin.
      let skuOffset = 0;
      if (binPrefix.trim()) {
        try {
          const r = await apiPost("/api/ebay/next-sku", { prefix: binPrefix.trim() });
          const d = (await readJson(r)) as { ok?: boolean; nextIndex?: number };
          if (d.ok && Number.isInteger(d.nextIndex) && (d.nextIndex as number) > 0) {
            skuOffset = d.nextIndex as number;
          }
        } catch {
          /* not connected or lookup failed — start at A like before */
        }
      }

      if (manualGroups.length > 0) {

  const validPhotoIds = new Set(photos.map((p) => p.id));

  const nextGroups: ItemGroup[] = manualGroups

    .map((photoIds, i) => ({

      id: newId(),

      sku: binPrefix.trim(),

      name: `Item ${i + 1}`,
clientId: workMode === "client" ? selectedClientId ?? undefined : undefined,
      photoIds: photoIds.filter((id) => validPhotoIds.has(id)),

      status: "idle" as const,

    }))

    .filter((g) => g.photoIds.length > 0);

  setSkuStart(skuOffset);

  setGroups(nextGroups);

  setOrphanIds([]);

  setStep("review");

  return;

}
      // Sort in chunks so each request's thumbnail payload stays small.
      type RawGroup = { name: string; photoIds: string[] };
      const chunkResults: RawGroup[][] = [];
      const orphanIdsAll: string[] = [];
      for (let off = 0; off < photos.length; off += SORT_CHUNK) {
        const chunk = photos.slice(off, off + SORT_CHUNK);
        if (photos.length > SORT_CHUNK) {
          setSortProgress(
            `Sorting photos ${off + 1}–${off + chunk.length} of ${photos.length}…`
          );
        }
        const res = await apiPost("/api/sort", {
          // Use the small thumbnail for sorting to keep the payload small.
          images: chunk.map((p) => ({
            mediaType: p.mediaType,
            data: p.previewUrl.split(",")[1],
          })),
          sortModel: getSortModel() ?? undefined,
        });
        const data = (await readJson(res, "Try sorting fewer photos per batch.")) as SortResponse;
        if (!data.ok || !data.groups) {
          throw new Error(data.error || "Could not sort the photos.");
        }
        const idxToId = (i: number) => chunk[i]?.id;
        chunkResults.push(
          data.groups
            .map((g) => ({
              name: g.name,
              photoIds: g.photoIndices.map(idxToId).filter(Boolean) as string[],
            }))
            .filter((g) => g.photoIds.length > 0)
        );
        orphanIdsAll.push(
          ...((data.orphanIndices ?? []).map(idxToId).filter(Boolean) as string[])
        );
      }

      // Stitch chunks back together: an item photographed across a chunk
      // boundary lands split in two — ask the model whether the group holding
      // the boundary's last photo and the one holding the next chunk's first
      // photo are actually the same item.
      const merged: RawGroup[] = [...(chunkResults[0] ?? [])];
      for (let c = 1; c < chunkResults.length; c++) {
        const rest = [...chunkResults[c]];
        const lastId = photos[c * SORT_CHUNK - 1]?.id;
        const firstId = photos[c * SORT_CHUNK]?.id;
        const prevGroup = merged.find((g) => lastId && g.photoIds.includes(lastId));
        const nextGroup = rest.find((g) => firstId && g.photoIds.includes(firstId));
        if (prevGroup && nextGroup) {
          setSortProgress("Checking for items split across batches…");
          try {
            const a = photoMap.get(prevGroup.photoIds[0]);
            const b = photoMap.get(nextGroup.photoIds[0]);
            if (a && b) {
              const res = await apiPost("/api/merge-check", {
                a: { mediaType: a.mediaType, data: a.previewUrl.split(",")[1] },
                b: { mediaType: b.mediaType, data: b.previewUrl.split(",")[1] },
                countA: prevGroup.photoIds.length,
                countB: nextGroup.photoIds.length,
                sortModel: getSortModel() ?? undefined,
              });
              const d = (await readJson(res)) as { ok?: boolean; merge?: boolean };
              if (d.ok && d.merge) {
                prevGroup.photoIds = [...prevGroup.photoIds, ...nextGroup.photoIds];
                rest.splice(rest.indexOf(nextGroup), 1);
              }
            }
          } catch {
            /* boundary check is best-effort — worst case the item stays split */
          }
        }
        merged.push(...rest);
      }

      const assigned = new Set<string>();
      merged.forEach((g) => g.photoIds.forEach((id) => assigned.add(id)));
      orphanIdsAll.forEach((id) => assigned.add(id));
      // Any photo the sorter never placed shouldn't vanish — surface it.
      const leftover = photos.filter((p) => !assigned.has(p.id)).map((p) => p.id);

      const nextGroups: ItemGroup[] = merged.map((g, i) => ({
        id: newId(),
        sku: binPrefix.trim(),
        name: g.name,
        clientId: workMode === "client" ? selectedClientId ?? undefined : undefined,
        photoIds: g.photoIds,
        status: "idle",
      }));
      setSkuStart(skuOffset);
      setGroups(nextGroups);
      setOrphanIds([...orphanIdsAll, ...leftover]);
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSorting(false);
      setSortProgress(null);
    }
  };

  // ── Review edits ────────────────────────────────────────
  const rename = (groupId: string, name: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name } : g))
    );

  const renameSku = (groupId: string, sku: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, sku } : g))
    );

  const movePhoto = (photoId: string, toGroupId: string | "orphans") => {
    setGroups((prev) =>
      prev.map((g) => {
        const nextIds =
          g.id === toGroupId
            ? g.photoIds.includes(photoId)
              ? g.photoIds
              : [...g.photoIds, photoId]
            : g.photoIds.filter((id) => id !== photoId);
        // A gained/lost photo invalidates an already-written listing — reset
        // it so "Write all listings" knows to redo this one (and only this one).
        const changed = nextIds.length !== g.photoIds.length;
        return {
          ...g,
          photoIds: nextIds,
          ...(changed && g.status === "done" ? { status: "idle" as const } : {}),
        };
      })
    );
    setOrphanIds((prev) => {
      const without = prev.filter((id) => id !== photoId);
      return toGroupId === "orphans" ? [...without, photoId] : without;
    });
  };

  // Reorder photos within a group. The array order is the eBay photo order
  // (index 0 = cover/gallery image), so this is all that's needed — `writeGroup`
  // and `postGroup` re-derive their image order from `photoIds` at call time.
  const reorderPhoto = (groupId: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= g.photoIds.length ||
          toIndex >= g.photoIds.length
        ) {
          return g;
        }
        const next = [...g.photoIds];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...g, photoIds: next };
      })
    );
  };

  const deleteGroup = async (groupId: string) => {

  // Remove it immediately from both the visible state and the ref

  // used by background/autosave work.

  groupsRef.current = groupsRef.current.filter((g) => g.id !== groupId);

  setGroups((prev) => prev.filter((g) => g.id !== groupId));

  try {

    const response = await fetch("/api/jobs", {

      method: "DELETE",

      headers: {

        "Content-Type": "application/json",

      },

      body: JSON.stringify({ id: groupId }),

    });

    if (!response.ok) {

      throw new Error("Failed to delete saved job");

    }

  } catch (error) {

    console.error("Failed to permanently delete group:", error);

  }

};
const deleteAll = async () => {

  const ids = groupsRef.current.map((g) => g.id);

  groupsRef.current = [];

  setGroups([]);

  try {

    await Promise.all(

      ids.map(async (id) => {

        const response = await fetch("/api/jobs", {

          method: "DELETE",

          headers: {

            "Content-Type": "application/json",

          },

          body: JSON.stringify({ id }),

        });

        if (!response.ok) {

          throw new Error(`Failed to delete saved job ${id}`);

        }

      })

    );

  } catch (error) {

    console.error("Failed to permanently delete all groups:", error);

  }

};




  const addGroup = () =>
    setGroups((prev) => [
      ...prev,
      {
        id: newId(),
        sku: binPrefix.trim(),
        name: `new-item-${prev.length + 1}`,
        photoIds: [],
        status: "idle",
      },
    ]);

  // ── Write listings ──────────────────────────────────────
  const writeGroup = useCallback(
    async (groupId: string) => {
      // Snapshot this group's photos from the latest state (no stale closure).
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group) return;
      const imgs = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, status: "writing", error: undefined } : g
        )
      );
      try {
        const res = await apiPost("/api/analyze", {
          profile: "auto",
          images: imgs,
          analysisModel: getAnalysisModel() ?? undefined,
          routerModel: getSortModel() ?? undefined,
        });
        const data = (await readJson(res)) as AnalyzeResponse;
        if (!data.ok || !data.listing) {
          throw new Error(data.error || "Could not write this listing.");
        }
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "done", listing: data.listing }
              : g
          )
        );
        // Market price check — advisory and best-effort, so it runs in the
        // background and silently stays hidden if it can't answer.
        void (async () => {
          try {
            const res = await apiPost("/api/ebay/comps", { listing: data.listing });
            const d = (await readJson(res)) as { ok?: boolean; comps?: CompsSummary };
            if (d.ok && d.comps?.ok) {
              setGroups((prev) =>
                prev.map((g) => (g.id === groupId ? { ...g, comps: d.comps } : g))
              );
            }
          } catch {
            /* comps unavailable — price stays purely the AI estimate */
          }
        })();
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "error", error: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const writeAll = async () => {
    // Only write listings that don't exist yet. Re-running everything after a
    // trip back to the review step re-billed the AI for unchanged listings
    // (issue #30) — groups whose photos changed are reset to "idle" by
    // movePhoto, so they (and only they) get rewritten here.
    const usable = groups
      .filter((g) => g.photoIds.length > 0 && g.status !== "done")
      .map((g) => g.id);
    setStep("listings");
    if (usable.length === 0) return;
    await runPool(usable, WRITE_CONCURRENCY, writeGroup);
  };

  const editListing = (groupId: string, patch: Partial<ListingResult>) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && g.listing
          ? { ...g, listing: { ...g.listing, ...patch } }
          : g
      )
    );

  const postGroup = useCallback(
    async (groupId: string) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group || !group.listing) return;
      const images = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }))
        .slice(0, MAX_PUBLISH_PHOTOS);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, postStatus: "posting", postError: undefined } : g
        )
      );
      try {
        // 1. Ship the photos to eBay first, in batches small enough that no
        // single request can hit Vercel's 4.5 MB body limit — the old
        // all-in-one publish request 413-failed on photo-heavy listings.
        const imageUrls: string[] = [];
        let uploadedCount = 0;
        for (const batch of chunkImagesForUpload(images)) {
          for (let attempt = 0; ; attempt++) {
            const res = await apiPost("/api/ebay/upload-photos", {
              sku: group.sku,
              images: batch,
              startIndex: uploadedCount,
            });
            if (attempt < 2 && TRANSIENT_STATUSES.has(res.status)) {
              await sleep(res.status === 429 ? 65_000 : 8_000);
              continue;
            }
            const d = (await readJson(res)) as { ok?: boolean; error?: string; urls?: string[] };
            if (!d.ok) throw new Error(d.error || "Could not upload photos to eBay.");
            imageUrls.push(...(Array.isArray(d.urls) ? d.urls : []));
            break;
          }
          uploadedCount += batch.length;
        }
        if (imageUrls.length === 0) {
          throw new Error("Could not upload any photos to eBay.");
        }
        // Partial upload failures don't block the listing, but they're loud —
        // a listing quietly missing photos sells worse and looks like a bug.
        const uploadWarnings =
          imageUrls.length < images.length
            ? [
                `${images.length - imageUrls.length} photo(s) failed to upload to eBay — the listing was posted with ${imageUrls.length}.`,
              ]
            : [];

        // 2. Publish with the eBay-hosted URLs (a few KB instead of megabytes).
        let data: {
          success: boolean;
          listingId?: string;
          error?: string;
          alreadyListed?: boolean;
          warnings?: string[];
        } | null = null;
        let hadTransientRetry = false;
        for (let attempt = 0; ; attempt++) {
          const res = await apiPost("/api/ebay/publish", {
            sku: group.sku,
            listing: group.listing,
            imageUrls,
          });
          // Wait out rate limits / transient platform errors instead of dying
          // mid-batch with "try again later".
          if (attempt < 2 && TRANSIENT_STATUSES.has(res.status)) {
            hadTransientRetry = true;
            await sleep(res.status === 429 ? 65_000 : 8_000);
            continue;
          }
          data = await readJson(res);
          break;
        }
        // A retried publish that finds the SKU already live means the earlier
        // attempt actually landed before the timeout — that's a success.
        if (data && !data.success && data.alreadyListed && hadTransientRetry && data.listingId) {
          data = { success: true, listingId: data.listingId };
        }
        if (!data?.success) throw new Error(data?.error || "eBay rejected the listing.");
        const allWarnings = [...uploadWarnings, ...(data.warnings ?? [])];
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  postStatus: "posted",
                  listingId: data!.listingId,
                  postWarnings: allWarnings.length ? allWarnings : undefined,
                }
              : g
          )
        );
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "error", postError: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const postAll = async () => {
    const ready = groups
      .filter((g) => g.status === "done" && g.postStatus !== "posted")
      .map((g) => g.id);
    // Sequential — keeps eBay calls gentle and errors easy to read.
    for (const id of ready) {
      await postGroup(id);
    }
  };

  const usableGroups = useMemo(
    () => groups.filter((g) => g.photoIds.length > 0),
    [groups]
  );

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">
          🪄
        </span>
        <div>
          <h1>Listing Writer</h1>
          <p>Upload a pile of photos · auto-sort into items · write every listing.</p>
        </div>
      </header>

      <EbayConnect

  workMode={workMode}

  selectedClientId={selectedClientId}

/>
      <section className="panel">

  <h2 className="section-label">Work mode</h2>

  <div>

   <button type="button" style={{ fontSize: "20px", padding: "10px 18px" }} onClick={() => {

  localStorage.setItem("workMode", "store");

  setWorkMode("store");

}}>My Store</button>

    <button type="button" style={{ fontSize: "20px", padding: "10px 18px" }} onClick={() => {

  localStorage.setItem("workMode", "client");

  setWorkMode("client");

}}>Client Job</button>
<p style={{ fontSize: "20px", marginTop: "16px" }}>Selected mode: {workMode === "store" ? "My Store" : "Client Job"}</p>
    {workMode === "client" && (
<>
  <input

    type="text"

    placeholder="Client Name"

    value={clientName}

    onChange={(e) => setClientName(e.target.value)}

    style={{ fontSize: "20px", padding: "10px", marginTop: "16px" }}

  />
  <button

  type="button"

  onClick={saveClient}

  style={{ fontSize: "20px", padding: "10px 18px", marginTop: "16px", marginLeft: "10px" }}

>

  Save Client

</button>
  {clients.length > 0 && (

  <div style={{ marginTop: "20px" }}>

    <h3>Saved Clients</h3>

    {clients.map((client) => (

      <div

        key={client.id}

        style={{

          display: "flex",

          alignItems: "center",

          gap: "10px",

          marginTop: "10px",

        }}

      >

        <strong>{client.name}</strong>

        <span>

          {client.active ? "Active" : "Inactive"}

        </span>

        <button

          type="button"

          onClick={() =>

            setClients((prev) =>

              prev.map((c) =>

                c.id === client.id

                  ? { ...c, active: !c.active }

                  : c

              )

            )

          }

        >

          {client.active ? "Deactivate" : "Reactivate"}

        </button>
        <button

  type="button"

  onClick={() => setSelectedClientId(client.id)}

>

  {selectedClientId === client.id ? "Selected" : "Select Client"}

</button>
        <button

  type="button"

  onClick={async () => {

    const newName = window.prompt("Enter the new client name:", client.name);

    if (!newName || !newName.trim() || newName.trim() === client.name) {

      return;

    }

    const response = await fetch("/api/clients", {

      method: "PATCH",

      headers: {

        "Content-Type": "application/json",

      },

      body: JSON.stringify({

        id: client.id,

        name: newName.trim(),

      }),

    });

    const data = await response.json();

    if (!response.ok || !data.success) {

      window.alert(data.error || "Failed to update client name");

      return;

    }

    setClients((prev) =>

      prev.map((c) =>

        c.id === client.id ? { ...c, name: data.client.name } : c

      )

    );

  }}

>

  Edit Name

</button>
<button

  type="button"

  onClick={() => {

    const firstConfirm = window.confirm(

      `Delete ${client.name} permanently?`

    );

    if (!firstConfirm) return;

    const secondConfirm = window.confirm(

      `FINAL CONFIRMATION: This will permanently delete ${client.name}. This cannot be undone.`

    );

    if (!secondConfirm) return;

    setClients((prev) =>

      prev.filter((c) => c.id !== client.id)

    );

  }}

>

  Delete Permanently

</button>
      </div>

    ))}

  </div>

)}


</>
)}
  </div>

</section>

      {step === "upload" && (
        <>
          <section className="hero">
            <h2>
              Dump every photo. <em>We&rsquo;ll sort it out.</em>
            </h2>
            <p>
              Add all your photos for the whole batch at once. The app groups
              them into separate items, then writes a polished eBay listing for
              each one.
            </p>
          </section>

          <section className="panel" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="section-label">
              1 · Add all your photos
            </h2>

            <div className="field bin-field">
              <label htmlFor="bin">
                Bin / SKU code{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  (where these items are stored)
                </span>
              </label>
              <input
                id="bin"
                type="text"
                placeholder="e.g. K75"
                value={binPrefix}
                onChange={(e) => setBinPrefix(e.target.value)}
                autoCapitalize="characters"
              />
              <span className="field-hint">
                Each item gets {binPrefix ? `${binPrefix.trim()}-A, ${binPrefix.trim()}-B` : "A, B, C"}
                … in order, so you can find it in the bin later. If this bin
                already has listings on eBay, lettering continues where it left
                off. You can edit any SKU after sorting.
              </span>
            </div>

            <div
              className={`dropzone${dragging ? " dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="icon" aria-hidden="true">
                📸
              </span>
              <strong>Tap to choose photos, or drag them all here</strong>
              <span>
                Every item in the batch · up to {MAX_PHOTOS} photos · JPG, PNG,
                WebP
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
            </div>
{manualGroups.length > 0 && (

  <div className="note">

    <strong>{manualGroups.length} items added</strong>

    <div>

      Each photo selection is saved as one separate item.

      Choose the photos for the next item to continue.

    </div>

  </div>

)}
            {photos.length > 0 && (
              <div className="thumbs" aria-label="Selected photos">
                {photos.map((p) => (
                  <div className="thumb" key={p.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="result-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              <ModelSelector />
              <button
                type="button"
                className="btn btn-primary"
                onClick={sort}
                disabled={photos.length === 0 || sorting}
              >
                {sorting ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Sorting{" "}
                    {photos.length} photos…
                  </>
                ) : (
                  <>🔀 Sort {photos.length || ""} photos into items</>
                )}
              </button>
            </div>

            {error && (
              <p className="note note-error" role="alert">
                {error}
              </p>
            )}
          </section>

          {sorting && (
            <section className="panel">
              <div className="loading-card">
                <span className="spinner" aria-hidden="true" />
                <span>
                  {sortProgress ??
                    "Grouping photos by item, then double-checking for mixed-up or split items. This takes a little while for big batches."}
                </span>
              </div>
            </section>
          )}
        </>
      )}

      {step === "review" && (
        <ReviewBoard
          groups={groups}
          orphanIds={orphanIds}
          photoById={photoById}
          onRename={rename}
          onRenameSku={renameSku}
          onMovePhoto={movePhoto}
          onRemovePhoto={removePhoto}
          onReorderPhoto={reorderPhoto}
          onDeleteGroup={deleteGroup}
          onAddGroup={addGroup}
          onAddFilesToGroup={addFilesToGroup}
          onWriteAll={writeAll}
          onBack={() => setStep("upload")}
        />
      )}

      {step === "listings" && (
        <ListingsView
          groups={usableGroups}
          photoById={photoById}
          ebayConnected={ebayConnected}
          onEdit={editListing}
          onRenameSku={renameSku}
          onRetry={writeGroup}
          onPost={postGroup}
          onReorderPhoto={reorderPhoto}
          onRemovePhoto={removePhoto}
          onDelete={deleteGroup}
          onDeleteAll={deleteAll}


          onPostAll={postAll}
          onBack={() => setStep("review")}
        />
      )}

      <p className="footnote">
        Your photos are sent securely to sort and write listings, and are not
        stored. One-click posting to eBay is coming in the next phase.
      </p>
    </main>
  );
}
