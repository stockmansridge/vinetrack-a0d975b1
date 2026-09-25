// CSV export & import for all vineyard equipment in one file.
//
// One row per item; the `equipment_class` column says which list it belongs
// to (Tractors, Spray Equipment, Vineyard Machines, Other Assets), so a file
// may hold all four classes or just some of them.
//
// Import never deletes or archives anything. Rows match an existing item by
// internal_id (or by name within the same class) and update it; otherwise a
// new item is created. On update, blank cells keep the existing value.
// Writes go through the same paths the setup pages use (tractor RPC,
// vineyard machine / equipment item helpers, spray_equipment table).

import { generateUuid } from "@/lib/uuid";
import { parseCsv } from "@/lib/paddockImportExport";
import { USER_MACHINE_TYPES, type UserMachineType } from "@/lib/equipmentTaxonomy";

export const EQUIPMENT_CLASSES = [
  "tractor",
  "spray_equipment",
  "vineyard_machine",
  "other_asset",
] as const;
export type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

export const EQUIPMENT_CLASS_LABEL: Record<EquipmentClass, string> = {
  tractor: "Tractors",
  spray_equipment: "Spray Equipment",
  vineyard_machine: "Vineyard Machines",
  other_asset: "Other Assets",
};

export const EQUIPMENT_CSV_COLUMNS = [
  "equipment_class",
  "internal_id",
  "name",
  "make",
  "model",
  "model_year",
  "machine_type",
  "fuel_usage_l_per_hour",
  "tank_capacity_litres",
  "fuel_tracking_enabled",
  "available_for_job_costing",
  "serial_number",
  "vin_number",
  "notes",
] as const;
type Col = (typeof EQUIPMENT_CSV_COLUMNS)[number];

const MACHINE_TYPE_ALIASES: Record<string, UserMachineType> = {
  atv: "atv",
  quad: "atv",
  side_by_side: "side_by_side",
  "side-by-side": "side_by_side",
  sidebyside: "side_by_side",
  harvester: "harvester",
  utility_vehicle: "utility_vehicle",
  "utility vehicle": "utility_vehicle",
  ute: "utility_vehicle",
  other_vineyard_machine: "other_vineyard_machine",
  "other vineyard machine": "other_vineyard_machine",
  other: "other_vineyard_machine",
};

export function normaliseClass(raw: string): EquipmentClass | null {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, EquipmentClass> = {
    tractor: "tractor",
    tractors: "tractor",
    spray_equipment: "spray_equipment",
    sprayer: "spray_equipment",
    sprayers: "spray_equipment",
    vineyard_machine: "vineyard_machine",
    vineyard_machines: "vineyard_machine",
    machine: "vineyard_machine",
    machines: "vineyard_machine",
    other_asset: "other_asset",
    other_assets: "other_asset",
    other: "other_asset",
    other_equipment: "other_asset",
  };
  return map[k] ?? null;
}

export function normaliseMachineType(raw: string): UserMachineType | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if ((USER_MACHINE_TYPES as readonly string[]).includes(k)) return k as UserMachineType;
  return MACHINE_TYPE_ALIASES[k] ?? MACHINE_TYPE_ALIASES[k.replace(/_/g, " ")] ?? null;
}

/** Existing item, flattened into the CSV shape. */
export interface ExistingEquipment {
  cls: EquipmentClass;
  id: string;
  name: string;
  make?: string | null;
  model?: string | null;
  model_year?: number | null;
  machine_type?: string | null;
  fuel_usage_l_per_hour?: number | null;
  tank_capacity_litres?: number | null;
  fuel_tracking_enabled?: boolean | null;
  available_for_job_costing?: boolean | null;
  serial_number?: string | null;
  vin_number?: string | null;
  notes?: string | null;
  sync_version?: number | null;
}

