// Growth Stage reference images (portal copy of the mobile bundled assets).
// Single source of truth: public/growth-stages/mapping.json — the same file
// Rork ships to iOS/Android. Keyed by the existing E-L stage code; stages
// listed in `stagesWithoutImage` intentionally have no photo and must fall
// back to a neutral placeholder tile — never another stage's image.
import mapping from "../../public/growth-stages/mapping.json";

export type GrowthStageImageEntry = {
  code: string;
  file: string;
  description: string;
};

export const GROWTH_STAGE_IMAGE_BASE = "/growth-stages/";

export const GROWTH_STAGE_IMAGES: GrowthStageImageEntry[] = (mapping.images as GrowthStageImageEntry[]).map(
  (i) => ({ code: i.code, file: i.file, description: i.description }),
);

export const GROWTH_STAGES_WITHOUT_IMAGE: string[] = mapping.stagesWithoutImage as string[];

const BY_CODE = new Map(GROWTH_STAGE_IMAGES.map((i) => [i.code.toUpperCase(), i]));

/** Public URL for a stage's reference image, or null when the stage has none. */
export function growthStageImageUrl(code: string | null | undefined): string | null {
  if (!code) return null;
  const entry = BY_CODE.get(code.trim().toUpperCase());
  return entry ? `${GROWTH_STAGE_IMAGE_BASE}${entry.file}` : null;
}

/** Alt text for a stage tile image. */
export function growthStageImageAlt(code: string, label: string): string {
  return `${code} reference photo — ${label}`;
}
