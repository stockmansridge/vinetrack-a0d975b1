// SQL 204 — vineyard spray target library (CONSUMER).
//
// Rork/VineTrack mobile owns this contract. The portal consumes the two RPCs
// (`list_vineyard_spray_targets`, `create_vineyard_spray_target`) and must
// never create a second target vocabulary.
//
// Built-in targets are compiled into the app (SPRAY_TARGETS) and are NOT in
// the table. The library is advisory: the identifier already lives on the
// spray, so a missing or unreachable library never changes what a spray
// targeted — it only changes how readable and reusable it is.
import { supabase } from "@/integrations/supabase/client";
import {
  SPRAY_TARGETS,
  SPRAY_TARGET_LABEL,
  type SprayTarget,
} from "@/lib/sprayApplicationDomain";

export interface VineyardSprayTarget {
  id: string;
  vineyardId: string;
  identifier: string;
  label: string;
  isActive: boolean;
}

/**
 * Slug written into `spray_jobs.targets` / `spray_records.targets`.
 * Must match what the mobile clients produce, or a tag will not be recognised
 * on reload: lower-cased, punctuation stripped, runs collapsed to `_`.
 */
export function slugifySprayTarget(label: string): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isBuiltInSprayTarget(identifier: string): identifier is SprayTarget {
  return (SPRAY_TARGETS as string[]).includes(identifier);
}

/** Last-resort wording when neither a built-in nor the library knows the slug. */
export function prettifySprayTargetIdentifier(identifier: string): string {
  const words = identifier.split("_").filter(Boolean);
  if (!words.length) return identifier;
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * Wording for an identifier. Built-in wording always wins so a vineyard cannot
 * silently redefine a VineTrack target; the library supplies custom wording;
 * an unknown slug is still displayed rather than dropped.
 */
export function sprayTargetLabel(
  identifier: string,
  library?: Map<string, string> | null,
): string {
  if (isBuiltInSprayTarget(identifier)) return SPRAY_TARGET_LABEL[identifier];
  return library?.get(identifier) ?? prettifySprayTargetIdentifier(identifier);
}

export function sprayTargetLabelMap(targets: VineyardSprayTarget[]): Map<string, string> {
  return new Map(targets.map((t) => [t.identifier, t.label]));
}

function fromJson(row: any): VineyardSprayTarget {
  return {
    id: String(row?.id ?? ""),
    vineyardId: String(row?.vineyard_id ?? ""),
    identifier: String(row?.identifier ?? ""),
    label: String(row?.label ?? ""),
    isActive: row?.is_active !== false,
  };
}

/**
 * Reads the vineyard's library. Degrades gracefully: if SQL 204 is not applied
 * in a given environment the caller simply gets an empty library and keeps
 * working from built-ins and identifiers already on the vineyard's own steps.
 */
export async function listVineyardSprayTargets(
  vineyardId: string,
): Promise<VineyardSprayTarget[]> {
  const { data, error } = await (supabase as any).rpc("list_vineyard_spray_targets", {
    p_vineyard_id: vineyardId,
    p_include_inactive: false,
  });
  if (error) {
    console.warn("[sprayTargetLibrary] list failed — using built-ins only", error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []).map(fromJson).filter((t) => t.identifier && t.label);
}

/**
 * Adds wording to the library. The RPC is idempotent and converges on an
 * existing active identifier, so two operators adding the same target share
 * one entry. A failure here is non-fatal: the tag is still applied to the
 * draft, it simply is not offered for reuse yet.
 */
export async function createVineyardSprayTarget(input: {
  vineyardId: string;
  label: string;
}): Promise<VineyardSprayTarget | null> {
  const label = input.label.trim();
  const identifier = slugifySprayTarget(label);
  if (!label || !identifier) return null;
  const { data, error } = await (supabase as any).rpc("create_vineyard_spray_target", {
    p_id: crypto.randomUUID(),
    p_vineyard_id: input.vineyardId,
    p_identifier: identifier,
    p_label: label,
  });
  if (error) {
    console.warn("[sprayTargetLibrary] create failed — tag applied locally only", error.message);
    return null;
  }
  return data ? fromJson(data) : null;
}
