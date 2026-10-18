import type { Metadata } from "next";
import "./tienda.css";

export const metadata: Metadata = {
  title: "Variedades San Andrés",
  description: "Prendas disponibles en Variedades San Andrés. Precios en quetzales.",
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <div className="vsa-page">{children}</div>;
}
