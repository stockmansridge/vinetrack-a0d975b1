// Clone & rootstock catalogue browsing + block usage matching (sql/182).
//
// Pure helpers shared by the Grape Varieties setup page (Clones / Rootstocks
// tabs). No database writes — usage is derived from the vineyard's block
// `variety_allocations` JSONB.
//
// Matching rules (contract):
//   1. Stable catalogue keys (`cloneKey` / `rootstockKey`) are authoritative.
//   2. Legacy display text is only used when an allocation carries NO key.
//   3. Sentinels (`mass_selection`, `own_roots`) are never catalogue rows and
//      never count as usage of a catalogue record.
import {
  CLONE_MASS_SELECTION_KEY,
  ROOTSTOCK_OWN_ROOTS_KEY,
  cloneMatches,
  rootstockMatches,
  type CatalogClone,
  type CatalogRootstock,
} from "@/lib/cloneRootstockCatalog";

export const SENTINEL_KEYS = new Set<string>([
  CLONE_MASS_SELECTION_KEY,
  ROOTSTOCK_OWN_ROOTS_KEY,
]);

export interface UsagePaddock {
  id: string;
  name: string | null;
  variety_allocations: any;
}

/** One row rendered in the Clones / Rootstocks tab. */
export interface UsageInfo {
  /** Distinct block names using this catalogue record. */
  blocks: string[];
  /** True when at least one match came from legacy free text (no stored key). */
  viaLegacyText: boolean;
}

const EMPTY_USAGE: UsageInfo = { blocks: [], viaLegacyText: false };

function norm(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

function allocationsOf(p: UsagePaddock): any[] {
  return Array.isArray(p.variety_allocations) ? p.variety_allocations : [];
}

function blockName(p: UsagePaddock): string {
  return p.name?.trim() || "Unnamed block";
}

interface AllocRef {
  key: string | null;
  text: string | null;
  block: string;
}

function collectRefs(
  paddocks: UsagePaddock[],
  keyOf: (a: any) => any,
  textOf: (a: any) => any,
): AllocRef[] {
  const refs: AllocRef[] = [];
  for (const p of paddocks) {
    const block = blockName(p);
    for (const a of allocationsOf(p)) {
      const rawKey = keyOf(a);
      const key = rawKey ? String(rawKey) : null;
      const rawText = textOf(a);
      const text = rawText && String(rawText).trim() ? String(rawText).trim() : null;
      if (!key && !text) continue;
      refs.push({ key, text, block });
    }
  }
  return refs;
}

export function collectCloneRefs(paddocks: UsagePaddock[]): AllocRef[] {
  return collectRefs(
    paddocks,
    (a) => a?.cloneKey ?? a?.clone_key ?? null,
    (a) => a?.clone ?? a?.clone_name ?? null,
  );
}

export function collectRootstockRefs(paddocks: UsagePaddock[]): AllocRef[] {
  return collectRefs(
    paddocks,
    (a) => a?.rootstockKey ?? a?.rootstock_key ?? a?.root_stock_key ?? null,
    (a) => a?.rootstock ?? a?.root_stock ?? null,
  );
}

function buildUsage(
  refs: AllocRef[],
  rowKey: string,
  legacyAliases: string[],
): UsageInfo {
  const blocks = new Set<string>();
  let viaLegacyText = false;
  const aliasSet = new Set(legacyAliases.map(norm).filter(Boolean));
  for (const ref of refs) {
    if (ref.key) {
      // Key present → key is authoritative; sentinels never match a row.
      if (SENTINEL_KEYS.has(ref.key)) continue;
      if (ref.key === rowKey) blocks.add(ref.block);
      continue;
    }
    // No key at all → legacy text fallback.
    if (ref.text && aliasSet.has(norm(ref.text))) {
      blocks.add(ref.block);
      viaLegacyText = true;
    }
  }
  return { blocks: Array.from(blocks).sort((a, b) => a.localeCompare(b)), viaLegacyText };
}

export function cloneUsage(refs: AllocRef[], c: CatalogClone): UsageInfo {
  if (SENTINEL_KEYS.has(c.key)) return EMPTY_USAGE;
  return buildUsage(refs, c.key, [c.display_name, c.clone_code ?? "", ...c.aliases]);
}

export function rootstockUsage(refs: AllocRef[], r: CatalogRootstock): UsageInfo {
  if (SENTINEL_KEYS.has(r.key)) return EMPTY_USAGE;
  return buildUsage(refs, r.key, [r.display_name, r.canonical_name ?? "", ...r.aliases]);
}

/** Browse list for the Clones tab: built-ins + this vineyard's ACTIVE customs.
 *  Archived customs are hidden. Sentinels are never included. */
export function browseClones(
  builtIns: CatalogClone[],
  customs: CatalogClone[],
  opts: { query?: string; varietyKey?: string | null } = {},
): CatalogClone[] {
  const rows = [
    ...builtIns.filter((c) => c.is_active),
    ...customs.filter((c) => c.is_active),
  ].filter((c) => !SENTINEL_KEYS.has(c.key));
  const filtered = rows.filter((c) => {
    if (opts.varietyKey && c.variety_key !== opts.varietyKey) return false;
    return cloneMatches(c, opts.query ?? "");
  });
  return filtered.sort(
    (a, b) =>
      a.variety_key.localeCompare(b.variety_key) ||
      a.display_name.localeCompare(b.display_name),
  );
}

/** Browse list for the Rootstocks tab — global, never variety filtered. */
export function browseRootstocks(
  builtIns: CatalogRootstock[],
  customs: CatalogRootstock[],
  opts: { query?: string } = {},
): CatalogRootstock[] {
  const rows = [
    ...builtIns.filter((r) => r.is_active),
    ...customs.filter((r) => r.is_active),
  ].filter((r) => !SENTINEL_KEYS.has(r.key));
  return rows
    .filter((r) => rootstockMatches(r, opts.query ?? ""))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Owner/Manager gate for custom catalogue writes (mirrors RLS). */
export function canManageCatalogue(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}
