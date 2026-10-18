"use client";

import { useEffect, useState } from "react";
import { catalogPhotoPath } from "@/lib/markets/guatemala-catalog";

export function PhotoGallery({ ids, alt }: { ids: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const current = ids[active] ?? ids[0];

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight") setActive((index) => (index + 1) % ids.length);
      if (event.key === "ArrowLeft") setActive((index) => (index - 1 + ids.length) % ids.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids.length, open]);

  if (!current) {
    return <div className="vsa-photo vsa-photo-empty">Sin foto</div>;
  }

  return (
    <div className="vsa-gallery">
      <button type="button" className="vsa-photo vsa-zoom" onClick={() => setOpen(true)}>
        <img src={catalogPhotoPath(current, 960)} alt={alt} width={960} height={960} />
        <span>Ampliar foto</span>
      </button>
      {ids.length > 1 ? (
        <div className="vsa-thumbs">
          {ids.map((id, index) => (
            <button
              key={id}
              type="button"
              className={index === active ? "is-active" : ""}
              onClick={() => setActive(index)}
              aria-label={`Foto ${index + 1}`}
            >
              <img src={catalogPhotoPath(id, 480)} alt="" width={480} height={480} />
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="vsa-lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada">
          <button type="button" className="vsa-lightbox-close" onClick={() => setOpen(false)}>
            Cerrar
          </button>
          <img src={catalogPhotoPath(current, 960)} alt={alt} width={960} height={960} />
          {ids.length > 1 ? (
            <div className="vsa-lightbox-nav">
              <button type="button" onClick={() => setActive((index) => (index - 1 + ids.length) % ids.length)}>
                Anterior
              </button>
              <button type="button" onClick={() => setActive((index) => (index + 1) % ids.length)}>
                Siguiente
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
