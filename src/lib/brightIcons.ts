// "Brighter icons" visual mode — System Admin preview only.
//
// Single source of truth for the vivid two-colour diagonal gradient icon
// badges used by the iOS/Android apps (rork-vinetrack-june26 4e08d0d5).
// Effective mode = knownIsSystemAdmin && per-user stored preference. The
// stored bit alone is never trusted. To roll out to all users later, change
// only `resolveBrightIcons` (and the toggle's visibility).
import type { MetricTone } from "@/components/ui/metric-card";

export type BrightCategory =
  | "work"
  | "equipment"
  | "fuel"
  | "irrigation"
  | "growth"
  | "costs"
  | "yield"
  | "pruning"
  | "resistance"
  | "insights"
  | "spray"
  | "trips"
  | "weather"
  | "observations"
  | "team"
  | "soil"
  | "settings";

/** Gradient + white glyph. Same in light and dark mode (white on saturated 500/600 stops). */
export const BRIGHT_BADGE_CLASSES: Record<BrightCategory, string> = {
  work: "bg-gradient-to-br from-indigo-500 to-purple-600",
  equipment: "bg-gradient-to-br from-amber-800 to-orange-500",
  fuel: "bg-gradient-to-br from-red-500 to-orange-500",
  irrigation: "bg-gradient-to-br from-blue-500 to-cyan-400",
  growth: "bg-gradient-to-br from-green-600 to-cyan-500",
  costs: "bg-gradient-to-br from-green-600 to-cyan-500",
  yield: "bg-gradient-to-br from-orange-500 to-red-500",
  pruning: "bg-gradient-to-br from-cyan-500 to-indigo-500",
  resistance: "bg-gradient-to-br from-purple-500 to-pink-500",
  insights: "bg-gradient-to-br from-purple-500 to-indigo-600",
  spray: "bg-gradient-to-br from-emerald-500 to-teal-500",
  trips: "bg-gradient-to-br from-sky-500 to-blue-600",
  weather: "bg-gradient-to-br from-sky-400 to-blue-500",
  observations: "bg-gradient-to-br from-amber-500 to-orange-600",
  team: "bg-gradient-to-br from-teal-500 to-cyan-600",
  soil: "bg-gradient-to-br from-amber-700 to-yellow-600",
  settings: "bg-gradient-to-br from-slate-500 to-slate-700",
};

export const BRIGHT_GLYPH_CLASS = "text-white shadow-sm";

export function brightBadgeClass(category: BrightCategory): string {
  return `${BRIGHT_BADGE_CLASSES[category]} ${BRIGHT_GLYPH_CLASS}`;
}

/** Default category for existing MetricCard tones (used when no explicit category given). */
export const TONE_TO_BRIGHT: Record<MetricTone, BrightCategory> = {
  primary: "growth",
  accent: "yield",
  teal: "irrigation",
  amber: "yield",
  purple: "insights",
  neutral: "settings",
  white: "growth",
  equipment: "equipment",
  team: "team",
};

/** Sidebar activity id → category. Unknown ids keep the normal icon. */
export const NAV_ACTIVITY_BRIGHT: Record<string, BrightCategory> = {
  dashboard: "insights",
  blocks: "growth",
  observations: "observations",
  weather: "weather",
  trips: "trips",
  "work-tasks": "work",
  spraying: "spray",
  pruning: "pruning",
  yield: "yield",
  irrigation: "irrigation",
  equipment: "equipment",
  "soil-analysis": "soil",
  reports: "costs",
  settings: "settings",
};

// ---- Per-user preference storage --------------------------------------------

export const BRIGHT_PREF_PREFIX = "vt.brightIcons.v1:";

export function brightPrefKey(userId: string): string {
  return `${BRIGHT_PREF_PREFIX}${userId}`;
}

export function readBrightPref(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(brightPrefKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeBrightPref(userId: string | null | undefined, on: boolean): void {
  if (!userId) return;
  try {
    if (on) window.localStorage.setItem(brightPrefKey(userId), "1");
    else window.localStorage.removeItem(brightPrefKey(userId));
  } catch {
    /* storage unavailable: preference simply doesn't persist */
  }
}

/** Fail closed: only a known (loaded) System Admin with the preference on. */
export function resolveBrightIcons(args: {
  isSystemAdmin: boolean;
  adminLoading: boolean;
  prefOn: boolean;
}): boolean {
  return !args.adminLoading && args.isSystemAdmin === true && args.prefOn === true;
}
