import { secretEqual } from "@/lib/secret";

export function cronAuthorized(authorization: string | null, alternate: string | null, secret: string): boolean {
  if (!secret) return false;
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  return secretEqual(bearer, secret) || secretEqual(alternate ?? "", secret);
}
