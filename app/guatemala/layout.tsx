import type { Metadata, Viewport } from "next";
import { StaffAppShell } from "./pwa/shell";
import "./pwa/pwa.css";

export const metadata: Metadata = {
  applicationName: "Variedades San Andrés",
  manifest: "/guatemala/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Variedades San Andrés",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "/guatemala/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f6e56",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function GuatemalaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StaffAppShell />
      {children}
    </>
  );
}
