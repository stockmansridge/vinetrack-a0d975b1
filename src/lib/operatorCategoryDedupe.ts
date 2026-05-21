// Client-side deduplication helpers for operator categories.
//
// Step 1 of the Team / User setup work: the iOS-shared `operator_categories`
// table has no unique constraint on (vineyard_id, name, cost_per_hour), so
// the same logical category can appear many times in the dropdown. Until
// Rork ships the backend dedupe migration + unique index (see
// docs/team-and-invitations-rpc-contract.md), we hide duplicates from
// assignment dropdowns without touching the underlying data.
//
// Rules:
//   - Normalise name = trim + collapse whitespace + lowercase.
//   - Group key = `${normalisedName}|${costPerHour ?? "null"}`.
//   - Kept row = most recently updated (fallback: most recently created).
//   - We tolerate but ignore rows missing a name.

import type { OperatorCategory } from "./operatorCategoriesQuery";

export function normaliseCategoryName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function categoryDedupeKey(c: OperatorCategory): string {
  const name = normaliseCategoryName(c.name);
  const cost = c.cost_per_hour == null ? "null" : Number(c.cost_per_hour).toFixed(2);
  return `${name}|${cost}`;
}

function compareForKeep(a: OperatorCategory, b: OperatorCategory): number {
  // Returns positive if `a` should be preferred over `b`.
  const at = Date.parse(a.updated_at ?? a.created_at ?? "") || 0;
  const bt = Date.parse(b.updated_at ?? b.created_at ?? "") || 0;
  if (at !== bt) return at - bt;
  // Prefer the row that has a cost when one is missing.
  const ac = a.cost_per_hour == null ? 0 : 1;
  const bc = b.cost_per_hour == null ? 0 : 1;
  return ac - bc;
}

export interface CategoryDedupeResult {
  unique: OperatorCategory[];
  duplicateCount: number;
  /** Map from any duplicate id → the kept canonical id. Includes kept→kept. */
  idToKeptId: Map<string, string>;
}

export function dedupeOperatorCategories(
  categories: readonly OperatorCategory[],
): CategoryDedupeResult {
  const groups = new Map<string, OperatorCategory[]>();
  for (const c of categories) {
    if (!normaliseCategoryName(c.name)) continue;
    const key = categoryDedupeKey(c);
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  const unique: OperatorCategory[] = [];
  const idToKeptId = new Map<string, string>();
  let duplicateCount = 0;

  for (const group of groups.values()) {
    const sorted = group.slice().sort(compareForKeep);
    const kept = sorted[sorted.length - 1];
    unique.push(kept);
    duplicateCount += group.length - 1;
    for (const c of group) idToKeptId.set(c.id, kept.id);
  }

  unique.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return { unique, duplicateCount, idToKeptId };
}
