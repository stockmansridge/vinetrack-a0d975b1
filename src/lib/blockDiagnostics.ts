// Pure diagnostic helpers for the System Admin Block Setup Troubleshooter.
// Read-only — never mutates customer data.
import type { AdminPaddock } from "@/lib/adminApi";

export type Severity = "critical" | "warning" | "info";
export type Category = "identity" | "geometry" | "rows" | "irrigation";

export interface BlockIssue {
  severity: Severity;
  category: Category;
  code: string;
  summary: string;
  detail?: string;
  suggestion?: string;
}

export interface BlockDiagnostic {
  vineyardId: string;
  vineyardName: string;
  paddock: AdminPaddock;
  issues: BlockIssue[];
  geometryStats: {
    pointCount: number;
    validCount: number;
    invalidCount: number;
    firstInvalidIndex: number | null;
    centroid: { lat: number; lng: number } | null;
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
    areaSqM: number | null;
    isClosed: boolean | null;
  };
  rowStats: {
    storedCount: number | null;
    actualCount: number;
    firstNumber: number | null;
    lastNumber: number | null;
    duplicates: number[];
    missingNumbers: number[];
    invalidGeometryCount: number;
  };
  irrigationStats: {
    flowLhr: number | null;
    emitterCount: number | null;
    emitterRateLhr: number | null;
    expectedFlowLhr: number | null;
    displayKlhr: number | null;
  };
}

const validLat = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
const validLng = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;

function polygonArea(points: Array<{ latitude: number; longitude: number }>): number {
  // Approx area in m² using equirectangular projection.
  if (points.length < 3) return 0;
  const R = 6378137;
  const lat0 = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const xy = points.map((p) => ({
    x: ((p.longitude * Math.PI) / 180) * R * cosLat,
    y: ((p.latitude * Math.PI) / 180) * R,
  }));
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2);
}

