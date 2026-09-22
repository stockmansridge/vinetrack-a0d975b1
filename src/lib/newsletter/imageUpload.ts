// Newsletter image storage.
//
// Reuses the existing public `guide-images` bucket on the canonical VineTrack
// project (the same mechanism as guide and canopy imagery) under a
// `newsletter/` prefix. Public URLs are durable: they keep working after the
// admin signs out and when the email is opened weeks later. Browser-local
// blob:/data: URLs are never stored.
import { supabase } from "@/integrations/ios-supabase/client";
import { GUIDE_IMAGE_BUCKET } from "@/lib/guide/guideImageStore";

export const NEWSLETTER_IMAGE_PREFIX = "newsletter";

export interface UploadedNewsletterImage {
  path: string;
  url: string;
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) ||
    "image";
}

export async function uploadNewsletterImage(file: File): Promise<UploadedNewsletterImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file (JPG, PNG, GIF or WebP).");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Images must be 5 MB or smaller so they load quickly in email.");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${NEWSLETTER_IMAGE_PREFIX}/${stamp}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(GUIDE_IMAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(GUIDE_IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Could not build a public URL for the image.");
  return { path, url: data.publicUrl };
}

/** True when a URL is safe to store in a newsletter (durable, not local). */
export function isDurableImageUrl(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim();
  if (!value) return false;
  return /^https?:\/\//i.test(value);
}
