// Pin colour mapping — mirrors the iOS app's pin category palette.
// Source: docs/web-portal-map-style.md §"Suggested category colours" and the
// iOS UIColor system tints used by the field app.
//
// Priority (per product direction 2026-05):
//   1. Resolve `mode` (or `category` fallback) against the iOS palette.
//   2. Only honour a per-pin `button_color` when the mode/category is unknown
//      AND the stored hex is clearly a deliberate custom colour (a valid hex
//      that is not one of the legacy palette/default greys).
//   3. Otherwise fall back to systemGray.
//
// Rationale: legacy iOS pins all carry the same default `button_color`, which
// previously masked the category-based palette and made every pin look the
// same in the portal.

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

// systemGray fallback for unknown modes/categories.
const DEFAULT_STYLE: PinStyle = { hex: "#8E8E93", label: "Other" };

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

// Hex values we treat as "legacy/default" — i.e. NOT a deliberate user choice.
// Includes the systemGray default and every palette colour itself (so a
// stored palette hex on an unknown-mode pin still gets routed to the palette
// label rather than overriding it).
const LEGACY_HEXES = new Set<string>(
  [DEFAULT_STYLE.hex, ...Object.values(PALETTE).map((p) => p.hex)].map((h) =>
    h.toUpperCase(),
  ),
);

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
 * @param buttonColor  pin.button_color (legacy/custom hex)
 * @param category     pin.category (fallback classifier)
 */
export function pinStyle(
  mode?: string | null,
  buttonColor?: string | null,
  category?: string | null,
): PinStyle {
  // 1. Category palette is the source of truth.
  const fromMode = lookupPalette(mode) ?? lookupPalette(category);
  if (fromMode) return fromMode;

  // 2. Only honour button_color if it's a deliberate custom hex.
  if (buttonColor) {
    const hex = normalizeHex(buttonColor);
    if (hex && !LEGACY_HEXES.has(hex)) {
      return { hex, label: "Custom" };
    }
  }

  // 3. Fallback.
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
