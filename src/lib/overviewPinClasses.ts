// Dashboard Overview map pin visibility classes — pure, derived, display only.
//
// Three mutually exclusive classes, matching the Portal growth identity
// contract in `growthStageRecordsQuery.ts` (mode 'Growth' OR non-blank
// growth_stage_code identifies a growth pin):
//
//   * "growth_stage" — a growth pin carrying an E-L growth stage code.
//   * "growth"       — a Growth-mode pin WITHOUT an E-L code (ordinary
//                      Growth-category observation).
//   * "repairs"      — every other pin (vine issues, posts, wires,
//                      irrigation, other).
//
// No mobile semantics are changed here: iOS/Android keep their own
// distinctions between Growth pins, EL Stage observations and Current EL Stage.

import { parseElStage } from "@/lib/growthHeatmap";

export type OverviewPinClass = "repairs" | "growth" | "growth_stage";

export interface OverviewPinLike {
  id?: string;
  mode?: string | null;
  growth_stage_code?: string | null;
  variety?: string | null;
  paddock_id?: string | null;
  date?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

const trimmed = (v: unknown) => String(v ?? "").trim();

export const isGrowthMode = (pin: OverviewPinLike | null | undefined): boolean =>
  trimmed(pin?.mode).toLowerCase() === "growth";

export const hasGrowthStageCode = (pin: OverviewPinLike | null | undefined): boolean =>
  trimmed(pin?.growth_stage_code).length > 0;

export function classifyOverviewPin(pin: OverviewPinLike | null | undefined): OverviewPinClass {
  if (hasGrowthStageCode(pin)) return "growth_stage";
  if (isGrowthMode(pin)) return "growth";
  return "repairs";
}

/** Variety key used to group Current Growth Stages. */
export function pinVarietyKey(
  pin: OverviewPinLike,
  varietyByPaddock?: Map<string, string | null>,
): string {
  const own = trimmed(pin.variety);
  if (own) return own.toLowerCase();
  const fromBlock = pin.paddock_id ? trimmed(varietyByPaddock?.get(pin.paddock_id)) : "";
  if (fromBlock) return fromBlock.toLowerCase();
  return pin.paddock_id ? `block:${pin.paddock_id}` : "unknown";
}

const pinDate = (pin: OverviewPinLike): string =>
  trimmed(pin.date) || trimmed(pin.completed_at) || trimmed(pin.created_at);

/**
 * Current Growth Stages: the highest recorded E-L per variety. Ties on E-L
 * resolve to the most recently recorded observation. Pins without a parseable
 * E-L stage are never "current".
 */
export function currentGrowthStagePinIds(
  pins: OverviewPinLike[],
  varietyByPaddock?: Map<string, string | null>,
): Set<string> {
  const best = new Map<string, { id: string; el: number; date: string }>();
  for (const pin of pins) {
    if (classifyOverviewPin(pin) !== "growth_stage") continue;
    const id = trimmed(pin.id);
    if (!id) continue;
    const el = parseElStage(pin.growth_stage_code);
    if (el == null) continue;
    const key = pinVarietyKey(pin, varietyByPaddock);
    const date = pinDate(pin);
    const cur = best.get(key);
    if (!cur || el > cur.el || (el === cur.el && date > cur.date)) {
      best.set(key, { id, el, date });
    }
  }
  return new Set(Array.from(best.values()).map((b) => b.id));
}

export interface OverviewPinVisibility {
  repairs: boolean;
  growth: boolean;
  currentGrowthStages: boolean;
}

/**
 * Should this pin be drawn? Growth-stage pins are only ever drawn when they
 * are the current (highest E-L) observation for their variety.
 */
export function isOverviewPinVisible(
  pin: OverviewPinLike,
  visibility: OverviewPinVisibility,
  currentIds: Set<string>,
): boolean {
  switch (classifyOverviewPin(pin)) {
    case "repairs":
      return visibility.repairs;
    case "growth":
      return visibility.growth;
    case "growth_stage":
      return visibility.currentGrowthStages && currentIds.has(trimmed(pin.id));
  }
}
