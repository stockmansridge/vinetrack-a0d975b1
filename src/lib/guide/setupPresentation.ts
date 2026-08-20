// Stage 3.2 — the single presentation resolver for overall Core Setup state.
//
// Every Setup surface (landing hero, Getting Started row + step circle, and the
// Setup drill-down readiness header) MUST consume this. No component may decide
// Setup status on its own, and no setup-health *rule* lives here: this file only
// maps an already-derived SetupHealthSummary onto one coherent display state.
import type { SetupHealthSummary } from "@/lib/guide/setupHealth";

export type SetupPresentationState = "complete" | "action_required" | "unknown";

export interface SetupPresentation {
  state: SetupPresentationState;
  /** Readiness of applicable REQUIRED checks; null when it cannot be shown. */
  percentage: number | null;
  /** Short status word/phrase: "Complete", "2 actions required", … */
  label: string;
  /** Supporting line: "100% complete", "13 of 13 required checks", … */
  detail: string;
  /** True while facts are still loading — render neutral, never red or 0%. */
  loading: boolean;
}

/**
 * Overall Setup state rules (Stage 3.2):
 *
 * - complete         — requiredTotal > 0, requiredComplete === requiredTotal and
 *                      no applicable, readable required check has failed.
 *                      Recommended and optional items NEVER downgrade this.
 * - action_required  — one or more applicable, readable required checks are
 *                      incomplete.
 * - unknown          — still loading, query failed, facts unresolved, or there
 *                      is nothing applicable to evaluate. Neutral, never red.
 */
export function deriveSetupPresentation(
  summary: SetupHealthSummary,
  opts: { loading?: boolean; error?: Error | null } = {},
): SetupPresentation {
  const { loading = false, error = null } = opts;

  if (loading) {
    return {
      state: "unknown",
      percentage: null,
      label: "Checking setup…",
      detail: "",
      loading: true,
    };
  }

  if (error || !summary.resolved) {
    return {
      state: "unknown",
      percentage: null,
      label: "Unable to check",
      detail: "",
      loading: false,
    };
  }

  const requiredFailures = summary.checks.filter(
    (c) =>
      c.importance === "required" &&
      c.applicable &&
      c.sourceState === "ok" &&
      c.status === "action_required",
  ).length;

  const total = summary.totalRequired;
  const done = summary.completedRequired;
  const pct = summary.readinessPct;

  if (total === 0) {
    return {
      state: "unknown",
      percentage: null,
      label: "Unable to check",
      detail: "Nothing to check yet",
      loading: false,
    };
  }

  if (requiredFailures === 0 && done === total) {
    return {
      state: "complete",
      percentage: pct ?? 100,
      label: "Complete",
      detail: `${pct ?? 100}% complete · ${done} of ${total} required checks`,
      loading: false,
    };
  }

  const outstanding = requiredFailures > 0 ? requiredFailures : total - done;
  return {
    state: "action_required",
    percentage: pct,
    label: `${outstanding} action${outstanding === 1 ? "" : "s"} required`,
    detail: `${pct ?? 0}% complete · ${done} of ${total} required checks`,
    loading: false,
  };
}

/** Compact caption used beside the label on dense surfaces. */
export function setupPresentationMeta(p: SetupPresentation): string {
  if (p.state === "unknown") return p.detail;
  return p.percentage === null ? p.detail : `${p.percentage}% complete`;
}
