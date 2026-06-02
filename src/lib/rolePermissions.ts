// Centralised page-level role permission matrix for the portal.
//
// Membership visibility (vineyard dropdown) is intentionally separate:
// every active membership — owner, manager, supervisor, operator — is
// shown in the selector. Once a vineyard is selected, the user's role
// for that vineyard gates which pages and actions they can use.

export type Role = "owner" | "manager" | "supervisor" | "operator";

export const ALL_ROLES: Role[] = ["owner", "manager", "supervisor", "operator"];
export const ADMIN_ROLES: Role[] = ["owner", "manager"];
export const FIELD_ROLES: Role[] = ["owner", "manager", "supervisor"];

// Routes restricted to a subset of roles. Anything not listed is open to
// all roles (per-page write actions still apply locally).
const ROUTE_ALLOW: Record<string, Role[]> = {
  // Owner/manager only — financials, team, admin setup
  "/reports/costs": ADMIN_ROLES,
  "/team": ADMIN_ROLES,
  "/billing": ["owner"],
  "/setup/vineyard": ADMIN_ROLES,
  "/setup/spray-equipment": ADMIN_ROLES,
  "/setup/equipment-other": ADMIN_ROLES,
  "/setup/chemicals": ADMIN_ROLES,
  "/setup/saved-inputs": ADMIN_ROLES,
  "/setup/weather": ADMIN_ROLES,
  "/setup/tractors": ADMIN_ROLES,
  "/settings/data-coverage": ADMIN_ROLES,

  // Owner/manager/supervisor — operational records and templates
  "/spray-jobs": FIELD_ROLES,
  "/spray-records": FIELD_ROLES,
  "/reports/spray": FIELD_ROLES,
  "/reports/documents": FIELD_ROLES,
  "/yield": FIELD_ROLES,
  "/setup/operator-categories": FIELD_ROLES,
};

export function getAllowedRoles(path: string): Role[] | null {
  // Exact match first, then prefix match for nested routes.
  if (ROUTE_ALLOW[path]) return ROUTE_ALLOW[path];
  for (const key of Object.keys(ROUTE_ALLOW)) {
    if (path.startsWith(key + "/")) return ROUTE_ALLOW[key];
  }
  return null;
}

export function canAccessRoute(path: string, role: string | null | undefined): boolean {
  const allowed = getAllowedRoles(path);
  if (!allowed) return true;
  return !!role && (allowed as string[]).includes(role);
}
