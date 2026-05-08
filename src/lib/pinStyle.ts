// Pin color mapping — mirrors the iOS app's pin category palette.
// Source: docs/web-portal-map-style.md §"Suggested category colours" and the
// iOS UIColor system tints used by the field app.
//
// If a pin carries a per-pin `button_color` (hex) from iOS, prefer that exact
// value — it is the authoritative colour the operator saw.
export interface PinStyle {
  hex: string;
  label: string;
}

// iOS system colours (matches UIKit systemRed / systemGreen / etc.)
const STYLES: Record<string, PinStyle> = {
  repair: { hex: "#FF3B30", label: "Repair" },
  repairs: { hex: "#FF3B30", label: "Repair" },
  growth: { hex: "#34C759", label: "Growth" },
  note: { hex: "#007AFF", label: "Note" },
  notes: { hex: "#007AFF", label: "Note" },
  hazard: { hex: "#FFCC00", label: "Hazard" },
  spray: { hex: "#AF52DE", label: "Spray" },
};

// systemGray fallback for unknown modes.
const DEFAULT_STYLE: PinStyle = { hex: "#8E8E93", label: "Other" };

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (!HEX_RE.test(s)) return null;
  return s.startsWith("#") ? s.toUpperCase() : `#${s.toUpperCase()}`;
}

export function pinStyle(mode?: string | null, buttonColor?: string | null): PinStyle {
  const base = mode ? STYLES[mode.toLowerCase()] ?? DEFAULT_STYLE : DEFAULT_STYLE;
  if (buttonColor) {
    const hex = normalizeHex(buttonColor);
    if (hex) return { hex, label: base.label };
  }
  return base;
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
  // Preserve existing decimals; trim trailing zeros beyond the operational form.
  const s = n.toString();
  return s;
}
