export interface ListScrollAnchor {
  id: string;
  nextId: string;
  top: number;
}

export function listScrollAnchor(ids: string[], actedId: string, top: number): ListScrollAnchor {
  const index = ids.indexOf(actedId);
  return {
    id: actedId,
    nextId: index >= 0 ? ids[index + 1] || "" : "",
    top,
  };
}

export function anchorElementId(vintedItemId: string): string {
  return `vinted-card-${vintedItemId}`;
}

export function scrollDelta(currentTop: number, previousTop: number): number {
  return currentTop - previousTop;
}
