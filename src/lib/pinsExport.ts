// Canonical Pin exports (SQL 171).
//
// Exports read `public.pins_export` ONLY. Placement columns are never
// rebuilt in Portal code — the server row is emitted verbatim.
import { fetchPinsExport } from "@/lib/pinPlacementQuery";

/** Canonical placement columns that must always be present in an export. */
export const PIN_EXPORT_PLACEMENT_COLUMNS = [
  "location_scope",
  "is_location_assigned",
  "location_assignment_basis",
  "block_id",
  "block_name",
  "row_summary",
  "latitude",
  "longitude",
  "location_warning_code",
] as const;

/** Columns hidden from customer-facing exports (internal identifiers). */
const HIDDEN = new Set(["vineyard_id"]);

/**
 * Ordered column list for an export: canonical placement columns first, then
 * every other field the server view supplies (preserved as-is).
 */
export function pinExportColumns(rows: Record<string, any>[]): string[] {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (HIDDEN.has(key)) continue;
      if ((PIN_EXPORT_PLACEMENT_COLUMNS as readonly string[]).includes(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(key);
    }
  }
  const first = extra.filter((k) => k === "pin_id" || k === "id" || k === "title");
  const rest = extra.filter((k) => !first.includes(k));
  return [...first, ...PIN_EXPORT_PLACEMENT_COLUMNS, ...rest];
}

function cell(v: any): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function pinExportRows(rows: Record<string, any>[]): string[][] {
  const cols = pinExportColumns(rows);
  return rows.map((r) => cols.map((c) => cell(r[c])));
}

export function pinsExportCsv(rows: Record<string, any>[]): string {
  const cols = pinExportColumns(rows);
  return [
    cols.map(csvEscape).join(","),
    ...pinExportRows(rows).map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
}

export async function downloadPinsCsv(vineyardId: string, vineyardName?: string | null) {
  const rows = await fetchPinsExport(vineyardId);
  const csv = pinsExportCsv(rows);
  const stem = `pins-${(vineyardName || "vineyard").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
