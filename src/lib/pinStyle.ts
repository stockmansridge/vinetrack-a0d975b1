// Pin colour mapping — mirrors the iOS app's per-button colour palette.
//
// In the iOS app every Repair / Growth button (e.g. "Irrigation",
// "Broken Post", "Vine Issue", "Powdery", "Downy", "Blackberries")
// has its own colour stored on `ButtonConfig.color`. When a pin is
// dropped, that button colour is written to `pins.button_color` —
// usually as a SwiftUI colour name like "blue", "brown", "darkgreen",
// "yellow", or as a `#RRGGBB` hex string.
//
// To make Lovable pins match the iOS app, the resolver order is:
//
//   1. pin.button_color  → SwiftUI named colour or hex string.
//      This is the per-button colour the user actually sees in the
//      iOS app, so it wins whenever it's present.
//   2. pin.mode / pin.category  → broad mode palette
//      (Repair / Growth / Note / Hazard / Spray).
//   3. Neutral default.
//
// All consumers (overview map, live dashboard map, pins page, pin
// detail panel, trip report) call `pinStyle(mode, button_color,
// category)` so changing the resolver here updates every surface.

export interface PinStyle {
  hex: string;
  label: string;
}

// Broad mode palette — used when no per-button colour is stored.
// Hexes match iOS UIKit system tints.
const MODE_PALETTE: Record<string, PinStyle> = {
  repair: { hex: "#FF3B30", label: "Repair" },
  repairs: { hex: "#FF3B30", label: "Repair" },
  growth: { hex: "#34C759", label: "Growth" },
  note: { hex: "#007AFF", label: "Note" },
  notes: { hex: "#007AFF", label: "Note" },
  hazard: { hex: "#FFCC00", label: "Hazard" },
  spray: { hex: "#AF52DE", label: "Spray" },
};

// SwiftUI / UIKit named colours → hex. Light-mode system tints where
// applicable so the web matches what the iOS button shows on screen.
const NAMED_COLORS: Record<string, string> = {
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#FFCC00",
  green: "#34C759",
  darkgreen: "#1B7F3B",
  mint: "#00C7BE",
  teal: "#30B0C7",
  cyan: "#32ADE6",
  blue: "#007AFF",
  indigo: "#5856D6",
  purple: "#AF52DE",
  pink: "#FF2D55",
  brown: "#A2845E",
  gray: "#8E8E93",
  grey: "#8E8E93",
  black: "#000000",
  white: "#FFFFFF",
};

const DEFAULT_STYLE: PinStyle = { hex: "#8E8E93", label: "Other" };

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (!HEX_RE.test(s)) return null;
  return (s.startsWith("#") ? s : `#${s}`).toUpperCase();
}

function lookupMode(key?: string | null): PinStyle | null {
  if (!key) return null;
  const k = key.trim().toLowerCase();
  if (!k) return null;
  return MODE_PALETTE[k] ?? null;
}

function lookupNamedColor(key: string): string | null {
  const k = key.trim().toLowerCase().replace(/\s+/g, "");
  return NAMED_COLORS[k] ?? null;
}

/**
 * Resolve a pin's display colour and label.
 *
 * @param mode         pin.mode  (broad classifier — Repair / Growth / …)
 * @param buttonColor  pin.button_color  (the per-button colour from iOS;
 *                     usually a SwiftUI colour name or `#RRGGBB`)
 * @param category     pin.category  (fallback classifier)
 */
export function pinStyle(
  mode?: string | null,
  buttonColor?: string | null,
  category?: string | null,
): PinStyle {
  const modeStyle = lookupMode(mode) ?? lookupMode(category);

  // 1. Per-button colour wins — that's the colour the user dropped.
  if (buttonColor && buttonColor.trim()) {
    const raw = buttonColor.trim();

    // Named SwiftUI colour (e.g. "blue", "brown", "darkgreen").
    const named = lookupNamedColor(raw);
    if (named) {
      return { hex: named, label: modeStyle?.label ?? DEFAULT_STYLE.label };
    }

    // Explicit hex (e.g. "#A2845E" or "A2845E").
    const hex = normalizeHex(raw);
    if (hex) {
      return { hex, label: modeStyle?.label ?? DEFAULT_STYLE.label };
    }
  }

  // 2. Fall back to the broad mode/category palette.
  if (modeStyle) return modeStyle;

  // 3. Neutral default.
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
