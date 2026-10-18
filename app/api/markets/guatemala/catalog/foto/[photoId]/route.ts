import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { GUATEMALA_CATALOG_MESSAGES } from "@/lib/markets/guatemala-catalog";
import { readPublicCatalogPhoto } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ photoId: string }> }
) {
  const limited = rateLimitRequest(request);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas. Espera un minuto." }, { status: 429 });
  }
  const { photoId } = await context.params;
  const width = request.nextUrl.searchParams.get("w") === "480" ? 480 : 960;
  try {
    const result = await readPublicCatalogPhoto(photoId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    const image = await presentPhoto(result.data, result.mediaType, width);
    return new NextResponse(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[guatemala/catalog] photo failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_CATALOG_MESSAGES.detailFailed }, { status: 500 });
  }
}

async function presentPhoto(data: string, mediaType: string, width: number): Promise<{ body: Buffer; type: string }> {
  const raw = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const bytes = Buffer.from(raw, "base64");
  const shrunk = await shrinkPhoto(bytes, width);
  return shrunk ? { body: shrunk, type: "image/jpeg" } : { body: bytes, type: mediaType };
}

async function shrinkPhoto(bytes: Buffer, width: number): Promise<Buffer | null> {
  try {
    const specifier = "sharp";
    const loaded = (await import(specifier)) as {
      default: (input: Buffer) => {
        rotate: () => {
          resize: (options: { width: number; withoutEnlargement: boolean }) => {
            jpeg: (options: { quality: number }) => { toBuffer: () => Promise<Buffer> };
          };
        };
      };
    };
    return await loaded.default(bytes).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  } catch {
    return null;
  }
}
