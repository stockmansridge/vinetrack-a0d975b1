// Stage 4 — the SQL 196 `public.resistance_plans` contract, as consumed by the
// portal.
//
// Columns verified live against the shared VineTrack project
// (`tbafuqwruefgkbyxrxyb`, PostgREST column probe, 2026-08-19):
//
//   id, vineyard_id, season_id, disease, jurisdiction, crop, block_ids,
//   positions, notes, ruleset_id, ruleset_version, created_at, updated_at,
//   created_by, updated_by, deleted_at, client_updated_at,
//   server_revision, base_revision            (SQL 198 concurrency)
//
// Lifecycle RPCs: `soft_delete_resistance_plan(p_id uuid)` and
// `restore_resistance_plan(p_id uuid)` — plans are SOFT deleted.
//
// NOTHING derived is persisted: no verdict, no score, no findings, no
// evaluation blob. The plan stores INTENT (which groups, in which order, for
// which blocks) plus the ruleset provenance it was last saved against. The
// result is always recomputed from current history.
import type { ResistanceDisease } from "@/lib/resistance/resistanceRuleset";
import { normaliseGroupCode } from "@/lib/resistance/resistanceRuleset";

/* ------------------------------------------------------------- positions */

/**
 * A planned strategy position. GROUP-FIRST: the resistance decision is the
 * group (or group combination); a product is an optional association.
 *
 * `keyStyle` and `extra` exist purely for cross-platform round-tripping: a
 * plan written by iOS/Android must come back out of the portal in the shape it
 * went in, including any field this portal build does not yet understand.
 */
export interface ResistancePlanPosition {
  /** Stable position ID. Never regenerated on edit. */
  id: string;
  /** 1-based intended order. */
  sequence: number;
  /** Normalised group codes. More than one = a combination, not one group. */
  groups: string[];
  savedChemicalId: string | null;
  productName: string | null;
  /** Optional per-position target; the plan's disease is the default. */
  target: ResistanceDisease | null;
  growthStage: string | null;
  notes: string | null;
  /** Key casing this position arrived in, preserved on write. */
  keyStyle: "camel" | "snake";
  /** Unknown keys from the shared contract, preserved verbatim. */
  extra: Record<string, unknown>;
}

const CAMEL_KEYS = [
  "id",
  "sequence",
  "order",
  "groups",
  "savedChemicalId",
  "productName",
  "target",
  "growthStage",
  "notes",
] as const;

const SNAKE_KEYS = [
  "id",
  "sequence",
  "order",
  "groups",
  "saved_chemical_id",
  "product_name",
  "target",
  "growth_stage",
  "notes",
] as const;

const KNOWN_KEYS = new Set<string>([...CAMEL_KEYS, ...SNAKE_KEYS, "group", "group_codes", "groupCodes"]);

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s === "" ? null : s;
};

const asDisease = (v: unknown): ResistanceDisease | null => {
  const s = (str(v) ?? "").toLowerCase();
  return s === "powdery_mildew" || s === "downy_mildew" ? (s as ResistanceDisease) : null;
};

