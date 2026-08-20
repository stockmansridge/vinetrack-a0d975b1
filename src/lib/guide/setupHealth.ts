// Stage 3 — authoritative Core Setup health resolver (pure, no I/O).
//
// The resolver turns a snapshot of setup *facts* (fetched elsewhere) into the
// status model the How VineTrack Works guide renders. Rules that matter:
//
//  • Readiness % = completed applicable REQUIRED checks / applicable REQUIRED
//    checks. Recommended and optional checks NEVER move the percentage.
//  • Conditional areas (Spray, Irrigation) are only applicable when there is
//    real usage evidence; otherwise they are "not applicable" and excluded
//    from both numerator and denominator.
//  • Anything we could not resolve stays `not_checked` — we never guess.
//  • Partial block completion is reported honestly ("11 of 14 blocks").

import type { SetupStatus } from "@/components/guide/SetupCard";

export type SetupCheckImportance = "required" | "recommended" | "optional";

export interface SetupCheckResult {
  id: string;
  groupId: string;
  label: string;
  importance: SetupCheckImportance;
  status: SetupStatus;
  /** Human detail, e.g. "11 of 14 blocks have rows". */
  detail?: string;
  route?: string;
  /** False when the check does not apply to this vineyard. */
  applicable: boolean;
  /** True when this check is part of the readiness percentage. */
  countsTowardReadiness: boolean;
}

export interface SetupGroupHealth {
  id: string;
  status: SetupStatus;
  /** Completed applicable required checks. */
  completedRequired: number;
  /** Applicable required checks. */
  totalRequired: number;
  /** "3 of 4 complete" — omitted when nothing applies. */
  progress?: string;
  checks: SetupCheckResult[];
}

