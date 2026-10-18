import Link from "next/link";
import { headers } from "next/headers";
import {
  catalogEmptyMessage,
  catalogPageSearch,
  catalogPhotoPath,
  parseCatalogFilters,
  PUBLIC_SOLD_BADGE,
  PUBLIC_SOLD_COUNT_LABEL,
  type CatalogAvailability,
} from "@/lib/markets/guatemala-catalog";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import { listPublicGuatemalaCatalog } from "@/lib/markets/guatemala-inventory-store";
import { isStoreHostname } from "@/lib/markets/store-host";
import { SoldTicket } from "./sold-ticket";

export const dynamic = "force-dynamic";

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseCatalogFilters(params);
  const storefront = isStoreHostname((await headers()).get("host"));
  const home = storefront ? "/" : "/tienda";
  const result = await listPublicGuatemalaCatalog(filters);
  const facets = result.ok ? result.facets : null;
  const items = result.ok ? result.items : [];

  return (
    <main className="vsa">
      <header className="vsa-top">
        <p className="vsa-mark" aria-hidden="true">VSA</p>
        <div>
          <h1>Variedades San Andrés</h1>
          <p>Precios en quetzales</p>
        </div>
      </header>
      <form className="vsa-filters" method="get" action={home}>
        <label>
          Buscar
          <input name="q" defaultValue={filters.q} placeholder="Título, marca o SKU" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label>
          Categoría
          <select name="categoria" defaultValue={filters.category}>
            <option value="">Todas</option>
            {(facets?.categories ?? []).map((category) => (
              <option key={category.key} value={category.key}>{category.label}</option>
            ))}
          </select>
        </label>
        <label>
          Talla
          <select name="talla" defaultValue={filters.size}>
            <option value="">Todas</option>
            {(facets?.sizes ?? []).map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <label>
          Marca
          <select name="marca" defaultValue={filters.brand}>
            <option value="">Todas</option>
            {(facets?.brands ?? []).map((brand) => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
        </label>
        <label>
          Precio mínimo
          <input name="min" inputMode="decimal" defaultValue={filters.minPrice ?? ""} placeholder="Q" />
        </label>
        <label>
          Precio máximo
          <input name="max" inputMode="decimal" defaultValue={filters.maxPrice ?? ""} placeholder="Q" />
        </label>
        {filters.availability !== "todos" ? <input type="hidden" name="estado" value={filters.availability} /> : null}
        <button type="submit">Aplicar</button>
      </form>
      <nav className="vsa-availability" aria-label="Disponibilidad">
        {(["todos", "disponibles", "vendidos"] as const).map((option) => (
          <Link
            key={option}
            href={availabilityHref(home, filters, option)}
            aria-current={filters.availability === option ? "page" : undefined}
          >
            {option === "todos" ? "Todos" : option === "disponibles" ? "Disponibles" : "Vendidos"}
          </Link>
        ))}
      </nav>
      {!result.ok ? <p className="vsa-note" role="alert">{result.error}</p> : null}
      {result.ok ? <p className="vsa-count">{PUBLIC_SOLD_COUNT_LABEL}: {result.soldCount}</p> : null}
      {result.ok && items.length === 0 ? <p className="vsa-note">{catalogEmptyMessage(filters)}</p> : null}
      <div className="vsa-grid">
        {items.map((item) => (
          <Link key={item.id} className={item.availability === "vendido" ? "vsa-card is-sold" : "vsa-card"} href={storefront ? `/prenda/${encodeURIComponent(item.id)}` : `/tienda/prenda/${encodeURIComponent(item.id)}`}>
            <span className="vsa-photo">
              {item.coverPhotoId ? (
                <img src={catalogPhotoPath(item.coverPhotoId, 480)} alt="" width={480} height={480} />
              ) : (
                <span className="vsa-photo-empty">Sin foto</span>
              )}
              {item.availability === "vendido" ? <SoldTicket /> : null}
            </span>
            <span className="vsa-copy">
              <strong>{item.title || "Prenda sin título"}</strong>
              {item.availability === "vendido" ? <span className="vsa-sold-label">{PUBLIC_SOLD_BADGE}</span> : null}
              {item.brand ? <span>{item.brand}</span> : null}
              <span>{item.size ? `Talla ${item.size}` : "Sin talla"}</span>
              <span className="vsa-price">{formatStoredQuetzales(item.priceGtq)}</span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function availabilityHref(home: string, filters: ReturnType<typeof parseCatalogFilters>, next: CatalogAvailability): string {
  const query = catalogPageSearch({ ...filters, availability: next });
  return query ? `${home}?${query}` : home;
}
