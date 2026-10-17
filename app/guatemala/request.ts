"use client";

import { accessHeaders, apiGet, apiPost } from "@/lib/api-client";

export async function guatemalaRequest(path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { ...accessHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status !== 401) return response;
  const payload = (await response.clone().json().catch(() => null)) as { code?: string } | null;
  if (payload?.code === "STAFF_SESSION_ENDED") return response;
  return body === undefined ? apiGet(path) : apiPost(path, body);
}
