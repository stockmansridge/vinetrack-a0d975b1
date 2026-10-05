// Read-only display enrichment for V3 Saved Chemicals.
//
// A Saved Chemical added from the VineTrack catalogue carries
// `chemical_v3_revision_id`. The linked `chemical_v3_product_revisions` row is
// the authority for its front-label image, manufacturer label/product links and
// structured vineyard uses. These values are read for display only — never
// written back into saved_chemicals, and Storage objects are never copied.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { V3_REVISIONS_TABLE, textList } from "@/lib/chemicalV3";

const sb = supabase as any;

export const V3_DISPLAY_COLUMNS = "*";

export interface V3RevisionDisplay {
  id: string;
  front_label_image_path: string | null;
  manufacturer_label_url: string | null;
  manufacturer_product_url: string | null;
  vineyard_uses: any;
  review_status?: string | null;
  status?: string | null;
}

export function v3RevisionIdOf(row: any): string | null {
  const v = row?.chemical_v3_revision_id;
  return typeof v === "string" && v ? v : null;
}

export async function fetchV3RevisionDisplay(ids: string[]): Promise<Map<string, V3RevisionDisplay>> {
  const map = new Map<string, V3RevisionDisplay>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return map;
  const { data, error } = await sb.from(V3_REVISIONS_TABLE).select(V3_DISPLAY_COLUMNS).in("id", unique);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as V3RevisionDisplay[]) map.set(r.id, r);
  return map;
}

/** One shared query per vineyard chemical list. */
export function useV3RevisionDisplay(rows: any[]) {
  const ids = Array.from(new Set(rows.map(v3RevisionIdOf).filter((x): x is string => !!x))).sort();
  return useQuery({
    queryKey: ["v3-revision-display", ids],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => fetchV3RevisionDisplay(ids),
  });
}

/** Flattened, de-duplicated (case-insensitive) targets across all vineyard uses. */
export function v3UseTargets(rev: V3RevisionDisplay | null | undefined): string[] {
  const uses = Array.isArray(rev?.vineyard_uses) ? rev!.vineyard_uses : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of uses) {
    for (const t of textList(u?.targets ?? u?.target)) {
      const clean = String(t).trim().replace(/\s+/g, " ");
      const k = clean.toLowerCase();
      if (!clean || seen.has(k)) continue;
      seen.add(k);
      out.push(clean);
    }
  }
  return out;
}

/**
 * "Used for": structured catalogue targets first; for manual/non-catalogue
 * chemicals the saved `problem` (then `use` when it isn't just the category).
 * Nothing is invented — empty means unknown.
 */
export function usedForOf(
  chem: any,
  rev: V3RevisionDisplay | null | undefined,
  categoryLabel?: string | null,
): string[] {
  const targets = v3UseTargets(rev);
  if (targets.length) return targets;
  const problem = String(chem?.problem ?? "").trim();
  if (problem) return [problem];
  const use = String(chem?.use ?? "").trim();
  if (use && use.toLowerCase() !== String(categoryLabel ?? "").trim().toLowerCase()) return [use];
  return [];
}

const http = (v: unknown): string | undefined =>
  typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined;

/** Thumbnail click target: saved label_url, falling back to the revision manufacturer label. */
export function labelLinkOf(chem: any, rev: V3RevisionDisplay | null | undefined): string | undefined {
  return http(chem?.label_url) ?? http(rev?.manufacturer_label_url);
}

export function productLinkOf(chem: any, rev: V3RevisionDisplay | null | undefined): string | undefined {
  return http(chem?.product_url) ?? http(rev?.manufacturer_product_url);
}
