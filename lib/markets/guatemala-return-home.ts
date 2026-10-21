export type GuatemalaAdminRole = "propietario" | "encargado";

export const OWNER_ADMIN_HOME = "/";
export const STAFF_PANEL_HOME = "/guatemala/panel";

export const UNSAVED_LEAVE_PROMPT =
  "Hay datos sin guardar. Si regresas ahora, esos cambios se perderán. ¿Quieres salir de todos modos?";

export function guatemalaAdminHome(role: GuatemalaAdminRole): string {
  return role === "encargado" ? STAFF_PANEL_HOME : OWNER_ADMIN_HOME;
}

export function showStaffReturnHome(pathname: string): boolean {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return path.startsWith(`${STAFF_PANEL_HOME}/`);
}

export function leaveIsAllowed(input: { dirty: boolean; confirmed: boolean }): boolean {
  return !input.dirty || input.confirmed;
}
