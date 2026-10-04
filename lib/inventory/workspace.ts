export function workspaceKey(
  workMode: string | null | undefined,
  clientId?: string | null
): string | null {
  if (workMode === "store") return "store";
  const id = clientId?.trim();
  if (workMode === "client" && id) return `client:${id}`;
  return null;
}
