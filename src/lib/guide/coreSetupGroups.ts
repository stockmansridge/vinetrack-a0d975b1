// Core Setup grouping for the How VineTrack Works guide (Stage 2.5).
//
// The catalogue stays authoritative — this file only decides how the nine
// Core Setup catalogue entries are *presented* as a short, scannable checklist.
// Each group is one compact card; the underlying catalogue items (and their
// sub-checks) are the detail revealed on demand.
//
// Stage 3 compatibility: `CoreSetupGroup` carries `setupHealthKeys`, and the
// UI already renders a status pill plus an optional "n of m complete" line, so
// live health can be attached without another layout change.

import {
  guideItemsForSection,
  type HowVineTrackWorksItem,
} from "@/lib/guide/howVineTrackWorksCatalogue";

export interface CoreSetupGroup {
  id: string;
  title: string;
  /** One-line summary shown on the compact card. */
  summary: string;
  visualKey: string;
  /** Catalogue items revealed when the admin opens "View details". */
  items: HowVineTrackWorksItem[];
  /** Stage 3 hook — the setup-health keys this group aggregates. */
  setupHealthKeys: string[];
  /** Total number of individual checks behind this group (Stage 3 denominator). */
  checkCount: number;
  optional?: boolean;
}

interface GroupSpec {
  id: string;
  title: string;
  summary: string;
  visualKey: string;
  itemIds: string[];
  optional?: boolean;
}

const SPECS: GroupSpec[] = [
  {
    id: "vineyard",
    title: "Vineyard Setup",
    summary: "Vineyard identity, blocks, boundaries, rows and planting information.",
    visualKey: "core.vineyard",
    itemIds: ["core.vineyard", "core.blocks", "core.planting"],
  },
  {
    id: "weather",
    title: "Weather",
    summary: "Weather, forecast and rainfall configuration.",
    visualKey: "core.weather",
    itemIds: ["core.weather"],
  },
  {
    id: "equipment",
    title: "Equipment",
    summary: "Tractors, vineyard machinery and spray equipment.",
    visualKey: "core.equipment",
    itemIds: ["core.equipment"],
  },
  {
    id: "team",
    title: "Team & Roles",
    summary: "People, roles and vineyard access.",
    visualKey: "core.team",
    itemIds: ["core.team"],
  },
  {
    id: "spray",
    title: "Spray Setup",
    summary: "Equipment, chemicals and application configuration.",
    visualKey: "core.spray",
    itemIds: ["core.spray_setup"],
  },
  {
    id: "irrigation",
    title: "Irrigation Setup",
    summary: "Irrigation configuration where applicable.",
    visualKey: "core.irrigation",
    itemIds: ["core.irrigation_setup"],
  },
  {
    id: "preferences",
    title: "Preferences",
    summary: "Units, display preferences and vineyard-wide defaults.",
    visualKey: "core.preferences",
    itemIds: ["core.preferences"],
    optional: true,
  },
];

/**
 * The compact Core Setup checklist. Every Core Setup catalogue entry is
 * represented exactly once — nothing is dropped by the grouping.
 */
export function coreSetupGroups(): CoreSetupGroup[] {
  const all = guideItemsForSection("core_setup");
  const claimed = new Set<string>();

  const groups = SPECS.map((spec) => {
    const items = spec.itemIds
      .map((id) => all.find((i) => i.id === id))
      .filter((i): i is HowVineTrackWorksItem => !!i);
    items.forEach((i) => claimed.add(i.id));
    return buildGroup(spec, items);
  }).filter((g) => g.items.length > 0);

  // Safety net: any Core Setup item not named above still gets a card, so a
  // catalogue addition can never silently disappear from the guide.
  const orphans = all.filter((i) => !claimed.has(i.id));
  for (const item of orphans) {
    groups.push(
      buildGroup(
        {
          id: item.id,
          title: item.title,
          summary: item.shortDescription,
          visualKey: item.visualKey ?? "core.preferences",
          itemIds: [item.id],
          optional: item.importance === "optional",
        },
        [item],
      ),
    );
  }

  return groups;
}

function buildGroup(spec: GroupSpec, items: HowVineTrackWorksItem[]): CoreSetupGroup {
  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    visualKey: spec.visualKey,
    items,
    optional: spec.optional,
    setupHealthKeys: items
      .map((i) => i.setupHealthKey)
      .filter((k): k is string => !!k),
    checkCount: items.reduce((n, i) => n + Math.max(1, i.subItems?.length ?? 0), 0),
  };
}

/** First real portal route in the group, used for the compact "Set up" link. */
export function coreSetupGroupRoute(group: CoreSetupGroup): string | undefined {
  return group.items.find((i) => i.webRoute)?.webRoute;
}
