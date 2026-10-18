import { redirect } from "next/navigation";

export default async function GuatemalaCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const prenda = typeof params.prenda === "string" ? params.prenda : "";
  if (prenda) redirect(`/tienda/prenda/${encodeURIComponent(prenda)}`);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "prenda" && typeof value === "string" && value) search.set(key, value);
  }
  const suffix = search.toString();
  redirect(suffix ? `/tienda?${suffix}` : "/tienda");
}
