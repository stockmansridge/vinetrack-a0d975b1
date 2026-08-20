// Stage 5C.1 — the single, central Setup detail → destination map.
//
// Every actionable row inside a Core Setup area resolves its portal route from
// here. Routes were verified against `src/App.tsx`; nothing is inferred from a
// label and no new page is invented. Keeping the map in one file means the JSX
// never hard-codes a route and tests can assert the whole matrix at once.
//
// Rule for the group-level CTA:
//   • multiple independent destinations → individual item links only
//   • exactly one genuine destination   → one group action is fine

export interface SetupDetailAction {
  /** Stable id for tests. */
  id: string;
  /** Row label, matching the catalogue sub-item text where one exists. */
  label: string;
  route: string;
}

/** groupId → the actionable detail rows shown inside that Setup area. */
export const SETUP_DETAIL_ACTIONS: Record<string, SetupDetailAction[]> = {
  vineyard: [
    { id: "vineyard.details", label: "Vineyard details & logo", route: "/setup/vineyard" },
    {
      id: "vineyard.location",
      label: "Location and GDD calculation mode",
      route: "/setup/vineyard-location",
    },
    {
      id: "vineyard.region",
      label: "Region, country, currency & units",
      route: "/setup/region-units",
    },
    { id: "vineyard.blocks", label: "Blocks / paddocks", route: "/setup/paddocks" },
    {
      id: "vineyard.boundaries",
      label: "Mapped boundaries & hectares",
      route: "/setup/paddocks",
    },
    {
      id: "vineyard.rows",
      label: "Row configuration & vine counts",
      route: "/setup/paddocks",
    },
    { id: "vineyard.soil", label: "Soil profiles (optional)", route: "/setup/paddocks" },
    {
      id: "vineyard.planting",
      label: "Planting, varieties, clones & rootstocks",
      route: "/setup/grape-varieties",
    },
  ],
  weather: [
    { id: "weather.source", label: "Weather & forecast source", route: "/setup/weather" },
  ],
  equipment: [
    { id: "equipment.tractors", label: "Tractors", route: "/setup/tractors" },
    {
      id: "equipment.machines",
      label: "Vineyard machines & implements",
      route: "/setup/vineyard-machines",
    },
    {
      id: "equipment.spray",
      label: "Spray equipment",
      route: "/setup/spray-equipment",
    },
    {
      id: "equipment.other",
      label: "Other equipment & assets",
      route: "/setup/equipment-other",
    },
  ],
  team: [
    { id: "team.members", label: "Members & invitations", route: "/team" },
    { id: "team.roles", label: "Roles & permissions", route: "/team" },
    {
      id: "team.operator_categories",
      label: "Operator categories",
      route: "/setup/operator-categories",
    },
  ],
  spray: [
    {
      id: "spray.chemicals",
      label: "Saved chemicals & label intelligence",
      route: "/setup/chemicals",
    },
    { id: "spray.equipment", label: "Spray equipment", route: "/setup/spray-equipment" },
    { id: "spray.templates", label: "Job templates", route: "/spray-jobs" },
  ],
  irrigation: [
    {
      id: "irrigation.systems",
      label: "Irrigation systems, valves & zones",
      route: "/irrigation/setup",
    },
    {
      id: "irrigation.allocations",
      label: "Valve → block allocations",
      route: "/irrigation/setup",
    },
  ],
  preferences: [
    {
      id: "preferences.season",
      label: "Season & E-L stage configuration",
      route: "/setup/operational-preferences",
    },
    {
      id: "preferences.defaults",
      label: "Spray / tank & yield defaults",
      route: "/setup/operational-preferences",
    },
  ],
};

export function setupDetailActions(groupId: string): SetupDetailAction[] {
  return SETUP_DETAIL_ACTIONS[groupId] ?? [];
}

/**
 * The group-level CTA, or undefined when the area has several independent
 * destinations (in which case the per-item links are the only navigation).
 */
export function setupGroupAction(groupId: string): string | undefined {
  const routes = new Set(setupDetailActions(groupId).map((a) => a.route));
  if (routes.size === 1) return [...routes][0];
  return undefined;
}

/** True when a group renders its own per-item links (no generic CTA). */
export function hasIndividualSetupActions(groupId: string): boolean {
  return setupDetailActions(groupId).length > 0 && !setupGroupAction(groupId);
}
