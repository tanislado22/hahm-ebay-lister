"use client";

import { useEffect, useState } from "react";
import { OwnerAccess } from "@/app/OwnerAccess";
import { accessHeaders } from "@/lib/api-client";
import { VINTED_REVIEW_LABEL, type ArchiveVintedFilter, type VintedReview } from "@/lib/archive/vinted-review";

interface ArchiveCard {
  id: string;
  sku: string;
  title: string;
  price: string;
  currency: string;
  ebayItemId: string;
  ebayUrl: string;
  listingStatus: string;
  vintedListingUrl: string;
  vintedReview: VintedReview;
  thumbUrl: string;
}

interface ArchiveDetail extends ArchiveCard {
  plainDescription?: string;
  description: string;
  quantitySold: number | null;
  variants: { sku: string; price: string; currency: string; quantity: string; specifics: { name: string; value: string }[] }[];
  vintedStatus: string;
  photos: { id: string; url: string }[];
}

interface ImportProgress {
  ok?: boolean;
  status?: string;
  retryable?: boolean;
  found?: number;
  imported?: number;
  existing?: number;
  errors?: { itemId: string; message: string }[];
  notices?: string[];
  pending?: number;
  page?: number;
  totalPages?: number | null;
  totalEntries?: number | null;
  detail?: string;
  missing?: string[];
  error?: string;
}

