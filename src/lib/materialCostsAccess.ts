// Material Library access gate.
//
// The Material Library (Setup → Material Library) is System Admin only until
// wider release is confirmed. This is the ONE place that gate lives: it reuses
// the existing authoritative System Admin status (src/lib/systemAdmin) and adds
// no database role, no feature column and no RLS change.
//
// Work Task Materials are NOT gated here — the temporary System Admin
// restriction on viewing/editing task material lines was removed; anyone who
// can normally edit a Work Task can use Materials.
//
// To release the library later: make `useMaterialCostsEnabled` return
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
