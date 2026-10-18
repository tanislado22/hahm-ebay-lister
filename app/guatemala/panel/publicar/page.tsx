import type { Metadata } from "next";
import { PublishScreen } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Publicar artículo · Tienda Guatemala",
};

export default function PublishPage() {
  return <PublishScreen />;
}
