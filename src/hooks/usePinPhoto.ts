import { useEffect, useState } from "react";
import { supabase } from "@/integrations/ios-supabase/client";

const BUCKET = "vineyard-pin-photos";
const TTL = 60 * 60;

/** Returns a signed URL for a pin photo, or null if missing/failed. */
export function usePinPhoto(photoPath?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoPath) {
      setUrl(null);
      return;
    }
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(photoPath, TTL)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setUrl(null);
        else setUrl(data.signedUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  return url;
}
