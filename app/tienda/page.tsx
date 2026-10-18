import Link from "next/link";
import { headers } from "next/headers";
import { catalogEmptyMessage, catalogPhotoPath, parseCatalogFilters } from "@/lib/markets/guatemala-catalog";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import { listPublicGuatemalaCatalog } from "@/lib/markets/guatemala-inventory-store";
import { isStoreHostname } from "@/lib/markets/store-host";

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
          <p>Prendas disponibles · precios en quetzales</p>
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
        <button type="submit">Aplicar</button>
      </form>
      {!result.ok ? <p className="vsa-note" role="alert">{result.error}</p> : null}
      {result.ok ? (
        <p className="vsa-count">
          {items.length === 1 ? "1 prenda disponible" : `${items.length} prendas disponibles`}
        </p>
      ) : null}
      {result.ok && items.length === 0 ? <p className="vsa-note">{catalogEmptyMessage(filters)}</p> : null}
      <div className="vsa-grid">
        {items.map((item) => (
          <Link key={item.id} className="vsa-card" href={storefront ? `/prenda/${encodeURIComponent(item.id)}` : `/tienda/prenda/${encodeURIComponent(item.id)}`}>
            <span className="vsa-photo">
              {item.coverPhotoId ? (
                <img src={catalogPhotoPath(item.coverPhotoId, 480)} alt="" width={480} height={480} />
              ) : (
                <span className="vsa-photo-empty">Sin foto</span>
              )}
            </span>
            <span className="vsa-copy">
              <strong>{item.title || "Prenda sin título"}</strong>
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