export function diagnosePaddock(
  paddock: AdminPaddock,
  vineyardName: string,
  ctx: { duplicateName?: boolean } = {},
): BlockDiagnostic {
  const issues: BlockIssue[] = [];
  const anyP = paddock as any;

  // A. Identity
  if (!paddock.id) issues.push({ severity: "critical", category: "identity", code: "missing_id", summary: "Missing block id" });
  if (!paddock.vineyard_id) issues.push({ severity: "critical", category: "identity", code: "missing_vineyard", summary: "Missing vineyard id" });
  if (!paddock.name || !paddock.name.trim()) issues.push({ severity: "warning", category: "identity", code: "missing_name", summary: "Block has no name" });
  if (ctx.duplicateName) issues.push({ severity: "warning", category: "identity", code: "duplicate_name", summary: `Duplicate block name in vineyard: "${paddock.name}"` });

  // B. Geometry
  const pts = paddock.polygon_points ?? [];
  let validCount = 0;
  let invalidCount = 0;
  let firstInvalidIndex: number | null = null;
  pts.forEach((p, i) => {
    if (p && validLat((p as any).latitude) && validLng((p as any).longitude)) validCount++;
    else {
      invalidCount++;
      if (firstInvalidIndex == null) firstInvalidIndex = i;
    }
  });
  let centroid: { lat: number; lng: number } | null = null;
  let bounds: BlockDiagnostic["geometryStats"]["bounds"] = null;
  let areaSqM: number | null = null;
  let isClosed: boolean | null = null;
  if (validCount >= 3) {
    const valid = pts.filter((p) => validLat((p as any).latitude) && validLng((p as any).longitude));
    centroid = {
      lat: valid.reduce((s, p) => s + p.latitude, 0) / valid.length,
      lng: valid.reduce((s, p) => s + p.longitude, 0) / valid.length,
    };
    bounds = {
      minLat: Math.min(...valid.map((p) => p.latitude)),
      maxLat: Math.max(...valid.map((p) => p.latitude)),
      minLng: Math.min(...valid.map((p) => p.longitude)),
      maxLng: Math.max(...valid.map((p) => p.longitude)),
    };
    areaSqM = polygonArea(valid);
    const first = valid[0];
    const last = valid[valid.length - 1];
    isClosed = Math.abs(first.latitude - last.latitude) < 1e-7 && Math.abs(first.longitude - last.longitude) < 1e-7;
  }

  if (!paddock.deleted_at) {
    if (pts.length === 0) {
      issues.push({ severity: "critical", category: "geometry", code: "no_polygon", summary: "Missing polygon geometry", suggestion: "Draw block boundary in Paddock Setup." });
    } else if (validCount < 3) {
      issues.push({ severity: "critical", category: "geometry", code: "too_few_points", summary: `Polygon has only ${validCount} valid points (need ≥3)` });
    }
    if (invalidCount > 0) {
      issues.push({ severity: "critical", category: "geometry", code: "invalid_vertices", summary: `${invalidCount} invalid polygon vertices`, detail: `First invalid index: ${firstInvalidIndex}` });
    }
    if (areaSqM != null && areaSqM > 0 && areaSqM < 50) {
      issues.push({ severity: "warning", category: "geometry", code: "tiny_area", summary: `Polygon area very small (${areaSqM.toFixed(1)} m²)` });
    }
    if (areaSqM != null && areaSqM > 5_000_000) {
      issues.push({ severity: "warning", category: "geometry", code: "huge_area", summary: `Polygon area extremely large (${(areaSqM / 10_000).toFixed(1)} ha)` });
    }
  }

  // C. Rows
  const rowsAny = (paddock.rows ?? []) as any[];
  const actualCount = rowsAny.length;
  const storedCount = paddock.row_count ?? null;
  const rowNumbers = rowsAny
    .map((r) => {
      if (r == null) return null;
      const v = r.row_number ?? r.number ?? r.index ?? r.first_row_number ?? null;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
  const presentNumbers = rowNumbers.filter((n): n is number => n != null);
  const duplicates: number[] = [];
  const seen = new Set<number>();
  for (const n of presentNumbers) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }
  const firstNumber = presentNumbers.length ? Math.min(...presentNumbers) : null;
  const lastNumber = presentNumbers.length ? Math.max(...presentNumbers) : null;
  const missingNumbers: number[] = [];
  if (firstNumber != null && lastNumber != null) {
    for (let i = Math.ceil(firstNumber); i <= Math.floor(lastNumber); i++) {
      if (!seen.has(i) && !seen.has(i + 0.5) && !seen.has(i - 0.5)) missingNumbers.push(i);
    }
  }
  let invalidGeometryCount = 0;
  rowsAny.forEach((r) => {
    const geom = r?.points ?? r?.geometry ?? r?.line ?? null;
    if (Array.isArray(geom)) {
      const bad = geom.some((pt: any) => !validLat(pt?.latitude) || !validLng(pt?.longitude));
      if (bad) invalidGeometryCount++;
    }
  });

  if (!paddock.deleted_at) {
    if (actualCount === 0) {
      issues.push({ severity: "warning", category: "rows", code: "no_rows", summary: "No row setup", suggestion: "Generate rows from Paddock Setup." });
    } else {
      if (storedCount != null && storedCount !== actualCount) {
        issues.push({ severity: "warning", category: "rows", code: "row_count_mismatch", summary: `Row count mismatch (stored ${storedCount}, actual ${actualCount})` });
      }
      if (rowNumbers.some((n) => n == null)) {
        issues.push({ severity: "warning", category: "rows", code: "missing_row_numbers", summary: `${rowNumbers.filter((n) => n == null).length} rows missing row number` });
      }
      if (duplicates.length) {
        issues.push({ severity: "warning", category: "rows", code: "duplicate_row_numbers", summary: `Duplicate row numbers: ${[...new Set(duplicates)].slice(0, 5).join(", ")}` });
      }
      if (firstNumber != null && lastNumber != null && firstNumber > lastNumber) {
        issues.push({ severity: "warning", category: "rows", code: "row_number_order", summary: `First row (${firstNumber}) is greater than last row (${lastNumber})` });
      }
      if (missingNumbers.length) {
        issues.push({ severity: "info", category: "rows", code: "row_gaps", summary: `Gaps in row numbering (${missingNumbers.length} missing)`, detail: missingNumbers.slice(0, 10).join(", ") });
      }
      if (invalidGeometryCount > 0) {
        issues.push({ severity: "warning", category: "rows", code: "invalid_row_geometry", summary: `${invalidGeometryCount} rows have invalid geometry` });
      }
    }
    if (anyP.row_width == null) issues.push({ severity: "info", category: "rows", code: "missing_row_width", summary: "Missing row spacing (row_width)" });
    if (anyP.vine_spacing == null) issues.push({ severity: "info", category: "rows", code: "missing_vine_spacing", summary: "Missing vine spacing" });
  }

  // D. Irrigation
  const flowLhr: number | null = numberOrNull(anyP.irrigation_flow_rate ?? anyP.flow_rate ?? anyP.flow_rate_lhr);
  const emitterCount: number | null = numberOrNull(anyP.emitter_count ?? anyP.number_of_emitters);
  const emitterRateLhr: number | null = numberOrNull(anyP.flow_per_emitter ?? anyP.emitter_rate ?? anyP.emitter_rate_lhr);
  const expectedFlowLhr =
    emitterCount != null && emitterRateLhr != null ? emitterCount * emitterRateLhr : null;
  const isIrrigated = anyP.is_irrigated === true || flowLhr != null || emitterCount != null || emitterRateLhr != null;
  if (!paddock.deleted_at && isIrrigated) {
    if (emitterCount == null) issues.push({ severity: "warning", category: "irrigation", code: "missing_emitter_count", summary: "Missing emitter count" });
    if (emitterRateLhr == null) issues.push({ severity: "warning", category: "irrigation", code: "missing_emitter_rate", summary: "Missing emitter rate (L/hr/emitter)" });
    if (flowLhr == null && expectedFlowLhr == null) {
      issues.push({ severity: "warning", category: "irrigation", code: "missing_flow", summary: "Missing irrigation flow rate" });
    }
    if (flowLhr != null && expectedFlowLhr != null) {
      const diff = Math.abs(flowLhr - expectedFlowLhr) / expectedFlowLhr;
      if (diff > 0.1) {
        issues.push({
          severity: "warning",
          category: "irrigation",
          code: "flow_mismatch",
          summary: `Flow rate doesn't match emitters × rate`,
          detail: `Stored ${flowLhr} L/hr vs expected ${expectedFlowLhr.toFixed(1)} L/hr`,
        });
      }
    }
  }

  return {
    vineyardId: paddock.vineyard_id,
    vineyardName,
    paddock,
    issues,
    geometryStats: {
      pointCount: pts.length,
      validCount,
      invalidCount,
      firstInvalidIndex,
      centroid,
      bounds,
      areaSqM,
      isClosed,
    },
    rowStats: {
      storedCount,
      actualCount,
      firstNumber,
      lastNumber,
      duplicates: [...new Set(duplicates)],
      missingNumbers,
      invalidGeometryCount,
    },
    irrigationStats: {
      flowLhr,
      emitterCount,
      emitterRateLhr,
      expectedFlowLhr,
      displayKlhr: flowLhr != null ? flowLhr / 1000 : expectedFlowLhr != null ? expectedFlowLhr / 1000 : null,
    },
  };
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function diagnoseVineyard(
  vineyardId: string,
  vineyardName: string,
  paddocks: AdminPaddock[],
): BlockDiagnostic[] {
  const nameCounts = new Map<string, number>();
  paddocks.forEach((p) => {
    if (p.deleted_at) return;
    const k = (p.name ?? "").trim().toLowerCase();
    if (!k) return;
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  });
  return paddocks.map((p) =>
    diagnosePaddock(p, vineyardName, {
      duplicateName: !p.deleted_at && (nameCounts.get((p.name ?? "").trim().toLowerCase()) ?? 0) > 1,
    }),
  );
}

export function buildTextReport(
  scope: string,
  diagnostics: BlockDiagnostic[],
  adminEmail?: string | null,
): string {
  const all = diagnostics.flatMap((d) => d.issues.map((i) => ({ d, i })));
  const counts = { critical: 0, warning: 0, info: 0 } as Record<Severity, number>;
  all.forEach(({ i }) => counts[i.severity]++);
  const vineyards = new Set(diagnostics.map((d) => d.vineyardId)).size;
  const lines: string[] = [];
  lines.push("VineTrack Web Portal Block Setup Diagnostic");
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (adminEmail) lines.push(`Admin user: ${adminEmail}`);
  lines.push(`Scope: ${scope}`);
  lines.push("");
  lines.push("Summary:");
  lines.push(`- Vineyards checked: ${vineyards}`);
  lines.push(`- Blocks checked: ${diagnostics.length}`);
  lines.push(`- Critical issues: ${counts.critical}`);
  lines.push(`- Warnings: ${counts.warning}`);
  lines.push(`- Info: ${counts.info}`);
  lines.push("");
  lines.push("Issues:");
  let n = 1;
  all.forEach(({ d, i }) => {
    lines.push(`${n}. ${d.vineyardName} / ${d.paddock.name || "(unnamed)"}`);
    lines.push(`   Severity: ${i.severity}`);
    lines.push(`   Category: ${i.category}`);
    lines.push(`   Issue: ${i.summary}`);
    if (i.detail) lines.push(`   Detail: ${i.detail}`);
    if (i.suggestion) lines.push(`   Suggested fix: ${i.suggestion}`);
    lines.push(`   Block id: ${d.paddock.id}`);
    lines.push("");
    n++;
  });
  if (all.length === 0) lines.push("(no issues found)");
  return lines.join("\n");
}

export function toCsv(diagnostics: BlockDiagnostic[]): string {
  const header = ["vineyard", "block", "block_id", "severity", "category", "code", "summary", "detail"];
  const rows = [header.join(",")];
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  diagnostics.forEach((d) => {
    d.issues.forEach((i) => {
      rows.push(
        [
          esc(d.vineyardName),
          esc(d.paddock.name ?? ""),
          esc(d.paddock.id),
          esc(i.severity),
          esc(i.category),
          esc(i.code),
          esc(i.summary),
          esc(i.detail ?? ""),
        ].join(","),
      );
    });
  });
  return rows.join("\n");
}