export interface SetupHealthSummary {
  /** False while facts are still loading / unavailable. */
  resolved: boolean;
  status: SetupStatus;
  /** Null until resolved (or when nothing is applicable). */
  readinessPct: number | null;
  completedRequired: number;
  totalRequired: number;
  actionsRequired: number;
  recommendedOutstanding: number;
  caption: string;
  checks: SetupCheckResult[];
  groups: SetupGroupHealth[];
  groupsById: Record<string, SetupGroupHealth>;
  /** Per-group status map for <CoreSetupChecklist statuses=… />. */
  groupStatuses: Record<string, SetupStatus>;
  /** Per-group progress map for <CoreSetupChecklist progress=… />. */
  groupProgress: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface SetupBlockFact {
  id: string;
  name: string | null;
  hasBoundary: boolean;
  hasRows: boolean;
  hasPlanting: boolean;
  isIrrigated: boolean;
}

export interface SetupHealthFacts {
  /** True once every fetch has settled (successfully or not). */
  resolved: boolean;
  vineyard: { name: string | null; hasLocation: boolean } | null;
  blocks: SetupBlockFact[] | null;
  weather: { anyConfigured: boolean } | null;
  equipment: { tractors: number; machines: number; sprayEquipment: number; other: number } | null;
  team: { members: number; owners: number } | null;
  spray: { chemicals: number; sprayEquipment: number; usageEvidence: number } | null;
  irrigation: {
    /** Any evidence the vineyard irrigates (blocks flagged, systems, valves). */
    applicable: boolean;
    systemsOk: boolean;
    valvesOk: boolean;
    allocationsOk: boolean;
  } | null;
  preferences: { seasonConfigured: boolean | null } | null;
}

export const EMPTY_SETUP_FACTS: SetupHealthFacts = {
  resolved: false,
  vineyard: null,
  blocks: null,
  weather: null,
  equipment: null,
  team: null,
  spray: null,
  irrigation: null,
  preferences: null,
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

interface CheckSpec {
  id: string;
  groupId: string;
  label: string;
  importance: SetupCheckImportance;
  route?: string;
  /** null → unresolved, "n/a" → not applicable. */
  evaluate: () => { done: boolean | null; applicable?: boolean; detail?: string };
}

const pct = (done: number, total: number) => (total === 0 ? null : Math.round((done / total) * 100));

function coverage(
  blocks: SetupBlockFact[] | null,
  pick: (b: SetupBlockFact) => boolean,
  noun: string,
): { done: boolean | null; applicable?: boolean; detail?: string } {
  if (!blocks) return { done: null };
  if (blocks.length === 0) return { done: false, detail: `No blocks created yet` };
  const covered = blocks.filter(pick).length;
  return {
    done: covered === blocks.length,
    detail: `${covered} of ${blocks.length} blocks ${noun}`,
  };
}

export function deriveSetupHealth(facts: SetupHealthFacts): SetupHealthSummary {
  const b = facts.blocks;

  const specs: CheckSpec[] = [
    {
      id: "vineyard.profile",
      groupId: "vineyard",
      label: "Vineyard profile",
      importance: "required",
      route: "/setup/vineyard",
      evaluate: () =>
        facts.vineyard === null
          ? { done: null }
          : { done: !!facts.vineyard.name?.trim() },
    },
    {
      id: "vineyard.location",
      groupId: "vineyard",
      label: "Vineyard location",
      importance: "required",
      route: "/setup/vineyard-location",
      evaluate: () =>
        facts.vineyard === null ? { done: null } : { done: facts.vineyard.hasLocation },
    },
    {
      id: "vineyard.blocks",
      groupId: "vineyard",
      label: "Blocks created",
      importance: "required",
      route: "/setup/paddocks",
      evaluate: () =>
        b === null ? { done: null } : { done: b.length > 0, detail: `${b.length} blocks` },
    },
    {
      id: "vineyard.boundaries",
      groupId: "vineyard",
      label: "Mapped boundaries",
      importance: "required",
      route: "/setup/paddocks",
      evaluate: () => coverage(b, (x) => x.hasBoundary, "mapped"),
    },
    {
      id: "vineyard.rows",
      groupId: "vineyard",
      label: "Row configuration",
      importance: "required",
      route: "/setup/paddocks",
      evaluate: () => coverage(b, (x) => x.hasRows, "have rows"),
    },
    {
      id: "vineyard.planting",
      groupId: "vineyard",
      label: "Planting & varieties",
      importance: "required",
      route: "/setup/grape-varieties",
      evaluate: () => coverage(b, (x) => x.hasPlanting, "have varieties"),
    },
    {
      id: "weather.source",
      groupId: "weather",
      label: "Weather source connected",
      importance: "required",
      route: "/setup/weather",
      evaluate: () =>
        facts.weather === null ? { done: null } : { done: facts.weather.anyConfigured },
    },
    {
      id: "equipment.registered",
      groupId: "equipment",
      label: "Equipment registered",
      importance: "recommended",
      route: "/setup/tractors",
      evaluate: () => {
        const e = facts.equipment;
        if (!e) return { done: null };
        const total = e.tractors + e.machines + e.sprayEquipment + e.other;
        return { done: total > 0, detail: total > 0 ? `${total} items` : "No equipment yet" };
      },
    },
    {
      id: "team.owner",
      groupId: "team",
      label: "Vineyard owner",
      importance: "required",
      route: "/team",
      evaluate: () => (facts.team === null ? { done: null } : { done: facts.team.owners > 0 }),
    },
    {
      id: "team.members",
      groupId: "team",
      label: "Team members invited",
      importance: "recommended",
      route: "/team",
      evaluate: () =>
        facts.team === null
          ? { done: null }
          : { done: facts.team.members > 1, detail: `${facts.team.members} members` },
    },
    {
      id: "spray.chemicals",
      groupId: "spray",
      label: "Saved chemicals",
      importance: "required",
      route: "/setup/chemicals",
      evaluate: () => {
        const s = facts.spray;
        if (!s) return { done: null };
        if (!sprayApplicable(s)) return { done: null, applicable: false };
        return { done: s.chemicals > 0, detail: `${s.chemicals} chemicals` };
      },
    },
    {
      id: "spray.equipment",
      groupId: "spray",
      label: "Spray equipment",
      importance: "required",
      route: "/setup/spray-equipment",
      evaluate: () => {
        const s = facts.spray;
        if (!s) return { done: null };
        if (!sprayApplicable(s)) return { done: null, applicable: false };
        return { done: s.sprayEquipment > 0, detail: `${s.sprayEquipment} sprayers` };
      },
    },
    {
      id: "irrigation.systems",
      groupId: "irrigation",
      label: "Irrigation systems",
      importance: "required",
      route: "/irrigation/setup",
      evaluate: () => {
        const i = facts.irrigation;
        if (!i) return { done: null };
        if (!i.applicable) return { done: null, applicable: false };
        return { done: i.systemsOk };
      },
    },
    {
      id: "irrigation.valves",
      groupId: "irrigation",
      label: "Valves & zones",
      importance: "required",
      route: "/irrigation/setup",
      evaluate: () => {
        const i = facts.irrigation;
        if (!i) return { done: null };
        if (!i.applicable) return { done: null, applicable: false };
        return { done: i.valvesOk };
      },
    },
    {
      id: "irrigation.allocations",
      groupId: "irrigation",
      label: "Valve → block allocations",
      importance: "required",
      route: "/irrigation/setup",
      evaluate: () => {
        const i = facts.irrigation;
        if (!i) return { done: null };
        if (!i.applicable) return { done: null, applicable: false };
        return { done: i.allocationsOk };
      },
    },
    {
      id: "preferences.season",
      groupId: "preferences",
      label: "Season & operational preferences",
      importance: "optional",
      route: "/setup/operational-preferences",
      evaluate: () => {
        const p = facts.preferences;
        if (!p || p.seasonConfigured === null) return { done: null };
        return { done: p.seasonConfigured };
      },
    },
  ];

  const checks: SetupCheckResult[] = specs.map((spec) => {
    const out = spec.evaluate();
    const applicable = out.applicable !== false;
    const status: SetupStatus = !applicable
      ? "not_applicable"
      : out.done === null
        ? "not_checked"
        : out.done
          ? "complete"
          : spec.importance === "required"
            ? "action_required"
            : "recommended";
    return {
      id: spec.id,
      groupId: spec.groupId,
      label: spec.label,
      importance: spec.importance,
      status,
      detail: applicable ? out.detail : undefined,
      route: spec.route,
      applicable,
      countsTowardReadiness:
        applicable && spec.importance === "required" && out.done !== null,
    };
  });

  const counted = checks.filter((c) => c.countsTowardReadiness);
  const completedRequired = counted.filter((c) => c.status === "complete").length;
  const totalRequired = counted.length;
  const actionsRequired = checks.filter((c) => c.status === "action_required").length;
  const recommendedOutstanding = checks.filter((c) => c.status === "recommended").length;

  const groupIds = Array.from(new Set(checks.map((c) => c.groupId)));
  const groups: SetupGroupHealth[] = groupIds.map((id) => {
    const own = checks.filter((c) => c.groupId === id);
    const req = own.filter((c) => c.countsTowardReadiness);
    const done = req.filter((c) => c.status === "complete").length;
    const applicableChecks = own.filter((c) => c.applicable);
    const status: SetupStatus = applicableChecks.length === 0
      ? "not_applicable"
      : own.some((c) => c.status === "action_required")
        ? "action_required"
        : own.some((c) => c.status === "not_checked")
          ? "not_checked"
          : own.some((c) => c.status === "recommended")
            ? "recommended"
            : "complete";
    return {
      id,
      status,
      completedRequired: done,
      totalRequired: req.length,
      progress: req.length > 0 ? `${done} of ${req.length} complete` : undefined,
      checks: own,
    };
  });

  const resolved = facts.resolved;
  const status: SetupStatus = !resolved
    ? "not_checked"
    : actionsRequired > 0
      ? "action_required"
      : checks.some((c) => c.applicable && c.status === "not_checked")
        ? "not_checked"
        : recommendedOutstanding > 0
          ? "recommended"
          : "complete";

  const readinessPct = resolved ? pct(completedRequired, totalRequired) : null;

  return {
    resolved,
    status,
    readinessPct,
    completedRequired,
    totalRequired,
    actionsRequired,
    recommendedOutstanding,
    caption: buildCaption(resolved, readinessPct, actionsRequired, recommendedOutstanding),
    checks,
    groups,
    groupsById: Object.fromEntries(groups.map((g) => [g.id, g])),
    groupStatuses: Object.fromEntries(groups.map((g) => [g.id, g.status])),
    groupProgress: Object.fromEntries(
      groups.filter((g) => g.progress).map((g) => [g.id, g.progress as string]),
    ),
  };
}

function sprayApplicable(s: NonNullable<SetupHealthFacts["spray"]>): boolean {
  return s.usageEvidence > 0 || s.chemicals > 0 || s.sprayEquipment > 0;
}

function buildCaption(
  resolved: boolean,
  readiness: number | null,
  actions: number,
  recommended: number,
): string {
  if (!resolved) return "Checking your setup…";
  if (readiness === null) return "Nothing to check yet";
  const parts = [`${readiness}% complete`];
  if (actions > 0) parts.push(`${actions} action${actions === 1 ? "" : "s"} required`);
  else if (recommended > 0)
    parts.push(`${recommended} recommended step${recommended === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
