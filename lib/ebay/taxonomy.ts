// eBay Taxonomy API: resolve the correct LEAF category and its REQUIRED item
// specifics (aspects) with valid values — instead of guessing from a static map.
//
// This fixes the two publish failure modes:
//   • 25005 "not a leaf category" — the static map held parent categories
//     (e.g. womens_shoes → 3034 "Women's Shoes"); eBay only accepts leaves.
//   • 25002 "<aspect> is missing" — required specifics vary per leaf category
//     and SELECTION_ONLY aspects only accept values from eBay's own list
//     (e.g. Department must be "Unisex Adults", never "Unisex Adult").
//
// These endpoints are read-only, app-level data. We authenticate with a
// client-credentials app token (minted + cached here), independent of the
// seller's user token — so this never needs a re-auth or a new user scope.

import {
  EBAY_TAX_BASE,
  EBAY_META_BASE,
  EBAY_MARKETPLACE_ID,
  EBAY_CATEGORY_TREE_ID,
  EBAY_TOKEN_URL,
  basicAuthHeader,
  getEbayCreds,
} from "./config";

export type AspectMode = "FREE_TEXT" | "SELECTION_ONLY";
export type AspectUsage = "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
export type AspectCardinality = "SINGLE" | "MULTI";

// eBay ties some aspect values to other aspects. A Size of "4XL" is often
// valid only when Size Type is "Plus" or "Big & Tall", and error 21920468
// fires when the pair does not match the category's matrix.
export interface AspectValueDependency {
  value: string;
  appliesTo: { aspectName: string; values: string[] }[];
}

export interface AspectMeta {
  name: string;
  required: boolean;
  usage: AspectUsage;
  mode: AspectMode;
  // eBay allows one value or several for this aspect. Flattening a MULTI aspect
  // ("Cotton/Polyester") to its first value loses searchable data.
  cardinality: AspectCardinality;
  maxLength?: number;
  // eBay validates value FORMAT at publish time for typed aspects — a prose
  // value in a NUMBER aspect ("Fabric Weight" = "Heavyweight") hard-fails the
  // publish with 25002 ("Fabric weight must be greater than 0").
  dataType?: string; // e.g. "STRING" | "NUMBER" | "DATE"
  format?: string; // e.g. "int32" | "double"
  values: string[]; // eBay's allowed/suggested values (full list for SELECTION_ONLY)
  dependencies?: AspectValueDependency[];
}

export interface CategorySuggestion {
  id: string;
  name: string;
}

// ── App token (client-credentials), cached in the warm lambda ────────────────

// Item aspects require the application scope metadata.insights in addition to
// the public base scope. Both are client-credentials scopes, so the seller
// does not re-authorize. Category suggestions need only the base scope.
const EBAY_APP_SCOPE = "https://api.ebay.com/oauth/api_scope";
const EBAY_ASPECTS_SCOPE = "https://api.ebay.com/oauth/api_scope/metadata.insights";

let cachedToken: { token: string; expiresAt: number } | null = null;

function summarizeEbayError(body: string): string {
  try {
    const data = JSON.parse(body);
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    if (errors.length) {
      return errors
        .map((e: { errorId?: number; message?: string }) =>
          `${e?.errorId ?? "?"} ${e?.message ?? ""}`.trim()
        )
        .join("; ");
    }
    if (data?.error) return `${data.error}: ${data.error_description ?? ""}`.trim();
  } catch {
    /* token and taxonomy errors are JSON; keep a short raw snippet otherwise */
  }
  return body.replace(/\s+/g, " ").slice(0, 300);
}

async function requestAppToken(
  scope: string
): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number; body: string }> {
  const creds = getEbayCreds();
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(creds),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope,
    }).toString(),
  });
  const body = await resp.text();
  if (!resp.ok) return { ok: false, status: resp.status, body };
  const data = JSON.parse(body) as { access_token?: string; expires_in?: number };
  if (!data.access_token || !data.expires_in) {
    return { ok: false, status: resp.status, body };
  }
  return { ok: true, token: data.access_token, expiresIn: data.expires_in };
}

// Exported for other read-only eBay APIs that accept the same client-credentials
// scope (e.g. Browse-API comp searches).
export async function appToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  let result = await requestAppToken(`${EBAY_APP_SCOPE} ${EBAY_ASPECTS_SCOPE}`);
  if (!result.ok && /invalid_scope/i.test(result.body)) {
    console.warn(
      `[ebay/taxonomy] app token rejected metadata.insights (HTTP ${result.status}); retrying with the base scope only`
    );
    result = await requestAppToken(EBAY_APP_SCOPE);
  }
  if (!result.ok) {
    console.warn(
      `[ebay/taxonomy] app token failed (HTTP ${result.status}): ${summarizeEbayError(result.body)}`
    );
    throw new Error(`eBay app token failed (${result.status})`);
  }
  cachedToken = { token: result.token, expiresAt: now + result.expiresIn * 1000 };
  return result.token;
}

