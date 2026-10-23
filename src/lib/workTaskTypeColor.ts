/** Stable, individual task-type colours shared by lists and filters.
 * Exact default names take priority over broader keyword fallbacks.
 * All colours use semantic --task-* tokens, never stored task data.
 */

export type WorkTaskTypeColorKey =
  | "shoot"
  | "wire"
  | "leaf"
  | "slashing"
  | "mulch"
  | "weed"
  | "soil"
  | "replant"
  | "guards"
  | "canopy"
  | "ground"
  | "spray"
  | "water"
  | "nutrient"
  | "harvest"
  | "planting"
  | "repair"
  | "inspection"
  | "machine"
  | "other";

const TYPE_KEYS: Readonly<Record<string, WorkTaskTypeColorKey>> = {
  pruning: "canopy",
  "shoot thinning": "shoot",
  "wire lifting": "wire",
  "leaf plucking": "leaf",
  mowing: "ground",
  slashing: "slashing",
  mulching: "mulch",
  weeding: "weed",
  "soil work": "soil",
  spraying: "spray",
  irrigation: "water",
  fertilising: "nutrient",
  fertilizing: "nutrient",
  harvesting: "harvest",
  planting: "planting",
  replanting: "replant",
  "removing guards": "guards",
  "trellis repair": "repair",
  inspection: "inspection",
  "machine work": "machine",
  other: "other",
};

/**
 * Ordered keyword rules. The first family whose keyword appears in the name
 * wins, so more specific families are listed before broader ones.
 */
const RULES: ReadonlyArray<{ key: WorkTaskTypeColorKey; words: readonly string[] }> = [
  { key: "harvest", words: ["harvest", "pick", "grape", "tipping", "delivery", "bin run"] },
  { key: "spray", words: ["spray", "herbicide", "pesticide", "fungicide", "insecticide", "miticid", "dust", "fog"] },
  { key: "water", words: ["irrigat", "fertiga", "water", "drain", "valve", "leak", "wet"] },
  { key: "nutrient", words: ["fertil", "compost", "nutrien", "lime", "gypsum", "manure", "amend"] },
  {
    key: "canopy",
    words: [
      "prun", "trim", "pluck", "thin", "wire", "leaf", "leaves", "canopy", "shoot",
      "sucker", "defoliat", "hedge", "toppi", "bud", "spur", "cane", "laterl",
    ],
  },
  {
    key: "ground",
    words: [
      "mow", "slash", "mulch", "weed", "soil", "cultivat", "till", "ridge", "rip",
      "grub", "ground", "trench", "compaction", "cover crop", "straw",
    ],
  },
  { key: "planting", words: ["plant", "replant", "establish", "cutting", "graft", "vine install"] },
  {
    key: "repair",
    words: ["repair", "mainten", "fix", "fence", "trellis", "replace", "install", "paint", "clean", "service", "post", "bolt"],
  },
  {
    key: "inspection",
    words: ["inspect", "monitor", "survey", "audit", "count", "assess", "check", "review", "measure", "sampl", "watch"],
  },
  {
    key: "machine",
    words: ["machine", "mach ", "tractor", "earthwork", "grading", "levell", "bulldoz", "excavat", "loader", "chip", "shred"],
  },
  { key: "other", words: ["other", "misc", "admin", "office", "meeting", "training", "paperwork"] },
];

/** Families used for names that match no keyword — never "other", so custom
 *  types still get a colour of their own. */
const FALLBACK_KEYS: readonly WorkTaskTypeColorKey[] = [
  "shoot",
  "wire",
  "leaf",
  "slashing",
  "mulch",
  "weed",
  "soil",
  "replant",
  "guards",
  "canopy",
  "ground",
  "spray",
  "water",
  "nutrient",
  "harvest",
  "planting",
  "repair",
  "inspection",
  "machine",
];

