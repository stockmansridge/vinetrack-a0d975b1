// Pin colour mapping — mirrors the iOS app's pin category palette.
// Source: docs/web-portal-map-style.md §"Suggested category colours" and the
// iOS UIColor system tints used by the field app.
//
// Resolution priority (2026-05 v3, after inspecting real historical data):
//   1. mode / category → palette  (case-insensitive, trimmed)
//   2. button_color exactly equals a known palette hex → use that palette
//      entry. (iOS stores the displayed hex per pin; this lets historical
//      pins without a `mode` value still resolve to red/green/blue/etc.)
//   3. button_color is some other valid hex → treat as a deliberate custom
//      colour and use it as-is.
//   4. systemGray default.
//
// Notes:
//   - We previously *discarded* button_color when it matched a palette hex,
//     which left every historical iOS pin grey. That was wrong — iOS writes
//     the palette colour directly into button_color, so a palette match is
//     in fact the strongest signal we have when `mode` is absent.

export interface PinStyle {
  hex: string;
  label: string;
}

// iOS system colours (matches UIKit systemRed / systemGreen / etc.)
const PALETTE: Record<string, PinStyle> = {
  repair: { hex: "#FF3B30", label: "Repair" },
  repairs: { hex: "#FF3B30", label: "Repair" },
  growth: { hex: "#34C759", label: "Growth" },
  note: { hex: "#007AFF", label: "Note" },
  notes: { hex: "#007AFF", label: "Note" },
  hazard: { hex: "#FFCC00", label: "Hazard" },
  spray: { hex: "#AF52DE", label: "Spray" },
};

const DEFAULT_STYLE: PinStyle = { hex: "#8E8E93", label: "Other" };

// Reverse map: hex → palette entry, for resolving by stored button_color.
const HEX_TO_PALETTE: Map<string, PinStyle> = new Map(
  Object.values(PALETTE).map((p) => [p.hex.toUpperCase(), p]),
);

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (!HEX_RE.test(s)) return null;
  return (s.startsWith("#") ? s : `#${s}`).toUpperCase();
}

function lookupPalette(key?: string | null): PinStyle | null {
  if (!key) return null;
  const k = key.trim().toLowerCase();
  if (!k) return null;
  return PALETTE[k] ?? null;
}

/**
 * Resolve a pin's display colour.
 *
 * @param mode         pin.mode (preferred classifier)
 * @param buttonColor  pin.button_color (per-pin hex written by iOS)
 * @param category     pin.category (fallback classifier)
 */
export function pinStyle(
  mode?: string | null,
  buttonColor?: string | null,
  category?: string | null,
): PinStyle {
  // 1. Category palette (case-insensitive).
  const fromMode = lookupPalette(mode) ?? lookupPalette(category);
  if (fromMode) return fromMode;

  // 2. button_color matches a known palette hex.
  if (buttonColor) {
    const hex = normalizeHex(buttonColor);
    if (hex) {
      const palette = HEX_TO_PALETTE.get(hex);
      if (palette) return palette;
      // 3. Custom hex.
      if (hex !== DEFAULT_STYLE.hex) return { hex, label: "Custom" };
    }
  }

  // 4. Fallback.
  return DEFAULT_STYLE;
}

// Row-number display: VineTrack stores whole-row integers but operationally
// rows are referred to as the .5 mid-row/path between adjacent rows. Show
// integer rows as `99.5`, preserve any existing decimal value as-is, and
// render null/undefined safely.
export function formatRowNumber(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return `${n}.5`;
  return n.toString();
}
