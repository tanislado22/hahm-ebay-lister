import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { isStoreHostname } from "@/lib/markets/store-host";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listing Writer — turn photos into eBay listings",
  description:
    "Upload your item photos and get a ready-to-post eBay listing in seconds.",
};

export async function generateViewport(): Promise<Viewport> {
  const host = (await headers()).get("host");
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: isStoreHostname(host) ? "#0f6e56" : "#1d6b5f",
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = (await headers()).get("host");
  return (
    <html lang={isStoreHostname(host) ? "es" : "en"}>
      <body>{children}</body>
    </html>
  );
}
