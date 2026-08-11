// Yield Analytics exports — follows the existing VineTrack export pattern
// (see manualIssuesExport.ts): pure row builder + CSV string + downloads.
import * as XLSX from "xlsx";
import type { YieldFact } from "@/lib/yieldAnalytics";

export const YIELD_ANALYTICS_COLUMNS = [
  "Vintage",
  "Block",
  "Variety",
  "Hectares",
  "Tonnes",
  "Tonnes/ha",
  "Avg $/tonne",
  "Crop revenue",
  "Revenue/ha",
  "Production cost",
  "Cost/ha",
  "Cost/tonne",
  "Gross margin",
  "Margin/ha",
  "Source",
] as const;

const n = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "" : Number(v).toFixed(dp);

export function yieldAnalyticsRows(facts: YieldFact[]): string[][] {
  return facts.map((f) => {
    const tPerHa = f.areaHa && f.areaHa > 0 ? f.tonnes / f.areaHa : null;
    const price = f.pricedTonnes > 0 && f.revenue != null ? f.revenue / f.pricedTonnes : null;
    const revPerHa = f.revenue != null && f.areaHa && f.areaHa > 0 ? f.revenue / f.areaHa : null;
    const costPerHa = f.cost != null && f.areaHa && f.areaHa > 0 ? f.cost / f.areaHa : null;
    const costPerT = f.cost != null && f.tonnes > 0 ? f.cost / f.tonnes : null;
    const margin = f.revenue != null && f.cost != null ? f.revenue - f.cost : null;
    const marginPerHa = margin != null && f.areaHa && f.areaHa > 0 ? margin / f.areaHa : null;
    return [
      f.vintage != null ? String(f.vintage) : "",
      f.blockName ?? "",
      f.variety ?? "",
      n(f.areaHa),
      n(f.tonnes, 3),
      n(tPerHa),
      n(price),
      n(f.revenue),
      n(revPerHa),
      n(f.cost),
      n(costPerHa),
      n(costPerT),
      n(margin),
      n(marginPerHa),
      f.source === "detailed" ? "Picking records" : "Manual actual yield",
    ];
  });
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function yieldAnalyticsCsv(facts: YieldFact[]): string {
  return [
    YIELD_ANALYTICS_COLUMNS.join(","),
    ...yieldAnalyticsRows(facts).map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadYieldAnalyticsCsv(facts: YieldFact[], filename = "yield-analytics.csv") {
  download(new Blob([yieldAnalyticsCsv(facts)], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadYieldAnalyticsXlsx(facts: YieldFact[], filename = "yield-analytics.xlsx") {
  const ws = XLSX.utils.aoa_to_sheet([
    [...YIELD_ANALYTICS_COLUMNS],
    ...yieldAnalyticsRows(facts),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Yield Analytics");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(new Blob([out], { type: "application/octet-stream" }), filename);
}
