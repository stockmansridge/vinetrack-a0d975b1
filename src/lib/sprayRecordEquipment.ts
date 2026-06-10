// Resolves display names for spray_records equipment using the new
// migration-safe FKs (machine_id, tractor_id, spray_equipment_id) with
// graceful fallback to the legacy text snapshots (tractor, equipment_type).
//
// SQL 101 added nullable FKs to spray_records. Old/free-text records have
// only the text fields populated; resolvers must keep working for those.

import type { SprayRecord } from "./sprayRecordsQuery";

export interface SprayEquipmentLookups {
  /** vineyard_machines rows (id + name) — preferred. */
  machines?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  /** Legacy tractors rows (id + name). */
  tractors?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  /** spray_equipment rows (id + name). */
  sprayEquipment?: ReadonlyArray<{ id: string; name?: string | null }> | null;
}

function findName(
  rows: ReadonlyArray<{ id: string; name?: string | null }> | null | undefined,
  id: string | null | undefined,
): string | null {
  if (!id || !rows) return null;
  const hit = rows.find((r) => r.id === id);
  const n = hit?.name?.trim();
  return n ? n : null;
}

/**
 * Resolve the tractor/machine display name for a spray record.
 * Priority: machine_id → tractor_id → text snapshot `tractor`.
 */
export function resolveSprayTractorName(
  record: Pick<SprayRecord, "machine_id" | "tractor_id" | "tractor">,
  lookups: SprayEquipmentLookups,
): string | null {
  const fromMachine = findName(lookups.machines, record.machine_id);
  if (fromMachine) return fromMachine;
  const fromTractor = findName(lookups.tractors, record.tractor_id);
  if (fromTractor) return fromTractor;
  const text = record.tractor?.trim();
  return text ? text : null;
}

/**
 * Resolve the spray equipment display name for a spray record.
 * Priority: spray_equipment_id → text snapshot `equipment_type`.
 */
export function resolveSprayEquipmentName(
  record: Pick<SprayRecord, "spray_equipment_id" | "equipment_type">,
  lookups: SprayEquipmentLookups,
): string | null {
  const fromFk = findName(lookups.sprayEquipment, record.spray_equipment_id);
  if (fromFk) return fromFk;
  const text = record.equipment_type?.trim();
  return text ? text : null;
}
