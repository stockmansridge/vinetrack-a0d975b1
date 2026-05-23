// Vineyard settings (name / country / logo / archive / create).
//
// Source of truth: the iOS app's Supabase project. iOS performs these as
// direct table updates against `vineyards` plus the RPCs
// `create_vineyard_with_owner` and `archive_vineyard`. We mirror that
// exactly so a vineyard edited in Lovable looks identical to one edited
// in iOS, and vice-versa.
import { supabase } from "@/integrations/ios-supabase/client";

export interface VineyardRecord {
  id: string;
  name: string;
  owner_id: string | null;
  country: string | null;
  logo_path: string | null;
  logo_updated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation_metres: number | null;
  timezone: string | null;
}

const LOGO_BUCKET = "vineyard-logos";

export async function fetchVineyard(vineyardId: string): Promise<VineyardRecord> {
  const { data, error } = await supabase
    .from("vineyards")
    .select(
      "id, name, owner_id, country, logo_path, logo_updated_at, created_at, updated_at, deleted_at, latitude, longitude, elevation_metres, timezone",
    )
    .eq("id", vineyardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Vineyard not found");
  return data as VineyardRecord;
}

/**
 * Update only the name + country fields. Mirrors iOS, which intentionally
 * does NOT include logo_path here so renaming never wipes the logo.
 */
export async function updateVineyardNameCountry(
  vineyardId: string,
  input: { name: string; country: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("vineyards")
    .update({ name: input.name, country: input.country })
    .eq("id", vineyardId);
  if (error) throw error;
}

export async function createVineyardWithOwner(input: {
  name: string;
  country: string | null;
}): Promise<VineyardRecord> {
  const { data, error } = await supabase.rpc("create_vineyard_with_owner", {
    p_name: input.name,
    p_country: input.country,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Vineyard creation returned no rows");
  return row as VineyardRecord;
}

export async function archiveVineyard(vineyardId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_vineyard", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
}

/**
 * Upload a new logo to `vineyard-logos/{vineyard_id}/logo.<ext>` and update
 * the `vineyards.logo_path` + `vineyards.logo_updated_at` columns. Storage
 * RLS already restricts writes to owner/manager, matching iOS.
 */
export async function uploadVineyardLogo(
  vineyardId: string,
  file: File,
): Promise<{ logo_path: string; logo_updated_at: string }> {
  const extFromName = file.name.split(".").pop()?.toLowerCase();
  const extFromType = file.type.split("/").pop()?.toLowerCase();
  const ext =
    extFromName && /^(jpg|jpeg|png|webp|heic)$/.test(extFromName)
      ? extFromName
      : extFromType === "jpeg"
        ? "jpg"
        : extFromType && /^(png|webp|heic)$/.test(extFromType)
          ? extFromType
          : "jpg";
  const path = `${vineyardId}/logo.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
      cacheControl: "3600",
    });
  if (upErr) throw upErr;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("vineyards")
    .update({ logo_path: path, logo_updated_at: nowIso })
    .eq("id", vineyardId)
    .select("logo_updated_at")
    .maybeSingle();
  if (error) throw error;
  return {
    logo_path: path,
    logo_updated_at: (data?.logo_updated_at as string | undefined) ?? nowIso,
  };
}

export async function removeVineyardLogo(vineyardId: string): Promise<void> {
  const v = await fetchVineyard(vineyardId);
  if (v.logo_path) {
    // Best-effort delete; ignore failures so the DB still gets cleared.
    await supabase.storage.from(LOGO_BUCKET).remove([v.logo_path]).catch(() => {});
  }
  const { error } = await supabase
    .from("vineyards")
    .update({ logo_path: null, logo_updated_at: new Date().toISOString() })
    .eq("id", vineyardId);
  if (error) throw error;
}

export function describeVineyardError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/42501|permission|RLS|not authoris|not authoriz/i.test(msg))
    return "You don't have permission to perform this action. Only owners and managers can edit vineyard settings.";
  return msg || "Something went wrong. Please try again.";
}
