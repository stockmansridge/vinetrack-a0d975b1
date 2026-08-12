// Stage 8 — canonical external write scopes.
//
// These five scopes are the ONLY write scopes the VineTrack public API
// accepts. The list is asserted against the canonical OpenAPI spec in
// src/test/stage8WriteScopes.test.ts (drift protection) — never widen it with
// a generic `:write` check.
export const ACTIVE_WRITE_SCOPE_LIST = [
  "work_tasks:write",
  "fuel:write",
  "irrigation:write",
  "growth_stages:write",
  "yield:write",
] as const;

export type ActiveWriteScope = (typeof ACTIVE_WRITE_SCOPE_LIST)[number];

const ACTIVE = new Set<string>(ACTIVE_WRITE_SCOPE_LIST);

/** Reserved write scopes — present in the catalogue, not grantable. */
export const RESERVED_WRITE_SCOPE_LIST = [
  "trips:write",
  "sprays:write",
  "pruning:write",
  "equipment:write",
  "pins:write",
] as const;

export function isWriteScopeName(scope: string): boolean {
  return scope.split(":")[1] === "write";
}

/** True only for the five Stage 8 scopes the API actually accepts. */
export function isActiveWriteScope(scope: string): boolean {
  return ACTIVE.has(scope);
}

/** True for a write scope that exists but cannot be granted. */
export function isReservedWriteScope(scope: string): boolean {
  return isWriteScopeName(scope) && !ACTIVE.has(scope);
}

/** Canonical Stage 8 write-scope labels and descriptions (from Rork docs). */
export const WRITE_SCOPE_LABELS: Record<string, string> = {
  "work_tasks:write": "Work Tasks — Write",
  "fuel:write": "Fuel Records — Write",
  "irrigation:write": "Irrigation Records — Write",
  "growth_stages:write": "Growth Stages — Write",
  "yield:write": "Yield Records — Write",
};

export const WRITE_SCOPE_DESCRIPTIONS: Record<string, string> = {
  "work_tasks:write":
    "Create and update supported Work Task records through the VineTrack API. Labour and machine cost lines are never writable externally.",
  "fuel:write":
    "Create and update operational fuel records through the VineTrack API. Fuel purchases, costs and financial fields are not included.",
  "irrigation:write":
    "Create irrigation records through the VineTrack API. Create-only in Stage 8 — VineTrack derives volume, allocations and vintage.",
  "growth_stages:write":
    "Record new vineyard growth-stage observations through the VineTrack API. Create-only, catalogue E-L stage codes only.",
  "yield:write":
    "Create and update supported historical yield records through the VineTrack API, in the canonical per-block shape.",
};

/** Short resource names used in the "Write access enabled" summary. */
export const WRITE_SCOPE_RESOURCE_LABELS: Record<string, string> = {
  "work_tasks:write": "Work Tasks",
  "fuel:write": "Fuel Records",
  "irrigation:write": "Irrigation Records",
  "growth_stages:write": "Growth Stages",
  "yield:write": "Yield Records",
};

export function writeResourceLabel(scope: string): string {
  return WRITE_SCOPE_RESOURCE_LABELS[scope] ?? scope;
}

/** Resource names for granted write scopes, in canonical order. */
export function grantedWriteResources(scopes: string[]): string[] {
  const granted = new Set(scopes);
  return ACTIVE_WRITE_SCOPE_LIST.filter((s) => granted.has(s)).map(writeResourceLabel);
}
