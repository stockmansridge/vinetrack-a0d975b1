// Role-based gating for cost/pricing visibility.
//
// Per costing rules: only owners and managers may see pricing or cost data
// (operator category cost/hour, labour rates, fuel cost, chemical cost,
// trip cost summaries, cost columns in exports, etc.).
//
// Supervisors and operators must never see those fields.

import { useVineyard } from "@/context/VineyardContext";

export type AppRole = "owner" | "manager" | "supervisor" | "operator" | string | null | undefined;

const COST_ROLES = new Set(["owner", "manager"]);

export function canSeeCosts(role: AppRole): boolean {
  return !!role && COST_ROLES.has(role);
}

/** Hook: true when the current user is owner or manager of the selected vineyard. */
export function useCanSeeCosts(): boolean {
  const { currentRole } = useVineyard();
  return canSeeCosts(currentRole);
}
