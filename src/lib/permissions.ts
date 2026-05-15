type Role = "admin" | "finance" | "employee";

const ACCESS_MAP: Record<string, Role[]> = {
  "/dashboard": ["admin", "finance", "employee"],
  "/claims/receipts": ["admin", "finance"],
  "/claims/statements": ["admin", "finance", "employee"],
  "/admin/users": ["admin"],
  "/admin/entities": ["admin"],
};

export function canAccess(role: Role, route: string): boolean {
  const allowed = ACCESS_MAP[route];
  if (!allowed) return false;
  return allowed.includes(role);
}