const esc = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildEquipmentCsv(items: ExistingEquipment[], classes: EquipmentClass[]): string {
  const lines = [EQUIPMENT_CSV_COLUMNS.join(",")];
  const order = new Map(EQUIPMENT_CLASSES.map((c, i) => [c, i]));
  const rows = items
    .filter((i) => classes.includes(i.cls))
    .sort((a, b) => order.get(a.cls)! - order.get(b.cls)! || a.name.localeCompare(b.name));
  for (const i of rows) {
    const rec: Record<Col, unknown> = {
      equipment_class: i.cls,
      internal_id: i.id,
      name: i.name,
      make: i.make,
      model: i.model,
      model_year: i.model_year,
      machine_type: i.cls === "vineyard_machine" ? i.machine_type : null,
      fuel_usage_l_per_hour: i.fuel_usage_l_per_hour,
      tank_capacity_litres: i.tank_capacity_litres,
      fuel_tracking_enabled:
        i.cls === "vineyard_machine" && i.fuel_tracking_enabled != null
          ? i.fuel_tracking_enabled ? "yes" : "no"
          : null,
      available_for_job_costing:
        i.cls === "vineyard_machine" && i.available_for_job_costing != null
          ? i.available_for_job_costing ? "yes" : "no"
          : null,
      serial_number: i.serial_number,
      vin_number: i.vin_number,
      notes: i.notes,
    };
    lines.push(EQUIPMENT_CSV_COLUMNS.map((c) => esc(rec[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function buildEquipmentTemplateCsv(): string {
  return (
    EQUIPMENT_CSV_COLUMNS.join(",") +
    "\n" +
    "# Lines starting with # are ignored. equipment_class: tractor | spray_equipment | vineyard_machine | other_asset\n" +
    "tractor,,Tractor 1,John Deere,5075E,2019,,6.5,,,,SN123,,\n" +
    "spray_equipment,,Sprayer 1,,,,,,1500,,,,,\n" +
    "vineyard_machine,,Quad bike,Honda,TRX420,,atv,2,,yes,yes,,,\n" +
    "other_asset,,Bin trailer,Custom,,,,,,,,,,Used at harvest\n"
  );
}

// ---------- Parse + plan ----------

export type RowAction = "create" | "update";

export interface PlannedRow {
  line: number;
  cls: EquipmentClass;
  action: RowAction;
  name: string;
  existing?: ExistingEquipment;
  /** Values from the CSV; `undefined` = blank cell. */
  values: Partial<Omit<ExistingEquipment, "cls" | "id" | "sync_version">>;
}

export interface EquipmentImportPlan {
  rows: PlannedRow[];
  errors: { line: number; message: string }[];
  skippedClasses: number;
}

const CURRENT_YEAR = new Date().getFullYear();

function parseBool(raw: string): boolean | undefined | "invalid" {
  const k = raw.trim().toLowerCase();
  if (!k) return undefined;
  if (["yes", "y", "true", "1"].includes(k)) return true;
  if (["no", "n", "false", "0"].includes(k)) return false;
  return "invalid";
}

function parseNum(raw: string): number | undefined | "invalid" {
  const k = raw.trim();
  if (!k) return undefined;
  const n = Number(k);
  return Number.isFinite(n) ? n : "invalid";
}

export function planEquipmentImport(
  text: string,
  existing: ExistingEquipment[],
  includeClasses: EquipmentClass[],
): EquipmentImportPlan {
  const errors: { line: number; message: string }[] = [];
  const rows: PlannedRow[] = [];
  let skippedClasses = 0;
  const table = parseCsv(text);
  if (table.length === 0) return { rows, errors: [{ line: 1, message: "File is empty" }], skippedClasses };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const idx = (c: Col) => header.indexOf(c);
  if (idx("equipment_class") < 0 || idx("name") < 0) {
    return {
      rows,
      errors: [{ line: 1, message: "Missing required columns: equipment_class and name" }],
      skippedClasses,
    };
  }
  const byId = new Map(existing.map((e) => [e.id.toLowerCase(), e]));
  const seen = new Set<string>();

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r];
    const get = (c: Col) => {
      const i = idx(c);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    if (cells.every((c) => !c.trim())) continue;
    if ((cells[0] ?? "").trim().startsWith("#")) continue;

    const cls = normaliseClass(get("equipment_class"));
    if (!cls) {
      errors.push({ line, message: `Unknown equipment_class "${get("equipment_class")}"` });
      continue;
    }
    if (!includeClasses.includes(cls)) {
      skippedClasses++;
      continue;
    }

    const id = get("internal_id");
    const name = get("name");
    let match: ExistingEquipment | undefined;
    if (id) {
      match = byId.get(id.toLowerCase());
      if (!match || match.cls !== cls) {
        errors.push({ line, message: `internal_id ${id} not found in ${EQUIPMENT_CLASS_LABEL[cls]}` });
        continue;
      }
    } else if (name) {
      match = existing.find((e) => e.cls === cls && e.name.trim().toLowerCase() === name.toLowerCase());
    }
    const action: RowAction = match ? "update" : "create";
    const finalName = name || match?.name || "";
    if (!finalName) {
      errors.push({ line, message: "Name is required" });
      continue;
    }
    if (finalName.length > 120) {
      errors.push({ line, message: "Name must be 120 characters or fewer" });
      continue;
    }
    const key = `${cls}:${match?.id ?? finalName.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push({ line, message: `"${finalName}" appears more than once in the file` });
      continue;
    }

    const values: PlannedRow["values"] = { name: finalName };
    const text = (c: Col, k: keyof PlannedRow["values"]) => {
      const v = get(c);
      if (v) (values as any)[k] = v;
    };
    let bad: string | null = null;

    text("serial_number", "serial_number");
    text("vin_number", "vin_number");
    if (cls === "other_asset" || cls === "vineyard_machine") text("notes", "notes");
    if (cls === "tractor" || cls === "other_asset") {
      text("make", "make");
      text("model", "model");
    }
    if (cls === "tractor") {
      const y = parseNum(get("model_year"));
      if (y === "invalid" || (typeof y === "number" && (!Number.isInteger(y) || y < 1900 || y > CURRENT_YEAR + 1)))
        bad = `model_year must be a year between 1900 and ${CURRENT_YEAR + 1}`;
      else if (y !== undefined) values.model_year = y;
    }
    if (cls === "tractor" || cls === "vineyard_machine") {
      const f = parseNum(get("fuel_usage_l_per_hour"));
      if (f === "invalid" || (typeof f === "number" && (f < 0 || f > 500)))
        bad = "fuel_usage_l_per_hour must be a number between 0 and 500";
      else if (f !== undefined) values.fuel_usage_l_per_hour = f;
      if (cls === "tractor" && action === "create" && !(values.fuel_usage_l_per_hour! > 0))
        bad = bad ?? "fuel_usage_l_per_hour is required for a new tractor";
    }
    if (cls === "spray_equipment") {
      const t = parseNum(get("tank_capacity_litres"));
      if (t === "invalid" || (typeof t === "number" && (t <= 0 || t > 100000)))
        bad = "tank_capacity_litres must be greater than 0 and at most 100000";
      else if (t !== undefined) values.tank_capacity_litres = t;
      else if (action === "create") bad = "tank_capacity_litres is required for new spray equipment";
    }
    if (cls === "vineyard_machine") {
      const mtRaw = get("machine_type");
      if (mtRaw) {
        const mt = normaliseMachineType(mtRaw);
        if (!mt) bad = `machine_type "${mtRaw}" is not valid (${USER_MACHINE_TYPES.join(", ")})`;
        else values.machine_type = mt;
      } else if (action === "create") bad = bad ?? "machine_type is required for a new vineyard machine";
      for (const c of ["fuel_tracking_enabled", "available_for_job_costing"] as const) {
        const b = parseBool(get(c));
        if (b === "invalid") bad = `${c} must be yes or no`;
        else if (b !== undefined) values[c] = b;
      }
    }
    if (bad) {
      errors.push({ line, message: bad });
      continue;
    }
    seen.add(key);
    rows.push({ line, cls, action, name: finalName, existing: match, values });
  }
  return { rows, errors, skippedClasses };
}

// ---------- Apply ----------

export interface EquipmentWriters {
  saveTractor: (input: {
    id: string | null;
    name: string;
    brand: string | null;
    model: string | null;
    model_year: number | null;
    fuel_usage_l_per_hour: number | null;
    serial_number: string | null;
    vin_number: string | null;
  }) => Promise<void>;
  insertSpray: (p: Record<string, unknown>) => Promise<void>;
  updateSpray: (id: string, p: Record<string, unknown>) => Promise<void>;
  createMachine: (p: Record<string, any>) => Promise<void>;
  updateMachine: (p: Record<string, any>) => Promise<void>;
  createItem: (p: Record<string, any>) => Promise<void>;
  updateItem: (p: Record<string, any>) => Promise<void>;
}

export interface EquipmentApplyResult {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

const pick = <T,>(v: T | undefined, fallback: T | null | undefined): T | null =>
  v !== undefined ? v : (fallback ?? null);

export async function applyEquipmentImport(
  plan: EquipmentImportPlan,
  w: EquipmentWriters,
): Promise<EquipmentApplyResult> {
  const out: EquipmentApplyResult = { created: 0, updated: 0, errors: [] };
  for (const row of plan.rows) {
    const v = row.values;
    const e = row.existing;
    try {
      if (row.cls === "tractor") {
        await w.saveTractor({
          id: e?.id ?? null,
          name: row.name,
          brand: pick(v.make, e?.make),
          model: pick(v.model, e?.model),
          model_year: pick(v.model_year, e?.model_year),
          fuel_usage_l_per_hour: pick(v.fuel_usage_l_per_hour, e?.fuel_usage_l_per_hour),
          serial_number: pick(v.serial_number, e?.serial_number),
          vin_number: pick(v.vin_number, e?.vin_number),
        });
      } else if (row.cls === "spray_equipment") {
        const p: Record<string, unknown> = {
          name: row.name,
          tank_capacity_litres: pick(v.tank_capacity_litres, e?.tank_capacity_litres),
          serial_number: pick(v.serial_number, e?.serial_number),
          vin_number: pick(v.vin_number, e?.vin_number),
        };
        if (e) await w.updateSpray(e.id, p);
        else await w.insertSpray({ id: generateUuid(), ...p });
      } else if (row.cls === "vineyard_machine") {
        const p = {
          name: row.name,
          machine_type: pick(v.machine_type, e?.machine_type),
          fuel_tracking_enabled: pick(v.fuel_tracking_enabled, e?.fuel_tracking_enabled) ?? true,
          available_for_job_costing: pick(v.available_for_job_costing, e?.available_for_job_costing) ?? true,
          fuel_usage_l_per_hour: pick(v.fuel_usage_l_per_hour, e?.fuel_usage_l_per_hour),
          notes: pick(v.notes, e?.notes),
          serial_number: pick(v.serial_number, e?.serial_number),
          vin_number: pick(v.vin_number, e?.vin_number),
        };
        if (e) await w.updateMachine({ id: e.id, current_sync_version: e.sync_version ?? null, ...p });
        else await w.createMachine(p);
      } else {
        const p = {
          name: row.name,
          make: pick(v.make, e?.make),
          model: pick(v.model, e?.model),
          serial_number: pick(v.serial_number, e?.serial_number),
          vin_number: pick(v.vin_number, e?.vin_number),
          notes: pick(v.notes, e?.notes),
        };
        if (e) await w.updateItem({ id: e.id, current_sync_version: e.sync_version ?? null, ...p });
        else await w.createItem(p);
      }
      if (e) out.updated++;
      else out.created++;
    } catch (err: any) {
      out.errors.push({ line: row.line, message: `${row.name}: ${err?.message ?? "save failed"}` });
    }
  }
  return out;
}
