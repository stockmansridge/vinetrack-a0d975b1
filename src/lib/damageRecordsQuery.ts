// Damage records — read + write against the iOS Supabase project.
// `damage_records` lives in the iOS-owned project; iOS remains the source of
// truth. Managers/owners (per vineyard_members.role) can create, update and
// soft-delete via RLS policies installed by Rork (see docs/ios-damage-records.md).
import { supabase } from "@/integrations/ios-supabase/client";

// iOS canonical snake_case codes for damage_type. The iOS sync engine and
// the suggested validation trigger (docs/ios-damage-records.md §2) both
// expect these codes — Title Case strings get filtered/rejected on the iOS
// side, which is why portal-created records were not showing up in the app.
export const DAMAGE_TYPE_CODES = [
  "frost", "hail", "wind", "heat_sunburn", "disease", "pest",
  "machinery", "herbicide_chemical", "waterlogging", "drought",
  "animal_bird", "other",
] as const;
export type DamageType = (typeof DAMAGE_TYPE_CODES)[number];

export const DAMAGE_TYPE_LABELS: Record<string, string> = {
  frost: "Frost",
  hail: "Hail",
  wind: "Wind",
  heat_sunburn: "Heat / Sunburn",
  disease: "Disease",
  pest: "Pest",
  machinery: "Machinery Damage",
  herbicide_chemical: "Herbicide / Chemical Damage",
  waterlogging: "Waterlogging",
  drought: "Drought Stress",
  animal_bird: "Animal / Bird Damage",
  other: "Other",
};

// Legacy alias kept for callers that imported the old list.
export const DAMAGE_TYPES = DAMAGE_TYPE_CODES;

export const damageTypeLabel = (code?: string | null): string =>
  !code ? "—" : (DAMAGE_TYPE_LABELS[code] ?? code);

export const SEVERITIES = ["low", "medium", "high", "severe"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["open", "monitoring", "resolved"] as const;
export type DamageStatus = (typeof STATUSES)[number];

export const SIDES = ["left", "right", "both", "unknown"] as const;
export type Side = (typeof SIDES)[number];

export interface DamageRecord {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  damage_type?: string | null;
  notes?: string | null;
  damage_percent?: number | null;
  polygon_points?: any;
  date?: string | null;
  date_observed?: string | null;
  row_number?: number | null;
  side?: string | null;
  severity?: string | null;
  status?: string | null;
  operator_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pin_id?: string | null;
  trip_id?: string | null;
  photo_urls?: string[] | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

export interface DamageRecordsResult {
  records: DamageRecord[];
  vineyardCount: number;
}

export async function fetchDamageRecordsForVineyard(
  vineyardId: string,
): Promise<DamageRecordsResult> {
  const res = await supabase
    .from("damage_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) throw res.error;
  const records = (res.data ?? []) as DamageRecord[];
  return { records, vineyardCount: records.length };
}

export type DamageRecordWriteInput = {
  vineyard_id: string;
  paddock_id?: string | null;
  damage_type?: string | null;
  notes?: string | null;
  damage_percent?: number | null;
  date_observed?: string | null;
  row_number?: number | null;
  side?: string | null;
  severity?: string | null;
  status?: string | null;
  operator_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pin_id?: string | null;
  trip_id?: string | null;
  polygon_points?: any;
};

export async function createDamageRecord(
  input: DamageRecordWriteInput,
  userId: string | null,
): Promise<DamageRecord> {
  const now = new Date().toISOString();
  // iOS-compat: legacy `date` column is still read by the iOS app — mirror
  // `date_observed` into it so portal records show up in iOS lists.
  // `sync_version` starts at 1 (matches iOS create behaviour).
  const payload: Record<string, any> = {
    ...input,
    // `notes` is NOT NULL in the iOS DB — coerce nullish to "".
    notes: input.notes ?? "",
    date: input.date_observed ?? now,
    created_by: userId,
    updated_by: userId,
    client_updated_at: now,
    sync_version: 1,
  };
  const res = await supabase
    .from("damage_records")
    .insert(payload)
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data as DamageRecord;
}

export async function updateDamageRecord(
  id: string,
  patch: Partial<DamageRecordWriteInput>,
  userId: string | null = null,
): Promise<DamageRecord> {
  const now = new Date().toISOString();
  // Read current sync_version so we can bump it — iOS sync uses
  // (client_updated_at, sync_version) to detect changes.
  const current = await supabase
    .from("damage_records")
    .select("sync_version")
    .eq("id", id)
    .single();
  const nextVersion = ((current.data?.sync_version as number | null) ?? 0) + 1;
  const payload: Record<string, any> = {
    ...patch,
    client_updated_at: now,
    sync_version: nextVersion,
  };
  if (userId) payload.updated_by = userId;
  if (patch.date_observed !== undefined && patch.date_observed) {
    payload.date = patch.date_observed;
  }
  const res = await supabase
    .from("damage_records")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data as DamageRecord;
}

export async function archiveDamageRecord(id: string, userId: string | null = null): Promise<void> {
  const now = new Date().toISOString();
  const current = await supabase
    .from("damage_records")
    .select("sync_version")
    .eq("id", id)
    .single();
  const nextVersion = ((current.data?.sync_version as number | null) ?? 0) + 1;
  const payload: Record<string, any> = {
    deleted_at: now,
    client_updated_at: now,
    sync_version: nextVersion,
  };
  if (userId) payload.updated_by = userId;
  const res = await supabase.from("damage_records").update(payload).eq("id", id);
  if (res.error) throw res.error;
}

const PHOTO_BUCKET = "damage-photos";
const PHOTO_TTL = 60 * 60;

/**
 * Resolve a `photo_urls` entry to a renderable URL.
 * Accepts either an absolute http(s) URL (returned as-is) or a storage path
 * inside the `damage-photos` bucket (signed for one hour).
 */
export async function resolveDamagePhotoUrl(value: string): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(value, PHOTO_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
