"use client";

/**
 * Client-side fetch wrapper for the API routes.
 *
 * A valid owner session cookie authorizes the request. When this browser
 * already saved the owner code, it is sent in `x-app-secret` as well.
 * A 401 stays a 401: the sign-in form asks once, and this module does not
 * open a dialog or retry.
 */

import { REJECTED_OWNER_CODE } from "@/lib/owner-code";

const STORAGE_KEY = "listing-writer:access-code";

function storedCode(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    if (!value || value === REJECTED_OWNER_CODE) return null;
    return value;
  } catch {
    return null;
  }
}

function saveCode(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private browsing — code just won't persist */
  }
}

export function readAccessCode(): string | null {
  return storedCode();
}

export function rememberAccessCode(code: string): void {
  const trimmed = code.trim();
  if (!trimmed || trimmed === REJECTED_OWNER_CODE) return;
  saveCode(trimmed);
}

export function accessHeaders(): Record<string, string> {
  const code = storedCode();
  return code ? { "x-app-secret": code } : {};
}

/** Only the access-code challenge may ask for the owner code. Other 401s stay as-is. */
export function isAccessCodeChallenge(status: number, code: unknown): boolean {
  return status === 401 && code === "ACCESS_CODE_REQUIRED";
}

export function clearAccessCode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export async function apiGet(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const code = storedCode();
  if (code) headers["x-app-secret"] = code;
  return fetch(path, { method: "GET", headers, cache: "no-store" });
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const code = storedCode();
  if (code) headers["x-app-secret"] = code;
  return fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
}
