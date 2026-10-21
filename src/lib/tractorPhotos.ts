import { supabase } from "@/integrations/ios-supabase/client";

// Shared VineTrack tractor_photos table + private tractor-photos bucket.
const db = supabase as unknown as { from: (t: string) => any; storage: typeof supabase.storage };
export const TRACTOR_PHOTO_BUCKET = "tractor-photos";
export const TRACTOR_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const TRACTOR_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export function tractorPhotoQueryKey(tractorId: string) {
  return ["tractor-photo", tractorId];
}

/** Signed URL for the tractor's active photo, or null. */
export async function fetchTractorPhotoUrl(tractorId: string): Promise<string | null> {
  const { data, error } = await db.from("tractor_photos")
    .select("storage_path").eq("tractor_id", tractorId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!data?.storage_path) return null;
  const { data: signed, error: e2 } = await db.storage.from(TRACTOR_PHOTO_BUCKET).createSignedUrl(data.storage_path, 3600);
  if (e2) throw e2;
  return signed?.signedUrl ?? null;
}

export function validateTractorPhoto(file: File): string | null {
  if (!TRACTOR_PHOTO_TYPES.includes(file.type)) return "Choose a PNG, JPG or WebP image.";
  if (file.size > TRACTOR_PHOTO_MAX_BYTES) return "Photos must be 5 MB or smaller.";
  return null;
}

/** Uploads the file, retires the previous active photo, then links the new one. */
export async function saveTractorPhoto(vineyardId: string, tractorId: string, file: File): Promise<void> {
  const invalid = validateTractorPhoto(file);
  if (invalid) throw new Error(invalid);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${vineyardId}/${tractorId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from(TRACTOR_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { error: retireErr } = await db.from("tractor_photos")
    .update({ deleted_at: new Date().toISOString() }).eq("tractor_id", tractorId).is("deleted_at", null);
  if (retireErr) throw retireErr;
  const { error: insErr } = await db.from("tractor_photos").insert({
    tractor_id: tractorId, vineyard_id: vineyardId, storage_path: path, content_type: file.type, byte_size: file.size,
  });
  if (insErr) throw insErr;
}

export async function removeTractorPhoto(tractorId: string): Promise<void> {
  const { error } = await db.from("tractor_photos")
    .update({ deleted_at: new Date().toISOString() }).eq("tractor_id", tractorId).is("deleted_at", null);
  if (error) throw error;
}
