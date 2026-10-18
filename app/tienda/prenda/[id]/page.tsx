import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { PUBLIC_SOLD_NOTICE } from "@/lib/markets/guatemala-catalog";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import { readPublicGuatemalaCatalogItem } from "@/lib/markets/guatemala-inventory-store";
import { isStoreHostname } from "@/lib/markets/store-host";
import { PhotoGallery } from "../../gallery";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await readPublicGuatemalaCatalogItem(id);
  if (!result.ok) return { title: "Prenda · Variedades San Andrés" };
  const name = result.item.title || result.item.sku;
  return {
    title: `${name} · Variedades San Andrés`,
    description:
      result.item.availability === "vendido"
        ? `${name}. ${PUBLIC_SOLD_NOTICE}`
        : result.item.description.slice(0, 160) || `${name} disponible en Variedades San Andrés.`,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storefront = isStoreHostname((await headers()).get("host"));
  const home = storefront ? "/" : "/tienda";
  const result = await readPublicGuatemalaCatalogItem(id);
  const item = result.ok ? result.item : null;

  return (
    <main className="vsa">
      <header className="vsa-top">
        <p className="vsa-mark" aria-hidden="true">VSA</p>
        <div>
          <h1>Variedades San Andrés</h1>
          <p>Precios en quetzales</p>
        </div>
      </header>
      <p>
        <Link className="vsa-back" href={home}>Volver al catálogo</Link>
      </p>
      {!result.ok ? <p className="vsa-note" role="alert">{result.error}</p> : null}
      {item ? (
        <article className="vsa-detail">
          <PhotoGallery ids={item.photoIds} alt={item.title || item.sku} sold={item.availability === "vendido"} />
          <div>
            {item.availability === "vendido" ? <p className="vsa-sold-notice" role="status">{item.soldNotice || PUBLIC_SOLD_NOTICE}</p> : null}
            <h2>{item.title || "Prenda sin título"}</h2>
            <p className="vsa-price">{formatStoredQuetzales(item.priceGtq)}</p>
            {item.brand ? <p>Marca: {item.brand}</p> : null}
            <p>{item.size ? `Talla ${item.size}` : "Sin talla"}</p>
            {item.conditionLabel ? <p>Condición: {item.conditionLabel}</p> : null}
            {item.categoryLabel ? <p>Categoría: {item.categoryLabel}</p> : null}
            <p>SKU {item.sku}</p>
            {item.description ? <p className="vsa-description">{item.description}</p> : null}
          </div>
        </article>
      ) : null}
    </main>
  );
}
