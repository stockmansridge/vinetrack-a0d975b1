// Persistence for System Admin → Spray Calculator → Canopy Reference Images.
//
// NO new schema. This reuses the two existing System Admin mechanisms already
// used by Guide Images (`src/lib/guide/guideImageStore.ts`):
//
//   1. Object storage: the existing admin asset bucket `guide-images`,
//      under the `canopy-reference/` prefix.
//   2. The existing system configuration store
//      (`get_system_feature_flags` / `set_system_feature_flag`), which persists
//      a jsonb `value` per key and is System Admin-write-only. The slot→asset
//      map lives under CANOPY_IMAGE_FLAG_KEY.
//
// Overrides are presentation only: they never touch canopy type/size/density,
// the AWRI L/100 m table, the L/ha conversion or the concentration factor.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { CANOPY_IMAGE_SLOTS, resolveCanopyImage, type CanopyImageKey } from "@/lib/canopyImages";

export const CANOPY_IMAGE_BUCKET = "guide-images";
export const CANOPY_IMAGE_PREFIX = "canopy-reference";
export const CANOPY_IMAGE_FLAG_KEY = "spray.canopy_reference_images";

export interface CanopyImageAsset {
  /** Storage object path inside CANOPY_IMAGE_BUCKET. */
  path: string;
  updated_at?: string;
}

export type CanopyImageMap = Partial<Record<CanopyImageKey, CanopyImageAsset>>;

export const CANOPY_IMAGES_QK = ["spray", "canopy-images"] as const;

const KNOWN_KEYS = new Set<string>(CANOPY_IMAGE_SLOTS.map((s) => s.key));

/** Parse the persisted jsonb value, dropping anything that is not a known slot. */
export function parseCanopyImageMap(value: unknown): CanopyImageMap {
  if (!value || typeof value !== "object") return {};
  const out: CanopyImageMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_KEYS.has(k)) continue;
    if (!v || typeof v !== "object") continue;
    const rec = v as Record<string, unknown>;
    if (typeof rec.path !== "string" || !rec.path) continue;
    out[k as CanopyImageKey] = {
      path: rec.path,
      updated_at: typeof rec.updated_at === "string" ? rec.updated_at : undefined,
    };
  }
  return out;
}

export function canopyImagePublicUrl(asset: CanopyImageAsset | undefined): string | undefined {
  if (!asset?.path) return undefined;
  const { data } = supabase.storage.from(CANOPY_IMAGE_BUCKET).getPublicUrl(asset.path);
  if (!data?.publicUrl) return undefined;
  return asset.updated_at
    ? `${data.publicUrl}?v=${encodeURIComponent(asset.updated_at)}`
    : data.publicUrl;
}

async function readCanopyImageMap(): Promise<CanopyImageMap> {
  const { data, error } = await (supabase as any).rpc("get_system_feature_flags");
  if (error) {
    // eslint-disable-next-line no-console
    console.debug("[canopyImages] config read unavailable", error.message);
    return {};
  }
  const row = (data ?? []).find((f: { key: string }) => f.key === CANOPY_IMAGE_FLAG_KEY);
  return parseCanopyImageMap(row?.value);
}

function describeBackendError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/bucket.*not found|not found.*bucket/i.test(msg)) {
    return new Error(
      `Storage bucket "${CANOPY_IMAGE_BUCKET}" is not available on the shared backend.`,
    );
  }
  if (/function .* does not exist|permission|42501|row-level security/i.test(msg)) {
    return new Error(
      `System Admin writes for "${CANOPY_IMAGE_FLAG_KEY}" are not enabled on the shared backend.`,
    );
  }
  return err instanceof Error ? err : new Error(msg || "Something went wrong.");
}

async function writeCanopyImageMap(map: CanopyImageMap): Promise<void> {
  const { error } = await (supabase as any).rpc("set_system_feature_flag", {
    p_key: CANOPY_IMAGE_FLAG_KEY,
    p_is_enabled: true,
    p_value: map,
  });
  if (error) throw describeBackendError(error);
}

export function useCanopyImages() {
  return useQuery({
    queryKey: CANOPY_IMAGES_QK,
    staleTime: 60_000,
    queryFn: readCanopyImageMap,
  });
}

/**
 * Resolved reference image for one slot: custom override when configured,
 * bundled default otherwise. `defaultUrl` is always returned so the renderer
 * can fall back when the custom object 404s.
 */
export function useCanopyImage(key: CanopyImageKey | null | undefined): {
  url: string | null;
  defaultUrl: string | null;
  source: "custom" | "default" | "none";
} {
  const { data } = useCanopyImages();
  if (!key) return { url: null, defaultUrl: null, source: "none" };
  const custom = canopyImagePublicUrl(data?.[key]);
  const resolved = resolveCanopyImage(key, custom);
  return { ...resolved, defaultUrl: resolveCanopyImage(key, null).url };
}

function extensionFor(file: File): string {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/svg+xml") return "svg";
  return "jpg";
}

export function useUploadCanopyImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: CanopyImageKey; file: File }) => {
      const current = await readCanopyImageMap();
      const path = `${CANOPY_IMAGE_PREFIX}/${args.key}/${Date.now()}.${extensionFor(args.file)}`;
      const { error: upErr } = await supabase.storage
        .from(CANOPY_IMAGE_BUCKET)
        .upload(path, args.file, {
          upsert: true,
          contentType: args.file.type || undefined,
          cacheControl: "3600",
        });
      if (upErr) throw describeBackendError(upErr);

      const previous = current[args.key];
      const next: CanopyImageMap = {
        ...current,
        [args.key]: { path, updated_at: new Date().toISOString() },
      };
      await writeCanopyImageMap(next);
      if (previous?.path && previous.path !== path) {
        await supabase.storage.from(CANOPY_IMAGE_BUCKET).remove([previous.path]).catch(() => {});
      }
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CANOPY_IMAGES_QK }),
  });
}

/**
 * Remove the custom image for a slot — i.e. reset to the bundled default.
 * The bundled asset under public/canopy/ is never deleted.
 */
export function useResetCanopyImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: CanopyImageKey) => {
      const current = await readCanopyImageMap();
      const asset = current[key];
      const next: CanopyImageMap = { ...current };
      delete next[key];
      await writeCanopyImageMap(next);
      if (asset?.path) {
        await supabase.storage.from(CANOPY_IMAGE_BUCKET).remove([asset.path]).catch(() => {});
      }
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CANOPY_IMAGES_QK }),
  });
}
