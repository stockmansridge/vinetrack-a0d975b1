// Shared colour-token parsing. Accepts SwiftUI/UIKit named colours (as the
// iOS button configuration stores them) or `#RRGGBB` / `RRGGBB` hex.

const NAMED_COLOURS: Record<string, string> = {
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#FFCC00",
  green: "#34C759",
  darkgreen: "#1B7F3B",
  lightgreen: "#6BD98A",
  mint: "#00C7BE",
  teal: "#30B0C7",
  cyan: "#32ADE6",
  blue: "#007AFF",
  lightblue: "#5AC8FA",
  indigo: "#5856D6",
  purple: "#AF52DE",
  violet: "#AF52DE",
  pink: "#FF2D55",
  magenta: "#FF2D55",
  brown: "#A2845E",
  tan: "#A2845E",
  gray: "#8E8E93",
  grey: "#8E8E93",
  black: "#000000",
  white: "#FFFFFF",
  amber: "#FF9500",
};

const HEX6 = /^#?[0-9a-fA-F]{6}$/;
const HEX3 = /^#?[0-9a-fA-F]{3}$/;

/**
 * Parse a stored colour token into an uppercase `#RRGGBB` string.
 * Returns null for empty / unrecognised / invalid values so callers can
 * fall back to the canonical palette.
 */
export function parseColourToken(raw?: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (HEX6.test(s)) return (s.startsWith("#") ? s : `#${s}`).toUpperCase();
  if (HEX3.test(s)) {
    const h = s.replace("#", "");
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  const named = NAMED_COLOURS[s.toLowerCase().replace(/[\s_-]+/g, "")];
  return named ?? null;
}
