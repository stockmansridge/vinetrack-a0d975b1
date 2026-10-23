// Colour coding for trip Function badges, matching the Work Task type
// colouring. Purely presentational: raw stored trip_function values are never
// changed. Known functions map to explicit task colour families; unknown raw
// values fall through the same keyword/hash fallbacks as workTaskTypeColorKey
// so custom functions still get a stable colour of their own.

import {
  workTaskTypeBadgeClassForKey,
  workTaskTypeDotClassForKey,
  workTaskTypeColorKey,
  type WorkTaskTypeColorKey,
} from "@/lib/workTaskTypeColor";

/** Known trip_function raw values (aligned with TRIP_FUNCTION_LABELS).
 *  Undervine weeding subtypes share the weed family like their parent. */
const FUNCTION_KEYS: Readonly<Record<string, WorkTaskTypeColorKey>> = {
  spray: "spray",
  spraying: "spray",
  slashing: "slashing",
  mulching: "mulch",
  harrowing: "soil",
  mowing: "ground",
  seeding: "planting",
  spreading: "nutrient",
  fertiliser: "nutrient",
  fertilising: "nutrient",
  undervineWeeding: "weed",
  undervineMowing: "weed",
  undervineMulticlean: "weed",
  undervineRollHacke: "weed",
  undervineDisc: "weed",
  undervineKnifing: "weed",
  interRowCultivation: "soil",
  pruning: "canopy",
  shootThinning: "shoot",
  canopyWork: "leaf",
  irrigationCheck: "water",
  repairs: "repair",
  other: "other",
};

/** The colour family a trip function belongs to (deterministic for any raw). */
export function tripFunctionColorKey(raw?: string | null): WorkTaskTypeColorKey {
  const key = (raw ?? "").trim();
  if (!key) return "other";
  if (FUNCTION_KEYS[key]) return FUNCTION_KEYS[key];
  // Unknown raw values reuse the task-type fallbacks: keyword matching on the
  // raw value, then a deterministic hash so custom functions get their own
  // stable colour rather than the plain one.
  return workTaskTypeColorKey(key);
}

/** Badge classes that colour a trip function by family. */
export function tripFunctionBadgeClass(raw?: string | null): string {
  return workTaskTypeBadgeClassForKey(tripFunctionColorKey(raw));
}

/** Small solid dot in the function colour, e.g. for the filter menu. */
export function tripFunctionDotClass(raw?: string | null): string {
  return workTaskTypeDotClassForKey(tripFunctionColorKey(raw));
}
