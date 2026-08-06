// Unified Add Pin / Action (SQL 170) — shared with iOS and Android.
//
// One creation workflow for every pin: choose a location, choose a pin type
// (Repair / Growth / Custom), choose a button, save.
//
// Repair and Growth pins are written to the shared `pins` table with the
// mobile modes 'Repairs' / 'Growth'. Custom pins go through the SQL 170
// `create_custom_pin` RPC with mode 'ManualIssue'.
//
// Pure logic only — nothing here touches the network.

import { parseColourToken } from "@/lib/colourToken";
import { buildSegments, parseRowSelection, ROW_SEGMENTS, type RowSegment } from "@/lib/manualIssues";
import type { LatLng } from "@/lib/paddockGeometry";

export type UnifiedPinType = "repair" | "growth" | "custom";
export type UnifiedPinScope = "point" | "row" | "block";

export const UNIFIED_PIN_TYPES: UnifiedPinType[] = ["repair", "growth", "custom"];
export const UNIFIED_PIN_SCOPES: UnifiedPinScope[] = ["point", "row", "block"];

export const PIN_TYPE_LABELS: Record<UnifiedPinType, string> = {
  repair: "Repair",
  growth: "Growth",
  custom: "Custom",
};

export const SCOPE_LABELS: Record<UnifiedPinScope, string> = {
  point: "Drop a pin",
  row: "Select a row",
  block: "Select a block",
};

/** Pin mode stored on the shared record for each pin type. */
export const PIN_TYPE_MODE: Record<UnifiedPinType, string> = {
  repair: "Repairs",
  growth: "Growth",
  custom: "ManualIssue",
};

// ------------------------------------------------------------- button sets

export interface PinButtonDef {
  /** Stable identifier from the vineyard configuration. */
  id: string;
  name: string;
  colour: string | null;
  growthStageCode: string | null;
}

const ID_FIELDS = ["category_id", "categoryId", "button_id", "buttonId", "id", "key", "slug", "code"];
const NAME_FIELDS = ["name", "label", "title", "button_name", "buttonName", "category"];
const COLOUR_FIELDS = ["color", "colour", "hex", "hex_color", "hexColor", "button_color", "buttonColor", "tint"];
const STAGE_FIELDS = ["growth_stage_code", "growthStageCode", "stage_code", "stageCode"];