export function newPositionId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `pos-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Normalise a mixed list of group inputs into ordered, deduplicated codes. */
export function normaliseGroupCodes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const item of list) {
    const code = normaliseGroupCode(typeof item === "string" || typeof item === "number" ? String(item) : null);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

function parsePosition(raw: unknown, index: number): ResistancePlanPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const snake = "saved_chemical_id" in o || "product_name" in o || "growth_stage" in o;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  const seqRaw = o.sequence ?? o.order;
  const seq = Number(seqRaw);

  return {
    id: str(o.id) ?? newPositionId(),
    sequence: Number.isFinite(seq) && seq > 0 ? Math.trunc(seq) : index + 1,
    groups: normaliseGroupCodes(o.groups ?? o.groupCodes ?? o.group_codes ?? o.group),
    savedChemicalId: str(o.savedChemicalId ?? o.saved_chemical_id),
    productName: str(o.productName ?? o.product_name),
    target: asDisease(o.target),
    growthStage: str(o.growthStage ?? o.growth_stage),
    notes: str(o.notes),
    keyStyle: snake ? "snake" : "camel",
    extra,
  };
}

/** Tolerant read of `positions` (jsonb array, or a JSON string). */
export function parsePositions(raw: unknown): ResistancePlanPosition[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(value) ? value : [];
  return list
    .map((p, i) => parsePosition(p, i))
    .filter((p): p is ResistancePlanPosition => !!p)
    .sort((a, b) => a.sequence - b.sequence)
    .map((p, i) => ({ ...p, sequence: i + 1 }));
}

/** Serialise back to the shared contract, preserving casing and unknown keys. */
export function serialisePositions(
  positions: ResistancePlanPosition[],
): Record<string, unknown>[] {
  return positions.map((p, i) => {
    const base: Record<string, unknown> = { ...p.extra, id: p.id, sequence: i + 1 };
    if (p.keyStyle === "snake") {
      base.groups = p.groups;
      base.saved_chemical_id = p.savedChemicalId;
      base.product_name = p.productName;
      base.target = p.target;
      base.growth_stage = p.growthStage;
      base.notes = p.notes;
    } else {
      base.groups = p.groups;
      base.savedChemicalId = p.savedChemicalId;
      base.productName = p.productName;
      base.target = p.target;
      base.growthStage = p.growthStage;
      base.notes = p.notes;
    }
    return base;
  });
}

export const positionIsPlannable = (p: ResistancePlanPosition): boolean => p.groups.length > 0;

/** `"3 + 11"` — a combination is never presented as one group. */
export const positionGroupLabel = (p: ResistancePlanPosition): string =>
  p.groups.length ? p.groups.join(" + ") : "Group not set";

/** Stable signature used for comparison/tests. */
export const positionSignature = (p: ResistancePlanPosition): string => p.groups.join("+");

/* ------------------------------------------------------------------ plan */

export interface ResistancePlan {
  id: string;
  vineyardId: string;
  seasonId: string;
  disease: ResistanceDisease | string;
  jurisdiction: string | null;
  crop: string | null;
  blockIds: string[];
  positions: ResistancePlanPosition[];
  notes: string | null;
  rulesetId: string | null;
  rulesetVersion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  clientUpdatedAt: string | null;
  /** SQL 198 — exactly as loaded. Never incremented by the client. */
  serverRevision: number | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function planFromRow(row: Record<string, any>): ResistancePlan {
  return {
    id: String(row.id),
    vineyardId: String(row.vineyard_id ?? ""),
    seasonId: str(row.season_id) ?? "",
    disease: str(row.disease) ?? "",
    jurisdiction: str(row.jurisdiction),
    crop: str(row.crop),
    blockIds: (Array.isArray(row.block_ids) ? row.block_ids : [])
      .map((b: unknown) => str(b))
      .filter((b: string | null): b is string => !!b),
    positions: parsePositions(row.positions),
    notes: str(row.notes),
    rulesetId: str(row.ruleset_id),
    rulesetVersion: str(row.ruleset_version),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    createdBy: str(row.created_by),
    updatedBy: str(row.updated_by),
    deletedAt: str(row.deleted_at),
    clientUpdatedAt: str(row.client_updated_at),
    serverRevision: numOrNull(row.server_revision),
  };
}

/**
 * The mutable payload. Deliberately excludes `server_revision` (server owned),
 * `base_revision` (added by the revision-write helper) and every derived
 * resistance value (never persisted).
 */
export function planWritePayload(plan: ResistancePlan): Record<string, unknown> {
  return {
    vineyard_id: plan.vineyardId,
    season_id: plan.seasonId,
    disease: plan.disease,
    jurisdiction: plan.jurisdiction,
    crop: plan.crop ?? "grape",
    block_ids: plan.blockIds,
    positions: serialisePositions(plan.positions),
    notes: plan.notes,
    ruleset_id: plan.rulesetId,
    ruleset_version: plan.rulesetVersion,
    client_updated_at: new Date().toISOString(),
  };
}

/** Ruleset provenance drift between a saved plan and the active engine ruleset. */
export interface RulesetDrift {
  drifted: boolean;
  storedId: string | null;
  storedVersion: string | null;
  currentId: string | null;
  currentVersion: string | null;
}

export function rulesetDrift(
  plan: Pick<ResistancePlan, "rulesetId" | "rulesetVersion">,
  current: { id: string | null; version: string | null },
): RulesetDrift {
  const stored = { id: plan.rulesetId, version: plan.rulesetVersion };
  const drifted =
    !!stored.id &&
    !!current.id &&
    (stored.id !== current.id || (stored.version ?? "") !== (current.version ?? ""));
  return {
    drifted,
    storedId: stored.id,
    storedVersion: stored.version,
    currentId: current.id,
    currentVersion: current.version,
  };
}

export const RULESET_DRIFT_MESSAGE =
  "Resistance strategy rules have been updated since this plan was saved. Review the current assessment.";

/** Minimum meaningful data to save. Group-first: a product is never required. */
export function planValidationIssues(plan: ResistancePlan): string[] {
  const issues: string[] = [];
  if (!plan.vineyardId) issues.push("No vineyard selected.");
  if (!plan.seasonId) issues.push("Choose a season.");
  if (plan.disease !== "powdery_mildew" && plan.disease !== "downy_mildew") {
    issues.push("Choose a supported disease.");
  }
  if (plan.blockIds.length === 0) issues.push("Select at least one block.");
  if (plan.positions.length === 0) issues.push("Add at least one planned position.");
  else if (plan.positions.some((p) => !positionIsPlannable(p))) {
    issues.push("Every planned position needs an activity group.");
  }
  return issues;
}
