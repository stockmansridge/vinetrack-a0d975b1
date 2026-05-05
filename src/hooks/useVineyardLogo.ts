import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";

const BUCKET = "vineyard-logos";
const SIGN_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Resolves the currently selected vineyard's logo as a signed URL from the
 * private `vineyard-logos` bucket. Returns null when there is no logo or the
 * fetch fails — callers should fall back to the VineTrack app icon.
 */
export function useVineyardLogo() {
  const { selectedVineyardId } = useVineyard();

  return useQuery({
    queryKey: ["vineyard-logo", selectedVineyardId],
    enabled: !!selectedVineyardId,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<string | null> => {
      try {
        const { data: vineyard, error: vErr } = await supabase
          .from("vineyards")
          .select("logo_path")
          .eq("id", selectedVineyardId!)
          .maybeSingle();
        if (vErr || !vineyard?.logo_path) return null;

        const { data: signed, error: sErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(vineyard.logo_path, SIGN_TTL_SECONDS);
        if (sErr || !signed?.signedUrl) return null;
        return signed.signedUrl;
      } catch {
        return null;
      }
    },
  });
}
