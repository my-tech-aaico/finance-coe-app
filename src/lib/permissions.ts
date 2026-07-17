// Central role type — import this everywhere instead of re-declaring the union.
// Values must match the `role` pg enum in src/db/schema/auth.ts.
export type Role = "admin" | "finance" | "credit_card_holder" | "employee";

const ACCESS_MAP: Record<string, Role[]> = {
  "/dashboard": ["admin", "finance", "credit_card_holder", "employee"],
  "/claims/receipts": ["admin", "finance", "credit_card_holder", "employee"],
  "/claims/statements": ["admin", "finance", "credit_card_holder"],
  "/admin/users": ["admin"],
  "/admin/entities": ["admin"],
  "/admin/project-code": ["admin", "finance"],
  "/admin/departments": ["admin"],
  "/admin/classes": ["admin", "finance"],
};

export function canAccess(role: Role, route: string): boolean {
  const allowed = ACCESS_MAP[route];
  if (!allowed) return false;
  return allowed.includes(role);
}
