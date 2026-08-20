// Runtime persistence for managed How VineTrack Works content.
//
// Reuses the existing System Admin mechanisms only:
//   • get_system_feature_flags / set_system_feature_flag (jsonb value per key)
//     under GUIDE_CONTENT_FLAG_KEY.
//   • the existing `guide-images` storage bucket for step screenshots.
// No new tables, RPCs or buckets are created here.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { GUIDE_IMAGE_BUCKET, guideImagePublicUrl } from "@/lib/guide/guideImageStore";
import {
  bootstrapGuideContent,
  defaultGuideContent,
  parseGuideContent,
  type GuideContentMap,
  type GuideContentSection,
  type GuideStepImage,
} from "@/lib/guide/guideContent";

export const GUIDE_CONTENT_FLAG_KEY = "guide.content";
export const GUIDE_CONTENT_QK = ["guide", "content"] as const;

async function readRawGuideContent(): Promise<unknown> {
  const { data, error } = await (supabase as any).rpc("get_system_feature_flags");
  if (error) throw describeBackendError(error);
  const row = (data ?? []).find((f: { key: string }) => f.key === GUIDE_CONTENT_FLAG_KEY);
  return row?.value ?? null;
}

async function readGuideContent(): Promise<GuideContentMap> {
  const { data, error } = await (supabase as any).rpc("get_system_feature_flags");
  if (error) {
    // eslint-disable-next-line no-console
    console.debug("[guideContent] flag read unavailable", error.message);
    return parseGuideContent(null);
  }
  const row = (data ?? []).find((f: { key: string }) => f.key === GUIDE_CONTENT_FLAG_KEY);
  return parseGuideContent(row?.value);
}

function describeBackendError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/bucket.*not found|not found.*bucket/i.test(msg)) {
    return new Error(
      `Storage bucket "${GUIDE_IMAGE_BUCKET}" does not exist on the shared backend yet. ` +
        `It must be provisioned through the backend contract before guide screenshots can be uploaded.`,
    );
  }
  if (/function .* does not exist|permission|42501|row-level security/i.test(msg)) {
    return new Error(
      `The shared backend has not enabled System Admin writes for "${GUIDE_CONTENT_FLAG_KEY}" yet. ` +
        `Guide content persistence needs that contract before it can be saved.`,
    );
  }
  return err instanceof Error ? err : new Error(msg || "Something went wrong.");
}

async function writeGuideContent(map: GuideContentMap): Promise<void> {
  const { error } = await (supabase as any).rpc("set_system_feature_flag", {
    p_key: GUIDE_CONTENT_FLAG_KEY,
    p_is_enabled: true,
    p_value: map,
  });
  if (error) throw describeBackendError(error);
}

/** All managed guide content, merged over the built-in defaults. */
export function useGuideContent() {
  return useQuery({
    queryKey: GUIDE_CONTENT_QK,
    staleTime: 60_000,
    queryFn: readGuideContent,
  });
}

/** One section — always resolves to at least the built-in defaults. */
export function useGuideSection(key: string | undefined): {
  section?: GuideContentSection;
  loading: boolean;
} {
  const { data, isLoading } = useGuideContent();
  if (!key) return { section: undefined, loading: isLoading };
  // Never block the guide on the network: fall back to built-in defaults.
  return { section: data?.[key] ?? defaultGuideContent()[key], loading: isLoading };
}

/** Persist one whole section (heading, intro, rows and their order). */
export function useSaveGuideSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (section: GuideContentSection) => {
      const current = await readGuideContent();
      const next: GuideContentMap = {
        ...current,
        [section.key]: { ...section, updated_at: new Date().toISOString() },
      };
      await writeGuideContent(next);
      return next[section.key];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDE_CONTENT_QK }),
  });
}

function extensionFor(file: File): string {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/**
 * Upload a step screenshot into the existing guide-images bucket.
 * Returns the asset reference; the caller stores it on the step row and saves.
 * Nothing is deleted here — orphan cleanup is never done implicitly.
 */
export function useUploadGuideStepImage() {
  return useMutation({
    mutationFn: async (args: {
      sectionKey: string;
      stepId: string;
      file: File;
    }): Promise<GuideStepImage> => {
      const path = `content/${args.sectionKey}/${args.stepId}/${Date.now()}.${extensionFor(args.file)}`;
      const { error } = await supabase.storage
        .from(GUIDE_IMAGE_BUCKET)
        .upload(path, args.file, {
          upsert: true,
          contentType: args.file.type || undefined,
          cacheControl: "3600",
        });
      if (error) throw describeBackendError(error);
      return { path, updated_at: new Date().toISOString() };
    },
  });
}

export function guideStepImageUrl(image: GuideStepImage | undefined): string | undefined {
  return guideImagePublicUrl(image);
}

/**
 * One-time, non-destructive import of the existing guide into `guide.content`.
 *
 * Safe to call repeatedly: it writes only when a section (or a section-level
 * field) is missing, and it never overwrites content edited through Guide
 * Content. Nothing is reset and no other feature flag is touched.
 */
export function useBootstrapGuideContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ imported: boolean }> => {
      const raw = await readRawGuideContent();
      const { map, changed } = bootstrapGuideContent(raw);
      if (!changed) return { imported: false };
      await writeGuideContent(map);
      return { imported: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDE_CONTENT_QK }),
  });
}
