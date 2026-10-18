import type Anthropic from "@anthropic-ai/sdk";
import { getClient, parseModelJson, AnthropicAuthError, anthropicAuthError } from "@/lib/anthropic";
import {
  PROFILE_ROUTER_PROMPT,
  buildProfiledAnalysisPrompt,
  normalizeItemProfile,
} from "@/lib/prompts";
import { toImageBlock, type ImageBlock } from "@/lib/images";
import { optimizeTitle } from "@/lib/titleOptimizer";
import { applyPriceMarkup, priceMarkupPercent } from "@/lib/pricing";
import { resolveModel } from "@/lib/models";
import { isGuatemalaMarket, prepareGuatemalaListing } from "@/lib/markets/guatemala";
import { buildGuatemalaAnalysisPrompt } from "@/lib/markets/guatemala-prompt";
import type { AnalyzeRequestBody, ListingResult } from "@/lib/types";

const ANALYSIS_MODEL = "claude-opus-4-8";
const ROUTER_MODEL = "claude-sonnet-4-6";
const MAX_IMAGES = 12;
const ANALYZE_TIME_BUDGET_MS = 250_000;
const ROUTER_TIMEOUT_MS = 20_000;
const ANALYSIS_CALL_TIMEOUT_MS = 120_000;
const MIN_CALL_MS = 5_000;

export type AnalyzeListingResult =
  | { ok: true; listing: ListingResult }
  | { ok: false; status: number; error: string };

function toImageBlocks(images: AnalyzeRequestBody["images"]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const block = toImageBlock(img);
    if (block) blocks.push(block);
  }
  return blocks;
}

async function routeProfile(
  client: Anthropic,
  imageBlocks: ImageBlock[],
  requested: string,
  routerModel: string,
  deadline: number
): Promise<string> {
  const forced = normalizeItemProfile(requested);
  if (forced !== "auto") return forced;
  const remaining = deadline - Date.now();
  if (remaining < MIN_CALL_MS) return "hard_goods";
  try {
    const resp = await client.messages.create(
      {
        model: routerModel,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [...imageBlocks, { type: "text", text: PROFILE_ROUTER_PROMPT }],
          },
        ],
      },
      { timeout: Math.min(ROUTER_TIMEOUT_MS, remaining), maxRetries: 0 }
    );
    const text = firstText(resp);
    const data = parseModelJson<{ profile?: string }>(text);
    const routed = normalizeItemProfile(data?.profile ?? "auto");
    return routed !== "auto" ? routed : "hard_goods";
  } catch (e) {
    const fatal = anthropicAuthError(e);
    if (fatal) throw fatal;
    return "hard_goods";
  }
}

function firstText(resp: Anthropic.Message): string {
  const block = resp.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

export async function analyzeListing(body: AnalyzeRequestBody): Promise<AnalyzeListingResult> {
  const analysisModel = resolveModel(body.analysisModel, ANALYSIS_MODEL);
  const routerModel = resolveModel(body.routerModel, ROUTER_MODEL);
  const spanish = isGuatemalaMarket(body.market);
  if (!Array.isArray(body.images) || body.images.length === 0) {
    return {
      ok: false,
      status: 400,
      error: spanish ? "Agrega al menos una foto." : "Please add at least one photo.",
    };
  }
  const imageBlocks = toImageBlocks(body.images);
  if (imageBlocks.length === 0) {
    return {
      ok: false,
      status: 400,
      error: spanish
        ? "No se pudieron leer las fotos. Usa JPG, PNG o WebP."
        : "No readable photos found. Use JPG, PNG, or WebP.",
    };
  }
  let client: Anthropic;
  try {
    client = getClient();
  } catch (e) {
    return { ok: false, status: 500, error: (e as Error).message };
  }
  try {
    const deadline = Date.now() + ANALYZE_TIME_BUDGET_MS;
    const profile = await routeProfile(client, imageBlocks, body.profile, routerModel, deadline);
    const guatemala = isGuatemalaMarket(body.market);
    const systemPrompt = guatemala
      ? buildGuatemalaAnalysisPrompt(profile)
      : buildProfiledAnalysisPrompt(profile);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) {
        lastErr = lastErr ?? new Error("Analysis ran out of time — the API is slow right now.");
        break;
      }
      try {
        const resp = await client.messages.create(
          {
            model: analysisModel,
            max_tokens: 3000,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            messages: [
              {
                role: "user",
                content: [
                  ...imageBlocks,
                  {
                    type: "text",
                    text: guatemala
                      ? "Analiza estas fotos y devuelve el JSON ahora. El título y la descripción van en español. No incluyas un precio."
                      : "Analyze these photos and return the listing JSON now.",
                  },
                ],
              },
            ],
          },
          { timeout: Math.min(ANALYSIS_CALL_TIMEOUT_MS, remaining), maxRetries: 0 }
        );
        const listing = parseModelJson<ListingResult>(firstText(resp));
        listing.item_profile = profile;
        if (guatemala) return { ok: true, listing: prepareGuatemalaListing(listing) };
        listing.title = optimizeTitle(listing);
        listing.suggested_price = applyPriceMarkup(listing.suggested_price, priceMarkupPercent());
        return { ok: true, listing };
      } catch (err) {
        const fatal = anthropicAuthError(err);
        if (fatal) throw fatal;
        lastErr = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  } catch (e) {
    if (e instanceof AnthropicAuthError) {
      console.error("[analyze] auth/billing failure:", e.message);
      return { ok: false, status: e.status, error: e.message };
    }
    console.error("[analyze]", e);
    return {
      ok: false,
      status: 500,
      error: isGuatemalaMarket(body.market)
        ? "No se pudieron preparar las fotos. Inténtalo de nuevo."
        : "Something went wrong analyzing photos — please try again.",
    };
  }
}