/** Full class strings (not composed) so Tailwind's content scanner picks them up. */
const BADGE_CLASS: Record<WorkTaskTypeColorKey, string> = {
  shoot: "border-task-shoot/50 bg-task-shoot/15 text-task-shoot",
  wire: "border-task-wire/50 bg-task-wire/15 text-task-wire",
  leaf: "border-task-leaf/50 bg-task-leaf/15 text-task-leaf",
  slashing: "border-task-slashing/50 bg-task-slashing/15 text-task-slashing",
  mulch: "border-task-mulch/50 bg-task-mulch/15 text-task-mulch",
  weed: "border-task-weed/50 bg-task-weed/15 text-task-weed",
  soil: "border-task-soil/50 bg-task-soil/15 text-task-soil",
  replant: "border-task-replant/50 bg-task-replant/15 text-task-replant",
  guards: "border-task-guards/50 bg-task-guards/15 text-task-guards",

  canopy: "border-task-canopy/50 bg-task-canopy/15 text-task-canopy",
  ground: "border-task-ground/50 bg-task-ground/15 text-task-ground",
  spray: "border-task-spray/50 bg-task-spray/15 text-task-spray",
  water: "border-task-water/50 bg-task-water/15 text-task-water",
  nutrient: "border-task-nutrient/50 bg-task-nutrient/15 text-task-nutrient",
  harvest: "border-task-harvest/50 bg-task-harvest/15 text-task-harvest",
  planting: "border-task-planting/50 bg-task-planting/15 text-task-planting",
  repair: "border-task-repair/50 bg-task-repair/15 text-task-repair",
  inspection: "border-task-inspection/50 bg-task-inspection/15 text-task-inspection",
  machine: "border-task-machine/50 bg-task-machine/15 text-task-machine",
  other: "border-task-other/50 bg-task-other/15 text-task-other",
};

/** Small solid dot in the family colour, e.g. for filter menus. */
const DOT_CLASS: Record<WorkTaskTypeColorKey, string> = {
  shoot: "bg-task-shoot",
  wire: "bg-task-wire",
  leaf: "bg-task-leaf",
  slashing: "bg-task-slashing",
  mulch: "bg-task-mulch",
  weed: "bg-task-weed",
  soil: "bg-task-soil",
  replant: "bg-task-replant",
  guards: "bg-task-guards",

  canopy: "bg-task-canopy",
  ground: "bg-task-ground",
  spray: "bg-task-spray",
  water: "bg-task-water",
  nutrient: "bg-task-nutrient",
  harvest: "bg-task-harvest",
  planting: "bg-task-planting",
  repair: "bg-task-repair",
  inspection: "bg-task-inspection",
  machine: "bg-task-machine",
  other: "bg-task-other",
};

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** The colour family a task type belongs to (deterministic for any name). */
export function workTaskTypeColorKey(name?: string | null): WorkTaskTypeColorKey {
  const key = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return "other";
  if (TYPE_KEYS[key]) return TYPE_KEYS[key];
  for (const rule of RULES) {
    if (rule.words.some((w) => key.includes(w))) return rule.key;
  }
  return FALLBACK_KEYS[hashName(key) % FALLBACK_KEYS.length];
}

/** Badge classes that colour a task type by family. */
export function workTaskTypeBadgeClass(name?: string | null): string {
  return BADGE_CLASS[workTaskTypeColorKey(name)];
}

/** Dot classes that colour a task type by family (filter menus, legends). */
export function workTaskTypeDotClass(name?: string | null): string {
  return DOT_CLASS[workTaskTypeColorKey(name)];
}

/** Badge classes straight from a colour key, for callers (like trip
 *  functions) that resolve to a task colour family themselves. */
export function workTaskTypeBadgeClassForKey(key: WorkTaskTypeColorKey): string {
  return BADGE_CLASS[key];
}

/** Dot classes straight from a colour key. */
export function workTaskTypeDotClassForKey(key: WorkTaskTypeColorKey): string {
  return DOT_CLASS[key];
}
