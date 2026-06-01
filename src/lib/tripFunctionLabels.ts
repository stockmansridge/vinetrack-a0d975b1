// Shared friendly labels for trip_function raw values.
// Keep aligned with Rork/iOS TripFunction enum.
export const TRIP_FUNCTION_LABELS: Record<string, string> = {
  spray: "Spray",
  spraying: "Spray",
  slashing: "Slashing",
  mulching: "Mulching",
  harrowing: "Harrowing",
  mowing: "Mowing",
  seeding: "Seeding",
  spreading: "Spreading",
  fertiliser: "Fertiliser",
  fertilising: "Fertilising",
  undervineWeeding: "Undervine weeding",
  // Rork Undervine Weeding subtypes:
  undervineMowing: "Mowing",
  undervineMulticlean: "Multiclean",
  undervineRollHacke: "Roll Hacke",
  undervineDisc: "Undervine Disc",
  undervineKnifing: "Undervine Knifing",
  interRowCultivation: "Inter-row cultivation",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Other",
};

export const tripFunctionLabel = (v?: string | null): string | null =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : null;

export const isKnownTripFunction = (v?: string | null): boolean =>
  !!v && Object.prototype.hasOwnProperty.call(TRIP_FUNCTION_LABELS, v);
