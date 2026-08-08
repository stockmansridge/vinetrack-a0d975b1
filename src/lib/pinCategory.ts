// Pin category → colour contract (shared with iOS / Android).
//
// Colour resolution order for a recognised category:
//   1. The current vineyard's configured colour for the stable
//      category/button id (see pinCategoryConfig.ts)
//   2. The canonical fallback colour below
//   3. Neutral grey
//
// Colour is derived ONLY from the stable category identity. It is never
// derived from the stored marker colour, the title text, completion
// status, missing block/row placement, sync state, creator, source
// platform, or manual-vs-GPS creation.
//
// Placement (block / row assignment) is a SEPARATE concern — an
// unassigned pin keeps its category colour and gains an amber warning.

export type PinCategoryId =
  | "vine_issue"
  | "broken_post"
  | "broken_wire"
  | "irrigation"
  | "other"
  | "unknown";

export interface PinCategoryStyle {
  id: PinCategoryId;
  label: string;
  /** Canonical colour token name (green / brown / orange / blue / grey). */
  token: string;
  hex: string;
}

const CATEGORY_STYLES: Record<PinCategoryId, PinCategoryStyle> = {
  vine_issue: { id: "vine_issue", label: "Vine Issue", token: "green", hex: "#34C759" },
  broken_post: { id: "broken_post", label: "Broken Post", token: "brown", hex: "#A2845E" },
  broken_wire: { id: "broken_wire", label: "Broken Wire", token: "orange", hex: "#FF9500" },
  irrigation: { id: "irrigation", label: "Irrigation", token: "blue", hex: "#007AFF" },
  other: { id: "other", label: "Other", token: "grey", hex: "#8E8E93" },
  unknown: { id: "unknown", label: "Unknown", token: "grey", hex: "#8E8E93" },
};

export const PIN_CATEGORY_ORDER: PinCategoryId[] = [
  "vine_issue",
  "broken_post",
  "broken_wire",
  "irrigation",
  "other",
  "unknown",
];

/** Accepted spellings coming from mobile / legacy button names. */
const SYNONYMS: Record<string, PinCategoryId> = {
  vine_issue: "vine_issue",
  vineissue: "vine_issue",
  vine: "vine_issue",
  vines: "vine_issue",
  deadvine: "vine_issue",
  missingvine: "vine_issue",
  broken_post: "broken_post",
  brokenpost: "broken_post",
  post: "broken_post",
  posts: "broken_post",
  broken_wire: "broken_wire",
  brokenwire: "broken_wire",
  wire: "broken_wire",
  wires: "broken_wire",
  irrigation: "irrigation",
  dripper: "irrigation",
  sprinkler: "irrigation",
  water: "irrigation",
  other: "other",
  general: "other",
  misc: "other",
  unknown: "unknown",
};

export function normaliseKey(raw?: string | null): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  return s.replace(/[\s-]+/g, "") || null;
}

const key = normaliseKey;

function match(raw?: string | null): PinCategoryId | null {
  const k = key(raw);
  if (!k) return null;
  return SYNONYMS[k] ?? SYNONYMS[k.replace(/_/g, "")] ?? null;
}

export interface PinCategoryLike {
  category_id?: string | null;
  category?: string | null;
  button_name?: string | null;
  button_id?: string | null;
  button_key?: string | null;
  mode?: string | null;
}

/**
 * Resolve the stable, normalised category id for a pin.
 * Order: category_id (canonical from mobile) → category → button_name.
 * Anything unrecognised (or missing) resolves to `unknown`.
 */
export function normalisePinCategoryId(pin: PinCategoryLike): PinCategoryId {
  return (
    match(pin.category_id) ??
    match(pin.category) ??
    match(pin.button_name) ??
    "unknown"
  );
}

export function pinCategoryStyleById(id: PinCategoryId): PinCategoryStyle {
  return CATEGORY_STYLES[id] ?? CATEGORY_STYLES.unknown;
}

/** Canonical colour/label for a pin's category. */
export function pinCategoryStyle(pin: PinCategoryLike): PinCategoryStyle {
  return pinCategoryStyleById(normalisePinCategoryId(pin));
}

export function pinCategoryColour(pin: PinCategoryLike): string {
  return pinCategoryStyle(pin).hex;
}

export function pinCategoryLabel(pin: PinCategoryLike): string {
  return pinCategoryStyle(pin).label;
}

// ---------- Placement ----------
//
// Placement/assignment is NOT derived here any more. The canonical source is
// the SQL 171 view `public.pin_placements` — see `src/lib/pinPlacement.ts`.
// The old `pinPlacement()` helper (paddock_id && row heuristics) was removed.
