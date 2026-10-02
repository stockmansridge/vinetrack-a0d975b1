// Chemical Lookup V3 — structured resistance group (activity_groups +
// activity_group_scheme + resistance_classification_state). Never parsed from
// product_category; category and resistance are separate concepts.
import { supabase } from "@/integrations/ios-supabase/client";

type Row = Record<string, any>;
const sb = supabase as any;

export const V3_RESISTANCE_RPC = "chemical_v3_set_resistance_groups";
export const V3_RESISTANCE_SCHEMES = ["frac", "hrac", "irac"] as const;
export type V3ResistanceScheme = (typeof V3_RESISTANCE_SCHEMES)[number];
export type V3ResistanceState = "classified" | "unresolved" | "not_applicable";
export const V3_RESISTANCE_STATES: V3ResistanceState[] = ["classified", "unresolved", "not_applicable"];
export const V3_RESISTANCE_STATE_LABEL: Record<V3ResistanceState, string> = {
  classified: "Classified", unresolved: "Unresolved", not_applicable: "Not applicable",
};
export const V3_RESISTANCE_UNRESOLVED_TEXT = "Resistance group unresolved";
export const V3_RESISTANCE_NA_TEXT = "No resistance group applies";
/** Resistance editing: pending/needs-attention, plus approved during the System Admin pilot. */
export const V3_RESISTANCE_EDITABLE_STATUSES = ["pending_review", "needs_attention", "approved"];

export function isV3ResistanceEditable(status: unknown): boolean {
  return V3_RESISTANCE_EDITABLE_STATUSES.includes(String(status ?? "").toLowerCase());
}

export interface V3Resistance {
  state: V3ResistanceState;
  scheme: string | null;
  groups: string[];
  source: string | null;
}

export function readV3Resistance(row: Row | null | undefined): V3Resistance {
  const rawState = String(row?.resistance_classification_state ?? "").toLowerCase();
  const scheme = row?.activity_group_scheme ? String(row.activity_group_scheme).toLowerCase() : null;
  const groups = Array.isArray(row?.activity_groups)
    ? row!.activity_groups.map((g: unknown) => String(g ?? "").trim()).filter(Boolean)
    : [];
  const source = row?.resistance_group_source ? String(row.resistance_group_source) : null;
  let state: V3ResistanceState = "unresolved";
  if (rawState === "not_applicable") state = "not_applicable";
  // Classified only when the stored state says so AND there is a real scheme + groups.
  else if (rawState === "classified" && scheme && (V3_RESISTANCE_SCHEMES as readonly string[]).includes(scheme) && groups.length) state = "classified";
  return { state, scheme, groups, source };
}

/** "HRAC 9", "FRAC 3 + 11". Never a bare code. */
export function formatV3Resistance(r: V3Resistance): string {
  if (r.state === "not_applicable") return V3_RESISTANCE_NA_TEXT;
  if (r.state !== "classified" || !r.scheme) return V3_RESISTANCE_UNRESOLVED_TEXT;
  return `${r.scheme.toUpperCase()} ${r.groups.join(" + ")}`;
}

const SOURCE_LABEL: Record<string, string> = {
  system_admin_review: "System Admin review",
};
export function formatV3ResistanceSource(source: string | null): string | null {
  if (!source) return null;
  const s = source.trim();
  if (SOURCE_LABEL[s.toLowerCase()]) return SOURCE_LABEL[s.toLowerCase()];
  if (/activity.?group.?reference/i.test(s)) {
    const v = s.match(/v(\d+)/i);
    return `VineTrack activity group reference${v ? ` v${v[1]}` : ""}`;
  }
  return s.replace(/_/g, " ");
}

export interface V3ResistanceDraft { state: V3ResistanceState; scheme: V3ResistanceScheme | ""; groups: string }

export function buildResistanceArgs(revisionId: string, d: V3ResistanceDraft):
  { args: Record<string, unknown> } | { error: string } {
  if (d.state === "not_applicable") {
    return { args: { p_revision_id: revisionId, p_scheme: "not_applicable", p_groups: [], p_state: "not_applicable", p_source: "system_admin_review" } };
  }
  const groups = d.groups.split(/[\n,+]/).map((g) => g.trim()).filter(Boolean);
  if (d.state === "classified") {
    if (!d.scheme) return { error: "Choose FRAC, HRAC or IRAC." };
    if (!groups.length) return { error: "Enter at least one group code." };
  }
  return { args: { p_revision_id: revisionId, p_scheme: d.scheme || null, p_groups: groups, p_state: d.state, p_source: "system_admin_review" } };
}

export async function setV3ResistanceGroups(revisionId: string, d: V3ResistanceDraft): Promise<void> {
  const built = buildResistanceArgs(revisionId, d);
  if ("error" in built) throw new Error(built.error);
  const { error } = await sb.rpc(V3_RESISTANCE_RPC, built.args);
  if (error) throw error;
}

/* ---- Suggestion from the existing VineTrack activity group reference (no second table). */
import { lookupActivityGroup } from "@/lib/activityGroupReference";

export interface V3ResistanceSuggestion { scheme: V3ResistanceScheme; groups: string[]; commonName: string | null }

const activeName = (a: unknown): string => {
  if (a == null) return "";
  if (typeof a === "string") return a;
  const o = a as Row;
  return String(o.name ?? o.active_ingredient ?? o.ingredient ?? o.active_name ?? o.label ?? "");
};

/** Suggest a classification only when every active matches the reference in one scheme. */
export function suggestV3Resistance(row: Row | null | undefined): V3ResistanceSuggestion | null {
  const raw = row?.active_ingredients;
  const actives: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const names = actives.map(activeName).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  const refs = names.map(lookupActivityGroup);
  if (refs.some((r) => !r)) return null;
  const scheme = refs[0]!.scheme;
  if (refs.some((r) => r!.scheme !== scheme)) return null;
  const groups = [...new Set(refs.map((r) => r!.code))];
  const commons = [...new Set(refs.map((r) => r!.common_name).filter(Boolean))] as string[];
  return { scheme, groups, commonName: commons.join(" / ") || null };
}
