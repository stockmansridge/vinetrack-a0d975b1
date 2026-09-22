// THE single Portal definition of "Total Work Task Cost".
//
//   Effective Labour Cost (SQL 189 / SQL 188 fallback)
// + Manual Machinery/Fuel Cost (work_task_machine_lines)
// + Linked GPS Trip Cost (trip_cost_allocations)
// + Material Cost (frozen work_task_materials snapshots)
// = Total Work Task Cost
//
// Pure functions only: no queries, no formatting, no writes. Every Work Task
// surface (table, sorting, CSV, drawer totals, block breakdown, task summary,
// season aggregates) must read its cost from here so the same task can never
// show two different totals.
//
// Rules preserved from the existing costing engines:
//   - piece-rate tasks cost from their saved snapshot; labour lines are never
//     summed on top (resolveEffectiveLabourCost is the only labour authority)
//   - trip cost is read from saved allocations, never estimated
//   - material lines are frozen snapshots and are counted exactly once
//   - soft-deleted lines (deleted_at) never contribute
//   - an unresolved labour rate stays visible even when materials are known
import {
  resolveEffectiveLabourCost,
  type EffectiveLabourCostRow,
} from "./effectiveLabourCost";
import { materialTotalNumber, type WorkTaskMaterial } from "./materialCosts";
import type { WorkTaskLabourLine } from "./workTasksQuery";
import type { WorkTaskMachineLine } from "./workTaskMachineLinesQuery";
import type { TripCostAllocation } from "./tripCostAllocationsQuery";

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Machine line entry sources that can duplicate a linked GPS trip. */
const OVERLAP_SOURCES = new Set(["missed_trip", "trip_failed", "correction"]);

export interface WorkTaskCostRollupInput {
  /** The Work Task row (supplies costing_method / piece-rate snapshot). */
  task: Parameters<typeof resolveEffectiveLabourCost>[0];
  labourLines: ReadonlyArray<WorkTaskLabourLine>;
  /** SQL 189 row for this task, when available. */
  effectiveLabourCost?: EffectiveLabourCostRow | null;
  machineLines?: ReadonlyArray<WorkTaskMachineLine>;
  /** Saved allocations for the trips linked to this task. */
  tripAllocations?: ReadonlyArray<TripCostAllocation>;
  /** Number of linked GPS trips (for the overlap warning / counts). */
  linkedTripCount?: number;
  /** Frozen material lines for this task. Pass [] when the gate is off. */
  materialLines?: ReadonlyArray<WorkTaskMaterial>;
}

export interface WorkTaskCostRollup {
  labourCost: number;
  /** False when no labour cost could be resolved ("—", not $0.00). */
  labourCostKnown: boolean;
  labourHours: number;
  machineCharge: number;
  machineFuel: number;
  machineCost: number;
  machineHours: number;
  machineLineCount: number;
  linkedTripCost: number;
  linkedTripLabour: number;
  linkedTripFuel: number;
  linkedTripChemical: number;
  linkedTripInput: number;
  linkedTripCount: number;
  materialCost: number;
  materialLineCount: number;
  /** Total Work Task Cost. */
  total: number;
  /** True when at least one component produced a known amount. */
  totalKnown: boolean;
  /** A labour line needs a rate that could not be resolved. */
  missingRate: boolean;
  /** Linked GPS trip + a machine line that may duplicate tracked work. */
  overlapRisk: boolean;
  workerTypes: Set<string>;
}

/** Builds the Total Work Task Cost roll-up for one task. */
export function buildWorkTaskCostRollup(
  input: WorkTaskCostRollupInput,
): WorkTaskCostRollup {
  const labourVisible = input.labourLines.filter((l) => !l.deleted_at);
  const labourLineTotal = labourVisible.length
    ? labourVisible.reduce(
        (s, l) => s + (l.total_cost == null ? 0 : toNum(l.total_cost)),
        0,
      )
    : null;
  const resolvedLabour = resolveEffectiveLabourCost(
    input.task,
    labourLineTotal,
    input.effectiveLabourCost ?? null,
  );
  const labourHours = labourVisible.reduce((s, l) => s + toNum(l.total_hours), 0);
  const workerTypes = new Set<string>();
  labourVisible.forEach((l) => l.worker_type && workerTypes.add(l.worker_type));
  const missingRate =
    resolvedLabour.costingMethod !== "piece_rate" &&
    labourVisible.some((l) => l.total_cost == null && l.worker_count && l.hours_per_worker);

  const machineVisible = (input.machineLines ?? []).filter((l) => !l.deleted_at);
  const machineCharge = machineVisible.reduce((s, l) => s + toNum(l.total_machine_cost), 0);
  const machineFuel = machineVisible.reduce((s, l) => s + toNum(l.fuel_cost), 0);
  const machineHours = machineVisible.reduce(
    (s, l) => s + toNum(l.duration_hours ?? l.engine_hours_used),
    0,
  );

  let linkedTripCost = 0;
  let linkedTripLabour = 0;
  let linkedTripFuel = 0;
  let linkedTripChemical = 0;
  let linkedTripInput = 0;
  (input.tripAllocations ?? []).forEach((a) => {
    linkedTripCost += toNum(a.total_cost);
    linkedTripLabour += toNum(a.labour_cost);
    linkedTripFuel += toNum(a.fuel_cost);
    linkedTripChemical += toNum(a.chemical_cost);
    linkedTripInput += toNum(a.input_cost);
  });

  // Counted exactly once, from the frozen per-line totals.
  const materialLines = (input.materialLines ?? []).filter((l) => !l.deleted_at);
  const materialCost = materialTotalNumber(materialLines);

  const labourCost = resolvedLabour.cost ?? 0;
  const machineCost = machineCharge + machineFuel;
  const total = labourCost + machineCost + linkedTripCost + materialCost;
  const linkedTripCount = input.linkedTripCount ?? 0;

  return {
    labourCost,
    labourCostKnown: resolvedLabour.cost != null,
    labourHours,
    machineCharge,
    machineFuel,
    machineCost,
    machineHours,
    machineLineCount: machineVisible.length,
    linkedTripCost,
    linkedTripLabour,
    linkedTripFuel,
    linkedTripChemical,
    linkedTripInput,
    linkedTripCount,
    materialCost,
    materialLineCount: materialLines.length,
    total,
    totalKnown:
      resolvedLabour.cost != null ||
      machineCost > 0 ||
      linkedTripCost > 0 ||
      materialLines.length > 0,
    missingRate,
    overlapRisk:
      linkedTripCount > 0 &&
      machineVisible.some((l) => OVERLAP_SOURCES.has(String(l.entry_source ?? ""))),
    workerTypes,
  };
}

/** Total Work Task Cost ÷ effective area (ha). Null when either is unusable. */
export function workTaskCostPerHectare(
  rollup: Pick<WorkTaskCostRollup, "total" | "totalKnown">,
  areaHa: number | null | undefined,
): number | null {
  if (!rollup.totalKnown) return null;
  const area = Number(areaHa);
  if (!Number.isFinite(area) || area <= 0) return null;
  return rollup.total / area;
}