function firstString(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toArray(configData: unknown): Record<string, unknown>[] {
  if (Array.isArray(configData)) {
    return configData.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  if (configData && typeof configData === "object") {
    const nested = (configData as Record<string, unknown>).buttons;
    if (Array.isArray(nested)) {
      return nested.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    }
  }
  return [];
}

export interface ButtonConfigRow {
  config_type?: string | null;
  config_data?: unknown;
}

/**
 * Build the Repair / Growth button catalogues from `vineyard_button_configs`.
 * Buttons without a usable name are ignored.
 */
export function parseButtonCatalogue(
  rows: ButtonConfigRow[] | null | undefined,
): { repair: PinButtonDef[]; growth: PinButtonDef[] } {
  const out = { repair: [] as PinButtonDef[], growth: [] as PinButtonDef[] };
  for (const row of rows ?? []) {
    const type = String(row?.config_type ?? "").toLowerCase();
    const target = type.includes("repair") ? out.repair : type.includes("growth") ? out.growth : null;
    if (!target) continue;
    for (const button of toArray(row?.config_data)) {
      const name = firstString(button, NAME_FIELDS);
      if (!name) continue;
      const id = firstString(button, ID_FIELDS) ?? name;
      if (target.some((b) => b.id === id)) continue;
      target.push({
        id,
        name,
        colour: parseColourToken(firstString(button, COLOUR_FIELDS)),
        growthStageCode: firstString(button, STAGE_FIELDS),
      });
    }
}

// ------------------------------------------------- left / right normalising

/**
 * The Repair and Growth catalogues historically hold one record per side
 * ("Powdery Left" / "Powdery Right"). The unified composer does not track a
 * side, so the two records collapse to one selectable button. The catalogue
 * itself is never rewritten — older workflows still reference both records.
 */
const SIDE_PATTERN =
  /(^|[\s_\-–—([]+)(left|right|lhs|rhs|l|r)([\s_\-–—)\]]*)$/i;

/** Strip a trailing side marker from a display name or identifier. */
export function stripSideToken(value: string): string {
  const cleaned = value.replace(SIDE_PATTERN, "").trim().replace(/[\s_\-]+$/, "");
  return cleaned || value.trim();
}

/** Canonical, side-free key a button is deduplicated on. */
export function canonicalButtonKey(button: PinButtonDef): string {
  const base = stripSideToken(button.name);
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Collapse left/right variants to one button per logical type, preserving the
 * canonical base identifier where the id itself carries the side marker.
 */
export function dedupePinButtons(buttons: PinButtonDef[]): PinButtonDef[] {
  const out: PinButtonDef[] = [];
  const seen = new Map<string, number>();
  for (const b of buttons) {
    const key = canonicalButtonKey(b);
    if (!key) continue;
    const baseId = stripSideToken(b.id);
    const canonical: PinButtonDef = {
      ...b,
      id: baseId !== b.id ? baseId : b.id,
      name: stripSideToken(b.name),
    };
    const at = seen.get(key);
    if (at == null) {
      seen.set(key, out.length);
      out.push(canonical);
      continue;
    }
    // Keep the first record, but fill any detail the first variant lacked.
    const existing = out[at];
    out[at] = {
      ...existing,
      colour: existing.colour ?? canonical.colour,
      growthStageCode: existing.growthStageCode ?? canonical.growthStageCode,
    };
  }
  return out;
}

/** True when the button is the "Growth Stage" action that opens the stage picker. */
export function isGrowthStageButton(button: PinButtonDef | null | undefined): boolean {
  if (!button) return false;
  return canonicalButtonKey(button) === "growthstage";
}

  return out;
}

// ------------------------------------------------------------- custom types

export interface CustomPinType {
  id: string;
  name: string;
  colour: string | null;
  icon: string | null;
  isActive: boolean;
}

export function normaliseCustomPinType(raw: any): CustomPinType {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? raw?.title ?? "").trim(),
    colour: parseColourToken(raw?.color ?? raw?.colour ?? null),
    icon: raw?.icon ?? null,
    isActive: raw?.is_active !== false,
  };
}

// ------------------------------------------------------------------- form

export interface UnifiedPinForm {
  scope: UnifiedPinScope;
  paddockId: string | null;
  /** point-only */
  latitude: number | null;
  longitude: number | null;
  drivingRowNumber: number | null;
  /** row-only */
  rowSelection: string;
  rowSections: number[];
  /** step 2 / 3 */
  pinType: UnifiedPinType;
  buttonId: string | null;
  customTypeId: string | null;
  notes: string;
}

export function emptyUnifiedPinForm(): UnifiedPinForm {
  return {
    scope: "point",
    paddockId: null,
    latitude: null,
    longitude: null,
    drivingRowNumber: null,
    rowSelection: "",
    rowSections: [...ROW_SEGMENTS],
    pinType: "repair",
    buttonId: null,
    customTypeId: null,
    notes: "",
  };
}

/** Clear location state that no longer applies when the scope changes. */
export function applyPinScopeChange(form: UnifiedPinForm, next: UnifiedPinScope): UnifiedPinForm {
  if (form.scope === next) return form;
  const base: UnifiedPinForm = { ...form, scope: next };
  if (next !== "point") {
    base.latitude = null;
    base.longitude = null;
    base.drivingRowNumber = null;
  }
  if (next !== "row") {
    base.rowSelection = "";
    base.rowSections = [...ROW_SEGMENTS];
  }
  return base;
}

export function validatePinLocation(form: UnifiedPinForm): string | null {
  if (!UNIFIED_PIN_SCOPES.includes(form.scope)) return "Choose a location type.";
  if (form.scope === "point" && (form.latitude == null || form.longitude == null)) {
    return "Tap the map to place the pin.";
  }
  if (form.scope === "block" && !form.paddockId) return "Choose a block.";
  if (form.scope === "row") {
    if (!form.paddockId) return "Choose a block.";
    if (!parseRowSelection(form.rowSelection).length) return "Select at least one row.";
    if (!form.rowSections.length) return "Select at least one row section.";
  }
  return null;
}

export function validateUnifiedPin(form: UnifiedPinForm): string | null {
  const location = validatePinLocation(form);
  if (location) return location;
  if (form.pinType === "custom") {
    if (!form.customTypeId) return "Choose a custom item.";
    return null;
  }
  if (!form.buttonId) return `Choose a ${PIN_TYPE_LABELS[form.pinType].toLowerCase()} button.`;
  return null;
}

/** Segments payload for row-scoped pins, otherwise null. */
export function pinSegments(form: UnifiedPinForm): RowSegment[] | null {
  if (form.scope !== "row") return null;
  const segs = buildSegments(parseRowSelection(form.rowSelection), form.rowSections);
  return segs.length ? segs : null;
}

/** Simple polygon centroid used for block-scoped pins. */
export function polygonCentroid(points: LatLng[] | null | undefined): LatLng | null {
  if (!points || !points.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

// ---------------------------------------------------------- write payloads

export interface CustomPinArgs {
  p_id: string;
  p_vineyard_id: string;
  p_custom_type_id: string;
  p_title: string;
  p_location_scope: UnifiedPinScope;
  p_paddock_id: string | null;
  p_latitude: number | null;
  p_longitude: number | null;
  p_snapped_latitude: number | null;
  p_snapped_longitude: number | null;
  p_driving_row_number: number | null;
  p_pin_row_number: number | null;
  p_along_row_distance_m: number | null;
  p_snapped_to_row: boolean | null;
  p_notes: string | null;
  p_segments: RowSegment[] | null;
  p_client_updated_at: string;
}

export function buildCustomPinArgs(
  form: UnifiedPinForm,
  opts: {
    id: string;
    vineyardId: string;
    title: string;
    centre?: LatLng | null;
    clientUpdatedAt?: string;
  },
): CustomPinArgs {
  const lat = form.scope === "point" ? form.latitude : opts.centre?.lat ?? null;
  const lng = form.scope === "point" ? form.longitude : opts.centre?.lng ?? null;
  return {
    p_id: opts.id,
    p_vineyard_id: opts.vineyardId,
    p_custom_type_id: form.customTypeId!,
    p_title: opts.title,
    p_location_scope: form.scope,
    p_paddock_id: form.paddockId,
    p_latitude: lat,
    p_longitude: lng,
    p_snapped_latitude: null,
    p_snapped_longitude: null,
    p_driving_row_number: form.scope === "point" ? form.drivingRowNumber : null,
    p_pin_row_number: null,
    p_along_row_distance_m: null,
    p_snapped_to_row: null,
    p_notes: form.notes.trim() || null,
    p_segments: pinSegments(form),
    p_client_updated_at: opts.clientUpdatedAt ?? new Date().toISOString(),
  };
}

export interface PinInsertRow {
  id: string;
  vineyard_id: string;
  paddock_id: string | null;
  mode: string;
  title: string;
  button_name: string;
  button_color: string | null;
  category_id: string;
  category: string;
  growth_stage_code: string | null;
  latitude: number | null;
  longitude: number | null;
  driving_row_number: number | null;
  notes: string | null;
  is_completed: boolean;
  client_updated_at: string;
}

/** Row written to `pins` for Repair / Growth pins (the mobile shape). */
export function buildPinInsertRow(
  form: UnifiedPinForm,
  opts: {
    id: string;
    vineyardId: string;
    button: PinButtonDef;
    centre?: LatLng | null;
    clientUpdatedAt?: string;
  },
): PinInsertRow {
  const lat = form.scope === "point" ? form.latitude : opts.centre?.lat ?? null;
  const lng = form.scope === "point" ? form.longitude : opts.centre?.lng ?? null;
  return {
    id: opts.id,
    vineyard_id: opts.vineyardId,
    paddock_id: form.paddockId,
    mode: PIN_TYPE_MODE[form.pinType],
    title: opts.button.name,
    button_name: opts.button.name,
    button_color: opts.button.colour,
    category_id: opts.button.id,
    category: opts.button.name,
    growth_stage_code: opts.button.growthStageCode,
    latitude: lat,
    longitude: lng,
    driving_row_number: form.scope === "point" ? form.drivingRowNumber : null,
    notes: form.notes.trim() || null,
    is_completed: false,
    client_updated_at: opts.clientUpdatedAt ?? new Date().toISOString(),
  };
}
