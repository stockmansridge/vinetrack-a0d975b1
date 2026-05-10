// Damage records — read + write against the iOS Supabase project.
// `damage_records` lives in the iOS-owned project; iOS remains the source of
// truth. Managers/owners (per vineyard_members.role) can create, update and
// soft-delete via RLS policies installed by Rork (see docs/ios-damage-records.md).
import { supabase } from "@/integrations/ios-supabase/client";

export const DAMAGE_TYPES = [
  "Frost",
  "Hail",
  "Wind",
  "Heat / Sunburn",
  "Disease",
  "Pest",
  "Machinery Damage",
  "Herbicide / Chemical Damage",
  "Waterlogging",
  "Drought Stress",
  "Animal / Bird Damage",
  "Other",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

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
};

export async function createDamageRecord(
  input: DamageRecordWriteInput,
  userId: string | null,
): Promise<DamageRecord> {
  const payload: Record<string, any> = {
    ...input,
    created_by: userId,
    client_updated_at: new Date().toISOString(),
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
): Promise<DamageRecord> {
  const payload: Record<string, any> = {
    ...patch,
    client_updated_at: new Date().toISOString(),
  };
  const res = await supabase
    .from("damage_records")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data as DamageRecord;
}

export async function archiveDamageRecord(id: string): Promise<void> {
  const res = await supabase
    .from("damage_records")
    .update({
      deleted_at: new Date().toISOString(),
      client_updated_at: new Date().toISOString(),
    })
    .eq("id", id);
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
