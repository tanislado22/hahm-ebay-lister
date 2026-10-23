import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { SoldTicket } from "./sold-ticket";
import {
  PUBLIC_COLLECTION_EMPTY,
  PUBLIC_SOLD_BADGE,
  PUBLIC_SOLD_COUNT_LABEL,
  catalogClearSearch,
  catalogEmptyMessage,
  catalogFilterChips,
  catalogPageSearch,
  parseCatalogFilters,
  type CatalogFilters,
} from "@/lib/markets/guatemala-catalog";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import { listPublicGuatemalaCatalog } from "@/lib/markets/guatemala-inventory-store";
import { GARMENT_KIND_CHOICES } from "@/lib/markets/guatemala-price-match";
import { isStoreHostname } from "@/lib/markets/store-host";
import {
  GUATEMALA_ARTICLE_WHATSAPP_LABEL,
  GUATEMALA_CATALOG_WHATSAPP_LABEL,
  GUATEMALA_CATALOG_WHATSAPP_MESSAGE,
  catalogRequestOrigin,
  guatemalaArticleWhatsappMessage,
  guatemalaWhatsappUrl,
  publicArticleUrl,
} from "@/lib/markets/guatemala-whatsapp";
import { WhatsappLink } from "./whatsapp-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Variedades San Andrés",
  description: "Catálogo de prendas de Variedades San Andrés. Precios en quetzales.",
};

const AVAILABILITY = [
  ["todos", "Todos"],
  ["disponibles", "Disponibles"],
  ["vendidos", "Vendidos"],
] as const;

function catalogHref(home: string, search: string): string {
  return search ? `${home}?${search}` : home;
}

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseCatalogFilters(await searchParams);
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const storefront = isStoreHostname(host);
  const origin = catalogRequestOrigin(host, headerList.get("x-forwarded-proto"));
  const home = storefront ? "/" : "/tienda";
  const catalogWhatsapp = guatemalaWhatsappUrl(GUATEMALA_CATALOG_WHATSAPP_MESSAGE);
  const result = await listPublicGuatemalaCatalog(filters);
  const items = result.ok ? result.items : [];
  const facets = result.ok ? result.facets : { categories: [], sizes: [], brands: [] };
  const chips = catalogFilterChips(filters);
  const filterCount = chips.filter((chip) => chip.id !== "q").length;
  const product = (id: string) => (storefront ? `/prenda/${id}` : `/tienda/prenda/${id}`);
  const availabilityHref = (availability: CatalogFilters["availability"]) =>
    catalogHref(home, catalogPageSearch({ ...filters, availability }));

  return (
    <main className="vsa">
      <header className="vsa-top">
        <p className="vsa-mark" aria-hidden="true">VSA</p>
        <div>
          <h1>Variedades San Andrés</h1>
          <p>Precios en quetzales</p>
        </div>
      </header>
      <WhatsappLink className="vsa-whatsapp-general" href={catalogWhatsapp}>
        {GUATEMALA_CATALOG_WHATSAPP_LABEL}
      </WhatsappLink>
      <form className="vsa-controls" action={home} method="get">
        {filters.availability !== "todos" ? <input type="hidden" name="estado" value={filters.availability} /> : null}
        <input id="vsa-filter-open" className="vsa-filter-toggle" type="checkbox" />
        <div className="vsa-toolbar">
          <label className="vsa-search">
            <span className="vsa-sr">Buscar</span>
            <input type="search" name="q" defaultValue={filters.q} placeholder="Buscar" enterKeyHint="search" />
          </label>
          <button className="vsa-search-go" type="submit">Buscar</button>
          <label className="vsa-filter-button" htmlFor="vsa-filter-open">
            Filtrar{filterCount > 0 ? ` (${filterCount})` : ""}
          </label>
        </div>
        <div className="vsa-filter-panel">
          <label>
            Categoría
            <select name="categoria" defaultValue={filters.category}>
              <option value="">Todas</option>
              {GARMENT_KIND_CHOICES.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </select>
          </label>
          <label>
            Talla
            <select name="talla" defaultValue={filters.size}>
              <option value="">Todas</option>
              {facets.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label>
            Marca
            <select name="marca" defaultValue={filters.brand}>
              <option value="">Todas</option>
              {facets.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          </label>
          <div className="vsa-price-range">
            <label>
              Desde
              <input name="min" inputMode="decimal" defaultValue={filters.minPrice ?? ""} placeholder="Q" />
            </label>
            <label>
              Hasta
              <input name="max" inputMode="decimal" defaultValue={filters.maxPrice ?? ""} placeholder="Q" />
            </label>
          </div>
          <button type="submit">Aplicar</button>
        </div>
      </form>
      {chips.length > 0 ? (
        <div className="vsa-chips">
          {chips.map((chip) => (
            <Link key={chip.id} href={catalogHref(home, chip.search)}>{chip.label} <span aria-hidden="true">×</span><span className="vsa-sr">Quitar</span></Link>
          ))}
          <Link href={catalogHref(home, catalogClearSearch(filters))}>Limpiar</Link>
        </div>
      ) : null}
      <nav className="vsa-availability" aria-label="Disponibilidad">
        {AVAILABILITY.map(([value, label]) => (
          <Link key={value} href={availabilityHref(value)} aria-current={filters.availability === value ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      {result.ok && result.soldCount > 0 ? (
        <p className="vsa-sold-count">{PUBLIC_SOLD_COUNT_LABEL}: {result.soldCount}</p>
      ) : null}
      {!result.ok ? <p className="vsa-note" role="alert">{result.error}</p> : null}
      {result.ok && items.length === 0 ? (
        <p className="vsa-empty">
          {result.collectionEmpty ? PUBLIC_COLLECTION_EMPTY : catalogEmptyMessage(filters)}
        </p>
      ) : null}
      <section className="vsa-grid" aria-label="Prendas">
        {items.map((item) => {
          const articleUrl = publicArticleUrl(origin, storefront, item.id);
          const consult = guatemalaWhatsappUrl(guatemalaArticleWhatsappMessage({
            title: item.title,
            sku: item.sku,
            priceGtq: item.priceGtq,
            publicUrl: articleUrl,
          }));
          return (
            <article key={item.id} className="vsa-card">
              <Link className="vsa-card-link" href={product(item.id)}>
                <span className="vsa-photo">
                  {item.coverPhotoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/markets/guatemala/catalog/foto/${encodeURIComponent(item.coverPhotoId)}?w=480`} alt="" />
                  ) : <span>Sin foto</span>}
                  {item.availability === "vendido" ? <SoldTicket /> : null}
                </span>
                <span className="vsa-copy">
                  <span className="vsa-price">{formatStoredQuetzales(item.priceGtq)}</span>
                  <strong>{item.title || "Prenda sin título"}</strong>
                  <span>{item.size ? `Talla ${item.size}` : "Sin talla"}{item.brand ? ` · ${item.brand}` : ""}</span>
                  {item.availability === "vendido" ? <span className="vsa-sold-label">{item.soldBadge || PUBLIC_SOLD_BADGE}</span> : null}
                </span>
              </Link>
              <div className="vsa-card-action">
                <WhatsappLink href={consult}>{GUATEMALA_ARTICLE_WHATSAPP_LABEL}</WhatsappLink>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
