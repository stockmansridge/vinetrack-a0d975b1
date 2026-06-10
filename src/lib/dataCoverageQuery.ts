// READ-ONLY data coverage / quality diagnostics for the portal.
// Pulls minimal columns across vineyard-scoped tables on the iOS Supabase
// project and computes a set of issue checks. No writes, no mutations.
//
// All counts and detail records are derived in-memory after a single batch
// of fetches per vineyard. Detail lists are intentionally capped per issue
// so vineyards with many records still render quickly.
import { supabase } from "@/integrations/ios-supabase/client";

export type Severity = "critical" | "warning" | "info";

export interface IssueDetail {
  id: string;
  label: string;          // short identifier (date / name)
  context?: string;       // secondary line (block, equipment, etc.)
}

export interface Issue {
  group: IssueGroup;
  key: string;
  name: string;
  severity: Severity;
  explanation: string;
  suggestedAction: string;
  count: number;
  details: IssueDetail[]; // capped (DETAIL_CAP)
}

export type IssueGroup =
  | "Work Tasks"
  | "Trips"
  | "Spray"
  | "Maintenance"
  | "Fuel"
  | "Pins"
  | "Blocks"
  | "Equipment";

const DETAIL_CAP = 50;

const fmtDate = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
const cap = (rows: IssueDetail[]): IssueDetail[] => rows.slice(0, DETAIL_CAP);

interface Paddock {
  id: string;
  name?: string | null;
  polygon_points?: any;
  rows?: any;
  variety_allocations?: any;
  deleted_at?: string | null;
}

interface WorkTask {
  id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  area_ha?: number | null;
  date?: string | null;
  task_type?: string | null;
  description?: string | null;
  is_archived?: boolean | null;
}

interface MachineLine {
  id: string;
  work_task_id: string;
  work_date?: string | null;
  equipment_source?: string | null;
  equipment_ref_id?: string | null;
  equipment_name_snapshot?: string | null;
  entry_source?: string | null;
}

interface LabourLine {
  id: string;
  work_task_id: string;
  worker_type?: string | null;
  operator_category_id?: string | null;
  work_date?: string | null;
}

interface Trip {
  id: string;
  paddock_id?: string | null;
  paddock_ids?: any;
  paddock_name?: string | null;
  tractor_id?: string | null;
  machine_id?: string | null;
  operator_user_id?: string | null;
  operator_category_id?: string | null;
  work_task_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  manual_correction_events?: string[] | null;
  trip_function?: string | null;
}

interface SprayRow {
  id: string;
  trip_id?: string | null;
  date?: string | null;
  spray_reference?: string | null;
  machine_id?: string | null;
  tractor_id?: string | null;
  spray_equipment_id?: string | null;
  tractor?: string | null;
  equipment_type?: string | null;
  temperature?: number | null;
  wind_speed?: number | null;
  humidity?: number | null;
  is_template?: boolean | null;
}

interface MaintRow {
  id: string;
  item_name?: string | null;
  equipment_source?: string | null;
  equipment_ref_id?: string | null;
  date?: string | null;
  parts_cost?: number | null;
  labour_cost?: number | null;
  is_archived?: boolean | null;
}

interface PinRow {
  id: string;
  paddock_id?: string | null;
  title?: string | null;
  category?: string | null;
  row_number?: number | null;
  driving_row_number?: number | null;
  pin_row_number?: number | null;
  side?: string | null;
  pin_side?: string | null;
  snapped_to_row?: boolean | null;
  created_at?: string | null;
}

interface FuelLog {
  id: string;
  tractor_id?: string | null;
  machine_id?: string | null;
  fill_datetime?: string | null;
  litres_added?: number | null;
}

interface FuelPurchase {
  id: string;
  date?: string | null;
  volume_litres?: number | null;
  total_cost?: number | null;
}

interface EquipRow {
  id: string;
  name?: string | null;
  legacy_tractor_id?: string | null;
}

export interface DataCoverageResult {
  generatedAt: string;
  issues: Issue[];
  counts: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  totals: {
    paddocks: number;
    workTasks: number;
    machineLines: number;
    labourLines: number;
    trips: number;
    sprayRecords: number;
    maintenance: number;
    pins: number;
    tractorFuelLogs: number;
    fuelPurchases: number;
    tractors: number;
    sprayEquipment: number;
    vineyardMachines: number;
    equipmentItems: number;
  };
}

