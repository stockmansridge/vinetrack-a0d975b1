// Vineyard-configured pin button colours.
//
// Source of truth: `vineyard_button_configs` (iOS project), one row per
// (vineyard_id, config_type) where config_type is `repair_buttons`,
// `growth_buttons` or `button_templates`. `config_data` is a JSON array of
// button definitions authored on iOS/Android.
//
// Colour is joined to pins by the launcher button's stable identifier first.
// Canonical Repair identity and exact normalised name remain compatibility
// paths for historical pins that pre-date `pins.launcher_button_id`.
//
// An individual pin's stored `button_color` is NOT trusted: historical pins
// may carry a colour that no longer matches the vineyard's configuration.

import { parseColourToken } from "@/lib/colourToken";
import { normaliseKey, normalisePinCategoryId, type PinCategoryId } from "@/lib/pinCategory";

export interface PinCategoryColourMap {
  /** Normalised launcher button id → current configured hex. */
  byLauncherButtonId: Record<string, string>;
  /** Canonical Repair category id → current configured hex. */
  byCanonicalCategory: Partial<Record<PinCategoryId, string>>;
  /** Exact normalised legacy button name → current configured hex. */
  byNormalizedName: Record<string, string>;
  /** Exact normalised legacy names separated by Repair/Growth catalogue. */
  byNormalizedNameByMode: Record<"repair" | "growth", Record<string, string>>;
  /** Configured display label per canonical category, when available. */
  labelByCategory: Partial<Record<PinCategoryId, string>>;
  /** Current configured display label by launcher id/name. */
  labelByLauncherButtonId: Record<string, string>;
  labelByNormalizedName: Record<string, string>;
}

export const EMPTY_PIN_CATEGORY_COLOURS: PinCategoryColourMap = {
  byLauncherButtonId: {},
  byCanonicalCategory: {},
  byNormalizedName: {},
  byNormalizedNameByMode: { repair: {}, growth: {} },
  labelByCategory: {},
  labelByLauncherButtonId: {},
  labelByNormalizedName: {},
};

const LAUNCHER_ID_FIELDS = ["launcher_button_id", "launcherButtonId", "button_id", "buttonId", "id", "key", "slug", "code"];
const CATEGORY_ID_FIELDS = ["category_id", "categoryId"];
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
  const byLauncherButtonId: Record<string, string> = {};
  const byCanonicalCategory: Partial<Record<PinCategoryId, string>> = {};
  const byNormalizedName: Record<string, string> = {};
  const byNormalizedNameByMode = { repair: {} as Record<string, string>, growth: {} as Record<string, string> };
  const labelByCategory: Partial<Record<PinCategoryId, string>> = {};
  const labelByLauncherButtonId: Record<string, string> = {};
  const labelByNormalizedName: Record<string, string> = {};

  for (const row of rows ?? []) {
    const configType = String(row?.config_type ?? "").trim().toLowerCase();
    const isRepairConfig = configType.includes("repair");
    const configMode = isRepairConfig ? "repair" : configType.includes("growth") ? "growth" : null;
    for (const button of toArray(row?.config_data)) {
      const hex = parseColourToken(firstString(button, COLOUR_FIELDS));
      if (!hex) continue;

      const launcherButtonId = firstString(button, LAUNCHER_ID_FIELDS);
      const categoryIdentity = firstString(button, CATEGORY_ID_FIELDS) ?? launcherButtonId;
      const name = firstString(button, NAME_FIELDS);

      const launcherKey = normaliseKey(launcherButtonId);
      if (launcherKey && !byLauncherButtonId[launcherKey]) {
        byLauncherButtonId[launcherKey] = hex;
        if (name) labelByLauncherButtonId[launcherKey] = name;
      }

      const nameKey = normaliseKey(name);
      if (nameKey && !byNormalizedName[nameKey]) {
        byNormalizedName[nameKey] = hex;
        if (name) labelByNormalizedName[nameKey] = name;
      }
      if (nameKey && configMode && !byNormalizedNameByMode[configMode][nameKey]) {
        byNormalizedNameByMode[configMode][nameKey] = hex;
      }

      const categoryId = normalisePinCategoryId({ category_id: categoryIdentity, category: name, button_name: name });
      if (isRepairConfig && categoryId !== "unknown" && !byCanonicalCategory[categoryId]) {
        byCanonicalCategory[categoryId] = hex;
        if (name) labelByCategory[categoryId] = name;
      }
    }
  }

  return {
    byLauncherButtonId,
    byCanonicalCategory,
    byNormalizedName,
    byNormalizedNameByMode,
    labelByCategory,
    labelByLauncherButtonId,
    labelByNormalizedName,
  };
}

export interface PinColourIdentity {
  launcher_button_id?: string | null;
  category_id?: string | null;
  button_id?: string | null;
  button_key?: string | null;
  category?: string | null;
  button_name?: string | null;
  mode?: string | null;
}

export interface ConfiguredPinColour {
  hex: string;
  label: string | null;
  source: "launcher_button_id" | "canonical_category" | "normalized_name";
}

/** Compatibility helper used by older callers; launcher identity is first. */
export function pinStableKeys(pin: PinColourIdentity): string[] {
  return [pin.launcher_button_id, pin.category_id, pin.button_id, pin.button_key, pin.category, pin.button_name]
    .map((value) => normaliseKey(value))
    .filter((value): value is string => !!value);
}

/** Current-vineyard configuration match using the mobile precedence contract. */
export function configuredPinColourMatch(
  pin: PinColourIdentity,
  colours: PinCategoryColourMap | null | undefined,
): ConfiguredPinColour | null {
  if (!colours) return null;

  const launcherKey = normaliseKey(pin.launcher_button_id);
  if (launcherKey && colours.byLauncherButtonId[launcherKey]) {
    return {
      hex: colours.byLauncherButtonId[launcherKey],
      label: colours.labelByLauncherButtonId[launcherKey] ?? null,
      source: "launcher_button_id",
    };
  }

  const categoryId = normalisePinCategoryId(pin);
  const modeKey = String(pin.mode ?? "").trim().toLowerCase();
  const explicitCategoryId = normalisePinCategoryId({ category_id: pin.category_id });
  const canUseRepairCategory = modeKey === "repair" || modeKey === "repairs" || explicitCategoryId !== "unknown";
  if (canUseRepairCategory && categoryId !== "unknown" && colours.byCanonicalCategory[categoryId]) {
    return {
      hex: colours.byCanonicalCategory[categoryId] as string,
      label: colours.labelByCategory[categoryId] ?? null,
      source: "canonical_category",
    };
  }

  for (const rawName of [pin.button_name, pin.category]) {
    const nameKey = normaliseKey(rawName);
    const pinMode = modeKey === "repair" || modeKey === "repairs"
      ? "repair"
      : modeKey === "growth"
        ? "growth"
        : null;
    const matchedHex = nameKey
      ? pinMode
        ? colours.byNormalizedNameByMode[pinMode][nameKey]
        : colours.byNormalizedName[nameKey]
      : null;
    if (nameKey && matchedHex) {
      return {
        hex: matchedHex,
        label: colours.labelByNormalizedName[nameKey] ?? null,
        source: "normalized_name",
      };
    }
  }
  return null;
}

/**
 * Vineyard-configured colour for a pin, or null when unconfigured/invalid.
 * Never looks at the pin's own stored colour, placement, or status.
 */
export function configuredPinColour(
  pin: PinColourIdentity,
  colours: PinCategoryColourMap | null | undefined,
): string | null {
  return configuredPinColourMatch(pin, colours)?.hex ?? null;
}
