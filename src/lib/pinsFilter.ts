// Pure helpers for the Pins page filter section.
// Placement data always comes from the canonical `pin_placements` view.
import type { PinPlacementRow } from "@/lib/pinPlacement";

/** Row numbers a pin occupies, derived only from canonical placement fields. */
export function placementRowNumbers(row: PinPlacementRow | null | undefined): number[] {
  if (!row) return [];
  const out: number[] = [];
  const push = (v: unknown) => {
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  };
  push(row.pin_row_number);
  push(row.driving_row_number);
  // Row-segment pins only expose their rows through the server row summary.
  const summary = (row.row_summary ?? "").trim();
  if (summary) {
    for (const m of summary.matchAll(/\d+(?:\.\d+)?/g)) push(m[0]);
  }
  return out;
}

/**
 * True when a pin falls inside an (optional) inclusive row range.
 * A pin with no row information is excluded as soon as either bound is set.
 */
export function matchesRowRange(
  row: PinPlacementRow | null | undefined,
  from: number | null,
  to: number | null,
): boolean {
  if (from == null && to == null) return true;
  const nums = placementRowNumbers(row);
  if (!nums.length) return false;
  return nums.some((n) => (from == null || n >= from) && (to == null || n <= to));
}

/** Parse a row-range input value; blank/invalid becomes null. */
export function parseRowBound(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Case-insensitive search across the pin's text fields plus its block/row labels. */
export function matchesPinSearch(
  pin: Record<string, unknown>,
  blockLabel: string,
  rowLabel: string,
  term: string,
): boolean {
  const f = term.trim().toLowerCase();
  if (!f) return true;
  const haystack = [
    pin.title,
    pin.button_name,
    pin.mode,
    pin.category,
    pin.priority,
    pin.status,
    pin.notes,
    blockLabel,
    rowLabel,
  ];
  return haystack.some((v) => String(v ?? "").toLowerCase().includes(f));
}