async function taxGet(path: string): Promise<any | null> {
  const token = await appToken();
  const operation = path.split("?")[0];
  const resp = await fetch(
    `${EBAY_TAX_BASE}/category_tree/${EBAY_CATEGORY_TREE_ID}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
      },
    }
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn(
      `[ebay/taxonomy] ${operation} failed (HTTP ${resp.status}): ${summarizeEbayError(body)}`
    );
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!data) {
    console.warn(`[ebay/taxonomy] ${operation} returned an unreadable body (HTTP ${resp.status})`);
  }
  return data;
}

// ── Public API ───────────────────────────────────────────────────────────────

// Resolve the best LEAF categories for a free-text query (title + hint), best
// match first. eBay only suggests leaf categories, so every hit is publish-safe.
// The runners-up double as *relevant* fallbacks if eBay rejects the first pick —
// far better than the old static list of unrelated collectible categories.
export async function suggestLeafCategories(
  query: string,
  limit = 3
): Promise<CategorySuggestion[]> {
  const q = (query || "").trim().slice(0, 350);
  if (!q) return [];
  try {
    const data = await taxGet(`get_category_suggestions?q=${encodeURIComponent(q)}`);
    const out: CategorySuggestion[] = [];
    for (const s of data?.categorySuggestions ?? []) {
      const id = s?.category?.categoryId;
      if (!id) continue;
      out.push({ id: String(id), name: String(s?.category?.categoryName ?? "") });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn(`[ebay/taxonomy] category suggestions failed: ${(e as Error).message}`);
    return [];
  }
}

export async function suggestLeafCategory(query: string): Promise<string | null> {
  const suggestions = await suggestLeafCategories(query, 1);
  return suggestions[0]?.id ?? null;
}

function parseAspectValues(rawValues: unknown): {
  values: string[];
  dependencies?: AspectValueDependency[];
} {
  const values: string[] = [];
  const dependencies: AspectValueDependency[] = [];
  for (const raw of (Array.isArray(rawValues) ? rawValues : []) as any[]) {
    const value = String(raw?.localizedValue ?? "").trim();
    if (!value) continue;
    values.push(value);
    const appliesTo: { aspectName: string; values: string[] }[] = [];
    for (const constraint of raw?.valueConstraints ?? []) {
      const aspectName = String(constraint?.applicableForLocalizedAspectName ?? "").trim();
      const allowed = (constraint?.applicableForLocalizedAspectValues ?? [])
        .map((v: unknown) => String(v ?? "").trim())
        .filter(Boolean);
      if (aspectName && allowed.length) appliesTo.push({ aspectName, values: allowed });
    }
    if (appliesTo.length) dependencies.push({ value, appliesTo });
  }
  return dependencies.length ? { values, dependencies } : { values };
}

const aspectCache = new Map<string, AspectMeta[]>();

// Required + optional aspects for a leaf category, with eBay's allowed values.
export async function categoryAspects(categoryId: string): Promise<AspectMeta[]> {
  if (!categoryId) return [];
  const cached = aspectCache.get(categoryId);
  if (cached) return cached;
  try {
    const data = await taxGet(
      `get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    );
    // A failed call returns null. Caching that as "no aspects" would stick for
    // the life of the process and keep publishing without a schema.
    if (!data) return [];
    const out: AspectMeta[] = [];
    for (const a of data?.aspects ?? []) {
      const con = a?.aspectConstraint ?? {};
      const name = String(a?.localizedAspectName ?? "").trim();
      if (!name) continue;
      const required = Boolean(con?.aspectRequired);
      const maxLen = Number(con?.aspectMaxLength);
      out.push({
        name,
        required,
        usage: required
          ? "REQUIRED"
          : con?.aspectUsage === "RECOMMENDED"
            ? "RECOMMENDED"
            : "OPTIONAL",
        mode: con?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
        cardinality:
          con?.itemToAspectCardinality === "MULTI" ? "MULTI" : "SINGLE",
        maxLength: Number.isFinite(maxLen) && maxLen > 0 ? maxLen : undefined,
        dataType: con?.aspectDataType ? String(con.aspectDataType) : undefined,
        format: con?.aspectFormat ? String(con.aspectFormat) : undefined,
        ...parseAspectValues(a?.aspectValues),
      });
    }
    aspectCache.set(categoryId, out);
    return out;
  } catch (e) {
    console.warn(
      `[ebay/taxonomy] item aspects failed for category ${categoryId}: ${(e as Error).message}`
    );
    return [];
  }
}

const condCache = new Map<string, Set<number>>();

// Numeric condition IDs eBay accepts for a leaf category (Sell Metadata API).
// Lets us pick a condition the category actually allows — fashion leaves reject
// the classic USED_VERY_GOOD/GOOD/ACCEPTABLE ids (4000/5000/6000), accepting
// only New variants plus 2990/3000/3010, which is the source of error 25021.
//
// Prefer the seller's user token when the caller has one: the client-credentials
// app token can be rejected by the Metadata API (scope), and a silent failure
// here is what made every apparel item publish as generic id 3000 — which eBay
// displays as "Pre-owned – Good" in clothing categories regardless of the item's
// real grade.
export async function acceptedConditionIds(
  categoryId: string,
  userToken?: string
): Promise<Set<number>> {
  if (!categoryId) return new Set();
  const cached = condCache.get(categoryId);
  if (cached) return cached;
  try {
    const token = userToken || (await appToken());
    const url =
      `${EBAY_META_BASE}/marketplace/${EBAY_MARKETPLACE_ID}` +
      `/get_item_condition_policies?filter=categoryIds:%7B${encodeURIComponent(categoryId)}%7D`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
      },
    });
    if (!resp.ok) {
      // Don't fail silently — this is exactly the path that mis-grades items.
      console.warn(
        `[ebay/taxonomy] condition policies unavailable for category ${categoryId} (HTTP ${resp.status})`
      );
      return new Set();
    }
    const data = await resp.json().catch(() => null);
    const ids = new Set<number>();
    for (const p of data?.itemConditionPolicies ?? [])
      for (const c of p?.itemConditions ?? []) {
        const n = Number(c?.conditionId);
        if (n) ids.add(n);
      }
    condCache.set(categoryId, ids);
    return ids;
  } catch (e) {
    console.warn(
      `[ebay/taxonomy] condition policies failed for category ${categoryId}: ${(e as Error).message}`
    );
    return new Set();
  }
}
