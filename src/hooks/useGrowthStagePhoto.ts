import { useEffect, useState } from "react";
import { supabase } from "@/integrations/ios-supabase/client";

const BUCKETS = ["growth-stage-photos", "vineyard-pin-photos"] as const;
const TTL = 60 * 60;

/**
 * Returns a signed URL for a growth stage photo. Tries the dedicated
 * `growth-stage-photos` bucket first, falls back to the legacy
 * `vineyard-pin-photos` bucket for pin-sourced records.
 */
export function useGrowthStagePhoto(photoPath?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoPath) {
      setUrl(null);
      return;
    }
    (async () => {
      for (const bucket of BUCKETS) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(photoPath, TTL);
        if (cancelled) return;
        if (!error && data?.signedUrl) {
          setUrl(data.signedUrl);
          return;
        }
      }
      if (!cancelled) setUrl(null);
    })().catch(() => {
      if (!cancelled) setUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  return url;
}
