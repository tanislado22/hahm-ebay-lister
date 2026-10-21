"use client";

import { usePathname } from "next/navigation";
import { showStaffReturnHome } from "@/lib/markets/guatemala-return-home";
import { ReturnHomeBar } from "../return-home";

export function StaffReturnHome() {
  const pathname = usePathname();
  if (!showStaffReturnHome(pathname || "")) return null;
  return <ReturnHomeBar role="encargado" />;
}
