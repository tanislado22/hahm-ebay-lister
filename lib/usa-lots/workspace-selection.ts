// Selection for the USA lot control on Your listings.
// Callers pass only the garments currently in that work area.
// Archived articles and items from other screens stay out because they are not in this list.

export function garmentsToAssign(selectedIds: readonly string[], workspaceIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return workspaceIds.filter((id) => selected.has(id));
}

export function applySelectAll(workspaceIds: readonly string[], checked: boolean): string[] {
  return checked ? [...workspaceIds] : [];
}

export function toggleWorkspaceGarment(
  selectedIds: readonly string[],
  garmentId: string,
  workspaceIds: readonly string[],
): string[] {
  const current = new Set(garmentsToAssign(selectedIds, workspaceIds));
  if (!workspaceIds.includes(garmentId)) return workspaceIds.filter((id) => current.has(id));
  if (current.has(garmentId)) current.delete(garmentId);
  else current.add(garmentId);
  return workspaceIds.filter((id) => current.has(id));
}

export function selectAllChecked(selectedIds: readonly string[], workspaceIds: readonly string[]): boolean {
  return workspaceIds.length > 0 && garmentsToAssign(selectedIds, workspaceIds).length === workspaceIds.length;
}

export function selectAllIndeterminate(selectedIds: readonly string[], workspaceIds: readonly string[]): boolean {
  const count = garmentsToAssign(selectedIds, workspaceIds).length;
  return count > 0 && count < workspaceIds.length;
}

export function canAssignSelectedToLot(lotId: string, selectedCount: number): boolean {
  return lotId.trim().length > 0 && selectedCount > 0;
}

export function clearSelectionAfterAssign(): string[] {
  return [];
}

export function selectedGarmentsLabel(count: number): string {
  return count === 1 ? "1 prenda seleccionada" : `${count} prendas seleccionadas`;
}

export function assignedGarmentsNote(assigned: number): string {
  const count = Math.max(0, assigned);
  if (count === 1) {
    return "1 prenda se asignó al lote. Publicar guarda el número del anuncio; quitarla del área de trabajo no borra ese vínculo.";
  }
  return `${count} prendas se asignaron al lote. Publicar guarda el número del anuncio; quitarlas del área de trabajo no borra ese vínculo.`;
}
