export interface ListScrollHold {
  id: string;
  nextId: string;
  scrollTop: number;
}

export function listScrollHold(ids: string[], actedId: string, scrollTop: number): ListScrollHold {
  const index = ids.indexOf(actedId);
  return {
    id: actedId,
    nextId: index >= 0 ? ids[index + 1] || "" : "",
    scrollTop,
  };
}

export function anchorElementId(vintedItemId: string): string {
  return `vinted-card-${vintedItemId}`;
}

export function keepWorkingOrder<T extends { vintedItemId: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((item) => [item.vintedItemId, item]));
  const kept: T[] = [];
  const seen = new Set<string>();
  for (const item of previous) {
    const next = byId.get(item.vintedItemId);
    if (!next) continue;
    kept.push(next);
    seen.add(item.vintedItemId);
  }
  for (const item of incoming) {
    if (seen.has(item.vintedItemId)) continue;
    kept.push(item);
  }
  return kept;
}

export function readDocumentScroll(): number {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

export function writeDocumentScroll(top: number): void {
  window.scrollTo(0, top);
  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
}
