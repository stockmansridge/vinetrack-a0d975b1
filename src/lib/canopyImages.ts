// Canopy Reference Images — the eight stable presentation slots.
//
// These are EXPLANATORY ASSETS ONLY. Nothing in this module (or in the admin
// override store that consumes it) participates in the spray calculation:
// canopy type, canopy size, canopy density, the AWRI dilute L/100 m value, the
// L/ha conversion and the concentration factor all live in
// `src/lib/sprayCanopy.ts` / `src/lib/sprayCalculation.ts` and are untouched by
// image configuration.
import {
  CANOPY_SIZES,
  CANOPY_SIZE_DESCRIPTION,
  CANOPY_SIZE_LABEL,
  CANOPY_TYPES,
  CANOPY_TYPE_LABEL,
  CANOPY_IMAGE,
  type CanopySize,
  type CanopyType,
} from "@/lib/sprayCanopy";

/** Stable semantic key for one canopy reference slot, e.g. `canopy.vsp.small`. */
export type CanopyImageKey = `canopy.${CanopyType}.${CanopySize}`;

export function canopyImageKey(type: CanopyType, size: CanopySize): CanopyImageKey {
  return `canopy.${type}.${size}`;
}

export interface CanopyImageSlot {
  key: CanopyImageKey;
  type: CanopyType;
  size: CanopySize;
  /** Human-readable canopy combination, e.g. "VSP — Large". */
  label: string;
  description: string;
  /** Bundled default that ships with the app and is never deleted. */
  defaultUrl: string;
}

export const CANOPY_IMAGE_SLOTS: CanopyImageSlot[] = CANOPY_TYPES.flatMap((type) =>
  CANOPY_SIZES.map((size) => ({
    key: canopyImageKey(type, size),
    type,
    size,
    label: `${CANOPY_TYPE_LABEL[type]} — ${CANOPY_SIZE_LABEL[size]}`,
    description: CANOPY_SIZE_DESCRIPTION[type][size],
    defaultUrl: CANOPY_IMAGE[type][size],
  })),
);

const SLOT_BY_KEY = new Map(CANOPY_IMAGE_SLOTS.map((s) => [s.key, s]));

export function canopyImageSlot(key: string): CanopyImageSlot | null {
  return SLOT_BY_KEY.get(key as CanopyImageKey) ?? null;
}

/** Bundled default for a slot key — always present, never removable. */
export function bundledCanopyImageUrl(key: string): string | null {
  return SLOT_BY_KEY.get(key as CanopyImageKey)?.defaultUrl ?? null;
}

/**
 * Runtime resolver: System Admin custom override first, bundled default second.
 * A missing/empty override resolves to the bundled default; broken uploads are
 * handled at render time by falling back to `defaultUrl`.
 */
export function resolveCanopyImage(
  key: string,
  customUrl: string | null | undefined,
): { url: string | null; source: "custom" | "default" | "none" } {
  const fallback = bundledCanopyImageUrl(key);
  if (customUrl) return { url: customUrl, source: "custom" };
  return fallback ? { url: fallback, source: "default" } : { url: null, source: "none" };
}
