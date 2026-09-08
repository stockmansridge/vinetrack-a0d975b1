// Branding for Spray Report exports.
//
// Two marks appear on every exported page:
//   * top left  — the logo configured for the TRIP's vineyard (never whichever
//     vineyard happens to be selected in the sidebar).
//   * bottom left — the official VineTrack mark, bundled with the app so
//     exports work offline.
//
// Logo bytes are embedded, never a temporary signed URL. When a vineyard has
// a configured logo that cannot be read, the export carries an honest warning
// instead of silently pretending no logo was configured.
import { supabase } from "@/integrations/ios-supabase/client";
import vinetrackLogo from "@/assets/vinetrack-logo.png";
import { dataUrlBytes, imageSizeFromBytes, type PixelSize } from "@/lib/imageDimensions";

const LOGO_BUCKET = "vineyard-logos";

export const VINEYARD_LOGO_UNAVAILABLE_MESSAGE =
  "This vineyard has a logo configured, but it could not be loaded for this export. The report shows the vineyard name instead.";

export interface BrandImage {
  dataUrl: string;
  /** Intrinsic pixel size, so the PDF can keep the aspect ratio. */
  size: PixelSize | null;
}

export interface SprayReportBranding {
  /** The trip vineyard's configured logo, when one is configured and readable. */
  vineyardLogo: BrandImage | null;
  /** The official VineTrack mark for the page footer. */
  vineTrackMark: BrandImage | null;
  /** Honest warning to surface in the export when a configured logo failed. */
  warning: string | null;
}

export const EMPTY_BRANDING: SprayReportBranding = {
  vineyardLogo: null,
  vineTrackMark: null,
  warning: null,
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function describe(dataUrl: string): BrandImage {
  return { dataUrl, size: imageSizeFromBytes(dataUrlBytes(dataUrl)) };
}

let markPromise: Promise<BrandImage | null> | null = null;

/**
 * The bundled VineTrack mark as embeddable bytes. Cached for the session so
 * repeated exports do not refetch it.
 */
export async function loadVineTrackMark(): Promise<BrandImage | null> {
  if (!markPromise) {
    markPromise = (async () => {
      try {
        const res = await fetch(vinetrackLogo);
        if (!res.ok) return null;
        return describe(await blobToDataUrl(await res.blob()));
      } catch {
        return null;
      }
    })();
  }
  try {
    return await markPromise;
  } catch {
    return null;
  }
}

/** Reset the cached mark. Test helper. */
export function resetBrandingCache() {
  markPromise = null;
}

interface VineyardLogoResult {
  logo: BrandImage | null;
  /** True when a logo is configured but its bytes could not be read. */
  failed: boolean;
}

/** Load the configured logo for one specific vineyard as embeddable bytes. */
export async function loadVineyardLogo(vineyardId: string): Promise<VineyardLogoResult> {
  let path: string | null = null;
  try {
    const { data, error } = await supabase
      .from("vineyards")
      .select("logo_path")
      .eq("id", vineyardId)
      .maybeSingle();
    if (error) return { logo: null, failed: false };
    path = (data as { logo_path?: string | null } | null)?.logo_path ?? null;
  } catch {
    return { logo: null, failed: false };
  }
  if (!path) return { logo: null, failed: false };

  try {
    const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(path);
    if (error || !data) return { logo: null, failed: true };
    return { logo: describe(await blobToDataUrl(data)), failed: false };
  } catch {
    return { logo: null, failed: true };
  }
}

/**
 * Everything an export needs to brand its pages. Never rejects: a branding
 * problem degrades to a clean text header plus a warning, it does not block
 * the report.
 */
export async function loadSprayReportBranding(
  vineyardId: string | null | undefined,
): Promise<SprayReportBranding> {
  const [logoResult, mark] = await Promise.all([
    vineyardId
      ? loadVineyardLogo(vineyardId).catch(() => ({ logo: null, failed: true }))
      : Promise.resolve({ logo: null, failed: false }),
    loadVineTrackMark(),
  ]);
  return {
    vineyardLogo: logoResult.logo,
    vineTrackMark: mark,
    warning: logoResult.failed ? VINEYARD_LOGO_UNAVAILABLE_MESSAGE : null,
  };
}
