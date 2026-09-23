import type { Trip } from "@/lib/tripsQuery";

export type LiveTripStatus = "active" | "paused" | "finished" | "older";

/**
 * Authoritative Live Dashboard trip status using the canonical lifecycle fields.
 *
 * - is_active === true && is_paused !== true → Active
 * - is_active === true && is_paused === true → Paused
 * - ended Trip with recent end_time → Finished today
 * - older ended Trip → Older
 * - is_active === false with no end_time → Older (excluded from the live surface)
 */
export function tripStatusOf(
  t: Pick<Trip, "is_active" | "is_paused" | "end_time">,
): LiveTripStatus {
  const ended = !!t.end_time;
  if (ended) {
    const ms = new Date(t.end_time!).getTime();
    if (!isNaN(ms) && Date.now() - ms < 24 * 3600 * 1000) return "finished";
    return "older";
  }
  if (t.is_active === true) {
    return t.is_paused === true ? "paused" : "active";
  }
  return "older";
}

export interface LiveDashboardSummary {
  active: number;
  paused: number;
  finished: number;
  operators: number;
}

export function buildLiveDashboardSummary(trips: Trip[]): LiveDashboardSummary {
  let active = 0;
  let paused = 0;
  let finished = 0;
  const operators = new Set<string>();
  for (const t of trips) {
    const s = tripStatusOf(t);
    if (s === "active") active++;
    else if (s === "paused") paused++;
    else if (s === "finished") finished++;
    if (s !== "older" && t.person_name) operators.add(t.person_name);
  }
  return { active, paused, finished, operators: operators.size };
}
