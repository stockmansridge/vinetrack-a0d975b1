// Read-only presentation helpers: derive vineyard-level stats (area, blocks,
// varieties, rows) from the admin paddock rows already returned by
// admin_list_vineyard_paddocks. No writes, no new queries.

import {
  parsePolygonPoints,
  parseVarietyAllocations,
  polygonAreaHectares,
} from "@/lib/paddockGeometry";
import type { AdminPaddock } from "@/lib/adminApi";

export interface AdminVineyardStats {
  blockCount: number;
  archivedBlockCount: number;
  totalAreaHa: number;
  rowCount: number;
  varieties: string[];
}

export function computeAdminVineyardStats(
  paddocks: (AdminPaddock & { variety_allocations?: unknown })[] | undefined,
): AdminVineyardStats {
  const list = paddocks ?? [];
  const active = list.filter((p) => !p.deleted_at);
  const varieties = new Set<string>();
  let totalAreaHa = 0;
  let rowCount = 0;

  for (const p of active) {
    const pts = parsePolygonPoints(p.polygon_points);
    totalAreaHa += polygonAreaHectares(pts);
    rowCount += p.row_count ?? 0;
    for (const a of parseVarietyAllocations((p as any).variety_allocations)) {
      const name = (a.variety ?? "").trim();
      if (name) varieties.add(name);
    }
  }

  return {
    blockCount: active.length,
    archivedBlockCount: list.length - active.length,
    totalAreaHa,
    rowCount,
    varieties: [...varieties].sort((a, b) => a.localeCompare(b)),
  };
}

export function formatHa(ha: number): string {
  if (!ha || ha <= 0) return "—";
  return `${ha.toFixed(ha < 10 ? 2 : 1)} ha`;
}
