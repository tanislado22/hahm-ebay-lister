import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getArchivePhoto } from "@/lib/archive/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ photoId: string }> }) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const { photoId } = await context.params;
  try {
    const photo = await getArchivePhoto(photoId);
    if (!photo) return NextResponse.json({ ok: false, error: "No está esa foto." }, { status: 404 });
    if ("redirect" in photo) return NextResponse.redirect(photo.redirect, 302);
    const thumb = req.nextUrl.searchParams.get("size") === "thumb";
    if (thumb && photo.thumb) {
      return new NextResponse(new Uint8Array(photo.thumb), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
      });
    }
    if (thumb && photo.bytes.length) {
      try {
        const sharp = (await import("sharp")).default;
        const small = await sharp(photo.bytes).rotate().resize(160, 160, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
        return new NextResponse(new Uint8Array(small), {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
        });
      } catch {
        /* fall through to the stored file */
      }
    }
    return new NextResponse(new Uint8Array(photo.bytes), {
      headers: { "Content-Type": photo.mediaType || "image/jpeg", "Cache-Control": "private, max-age=86400" },
    });
  } catch (error) {
    console.error("[archivo] photo", error);
    return NextResponse.json({ ok: false, error: "No se pudo cargar la foto." }, { status: 500 });
  }
}
