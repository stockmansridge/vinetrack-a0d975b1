/**
 * Colour coding for Work Task types.
 *
 * Task types are free-text per vineyard (the shared `work_task_types` table plus
 * the hardcoded defaults), so there is no stored colour to read. Instead every
 * type name is mapped deterministically to one semantic "family" — canopy work,
 * ground work, spraying, water, nutrition, harvest, planting, repairs,
 * inspection, machine work — and any type that matches no family is hashed to a
 * family so the same custom name always shows the same colour.
 *
 * Colours come from the `--task-*` design tokens (index.css) exposed to Tailwind
 * as `task-*` utilities; class names are written out in full so the Tailwind
 * scanner can see them.
 */

export type WorkTaskTypeColorKey =
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
  canopy: "border-task-canopy/40 bg-task-canopy/10 text-task-canopy",
  ground: "border-task-ground/40 bg-task-ground/10 text-task-ground",
  spray: "border-task-spray/40 bg-task-spray/10 text-task-spray",
  water: "border-task-water/40 bg-task-water/10 text-task-water",
  nutrient: "border-task-nutrient/40 bg-task-nutrient/10 text-task-nutrient",
  harvest: "border-task-harvest/40 bg-task-harvest/10 text-task-harvest",
  planting: "border-task-planting/40 bg-task-planting/10 text-task-planting",
  repair: "border-task-repair/40 bg-task-repair/10 text-task-repair",
  inspection: "border-task-inspection/40 bg-task-inspection/10 text-task-inspection",
  machine: "border-task-machine/40 bg-task-machine/10 text-task-machine",
  other: "border-task-other/40 bg-task-other/10 text-task-other",
};

/** Small solid dot in the family colour, e.g. for filter menus. */
const DOT_CLASS: Record<WorkTaskTypeColorKey, string> = {
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
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return "other";
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
