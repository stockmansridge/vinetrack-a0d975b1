// Damage impact calculations.
//
// A damage record stores:
//   - paddock_id          → block this damage belongs to
//   - polygon_points      → spatial footprint of the damaged area (jsonb,
//                           same iOS-compatible shape as paddocks.polygon_points;
//                           parsePolygonPoints handles {lat,lng}/{latitude,longitude}/[lat,lng])
//   - damage_percent      → intensity of damage inside that polygon (0–100)
//
// Effective loss model (matches the iOS app):
//   damaged_area_ha   = polygonAreaHectares(damage.polygon_points)
//   effective_area_ha = damaged_area_ha × damage_percent / 100
//   block_loss_pct    = effective_area_ha ÷ block_area_ha × 100
//
// When polygon_points is missing we fall back to the whole block area, treating
// the damage_percent as covering the entire paddock (this matches the iOS
// behaviour for row/area-only records).

import {
  parsePolygonPoints,
  polygonAreaHectares,
  type LatLng,
} from "@/lib/paddockGeometry";
import type { DamageRecord } from "@/lib/damageRecordsQuery";

export interface DamageImpact {
  damagedAreaHa: number;       // raw polygon area
  effectiveAreaHa: number;     // damaged area × damage_percent / 100
  blockAreaHa: number;         // for context
  blockLossPct: number;        // effective_area / block_area * 100 (0 when block area unknown)
  hasPolygon: boolean;
  damagePercent: number;       // resolved (defaults to 0 when null)
}

export function damagePolygon(record: Pick<DamageRecord, "polygon_points">): LatLng[] {
  return parsePolygonPoints(record.polygon_points);
}

export function calculateDamageImpact(
  record: Pick<DamageRecord, "polygon_points" | "damage_percent">,
  blockAreaHa: number,
): DamageImpact {
  const polygon = damagePolygon(record);
  const hasPolygon = polygon.length >= 3;
  const polyAreaHa = hasPolygon ? polygonAreaHectares(polygon) : 0;
  const damagePercent = Number.isFinite(record.damage_percent) ? Number(record.damage_percent) : 0;

  // Fall back to whole-block area when no polygon — matches iOS row/area-only case.
  const damagedAreaHa = hasPolygon ? polyAreaHa : blockAreaHa;
  const effectiveAreaHa = (damagedAreaHa * damagePercent) / 100;
  const blockLossPct = blockAreaHa > 0 ? (effectiveAreaHa / blockAreaHa) * 100 : 0;

  return {
    damagedAreaHa,
    effectiveAreaHa,
    blockAreaHa,
    blockLossPct,
    hasPolygon,
    damagePercent,
  };
}

/** Aggregate impacts per paddock, capped at 100% loss per block. */
export function aggregateDamageByPaddock(
  records: DamageRecord[],
  blockAreaByPaddockId: Map<string, number>,
): Map<string, { totalEffectiveHa: number; blockAreaHa: number; lossPct: number; recordCount: number }> {
  const out = new Map<string, { totalEffectiveHa: number; blockAreaHa: number; lossPct: number; recordCount: number }>();
  for (const r of records) {
    if (!r.paddock_id) continue;
    const blockArea = blockAreaByPaddockId.get(r.paddock_id) ?? 0;
    const impact = calculateDamageImpact(r, blockArea);
    const existing = out.get(r.paddock_id) ?? {
      totalEffectiveHa: 0,
      blockAreaHa: blockArea,
      lossPct: 0,
      recordCount: 0,
    };
    existing.totalEffectiveHa += impact.effectiveAreaHa;
    existing.recordCount += 1;
    existing.blockAreaHa = blockArea;
    existing.lossPct = blockArea > 0
      ? Math.min(100, (existing.totalEffectiveHa / blockArea) * 100)
      : 0;
    out.set(r.paddock_id, existing);
  }
  return out;
}
