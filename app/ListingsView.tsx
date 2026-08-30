"use client";

import { ListingCard } from "./ListingCard";
import {
  downloadFile,
  listingsToCsv,
  listingsToJson,
} from "@/lib/export";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";
import { chunkImagesForUpload } from "@/lib/uploadBatches";
import { apiPost } from "@/lib/api-client";

async function uploadPhotosToEbay(sku: string, photos: Photo[]) {

  const batches = chunkImagesForUpload(photos);

  const urls: string[] = [];

  let startIndex = 0;

  for (const images of batches) {

    const response = await apiPost("/api/ebay/upload-photos", {

  sku,

  images,

  startIndex,

});

    const result = await response.json();

    if (!response.ok || !result.ok) {

      throw new Error(result.error || "Failed to upload photos to eBay.");

    }

    urls.push(...(result.urls ?? []));

    startIndex += images.length;

  }

  return { urls };

}
interface ListingsViewProps {
  groups: ItemGroup[];
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
  onDeleteAll: () => void;
  onPostAll: () => void;
  onDraftAll: () => void;
  onBack: () => void;
}

export function ListingsView({
  groups,
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
  onDeleteAll,
  onPostAll,
  onDraftAll,
  onBack,
}: ListingsViewProps) {
  const done = groups.filter((g) => g.status === "done").length;
  const writing = groups.filter((g) => g.status === "writing").length;
  const failed = groups.filter((g) => g.status === "error").length;
  const posted = groups.filter((g) => g.postStatus === "posted").length;
  const posting = groups.some((g) => g.postStatus === "posting");
  const readyToPost = groups.filter(
    (g) => g.status === "done" && g.postStatus !== "posted"
  ).length;
  const allDone = writing === 0 && done > 0;

  return (
    <section className="panel" aria-labelledby="listings-heading">
      <div className="result-head">
        <h3 id="listings-heading">Your listings</h3>
        <span className="badge">
          {done}/{groups.length} ready
          {writing > 0 ? ` · ${writing} writing` : ""}
          {failed > 0 ? ` · ${failed} failed` : ""}
          {posted > 0 ? ` · ${posted} posted` : ""}
        </span>
      </div>

      {ebayConnected && readyToPost > 0 && (
        <div className="post-all-bar">
          <span>
            {posted > 0
              ? `${posted} posted · ${readyToPost} left`
              : "Connected to eBay — post a single item to test first, or post them all."}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onPostAll}
            disabled={posting}
          >
            {posting ? (
              <>
                <span className="spinner" aria-hidden="true" /> Posting…
              </>
            ) : (
              `🚀 Post all ${readyToPost} to eBay`
            )}
          </button>
          <button

  type="button"

  className="btn btn-ghost"

  disabled={done === 0}

  onClick={onDraftAll}

>

  📄 Draft All Listings

</button>


        </div>
      )}
<button

  type="button"

  className="btn btn-ghost"

  onClick={() => {

    if (window.confirm("Delete ALL items permanently?")) {

      onDeleteAll();

    }

  }}

  disabled={groups.length === 0}

>

  🗑 Delete All

</button>
      <div className="listing-list">
        {groups.map((group) => (
          <ListingCard
            key={group.id}
            group={group}
            photoById={photoById}
            ebayConnected={ebayConnected}
            onEdit={onEdit}
            onRenameSku={onRenameSku}
            onRetry={onRetry}
            onPost={onPost}
            onDraft={onDraft}
            onReorderPhoto={onReorderPhoto}
            onRemovePhoto={onRemovePhoto}
            onDelete={onDelete}
          />
        ))}
      </div>

      <div className="result-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back to items
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={done === 0}
         onClick={async () => {

  try {

    if (!ebayConnected) {

      alert("Connect eBay first so the photos can be uploaded.");

      return;

    }

    const pictureUrlsBySku: Record<string, string[]> = {};

    for (const group of groups.filter((g) => g.listing)) {

      const photos = group.photoIds

        .map((id) => photoById(id))

        .filter((p): p is Photo => Boolean(p));

      const result = await uploadPhotosToEbay(group.sku, photos);

      pictureUrlsBySku[group.sku] = result.urls ?? [];

    }

    downloadFile(

      "ebay-listings.csv",

      listingsToCsv(groups, pictureUrlsBySku),

      "text/csv"

    );

  } catch (error) {

    alert(

      error instanceof Error

        ? error.message

        : "Could not create the eBay CSV."

    );

  }

}}
        >
          ⬇️ Download spreadsheet (CSV)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={done === 0}
          onClick={() =>
            downloadFile(
              "ebay-listings.json",
              listingsToJson(groups),
              "application/json"
            )
          }
        >
          ⬇️ Download all ({done})
        </button>
       

      </div>

      {allDone && (
        <p className="footnote" style={{ marginTop: "1.5rem" }}>
          Next phase: post all of these straight to eBay with one click.
        </p>
      )}
    </section>
  );
}
