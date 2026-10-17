"use client";

import { accessHeaders, apiGet, apiPost } from "@/lib/api-client";

export async function guatemalaRequest(
  path: string,
  body?: unknown,
  options?: { actor?: "encargado" }
): Promise<Response> {
  const staffPanel = options?.actor === "encargado";
  const headers: Record<string, string> = staffPanel
    ? { "x-guatemala-actor": "encargado" }
    : { ...accessHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  // The staff panel must not retry with the owner's access code.
  if (staffPanel || response.status !== 401) return response;
  const payload = (await response.clone().json().catch(() => null)) as { code?: string } | null;
  if (payload?.code === "STAFF_SESSION_ENDED") return response;
  return body === undefined ? apiGet(path) : apiPost(path, body);
}
