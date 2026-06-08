// Display-only formatting helpers for trip-related values.
// These NEVER change stored values — they only clean up the labels shown
// in the portal so iOS-stored internal keys (e.g. "everySecondRow") read
// as friendly labels (e.g. "EverySecondRow").

/** Convert an internal pattern key into a PascalCase display label.
 *  Handles camelCase, snake_case, kebab-case and lower/upper input.
 *  Preserves digit-only tokens (e.g. "5/3" → "5/3"). */
export function formatTripPatternLabel(value?: string | null): string {
  if (value == null) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";

  // Leave values that already contain non-word delimiters like "/" alone
  // (e.g. "5/3") so they round-trip unchanged.
  if (/[\/\\]/.test(raw)) return raw;

  // Split on common separators OR camelCase boundaries.
  const parts = raw
    .replace(/[_\-\s]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return raw;

  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

/** Function label is sourced from tripFunctionLabel; this wrapper just
 *  normalises empty values to em-dash and title-cases any unknown raw
 *  single-word values defensively. */
export function formatTripFunctionLabel(
  raw?: string | null,
  knownLabel?: string | null,
): string {
  if (knownLabel && knownLabel.trim()) return knownLabel;
  if (!raw) return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  // For unknown camelCase/snake_case raw values, reuse pattern formatter
  // so we don't surface obviously internal keys.
  return formatTripPatternLabel(s);
}

const KNOWN_PATTERN_KEYS = new Set([
  "sequential",
  "everysecondrow",
  "every_second_row",
  "every-second-row",
  "alternaterows",
  "alternate_rows",
  "fivethree",
  "five_three",
]);

/** Decide a friendly trip name.
 *  - If trip_title looks like an internal pattern key, format it.
 *  - Otherwise preserve user wording. */
export function formatTripNameLabel(
  tripTitle?: string | null,
  pattern?: string | null,
  fallback?: string | null,
): string {
  const title = (tripTitle ?? "").trim();
  if (title) {
    if (KNOWN_PATTERN_KEYS.has(title.toLowerCase())) {
      return formatTripPatternLabel(title);
    }
    return title;
  }
  if (pattern && String(pattern).trim()) {
    return formatTripPatternLabel(pattern);
  }
  if (fallback && fallback.trim()) return fallback;
  return "—";
}

/** Format a duration as "X min" or "H h M min". Avoids the ambiguous "m"
 *  which can be confused with metres in distance columns. */
export function formatTripDurationLabel(
  start?: string | null,
  end?: string | null,
): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
