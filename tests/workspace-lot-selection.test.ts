import { describe, expect, test } from "vitest";
import {
  applySelectAll,
  assignedGarmentsNote,
  canAssignSelectedToLot,
  clearSelectionAfterAssign,
  garmentsToAssign,
  selectAllChecked,
  selectAllIndeterminate,
  selectedGarmentsLabel,
  toggleWorkspaceGarment,
} from "@/lib/usa-lots/workspace-selection";

const workspace15 = Array.from({ length: 15 }, (_, index) => `work-${index + 1}`);
const workspace10 = workspace15.slice(0, 10);
const archived = ["archive-1", "archive-2"];
const otherScreens = ["vinted-1", "guatemala-1"];

describe("USA lot selection in the listings work area", () => {
  test("select all marks every garment in the current work area and nothing else", () => {
    for (const workspace of [workspace10, workspace15]) {
      const selected = applySelectAll(workspace, true);
      expect(selected).toEqual(workspace);
      expect(selected).toHaveLength(workspace.length);
      expect(selected.some((id) => archived.includes(id) || otherScreens.includes(id))).toBe(false);
      expect(selectAllChecked(selected, workspace)).toBe(true);
      expect(selectAllIndeterminate(selected, workspace)).toBe(false);
      expect(selectedGarmentsLabel(selected.length)).toBe(`${workspace.length} prendas seleccionadas`);
    }
  });

  test("unchecking select all clears the selection", () => {
    const selected = applySelectAll(applySelectAll(workspace15, true), false);
    expect(selected).toEqual([]);
    expect(selectAllChecked(selected, workspace15)).toBe(false);
    expect(selectedGarmentsLabel(selected.length)).toBe("0 prendas seleccionadas");
    expect(canAssignSelectedToLot("lot-usa", selected.length)).toBe(false);
  });

  test("unchecking one garment leaves the rest ready to assign", () => {
    let selected = applySelectAll(workspace15, true);
    selected = toggleWorkspaceGarment(selected, "work-4", workspace15);

    expect(selected).toHaveLength(14);
    expect(selected).not.toContain("work-4");
    expect(selected.some((id) => archived.includes(id) || otherScreens.includes(id))).toBe(false);
    expect(selectAllChecked(selected, workspace15)).toBe(false);
    expect(selectAllIndeterminate(selected, workspace15)).toBe(true);
    expect(selectedGarmentsLabel(selected.length)).toBe("14 prendas seleccionadas");
    expect(canAssignSelectedToLot("", selected.length)).toBe(false);
    expect(canAssignSelectedToLot("lot-usa", 0)).toBe(false);
    expect(canAssignSelectedToLot("lot-usa", selected.length)).toBe(true);

    const assignedIds = garmentsToAssign(selected, workspace15);
    expect(assignedIds).toEqual(selected);
    expect(assignedIds).not.toContain("work-4");

    const afterAssign = clearSelectionAfterAssign();
    expect(afterAssign).toEqual([]);
    expect(selectAllChecked(afterAssign, workspace15)).toBe(false);
    expect(assignedGarmentsNote(assignedIds.length)).toBe(
      "14 prendas se asignaron al lote. Publicar guarda el número del anuncio; quitarlas del área de trabajo no borra ese vínculo.",
    );
  });

  test("drops archived and other-screen ids that are not in the work area", () => {
    const mixed = ["work-1", ...archived, ...otherScreens];
    expect(garmentsToAssign(mixed, workspace15)).toEqual(["work-1"]);
    expect(toggleWorkspaceGarment(mixed, "work-2", workspace15)).toEqual(["work-1", "work-2"]);
    expect(toggleWorkspaceGarment(mixed, "archive-1", workspace15)).toEqual(["work-1"]);
  });

  test("uses the singular label for one garment", () => {
    const selected = toggleWorkspaceGarment([], "work-1", workspace10);
    expect(selectedGarmentsLabel(selected.length)).toBe("1 prenda seleccionada");
    expect(assignedGarmentsNote(1)).toBe(
      "1 prenda se asignó al lote. Publicar guarda el número del anuncio; quitarla del área de trabajo no borra ese vínculo.",
    );
  });
});
