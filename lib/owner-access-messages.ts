export function ownerAccessMessage(status: number, code: unknown): string {
  if (status === 429) return "Demasiados intentos. Espera un minuto y vuelve a entrar.";
  if (status === 503 || code === "UNCONFIGURED") {
    return "Este despliegue no tiene acceso de propietario configurado.";
  }
  if (code === "SESSION_EXPIRED") return "La sesión del propietario venció. Vuelve a entrar.";
  if (code === "ACCESS_CODE_REJECTED") return "Ese código no corresponde al acceso del propietario.";
  if (code === "ACCESS_CODE_REQUIRED") return "Hace falta el acceso del propietario.";
  return "No se pudo comprobar el acceso del propietario.";
}

export function isOwnerAccessFailure(status: number, code: unknown): boolean {
  return (
    code === "ACCESS_CODE_REQUIRED" ||
    code === "ACCESS_CODE_REJECTED" ||
    code === "SESSION_EXPIRED" ||
    code === "UNCONFIGURED" ||
    status === 503
  );
}
