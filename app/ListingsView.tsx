"use client";

import { useEffect, useRef, useState } from "react";
import { ListingCard } from "./ListingCard";
import {
  downloadFile,
  listingsToCsv,
  listingsToJson,
} from "@/lib/export";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";
import { chunkImagesForUpload } from "@/lib/uploadBatches";
import { accessHeaders, apiPost } from "@/lib/api-client";
import {
  applySelectAll,
  assignedGarmentsNote,
  canAssignSelectedToLot,
  clearSelectionAfterAssign,
  garmentsToAssign,
  selectAllChecked,
  selectAllIndeterminate,
  selectedGarmentsLabel,
  toggleWorkspaceGarment,
} from "@/lib/usa-lots/workspace-selection";

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
  onPost: (groupId: string, lotId?: string) => void;
  onRememberLot?: (groupIds: string[], lotId: string) => void;
  onDraft: (groupId: string) => void;


  onReorderPhoto: (groupId: string, fromIndex: number, toIndex: number) => void;
  onRemovePhoto: (photoId: string) => void;
  onDelete: (groupId: string) => void;
  onDeleteAll: () => void;
  onArchive?: (groupId: string) => void;
  onArchivePublished?: () => void;
  archiveNote?: string | null;
  archiving?: boolean;
  onPostAll: () => void;
  onDraftAll: () => void;
  onSoldCompsAll: () => void;
  onPrepareAll: () => void;
  onPrepareVinted: (groupId: string, sku: string) => void;
  onMarkVintedPublished: (groupId: string, url: string) => void;
  vintedPreparing: boolean;
  guatemala?: boolean;
  skuNotice?: string;
  inventoryClientId?: string;
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
  onRememberLot,
  onDraft,
  onReorderPhoto,
  onRemovePhoto,
  onDelete,
  onDeleteAll,
  onArchive,
  onArchivePublished,
  archiveNote,
  archiving = false,
  onPostAll,
  onDraftAll,
  onSoldCompsAll,
  onPrepareAll,
  onPrepareVinted,
  onMarkVintedPublished,
  vintedPreparing,
  guatemala = false,
  skuNotice,
  inventoryClientId,
  onBack,
}: ListingsViewProps) {
  const [usaLots, setUsaLots] = useState<{ id: string; name: string }[]>([]);
  const [usaLotId, setUsaLotId] = useState("");
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([]);
  const [lotAssignNote, setLotAssignNote] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);
  const workspaceIds = groups.map((group) => group.id);
  const selectedWorkspaceIds = garmentsToAssign(selectedLotIds, workspaceIds);
  const allWorkspaceSelected = selectAllChecked(selectedWorkspaceIds, workspaceIds);
  const workspacePartiallySelected = selectAllIndeterminate(selectedWorkspaceIds, workspaceIds);
  useEffect(() => {
    if (guatemala) return;
    const params = new URLSearchParams();
    if (inventoryClientId) {
      params.set("workMode", "client");
      params.set("clientId", inventoryClientId);
    }
    void fetch(`/api/lotes?${params.toString()}`, { cache: "no-store", headers: accessHeaders() })
      .then((response) => response.json())
      .then((data: { lots?: { id: string; name: string }[] }) => setUsaLots(data.lots || []))
      .catch(() => setUsaLots([]));
  }, [guatemala, inventoryClientId]);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = workspacePartiallySelected;
  }, [workspacePartiallySelected]);
  const done = groups.filter((g) => g.status === "done").length;
  const writing = groups.filter((g) => g.status === "writing").length;
  const failed = groups.filter((g) => g.status === "error").length;
  const posted = groups.filter((g) => g.postStatus === "posted").length;
  const posting = groups.some((g) => g.postStatus === "posting");
  const readyToPost = groups.filter(
    (g) => g.status === "done" && g.postStatus !== "posted"
  ).length;
  const readyToPrepare = groups.filter(
    (g) => g.status === "done" && g.listing && g.vintedStatus !== "published"
  ).length;
  const allDone = writing === 0 && done > 0;

  return (
    <section className="panel" aria-labelledby="listings-heading">
      <div className="result-head">
        <h3 id="listings-heading">{guatemala ? "Publicaciones" : "Your listings"}</h3>
        <span className="badge">
          {done}/{groups.length} {guatemala ? "listas" : "ready"}
          {writing > 0 ? ` · ${writing} ${guatemala ? "escribiendo" : "writing"}` : ""}
          {failed > 0 ? ` · ${failed} ${guatemala ? "con error" : "failed"}` : ""}
          {!guatemala && posted > 0 ? ` · ${posted} posted` : ""}
        </span>
      </div>
      {guatemala ? (
        <p className="note">
          El título y la descripción salen en español. El precio se escribe en quetzales. Esta tienda no se publica en eBay.
        </p>
      ) : null}
      {skuNotice ? (
        <p className="note" role="alert">
          {skuNotice}
        </p>
      ) : null}

      {!guatemala && ebayConnected && readyToPost > 0 && (
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
<button

  type="button"

  className="btn btn-ghost"

  disabled={done === 0}

  onClick={onSoldCompsAll}

>

  🔎 Sold Comps All

</button>

        </div>
      )}
      {!guatemala && (
      <div className="post-all-bar">
        <span>Prepare items for Vinted. Publishing on Vinted stays manual.</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onPrepareAll}
          disabled={vintedPreparing || readyToPrepare === 0}
        >
          {vintedPreparing ? "Preparing…" : "Prepare All for Vinted"}
        </button>
        <a className="btn btn-ghost" href="/vinted">
          Vinted queue
        </a>
        <a className="btn btn-ghost" href="/vinted/inventory">
          Inventario Vinted
        </a>
      </div>
      )}
{!guatemala && onArchivePublished ? (
  <button
    type="button"
    className="btn btn-ghost"
    disabled={posted === 0 || archiving}
    onClick={() => {
      if (
        window.confirm(
          "Archivar quita del área de trabajo solo los artículos ya publicados y los guarda en el archivo. No los elimina y no modifica los anuncios en eBay. Los que siguen pendientes se quedan aquí."
        )
      ) {
        onArchivePublished();
      }
    }}
  >
    {archiving ? "Archivando…" : "Archivar todos los publicados"}
  </button>
) : null}
{archiveNote ? (
  <p className="note" role="status">
    {archiveNote}
  </p>
) : null}
<button

  type="button"

  className="btn btn-ghost danger"

  onClick={() => {

    if (
      window.confirm(
        "Eliminar todo quita estos artículos del área de trabajo. No borra el archivo, las fotos ni el lote, el SKU y el número de anuncio ya guardados."
      )
    ) {

      onDeleteAll();

    }

  }}

  disabled={groups.length === 0 || archiving}

