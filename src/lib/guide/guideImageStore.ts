// Runtime persistence for How VineTrack Works guide imagery (Stage 2.9).
//
// IMPORTANT — no Lovable-invented schema.
// This module deliberately does NOT create tables, RPCs or buckets. It reuses
// two existing, authoritative System Admin mechanisms on the shared backend:
//
//   1. Object storage: bucket `guide-images` (see GUIDE_IMAGE_BUCKET).
//   2. The existing system feature-flag configuration store
//      (get_system_feature_flags / set_system_feature_flag), which already
//      persists a jsonb `value` per key and is System Admin-write-only.
//      The key→asset mapping lives under GUIDE_IMAGE_FLAG_KEY.
//
// If either piece is not yet provisioned on the shared backend, reads degrade
// to the built-in placeholders and writes surface a clear contract message —
// nothing is silently created here.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  GUIDE_IMAGE_SLOTS,
  type GuideImageFocus,
  type GuideImageKey,
} from "@/lib/guide/guideImages";

export const GUIDE_IMAGE_BUCKET = "guide-images";
export const GUIDE_IMAGE_FLAG_KEY = "guide.visual_assets";

export interface GuideImageAsset {
  /** Storage object path inside GUIDE_IMAGE_BUCKET. */
  path: string;
  focus?: GuideImageFocus;
  updated_at?: string;
}

export type GuideImageMap = Partial<Record<GuideImageKey, GuideImageAsset>>;

export const GUIDE_IMAGES_QK = ["guide", "images"] as const;

const KNOWN_KEYS = new Set(GUIDE_IMAGE_SLOTS.map((s) => s.key));

function parseMap(value: unknown): GuideImageMap {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const out: GuideImageMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k as GuideImageKey)) continue;
    if (!v || typeof v !== "object") continue;
    const rec = v as Record<string, unknown>;
    if (typeof rec.path !== "string" || !rec.path) continue;
    out[k as GuideImageKey] = {
      path: rec.path,
      focus: (rec.focus as GuideImageFocus | undefined) ?? undefined,
      updated_at: typeof rec.updated_at === "string" ? rec.updated_at : undefined,
    };
  }
  return out;
}

export function guideImagePublicUrl(asset: GuideImageAsset | undefined): string | undefined {
  if (!asset?.path) return undefined;
  const { data } = supabase.storage.from(GUIDE_IMAGE_BUCKET).getPublicUrl(asset.path);
  if (!data?.publicUrl) return undefined;
  // Cache-bust on replacement so admins and the guide see the new image without
  // a hard refresh.
  return asset.updated_at
    ? `${data.publicUrl}?v=${encodeURIComponent(asset.updated_at)}`
    : data.publicUrl;
}

async function readGuideImageMap(): Promise<GuideImageMap> {
  const { data, error } = await (supabase as any).rpc("get_system_feature_flags");
  if (error) {
    // eslint-disable-next-line no-console
    console.debug("[guideImages] flag read unavailable", error.message);
    return {};
  }
  const row = (data ?? []).find((f: { key: string }) => f.key === GUIDE_IMAGE_FLAG_KEY);
  return parseMap(row?.value);
}

/** All configured guide images. Always resolves — never blocks the guide. */
export function useGuideImages() {
  return useQuery({
    queryKey: GUIDE_IMAGES_QK,
    staleTime: 60_000,
    queryFn: readGuideImageMap,
  });
}

/** Resolved image URL + object-position for one slot (undefined ⇒ placeholder). */
export function useGuideImage(key: GuideImageKey | undefined): {
  url?: string;
  focus?: GuideImageFocus;
} {
  const { data } = useGuideImages();
  if (!key) return {};
  const asset = data?.[key];
  if (!asset) return {};
  return { url: guideImagePublicUrl(asset), focus: asset.focus };
}

function describeBackendError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/bucket.*not found|not found.*bucket/i.test(msg)) {
    return new Error(
      `Storage bucket "${GUIDE_IMAGE_BUCKET}" does not exist on the shared backend yet. ` +
        `It must be provisioned through the backend contract before guide images can be uploaded.`,
    );
  }
  if (/function .* does not exist|permission|42501|row-level security/i.test(msg)) {
    return new Error(
      `The shared backend has not enabled System Admin writes for "${GUIDE_IMAGE_FLAG_KEY}" yet. ` +
        `Guide image persistence needs that contract before it can be saved.`,
    );
  }
  return err instanceof Error ? err : new Error(msg || "Something went wrong.");
}

async function writeGuideImageMap(map: GuideImageMap): Promise<void> {
  const { error } = await (supabase as any).rpc("set_system_feature_flag", {
    p_key: GUIDE_IMAGE_FLAG_KEY,
    p_is_enabled: true,
    p_value: map,
  });
  if (error) throw describeBackendError(error);
}

function extensionFor(file: File): string {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export function useUploadGuideImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: GuideImageKey; file: File; focus?: GuideImageFocus }) => {
      const current = await readGuideImageMap();
      const path = `${args.key}/${Date.now()}.${extensionFor(args.file)}`;
      const { error: upErr } = await supabase.storage
        .from(GUIDE_IMAGE_BUCKET)
        .upload(path, args.file, {
          upsert: true,
          contentType: args.file.type || undefined,
          cacheControl: "3600",
        });
      if (upErr) throw describeBackendError(upErr);

      const previous = current[args.key];
      const next: GuideImageMap = {
        ...current,
        [args.key]: {
          path,
          focus: args.focus ?? previous?.focus,
          updated_at: new Date().toISOString(),
        },
      };
      await writeGuideImageMap(next);

      // Only ever remove the object this slot previously pointed at.
      if (previous?.path && previous.path !== path) {
        await supabase.storage
          .from(GUIDE_IMAGE_BUCKET)
          .remove([previous.path])
          .catch(() => {});
      }
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDE_IMAGES_QK }),
  });
}

export function useSetGuideImageFocus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: GuideImageKey; focus: GuideImageFocus }) => {
      const current = await readGuideImageMap();
      const asset = current[args.key];
      if (!asset) return current;
      const next: GuideImageMap = {
        ...current,
        [args.key]: { ...asset, focus: args.focus, updated_at: new Date().toISOString() },
      };
      await writeGuideImageMap(next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDE_IMAGES_QK }),
  });
}

export function useRemoveGuideImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: GuideImageKey) => {
      const current = await readGuideImageMap();
      const asset = current[key];
      const next: GuideImageMap = { ...current };
      delete next[key];
      await writeGuideImageMap(next);
      if (asset?.path) {
        await supabase.storage.from(GUIDE_IMAGE_BUCKET).remove([asset.path]).catch(() => {});
      }
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDE_IMAGES_QK }),
  });
}