export default function ArchivePage() {
  const [workMode, setWorkMode] = useState("store");
  const [clientId, setClientId] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [filter, setFilter] = useState<ArchiveVintedFilter>("all");
  const [vintedUrl, setVintedUrl] = useState("");
  const [savingVinted, setSavingVinted] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [articles, setArticles] = useState<ArchiveCard[]>([]);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [importing, setImporting] = useState<"sample" | "all" | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const queryString = () => {
    const params = new URLSearchParams();
    if (workMode === "client" && clientId) {
      params.set("workMode", "client");
      params.set("clientId", clientId);
    }
    return params;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("workMode") === "client" ? "client" : "store";
    const id = params.get("clientId") || "";
    setWorkMode(mode);
    setClientId(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      const params = queryString();
      params.set("page", String(page));
      if (submittedQuery) params.set("q", submittedQuery);
      if (filter !== "all") params.set("vinted", filter);
      try {
        const response = await fetch(`/api/archivo?${params.toString()}`, {
          cache: "no-store",
          headers: accessHeaders(),
          signal: controller.signal,
        });
        const data = (await response.json()) as { ok?: boolean; error?: string; articles?: ArchiveCard[]; pages?: number; total?: number };
        if (!response.ok || !data.ok) {
          setError(data.error || "No se pudo leer el archivo.");
          setArticles([]);
          return;
        }
        setArticles(data.articles || []);
        setPages(data.pages || 1);
        setTotal(data.total || 0);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") setError("No se pudo leer el archivo.");
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [page, submittedQuery, filter, workMode, clientId, reloadToken]);

  const openArticle = async (id: string) => {
    setError("");
    const params = queryString();
    const response = await fetch(`/api/archivo/${encodeURIComponent(id)}?${params.toString()}`, {
      cache: "no-store",
      headers: accessHeaders(),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; article?: ArchiveDetail };
    if (!response.ok || !data.article) {
      setError(data.error || "No se pudo abrir el artículo.");
      return;
    }
    setDetail(data.article);
    setVintedUrl(data.article.vintedListingUrl || "");
  };

  const saveVinted = async (action: "link" | "unlink" | "pending" | "unverified") => {
    if (!detail) return;
    setSavingVinted(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/archivo/vinted", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders() },
        body: JSON.stringify({
          id: detail.id,
          workMode,
          clientId: clientId || null,
          action,
          url: vintedUrl,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; review?: VintedReview; vintedListingUrl?: string };
      if (!response.ok || !data.ok || !data.review) {
        setError(data.error || "No se pudo guardar el estado de Vinted.");
        return;
      }
      setDetail({ ...detail, vintedReview: data.review, vintedListingUrl: data.vintedListingUrl || "" });
      setVintedUrl(data.vintedListingUrl || "");
      setMessage(`Estado guardado: ${VINTED_REVIEW_LABEL[data.review]}.`);
      setReloadToken((current) => current + 1);
    } finally {
      setSavingVinted(false);
    }
  };

  const prepareVinted = async (id: string) => {
    setSavingVinted(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/archivo/preparar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders() },
        body: JSON.stringify({ id, workMode, clientId: clientId || null }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string; review?: VintedReview };
      if (!response.ok || !data.ok) {
        setError(data.error || "No se pudo preparar el artículo para Vinted.");
        return;
      }
      if (data.review && detail?.id === id) setDetail({ ...detail, vintedReview: data.review });
      setMessage(data.message || "Quedó preparado para Vinted.");
      setReloadToken((current) => current + 1);
    } finally {
      setSavingVinted(false);
    }
  };

  const restore = async (id: string) => {
    setMessage("");
    setError("");
    const response = await fetch("/api/archivo/devolver", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessHeaders() },
      body: JSON.stringify({ id, workMode, clientId: clientId || null }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudo devolver el artículo.");
      return;
    }
    setMessage(data.message || "Volvió al área de trabajo.");
  };

  const runImport = async (mode: "sample" | "all") => {
    setImporting(mode);
    setImportError("");
    setMessage("");
    let guard = 0;
    try {
      while (guard < 400) {
        guard += 1;
        const response = await fetch("/api/archivo/importar", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...accessHeaders() },
          body: JSON.stringify({ mode, workMode, clientId: clientId || null }),
        });
        const data = (await response.json()) as ImportProgress;
        setProgress(data);
        if (data.retryable) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        if (!response.ok || data.status === "done" || data.status === "error") {
          if (data.error) setImportError([data.error, ...(data.missing || [])].filter(Boolean).join(" "));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setPage(1);
      setReloadToken((current) => current + 1);
    } finally {
      setImporting(null);
    }
  };

  return (
    <main className="wrap">
      <header>
        <h1>Archivo de artículos</h1>
        <p>
          <a href="/">Área de trabajo</a>
          {" · "}
          Los artículos quedan guardados en el servidor, asociados a la cuenta de eBay conectada.
        </p>
      </header>
      <OwnerAccess nextHref="/archivo" />

      <section className="panel">
        <h2 className="section-label">Importar artículos activos de eBay</h2>
        <p className="note">
          La importación solo lee la cuenta conectada. No crea, modifica, finaliza ni vuelve a publicar anuncios.
          Empieza con diez anuncios. Cuando esa prueba quede guardada, puedes traer todos los activos.
        </p>
        <div className="result-actions">
          <button type="button" className="btn btn-primary" disabled={importing !== null} onClick={() => void runImport("sample")}>
            {importing === "sample" ? "Importando 10…" : "Importar 10 anuncios (prueba)"}
          </button>
          <button type="button" className="btn btn-ghost" disabled={importing !== null} onClick={() => void runImport("all")}>
            {importing === "all" ? "Importando activos…" : "Importar todos los activos"}
          </button>
        </div>
        {progress ? (
          <p className="note" role="status">
            Encontrados: {progress.found ?? 0}. Importados: {progress.imported ?? 0}. Existentes: {progress.existing ?? 0}.
            Errores: {progress.errors?.length ?? 0}.
            {progress.totalPages ? ` Página ${progress.page ?? 0} de ${progress.totalPages}.` : ""}
            {progress.pending ? ` Pendientes: ${progress.pending}.` : ""}
            {progress.detail ? ` ${progress.detail}` : ""}
          </p>
        ) : null}
        {importError ? <p className="note note-error" role="alert">{importError}</p> : null}
        {progress?.missing && progress.missing.length > 0 ? (
          <ul className="note">
            {progress.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {progress?.notices && progress.notices.length > 0 ? (
          <ul className="note">
            {progress.notices.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {progress?.errors && progress.errors.length > 0 ? (
          <ul className="note note-error">
            {progress.errors.slice(0, 8).map((item) => (
              <li key={`${item.itemId}-${item.message}`}>{item.itemId}: {item.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <form
          className="archive-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedQuery(query.trim());
            setDetail(null);
          }}
        >
          <label htmlFor="archive-query">Buscar por SKU, título o número de anuncio</label>
          <input
            id="archive-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-ghost">Buscar</button>
        </form>
        <div className="archive-filters" role="group" aria-label="Filtrar por Vinted">
          {([
            ["all", "Todos"],
            ["linked", "Vinculados a Vinted"],
            ["pending", "Pendientes de publicar"],
            ["unverified", "Sin verificar"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "btn btn-primary" : "btn btn-ghost"}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="note">{loading ? "Cargando…" : `${total} artículo${total === 1 ? "" : "s"} en el archivo. Se muestran 20 por página.`}</p>
        {error ? <p className="note note-error" role="alert">{error}</p> : null}
        {message ? <p className="note" role="status">{message}</p> : null}
        <div className="archive-grid">
          {articles.map((article) => (
            <button key={article.id} type="button" className="archive-card" onClick={() => void openArticle(article.id)}>
              {article.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={article.thumbUrl} alt="" />
              ) : (
                <span className="archive-thumb-empty">Sin miniatura</span>
              )}
              <strong>{article.title || "Sin título"}</strong>
              <span>SKU: {article.sku || "sin SKU"}</span>
              <span>{article.price ? `${article.price} ${article.currency}` : "Sin precio"}</span>
              <span>{article.ebayItemId || "Sin número de anuncio"}</span>
              <span>{VINTED_REVIEW_LABEL[article.vintedReview] || "Sin verificar"}</span>
            </button>
          ))}
        </div>
        <div className="result-actions">
          <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Anterior
          </button>
          <span>Página {page} de {pages}</span>
          <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>
            Siguiente
          </button>
        </div>
      </section>

      {detail ? (
        <section className="panel" aria-live="polite">
          <h2>{detail.title || "Sin título"}</h2>
          <p>SKU: {detail.sku || "eBay no envió SKU"}</p>
          <p>Precio: {detail.price ? `${detail.price} ${detail.currency}` : "No disponible"}</p>
          <p>
            Estado: {detail.listingStatus || (detail.ebayItemId ? "Publicado. eBay no envió otro estado en esta copia." : "Sin estado")}
            {detail.quantitySold != null ? ` · vendidos según eBay: ${detail.quantitySold}` : ""}
          </p>
          <p>
            Anuncio: {detail.ebayItemId || "sin número"}
            {detail.ebayUrl ? <> · <a href={detail.ebayUrl} target="_blank" rel="noopener noreferrer">Abrir en eBay</a></> : null}
          </p>
          <p>
            Vinted: {VINTED_REVIEW_LABEL[detail.vintedReview] || "Sin verificar"}.
            {detail.vintedReview === "linked"
              ? " Tiene un enlace guardado. Esto no garantiza que el anuncio siga activo."
              : detail.vintedReview === "pending"
                ? " Confirmaste que falta publicarlo."
                : " Todavía no sabemos si está publicado."}
          </p>
          <form
            className="archive-search"
            onSubmit={(event) => {
              event.preventDefault();
              void saveVinted("link");
            }}
          >
            <label htmlFor="vinted-url">Vincular anuncio de Vinted</label>
            <input
              id="vinted-url"
              value={vintedUrl}
              onChange={(event) => setVintedUrl(event.target.value)}
              placeholder="https://www.vinted.com/items/12345678"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary" disabled={savingVinted}>Vincular anuncio de Vinted</button>
            {detail.vintedListingUrl ? (
              <a className="btn btn-ghost" href={detail.vintedListingUrl} target="_blank" rel="noopener noreferrer">Abrir en Vinted</a>
            ) : null}
          </form>
          <div className="result-actions">
            {detail.vintedListingUrl ? (
              <button type="button" className="btn btn-ghost" disabled={savingVinted} onClick={() => void saveVinted("unlink")}>
                Quitar vínculo
              </button>
            ) : null}
            {detail.vintedReview !== "linked" && detail.vintedReview !== "pending" ? (
              <button type="button" className="btn btn-ghost" disabled={savingVinted} onClick={() => void saveVinted("pending")}>
                Marcar como pendiente
              </button>
            ) : null}
            {detail.vintedReview === "pending" ? (
              <button type="button" className="btn btn-ghost" disabled={savingVinted} onClick={() => void saveVinted("unverified")}>
                Marcar como sin verificar
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" disabled={savingVinted} onClick={() => void prepareVinted(detail.id)}>
              Preparar para Vinted
            </button>
          </div>
          <p className="archive-description">{detail.plainDescription || "eBay no envió descripción."}</p>
          {detail.variants.length > 0 ? (
            <ul>
              {detail.variants.map((variant, index) => (
                <li key={`${variant.sku}-${index}`}>
                  SKU {variant.sku || "sin SKU"} · {variant.price} {variant.currency}
                  {variant.specifics.map((specific) => ` · ${specific.name}: ${specific.value}`).join("")}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="archive-photos">
            {detail.photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo.id} src={photo.url} alt="" />
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void restore(detail.id)}>
            Devolver al área de trabajo
          </button>
        </section>
      ) : null}
    </main>
  );
}
