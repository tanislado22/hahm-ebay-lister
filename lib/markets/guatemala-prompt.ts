import { normalizeItemProfile } from "@/lib/prompts";

const GUATEMALA_CLOTHING_ADDON = `

PRENDA DE ROPA
Lee cada etiqueta y cada foto de medidas.
Conserva la marca exactamente como está escrita.
Si hay una etiqueta de talla, copia la talla tal como está impresa, incluso si dice 0XL. No la conviertas a otra talla.
Si no hay etiqueta de talla, pero las medidas se ven con claridad, escribe la talla aproximada solo en el campo size y explica en la descripción: "Talla aproximada según las medidas; no se ve etiqueta de talla."
Si no alcanza la información, deja size vacío.
La condición predeterminada es usada. Usa NEW_WITH_TAGS solo si se ve la etiqueta original de la tienda. Usa NEW_NO_TAGS solo si hay evidencia clara de que la prenda está nueva y sin uso.
Incluye en la descripción todas las medidas visibles, con su nombre y su valor.`;

export const GUATEMALA_ANALYSIS_PROMPT = `Eres especialista en catalogar ropa para una tienda en Guatemala.

Analiza TODAS las fotos de una sola prenda.
Escribe el título y la descripción en español de Guatemala, con frases claras para un comprador.
No uses inglés en el título ni en la descripción, salvo el nombre de la marca tal como aparece en la etiqueta.

No inventes marca, talla, material ni medidas. Si un dato no se ve, déjalo vacío.
No incluyas un precio. No estimes un precio por el aspecto de la prenda. No conviertas precios de otros países. El campo suggested_price debe ser 0.

Devuelve ÚNICAMENTE JSON válido, sin markdown y sin explicación:
{
  "title": "Título claro en español, con marca, tipo de prenda, color y talla cuando se vean. Máximo 120 caracteres.",
  "category": "La opción más cercana: womens_top, womens_dress, womens_skirt, womens_pants, womens_coat, womens_sweater, womens_jeans, womens_clothing, womens_shoes, handbag, wallet, mens_top, mens_pants, mens_coat, mens_sweater, mens_jeans, mens_clothing, mens_shoes, jewelry, scarf, belt, sunglasses, hat, accessory, other",
  "category_hint": "Frase corta en español para identificar la prenda",
  "category_id": "",
  "brand": "Marca exacta de la etiqueta. Usa 'Sin marca' solo si de verdad no tiene marca.",
  "item_type": "Tipo de prenda en español",
  "color": ["Color principal"],
  "size": "Talla exacta de la etiqueta, o talla aproximada si no hay etiqueta y las medidas alcanzan. Vacío si no se puede saber.",
  "size_estimated": false,
  "material": "Composición de la etiqueta, o vacío si no se ve.",
  "condition": "Una de: NEW_WITH_TAGS, NEW_NO_TAGS, EXCELLENT, VERY_GOOD, GOOD, FAIR",
  "condition_notes": "Dos o tres frases honestas, en español, sobre el estado.",
  "measurements": "Medidas visibles, con su nombre. Vacío si no hay.",
  "description": "Descripción en español, en texto plano. Incluye lo que se ve: tipo, color, marca, talla, material, medidas y estado. No incluyas un precio.",
  "suggested_price": 0,
  "seo_keywords": ["frases en español que usaría un comprador"],
  "key_features": ["hasta 5 rasgos visibles"],
  "item_specifics": {}
}`;

export function buildGuatemalaAnalysisPrompt(profile: string): string {
  const normalized = normalizeItemProfile(profile);
  const addon = normalized === "clothing" ? GUATEMALA_CLOTHING_ADDON : "";
  return GUATEMALA_ANALYSIS_PROMPT + addon;
}
