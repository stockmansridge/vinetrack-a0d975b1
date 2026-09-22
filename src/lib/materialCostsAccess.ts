// TEMPORARY Material Costs access gate (Phase 3).
//
// Material Costs is System Admin only until wider release is confirmed. This is
// the ONE place the gate lives: it reuses the existing authoritative System
// Admin status (src/lib/systemAdmin) and adds no database role, no feature
// column and no RLS change.
//
// To release the feature later: make `useMaterialCostsEnabled` return
// `{ enabled: true, loading: false }` (or delete it and its call sites'
// conditionals). No backend or database change is required.
import { useIsSystemAdmin } from "@/lib/systemAdmin";

export interface MaterialCostsAccess {
  enabled: boolean;
  loading: boolean;
}

export function useMaterialCostsEnabled(): MaterialCostsAccess {
  const { isAdmin, loading } = useIsSystemAdmin();
  return { enabled: !!isAdmin, loading: !!loading };
}

/** Pure form of the same rule, for navigation config and tests. */
export function materialCostsVisible(viewer: { isSystemAdmin?: boolean }): boolean {
  return !!viewer?.isSystemAdmin;
}