>

  🗑 Delete All

</button>
      {!guatemala ? (
        <div className="result-actions lot-assign-bar">
          <label className="lot-field" htmlFor="usa-lot-select">
            Lote USA
            <select id="usa-lot-select" value={usaLotId} onChange={(event) => setUsaLotId(event.target.value)}>
              <option value="">Elige un lote</option>
              {usaLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.name}</option>)}
            </select>
          </label>
          <label className="lot-select-all" htmlFor="select-all-workspace">
            <input
              ref={selectAllRef}
              id="select-all-workspace"
              type="checkbox"
              checked={allWorkspaceSelected}
              disabled={workspaceIds.length === 0}
              onChange={(event) => setSelectedLotIds(applySelectAll(workspaceIds, event.target.checked))}
            />
            Seleccionar todos
          </label>
          <span className="lot-select-count" role="status">
            {selectedGarmentsLabel(selectedWorkspaceIds.length)}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canAssignSelectedToLot(usaLotId, selectedWorkspaceIds.length)}
            onClick={() => {
              const chosenIds = [...selectedWorkspaceIds];
              const chosenLot = usaLotId;
              const items = groups.filter((group) => chosenIds.includes(group.id)).map((group) => ({
                sku: group.sku,
                ebayItemId: group.listingId || "",
                jobId: group.id,
                title: group.listing?.title || group.name,
              }));
              const params = inventoryClientId ? { workMode: "client", clientId: inventoryClientId } : { workMode: "store", clientId: null };
              void fetch("/api/lotes", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...accessHeaders() },
                body: JSON.stringify({ action: "assign", ...params, lotId: chosenLot, items }),
              }).then(async (response) => {
                const data = await response.json() as { ok?: boolean; error?: string; assigned?: number };
                if (response.ok && data.ok) {
                  onRememberLot?.(chosenIds, chosenLot);
                  setSelectedLotIds(clearSelectionAfterAssign());
                  setLotAssignNote(assignedGarmentsNote(data.assigned ?? chosenIds.length));
                } else {
                  setLotAssignNote(data.error || "No se pudo asignar el lote.");
                }
              }).catch(() => setLotAssignNote("No se pudo asignar el lote."));
            }}
          >
            Asignar seleccionados al lote
          </button>
          <p className="note">Marca el artículo, elige su lote y publícalo. El SKU, el lote y el número del anuncio se quedan guardados si después limpias el área de trabajo. Una venta sin lote no entra en las cuentas de ningún lote.</p>
          {lotAssignNote ? <p className="note" role="status">{lotAssignNote}</p> : null}
        </div>
      ) : null}
      <div className="listing-list">
        {groups.map((group) => (
          <ListingCard
            key={group.id}
            group={group}
            lotSelected={selectedWorkspaceIds.includes(group.id)}
            onToggleLotSelect={guatemala ? undefined : (id) => setSelectedLotIds((current) => toggleWorkspaceGarment(current, id, workspaceIds))}
            photoById={photoById}
            ebayConnected={ebayConnected}
            onEdit={onEdit}
            onRenameSku={onRenameSku}
            onRetry={onRetry}
            onPost={(id) => {
              const group = groups.find((item) => item.id === id);
              const lot = group?.usaLotId || (selectedWorkspaceIds.includes(id) && usaLotId ? usaLotId : "");
              onPost(id, lot);
            }}
            onDraft={onDraft}
            onReorderPhoto={onReorderPhoto}
            onRemovePhoto={onRemovePhoto}
            onDelete={onDelete}
            onArchive={onArchive}
            onPrepareVinted={onPrepareVinted}
            onMarkVintedPublished={onMarkVintedPublished}
            guatemala={guatemala}
            inventoryClientId={inventoryClientId}
          />
        ))}
      </div>

      <div className="result-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          {guatemala ? "← Volver a las prendas" : "← Back to items"}
        </button>
        {!guatemala && (
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
        )}
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
          {guatemala ? `Descargar textos (${done})` : `⬇️ Download all (${done})`}
        </button>
       

      </div>

      {allDone && !guatemala && (
        <p className="footnote" style={{ marginTop: "1.5rem" }}>
          Next phase: post all of these straight to eBay with one click.
        </p>
      )}
    </section>
  );
}