async function selectAll<T>(
  table: string,
  vineyardId: string,
  cols = "*",
  opts: { excludeDeleted?: boolean } = { excludeDeleted: true },
): Promise<T[]> {
  let q = supabase.from(table).select(cols).eq("vineyard_id", vineyardId);
  if (opts.excludeDeleted) q = q.is("deleted_at", null);
  const { data, error } = await q;
  if (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[dataCoverage] ${table} fetch failed:`, error.message);
    }
    return [];
  }
  return (data ?? []) as T[];
}

export async function runDataCoverage(vineyardId: string): Promise<DataCoverageResult> {
  const [
    paddocks,
    workTasks,
    machineLines,
    labourLines,
    wtPadLinks,
    trips,
    sprays,
    maint,
    pins,
    fuelLogs,
    fuelPurchases,
    tractors,
    sprayEquipment,
    vineyardMachines,
    equipmentItems,
  ] = await Promise.all([
    selectAll<Paddock>("paddocks", vineyardId, "id,name,polygon_points,rows,variety_allocations"),
    selectAll<WorkTask>(
      "work_tasks",
      vineyardId,
      "id,paddock_id,paddock_name,area_ha,date,task_type,description,is_archived",
    ),
    selectAll<MachineLine>(
      "work_task_machine_lines",
      vineyardId,
      "id,work_task_id,work_date,equipment_source,equipment_ref_id,equipment_name_snapshot,entry_source",
    ),
    selectAll<LabourLine>(
      "work_task_labour_lines",
      vineyardId,
      "id,work_task_id,worker_type,operator_category_id,work_date",
    ),
    selectAll<{ work_task_id: string; paddock_id: string }>(
      "work_task_paddocks",
      vineyardId,
      "work_task_id,paddock_id",
      { excludeDeleted: false },
    ),
    selectAll<Trip>(
      "trips",
      vineyardId,
      "id,paddock_id,paddock_ids,paddock_name,tractor_id,machine_id,operator_user_id,operator_category_id,work_task_id,start_time,end_time,manual_correction_events,trip_function",
    ),
    selectAll<SprayRow>(
      "spray_records",
      vineyardId,
      "id,trip_id,date,spray_reference,machine_id,tractor_id,spray_equipment_id,tractor,equipment_type,temperature,wind_speed,humidity,is_template",
    ),
    selectAll<MaintRow>(
      "maintenance_logs",
      vineyardId,
      "id,item_name,equipment_source,equipment_ref_id,date,parts_cost,labour_cost,is_archived",
    ),
    selectAll<PinRow>(
      "pins",
      vineyardId,
      "id,paddock_id,title,category,row_number,driving_row_number,pin_row_number,side,pin_side,snapped_to_row,created_at",
    ),
    selectAll<FuelLog>(
      "tractor_fuel_logs",
      vineyardId,
      "id,tractor_id,machine_id,fill_datetime,litres_added",
    ),
    selectAll<FuelPurchase>(
      "fuel_purchases",
      vineyardId,
      "id,date,volume_litres,total_cost",
    ),
    selectAll<EquipRow>("tractors", vineyardId, "id,name"),
    selectAll<EquipRow>("spray_equipment", vineyardId, "id,name"),
    selectAll<EquipRow>("vineyard_machines", vineyardId, "id,name,legacy_tractor_id"),
    selectAll<EquipRow>("equipment_items", vineyardId, "id,name"),
  ]);

  // Strip records that are out-of-scope for diagnostics:
  //  - spray templates (is_template = true) — they intentionally have no
  //    weather / no trip / often no stable equipment.
  //  - archived work_tasks and maintenance_logs — these are hidden from the
  //    operational pages and should not contribute to "issue" counts.
  const sprayRecords = sprays.filter((s) => !s.is_template);
  const activeWorkTasks = workTasks.filter((t) => !t.is_archived);
  const activeMaint = maint.filter((m) => !m.is_archived);

  const paddockById = new Map(paddocks.map((p) => [p.id, p]));
  const workTaskById = new Map(activeWorkTasks.map((t) => [t.id, t]));
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const taskName = (t?: WorkTask) =>
    t?.task_type || t?.description?.slice(0, 60) || t?.id?.slice(0, 8) || "—";
  const tripName = (t?: Trip) =>
    t?.trip_function || t?.paddock_name || (t?.id ? t.id.slice(0, 8) : "—");

  // Build link sets.
  const taskHasLinkedPaddock = new Set<string>();
  wtPadLinks.forEach((l) => taskHasLinkedPaddock.add(l.work_task_id));

  // Equipment lookup sets for ref_id validation.
  const allEquipIds = new Set<string>();
  [tractors, sprayEquipment, vineyardMachines, equipmentItems].forEach((arr) =>
    arr.forEach((e) => allEquipIds.add(e.id)),
  );

  const issues: Issue[] = [];

  const push = (i: Issue) => {
    if (i.count > 0) issues.push(i);
  };

  // ---------- Work Tasks ----------
  {
    const orphans = activeWorkTasks.filter(
      (t) => !t.paddock_id && !taskHasLinkedPaddock.has(t.id),
    );
    push({
      group: "Work Tasks",
      key: "wt_no_block",
      name: "Work Tasks with no Block",
      severity: "critical",
      explanation: "Task is not linked to any Block, so it cannot be allocated in Block-level reports.",
      suggestedAction: "Open the Work Task and assign one or more Blocks.",
      count: orphans.length,
      details: cap(
        orphans.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.date)} · ${taskName(t)}`,
          context: t.paddock_name ?? undefined,
        })),
      ),
    });

    // "No resolved area" — only count tasks where area can't be derived
    // anywhere. If the task has linked Blocks via work_task_paddocks the
    // reporting layer can derive area from those, so don't flag it. Severity
    // lowered to info: tasks with linked Blocks but null area_ha are common
    // and reports already cope with this.
    const noArea = activeWorkTasks.filter(
      (t) =>
        (t.area_ha == null || Number(t.area_ha) <= 0) &&
        !taskHasLinkedPaddock.has(t.id) &&
        !t.paddock_id,
    );
    push({
      group: "Work Tasks",
      key: "wt_no_area",
      name: "Work Tasks with no resolved area",
      severity: "info",
      explanation: "No area_ha is set and no Block is linked, so per-hectare reporting can't be derived.",
      suggestedAction: "Set Block area on the Work Task, or link one or more Blocks with polygons.",
      count: noArea.length,
      details: cap(
        noArea.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.date)} · ${taskName(t)}`,
        })),
      ),
    });

    const mlNoStableId = machineLines.filter(
      (m) =>
        (m.entry_source ?? "manual") !== "trip" &&
        (m.equipment_source === "free_text" || !m.equipment_ref_id),
    );
    push({
      group: "Work Tasks",
      key: "wt_machine_no_stable_id",
      name: "Manual machine lines without a stable equipment ID",
      severity: "warning",
      explanation: "Equipment is recorded as free text or has no equipment_ref_id, so it can't be grouped with the same machine elsewhere.",
      suggestedAction: "Edit the machine line and pick a Tractor, Spray Equipment, Vineyard Machine, or Other Equipment.",
      count: mlNoStableId.length,
      details: cap(
        mlNoStableId.map((m) => ({
          id: m.id,
          label: m.equipment_name_snapshot || "(unnamed equipment)",
          context: `${fmtDate(m.work_date)} · ${m.equipment_source ?? "free_text"}`,
        })),
      ),
    });

    // Tasks with linked GPS trips and any corrections/manual events
    const tripsByTask = new Map<string, Trip[]>();
    trips.forEach((tr) => {
      if (tr.work_task_id) {
        const arr = tripsByTask.get(tr.work_task_id) ?? [];
        arr.push(tr);
        tripsByTask.set(tr.work_task_id, arr);
      }
    });
    const tasksWithCorrections: WorkTask[] = [];
    tripsByTask.forEach((trs, taskId) => {
      const corrected = trs.some(
        (tr) => Array.isArray(tr.manual_correction_events) && tr.manual_correction_events.length > 0,
      );
      if (corrected) {
        const t = workTaskById.get(taskId);
        if (t) tasksWithCorrections.push(t);
      }
    });
    push({
      group: "Work Tasks",
      key: "wt_trips_with_corrections",
      name: "Work Tasks with GPS trips that had manual corrections",
      severity: "info",
      explanation: "One or more linked trips have manual correction events. Costs may differ from the raw GPS run.",
      suggestedAction: "Review the trip(s) and confirm the corrected machine/operator data is intended.",
      count: tasksWithCorrections.length,
      details: cap(
        tasksWithCorrections.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.date)} · ${taskName(t)}`,
        })),
      ),
    });

    const labourMissingCategory = labourLines.filter(
      (l) => !l.operator_category_id && !l.worker_type,
    );
    push({
      group: "Work Tasks",
      key: "wt_labour_missing_category",
      name: "Labour lines missing operator category and worker type",
      severity: "warning",
      explanation: "Labour line has neither an Operator Category nor a worker type, so labour cost rollups can't classify it.",
      suggestedAction: "Open the Work Task and set an Operator Category on the labour line.",
      count: labourMissingCategory.length,
      details: cap(
        labourMissingCategory.map((l) => ({
          id: l.id,
          label: `${fmtDate(l.work_date)} · task ${l.work_task_id.slice(0, 8)}`,
        })),
      ),
    });
  }

  // ---------- Trips ----------
  {
    const noBlock = trips.filter((tr) => {
      const ids = Array.isArray(tr.paddock_ids) ? tr.paddock_ids : [];
      return !tr.paddock_id && ids.length === 0;
    });
    push({
      group: "Trips",
      key: "trip_no_block",
      name: "Trips with no Block link",
      severity: "critical",
      explanation: "Trip has no paddock_id and no paddock_ids list. It can't be allocated to a Block.",
      suggestedAction: "Edit the trip on iOS and assign one or more Blocks.",
      count: noBlock.length,
      details: cap(
        noBlock.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.start_time)} · ${tripName(t)}`,
        })),
      ),
    });

    const noMachine = trips.filter((tr) => !tr.machine_id && !tr.tractor_id);
    push({
      group: "Trips",
      key: "trip_no_machine",
      name: "Trips with no machine/tractor",
      severity: "warning",
      explanation: "No machine_id or tractor_id is set, so machine costs and fuel can't be attributed.",
      suggestedAction: "Pick a Vineyard Machine or Tractor for the trip.",
      count: noMachine.length,
      details: cap(
        noMachine.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.start_time)} · ${tripName(t)}`,
        })),
      ),
    });

    const noOperator = trips.filter(
      (tr) => !tr.operator_user_id && !tr.operator_category_id,
    );
    push({
      group: "Trips",
      key: "trip_no_operator",
      name: "Trips with no operator/category",
      severity: "warning",
      explanation: "No operator user or operator category is set, so labour cost can't be attributed.",
      suggestedAction: "Assign an operator or operator category to the trip.",
      count: noOperator.length,
      details: cap(
        noOperator.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.start_time)} · ${tripName(t)}`,
        })),
      ),
    });

    const orphanTaskRef = trips.filter(
      (tr) => tr.work_task_id && !workTaskById.has(tr.work_task_id),
    );
    push({
      group: "Trips",
      key: "trip_deleted_task",
      name: "Trips linked to a deleted/missing Work Task",
      severity: "critical",
      explanation: "The referenced work_task_id is no longer visible (likely soft-deleted).",
      suggestedAction: "Unlink the trip from the deleted task, or recreate the task.",
      count: orphanTaskRef.length,
      details: cap(
        orphanTaskRef.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.start_time)} · ${tripName(t)}`,
          context: `task ${t.work_task_id?.slice(0, 8)}`,
        })),
      ),
    });

    const badDuration = trips.filter((tr) => {
      if (!tr.start_time || !tr.end_time) return true;
      const a = Date.parse(tr.start_time);
      const b = Date.parse(tr.end_time);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
      return b <= a;
    });
    push({
      group: "Trips",
      key: "trip_bad_duration",
      name: "Trips with missing or invalid duration",
      severity: "warning",
      explanation: "start_time or end_time is missing, or end is not after start. Duration-based costs can't be computed.",
      suggestedAction: "Edit the trip and correct the start/end times.",
      count: badDuration.length,
      details: cap(
        badDuration.map((t) => ({
          id: t.id,
          label: `${fmtDate(t.start_time)} · ${tripName(t)}`,
        })),
      ),
    });
  }

  // ---------- Spray ----------
  {
    const noMachineId = sprayRecords.filter((s) => !s.machine_id && !s.tractor_id);
    push({
      group: "Spray",
      key: "spray_no_machine",
      name: "Spray records with no stable tractor/machine ID",
      severity: "warning",
      explanation: "Free-text tractor only; can't be matched to a Vineyard Machine for fuel/cost rollups.",
      suggestedAction: "Open the spray record and pick a Tractor or Vineyard Machine.",
      count: noMachineId.length,
      details: cap(
        noMachineId.map((s) => ({
          id: s.id,
          label: `${fmtDate(s.date)} · ${s.spray_reference || s.tractor || "(spray)"}`,
        })),
      ),
    });

    const noSprayEquip = sprayRecords.filter((s) => !s.spray_equipment_id);
    push({
      group: "Spray",
      key: "spray_no_equipment",
      name: "Spray records with no stable spray equipment ID",
      severity: "warning",
      explanation: "No spray_equipment_id set; tank capacity and equipment-level rollups won't apply.",
      suggestedAction: "Pick a Spray Equipment item on the record.",
      count: noSprayEquip.length,
      details: cap(
        noSprayEquip.map((s) => ({
          id: s.id,
          label: `${fmtDate(s.date)} · ${s.spray_reference || "(spray)"}`,
        })),
      ),
    });

    const orphanTrip = sprayRecords.filter(
      (s) => s.trip_id && !tripById.has(s.trip_id),
    );
    push({
      group: "Spray",
      key: "spray_orphan_trip",
      name: "Spray records linked to a deleted/missing trip",
      severity: "critical",
      explanation: "trip_id references a trip that is no longer visible.",
      suggestedAction: "Unlink the spray from the deleted trip or recreate the trip.",
      count: orphanTrip.length,
      details: cap(
        orphanTrip.map((s) => ({
          id: s.id,
          label: `${fmtDate(s.date)} · ${s.spray_reference || "(spray)"}`,
          context: `trip ${s.trip_id?.slice(0, 8)}`,
        })),
      ),
    });

    const noWeather = sprayRecords.filter(
      (s) => s.temperature == null && s.wind_speed == null && s.humidity == null,
    );
    push({
      group: "Spray",
      key: "spray_no_weather",
      name: "Spray records missing weather snapshot",
      severity: "warning",
      explanation: "No temperature, wind, or humidity recorded. Compliance reports may be incomplete.",
      suggestedAction: "Edit the record and fill in completion weather, or capture it live next time.",
      count: noWeather.length,
      details: cap(
        noWeather.map((s) => ({
          id: s.id,
          label: `${fmtDate(s.date)} · ${s.spray_reference || "(spray)"}`,
        })),
      ),
    });

    const legacyFreeText = sprayRecords.filter(
      (s) => !s.machine_id && !s.tractor_id && !s.spray_equipment_id && (s.tractor || s.equipment_type),
    );
    push({
      group: "Spray",
      key: "spray_legacy_free_text",
      name: "Old free-text-only spray records",
      severity: "info",
      explanation: "Record has only free-text equipment fields (no stable IDs). Still readable, but won't roll up by equipment.",
      suggestedAction: "Re-save the record after picking Tractor and Spray Equipment.",
      count: legacyFreeText.length,
      details: cap(
        legacyFreeText.map((s) => ({
          id: s.id,
          label: `${fmtDate(s.date)} · ${s.spray_reference || "(spray)"}`,
        })),
      ),
    });
  }

  // ---------- Maintenance ----------
  {
    const freeText = activeMaint.filter((m) => m.equipment_source === "free_text");
    push({
      group: "Maintenance",
      key: "maint_free_text",
      name: "Maintenance logs with free-text equipment",
      severity: "warning",
      explanation: "Equipment is free text only; logs won't link to a Tractor / Spray Equipment / Vineyard Machine / Other Equipment record.",
      suggestedAction: "Edit the log and pick a stable equipment item.",
      count: freeText.length,
      details: cap(
        freeText.map((m) => ({
          id: m.id,
          label: `${fmtDate(m.date)} · ${m.item_name ?? "(no name)"}`,
        })),
      ),
    });

    const missingRefId = activeMaint.filter(
      (m) =>
        m.equipment_source &&
        m.equipment_source !== "free_text" &&
        !m.equipment_ref_id,
    );
    push({
      group: "Maintenance",
      key: "maint_missing_ref",
      name: "Maintenance logs missing equipment_ref_id",
      severity: "critical",
      explanation: "equipment_source is a stable type but no equipment_ref_id is set.",
      suggestedAction: "Edit the log and re-select the equipment.",
      count: missingRefId.length,
      details: cap(
        missingRefId.map((m) => ({
          id: m.id,
          label: `${fmtDate(m.date)} · ${m.item_name ?? "(no name)"}`,
          context: m.equipment_source ?? undefined,
        })),
      ),
    });

    const danglingRefId = activeMaint.filter(
      (m) =>
        m.equipment_source &&
        m.equipment_source !== "free_text" &&
        m.equipment_ref_id &&
        !allEquipIds.has(m.equipment_ref_id),
    );
    push({
      group: "Maintenance",
      key: "maint_dangling_ref",
      name: "Maintenance logs pointing to missing equipment",
      severity: "critical",
      explanation: "equipment_ref_id no longer matches any visible equipment row.",
      suggestedAction: "Re-select the equipment, or restore/recreate the deleted equipment.",
      count: danglingRefId.length,
      details: cap(
        danglingRefId.map((m) => ({
          id: m.id,
          label: `${fmtDate(m.date)} · ${m.item_name ?? "(no name)"}`,
          context: `${m.equipment_source} ${m.equipment_ref_id?.slice(0, 8)}`,
        })),
      ),
    });

    const missingDateOrCost = activeMaint.filter(
      (m) =>
        !m.date ||
        ((m.parts_cost ?? 0) === 0 && (m.labour_cost ?? 0) === 0),
    );
    push({
      group: "Maintenance",
      key: "maint_missing_date_cost",
      name: "Maintenance logs missing date or cost",
      severity: "info",
      explanation: "Either the date is missing or both parts and labour cost are zero.",
      suggestedAction: "Fill in the date and any known parts/labour cost.",
      count: missingDateOrCost.length,
      details: cap(
        missingDateOrCost.map((m) => ({
          id: m.id,
          label: `${fmtDate(m.date)} · ${m.item_name ?? "(no name)"}`,
        })),
      ),
    });
  }

  // ---------- Fuel ----------
  {
    const fuelNoEquip = fuelLogs.filter((f) => !f.machine_id && !f.tractor_id);
    push({
      group: "Fuel",
      key: "fuel_no_equip",
      name: "Fuel logs with no equipment/machine link",
      severity: "critical",
      explanation: "Tractor fuel log has no tractor_id or machine_id; cannot be attributed.",
      suggestedAction: "Assign a Vineyard Machine or Tractor to the log.",
      count: fuelNoEquip.length,
      details: cap(
        fuelNoEquip.map((f) => ({
          id: f.id,
          label: `${fmtDate(f.fill_datetime)} · ${(f.litres_added ?? 0)} L`,
        })),
      ),
    });

    const fuelLegacyTractorOnly = fuelLogs.filter(
      (f) => !f.machine_id && f.tractor_id,
    );
    push({
      group: "Fuel",
      key: "fuel_legacy_tractor_only",
      name: "Fuel logs still using legacy tractor reference only",
      severity: "info",
      explanation: "Log has tractor_id but no machine_id. Vineyard Machines is the new home for fuel tracking.",
      suggestedAction: "Open the log and pick the matching Vineyard Machine.",
      count: fuelLegacyTractorOnly.length,
      details: cap(
        fuelLegacyTractorOnly.map((f) => ({
          id: f.id,
          label: `${fmtDate(f.fill_datetime)} · ${(f.litres_added ?? 0)} L`,
        })),
      ),
    });

    const purchaseMissing = fuelPurchases.filter(
      (p) => !p.date || p.volume_litres == null || p.total_cost == null,
    );
    push({
      group: "Fuel",
      key: "fuel_purchase_missing",
      name: "Fuel purchases missing price/volume/date",
      severity: "warning",
      explanation: "Purchase row has a missing date, volume, or cost. Fuel cost-per-litre won't be available.",
      suggestedAction: "Open the purchase and fill in the missing field.",
      count: purchaseMissing.length,
      details: cap(
        purchaseMissing.map((p) => ({
          id: p.id,
          label: `${fmtDate(p.date)} · ${p.volume_litres ?? "—"} L · ${p.total_cost ?? "—"}`,
        })),
      ),
    });
  }

  // ---------- Pins ----------
  {
    const pinNoBlock = pins.filter((p) => !p.paddock_id);
    push({
      group: "Pins",
      key: "pin_no_block",
      name: "Pins with no Block",
      severity: "critical",
      explanation: "Pin has no paddock_id, so it can't appear under a Block in reports.",
      suggestedAction: "Open the pin and assign it to a Block.",
      count: pinNoBlock.length,
      details: cap(
        pinNoBlock.map((p) => ({
          id: p.id,
          label: `${fmtDate(p.created_at)} · ${p.title ?? p.category ?? "(pin)"}`,
        })),
      ),
    });

    const pinNoRow = pins.filter(
      (p) =>
        p.row_number == null &&
        p.driving_row_number == null &&
        p.pin_row_number == null,
    );
    push({
      group: "Pins",
      key: "pin_no_row",
      name: "Pins with no row/path attachment",
      severity: "info",
      explanation: "No row or driving path attached. Row-level overlays won't render, but free-placement pins (gates, observations) are legitimately rowless.",
      suggestedAction: "If this pin is meant to sit on a row, snap it to a row in iOS.",
      count: pinNoRow.length,
      details: cap(
        pinNoRow.map((p) => ({
          id: p.id,
          label: `${fmtDate(p.created_at)} · ${p.title ?? "(pin)"}`,
        })),
      ),
    });

    const pinDeletedBlock = pins.filter(
      (p) => p.paddock_id && !paddockById.has(p.paddock_id),
    );
    push({
      group: "Pins",
      key: "pin_deleted_block",
      name: "Pins linked to a deleted/missing Block",
      severity: "critical",
      explanation: "Pin references a paddock_id that is no longer visible.",
      suggestedAction: "Re-assign the pin to an active Block, or restore the Block.",
      count: pinDeletedBlock.length,
      details: cap(
        pinDeletedBlock.map((p) => ({
          id: p.id,
          label: `${fmtDate(p.created_at)} · ${p.title ?? "(pin)"}`,
          context: `block ${p.paddock_id?.slice(0, 8)}`,
        })),
      ),
    });

    // Duplicate risk: same block + same snapped row + same side, >1 pin.
    const dupBuckets = new Map<string, PinRow[]>();
    pins.forEach((p) => {
      if (!p.snapped_to_row) return;
      const row = p.pin_row_number ?? p.row_number;
      const side = p.pin_side ?? p.side;
      if (!p.paddock_id || row == null) return;
      const key = `${p.paddock_id}|${row}|${side ?? "?"}`;
      const arr = dupBuckets.get(key) ?? [];
      arr.push(p);
      dupBuckets.set(key, arr);
    });
    const dupDetails: IssueDetail[] = [];
    let dupCount = 0;
    dupBuckets.forEach((arr, key) => {
      if (arr.length > 1) {
        dupCount += arr.length;
        const [pid, row, side] = key.split("|");
        const block = paddockById.get(pid)?.name ?? pid.slice(0, 8);
        dupDetails.push({
          id: key,
          label: `${block} · row ${row} ${side}`,
          context: `${arr.length} pins`,
        });
      }
    });
    push({
      group: "Pins",
      key: "pin_dup_risk",
      name: "Possible duplicate pins on the same row/side",
      severity: "warning",
      explanation: "More than one snapped pin sits on the same Block + row + side. Could be intentional or a duplicate-tap.",
      suggestedAction: "Review the pins on that row and delete any duplicates.",
      count: dupCount,
      details: cap(dupDetails),
    });
  }

  // ---------- Blocks ----------
  {
    const noArea = paddocks.filter(
      (p) => !Array.isArray(p.polygon_points) || (p.polygon_points as any[]).length < 3,
    );
    push({
      group: "Blocks",
      key: "block_no_area",
      name: "Blocks with missing polygon/area",
      severity: "warning",
      explanation: "Block has no polygon, so area can't be calculated and per-hectare reports may be off.",
      suggestedAction: "Open the Block and draw or import its boundary.",
      count: noArea.length,
      details: cap(noArea.map((p) => ({ id: p.id, label: p.name ?? "(unnamed block)" }))),
    });

    const noRows = paddocks.filter((p) => {
      const arr = Array.isArray(p.rows) ? p.rows : null;
      return !arr || arr.length === 0;
    });
    push({
      group: "Blocks",
      key: "block_no_rows",
      name: "Blocks with no rows configured",
      severity: "info",
      explanation: "No row layout stored. Row-level features (pins, trip paths) won't have a reference.",
      suggestedAction: "Open the Block and generate rows on the Rows tab.",
      count: noRows.length,
      details: cap(noRows.map((p) => ({ id: p.id, label: p.name ?? "(unnamed block)" }))),
    });

    const noVariety = paddocks.filter((p) => {
      const va = p.variety_allocations;
      if (!va) return true;
      if (Array.isArray(va)) return va.length === 0;
      if (typeof va === "object") return Object.keys(va).length === 0;
      return true;
    });
    push({
      group: "Blocks",
      key: "block_no_variety",
      name: "Blocks with no variety allocation",
      severity: "warning",
      explanation: "Block has no variety allocation, so variety-level rollups (yield, cost per tonne) can't compute.",
      suggestedAction: "Open the Block and set variety allocations.",
      count: noVariety.length,
      details: cap(noVariety.map((p) => ({ id: p.id, label: p.name ?? "(unnamed block)" }))),
    });

    const badAlloc = paddocks.filter((p) => {
      const va = p.variety_allocations;
      const list: any[] = Array.isArray(va) ? va : va && typeof va === "object" ? Object.values(va) : [];
      if (!list.length) return false;
      const total = list.reduce((sum, item) => {
        const pct = Number(
          typeof item === "number"
            ? item
            : item?.percentage ?? item?.percent ?? item?.share ?? 0,
        );
        return sum + (Number.isFinite(pct) ? pct : 0);
      }, 0);
      return Math.abs(total - 100) > 0.5;
    });
    push({
      group: "Blocks",
      key: "block_bad_variety_sum",
      name: "Variety allocations that don't sum to 100%",
      severity: "warning",
      explanation: "Allocation percentages don't add up to 100%. Variety-level reports may under/over-attribute.",
      suggestedAction: "Open the Block and rebalance the variety allocation.",
      count: badAlloc.length,
      details: cap(badAlloc.map((p) => ({ id: p.id, label: p.name ?? "(unnamed block)" }))),
    });
  }

  // ---------- Equipment ----------
  {
    // Duplicate-looking names across all equipment tables (case-insensitive).
    const nameBuckets = new Map<string, { id: string; name: string; src: string }[]>();
    const ingest = (arr: EquipRow[], src: string) => {
      arr.forEach((e) => {
        if (!e.name) return;
        const k = e.name.trim().toLowerCase();
        if (!k) return;
        const arr2 = nameBuckets.get(k) ?? [];
        arr2.push({ id: e.id, name: e.name, src });
        nameBuckets.set(k, arr2);
      });
    };
    ingest(tractors, "Tractor");
    ingest(sprayEquipment, "Spray Equipment");
    // Exclude vineyard_machines that are pure migration shims for a legacy
    // tractor row (legacy_tractor_id is set) — those intentionally share the
    // same display name as the underlying tractor and would otherwise spam
    // the duplicate-name list during the Vineyard Machines rollout.
    ingest(
      vineyardMachines.filter((m) => !m.legacy_tractor_id),
      "Vineyard Machine",
    );
    ingest(equipmentItems, "Other Equipment");
    const dupNameDetails: IssueDetail[] = [];
    let dupNameCount = 0;
    nameBuckets.forEach((arr, key) => {
      if (arr.length > 1) {
        dupNameCount += arr.length;
        dupNameDetails.push({
          id: key,
          label: arr[0].name,
          context: arr.map((a) => a.src).join(", "),
        });
      }
    });
    push({
      group: "Equipment",
      key: "equip_dup_name",
      name: "Duplicate-looking equipment names",
      severity: "warning",
      explanation: "The same name appears across multiple equipment tables. Records may be double-counted by name.",
      suggestedAction: "Rename or consolidate the duplicate equipment entries.",
      count: dupNameCount,
      details: cap(dupNameDetails),
    });

    // Records referencing equipment IDs that aren't in any visible equipment table.
    const missingRefs = new Map<string, { src: string; recordId: string; date?: string | null; label?: string }[]>();
    const add = (refId: string | null | undefined, entry: { src: string; recordId: string; date?: string | null; label?: string }) => {
      if (!refId) return;
      if (allEquipIds.has(refId)) return;
      const arr = missingRefs.get(refId) ?? [];
      arr.push(entry);
      missingRefs.set(refId, arr);
    };
    machineLines.forEach((m) =>
      add(m.equipment_ref_id, {
        src: "work_task_machine_line",
        recordId: m.id,
        date: m.work_date,
        label: m.equipment_name_snapshot ?? undefined,
      }),
    );
    sprayRecords.forEach((s) => {
      add(s.tractor_id, { src: "spray.tractor_id", recordId: s.id, date: s.date });
      add(s.machine_id, { src: "spray.machine_id", recordId: s.id, date: s.date });
      add(s.spray_equipment_id, { src: "spray.spray_equipment_id", recordId: s.id, date: s.date });
    });
    trips.forEach((t) => {
      add(t.tractor_id, { src: "trip.tractor_id", recordId: t.id, date: t.start_time });
      add(t.machine_id, { src: "trip.machine_id", recordId: t.id, date: t.start_time });
    });
    fuelLogs.forEach((f) => {
      add(f.tractor_id, { src: "fuel.tractor_id", recordId: f.id, date: f.fill_datetime });
      add(f.machine_id, { src: "fuel.machine_id", recordId: f.id, date: f.fill_datetime });
    });
    const missingRefDetails: IssueDetail[] = [];
    let missingRefCount = 0;
    missingRefs.forEach((arr, refId) => {
      missingRefCount += arr.length;
      const sample = arr[0];
      missingRefDetails.push({
        id: refId,
        label: sample.label || `equipment ${refId.slice(0, 8)}`,
        context: `${arr.length} ref(s) · ${sample.src}`,
      });
    });
    push({
      group: "Equipment",
      key: "equip_missing_ref",
      name: "Equipment referenced by records but not in equipment tables",
      severity: "critical",
      explanation: "One or more records (spray, trip, fuel, machine line) point to an equipment ID that has been deleted or never existed.",
      suggestedAction: "Restore or recreate the equipment, or re-assign the records to a visible equipment item.",
      count: missingRefCount,
      details: cap(missingRefDetails),
    });

    const legacyTractorMachines = vineyardMachines.filter(
      (m) => !!m.legacy_tractor_id,
    );
    push({
      group: "Equipment",
      key: "equip_legacy_tractor_machine",
      name: "Vineyard Machines still tied to a legacy tractor reference",
      severity: "info",
      explanation: "vineyard_machines.legacy_tractor_id is still set. These are placeholder shims for old tractor rows pending migration.",
      suggestedAction: "Complete the Vineyard Machines migration so legacy_tractor_id can be cleared.",
      count: legacyTractorMachines.length,
      details: cap(
        legacyTractorMachines.map((m) => ({
          id: m.id,
          label: m.name ?? "(unnamed machine)",
        })),
      ),
    });
  }

  // ---------- Summary counts ----------
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    total: issues.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    issues,
    counts,
    totals: {
      paddocks: paddocks.length,
      workTasks: workTasks.length,
      machineLines: machineLines.length,
      labourLines: labourLines.length,
      trips: trips.length,
      sprayRecords: sprayRecords.length,
      maintenance: activeMaint.length,
      pins: pins.length,
      tractorFuelLogs: fuelLogs.length,
      fuelPurchases: fuelPurchases.length,
      tractors: tractors.length,
      sprayEquipment: sprayEquipment.length,
      vineyardMachines: vineyardMachines.length,
      equipmentItems: equipmentItems.length,
    },
  };
}

export function dataCoverageCsv(result: DataCoverageResult): string {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Issue group",
    "Issue name",
    "Severity",
    "Count",
    "Explanation",
    "Suggested action",
  ].join(",");
  const lines = result.issues.map((i) =>
    [i.group, i.name, i.severity, i.count, i.explanation, i.suggestedAction]
      .map(esc)
      .join(","),
  );
  return [header, ...lines].join("\n");
}
