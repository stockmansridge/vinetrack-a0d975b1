// Vineyard-configured pin button colours.
//
// Source of truth: `vineyard_button_configs` (iOS project), one row per
// (vineyard_id, config_type) where config_type is `repair_buttons`,
// `growth_buttons` or `button_templates`. `config_data` is a JSON array of
// button definitions authored on iOS/Android.
//
// Colour is joined to pins by STABLE IDENTIFIER, never by display text
// alone. Match priority: category_id → button_id / stable button key →
// normalised legacy category or button name.
//
// An individual pin's stored `button_color` is NOT trusted: historical pins
// may carry a colour that no longer matches the vineyard's configuration.

import { parseColourToken } from "@/lib/colourToken";
import { normaliseKey, normalisePinCategoryId, type PinCategoryId } from "@/lib/pinCategory";

export interface PinCategoryColourMap {
  /** Normalised stable key (button id / category id / name) → hex. */
  byKey: Record<string, string>;
  /** Canonical category id → hex, when a configured button maps onto one. */
  byCategory: Partial<Record<PinCategoryId, string>>;
  /** Configured display label per canonical category, when available. */
  labelByCategory: Partial<Record<PinCategoryId, string>>;
}

export const EMPTY_PIN_CATEGORY_COLOURS: PinCategoryColourMap = {
  byKey: {},
  byCategory: {},
  labelByCategory: {},
};

const ID_FIELDS = ["category_id", "categoryId", "button_id", "buttonId", "id", "key", "slug", "code"];
const NAME_FIELDS = ["name", "label", "title", "button_name", "buttonName", "category"];
const COLOUR_FIELDS = ["color", "colour", "hex", "hex_color", "hexColor", "button_color", "buttonColor", "tint"];

function firstString(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toArray(configData: unknown): Record<string, unknown>[] {
  if (Array.isArray(configData)) return configData.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (configData && typeof configData === "object") {
    const nested = (configData as Record<string, unknown>).buttons;
    if (Array.isArray(nested)) return nested.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  return [];
}

export interface ButtonConfigRow {
  config_type?: string | null;
  config_data?: unknown;
}

/**
 * Build the colour lookup from raw `vineyard_button_configs` rows.
 * Invalid / unparseable colours are ignored so the canonical fallback wins.
 */
export function buildPinCategoryColours(rows: ButtonConfigRow[] | null | undefined): PinCategoryColourMap {
  const byKey: Record<string, string> = {};
  const byCategory: Partial<Record<PinCategoryId, string>> = {};
  const labelByCategory: Partial<Record<PinCategoryId, string>> = {};

  for (const row of rows ?? []) {
    for (const button of toArray(row?.config_data)) {
      const hex = parseColourToken(firstString(button, COLOUR_FIELDS));
      if (!hex) continue;

      const id = firstString(button, ID_FIELDS);
      const name = firstString(button, NAME_FIELDS);

      for (const raw of [id, name]) {
        const k = normaliseKey(raw);
        if (k && !byKey[k]) byKey[k] = hex;
      }

      const categoryId = normalisePinCategoryId({ category_id: id, category: name, button_name: name });
      if (categoryId !== "unknown" && !byCategory[categoryId]) {
        byCategory[categoryId] = hex;
        if (name) labelByCategory[categoryId] = name;
      }
    }
  }

  return { byKey, byCategory, labelByCategory };
}

/** Stable identifiers on a pin, in match priority order. */
export function pinStableKeys(pin: {
  category_id?: string | null;
  button_id?: string | null;
  button_key?: string | null;
  category?: string | null;
  button_name?: string | null;
}): string[] {
  return [pin.category_id, pin.button_id, pin.button_key, pin.category, pin.button_name]
    .map((v) => normaliseKey(v))
    .filter((v): v is string => !!v);
}

/**
 * Vineyard-configured colour for a pin, or null when unconfigured/invalid.
 * Never looks at the pin's own stored colour, placement, or status.
 */
export function configuredPinColour(
  pin: Parameters<typeof pinStableKeys>[0],
  colours: PinCategoryColourMap | null | undefined,
): string | null {
  if (!colours) return null;
  for (const k of pinStableKeys(pin)) {
    const hit = colours.byKey[k];
    if (hit) return hit;
  }
  const categoryId = normalisePinCategoryId(pin);
  return colours.byCategory[categoryId] ?? null;
}
