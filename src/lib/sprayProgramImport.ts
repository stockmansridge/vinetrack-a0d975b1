// Spray Program Excel import — v1
//
// Implements the Rork-confirmed contract for importing planned spray jobs:
//   - One Excel row → one public.spray_jobs row.
//   - status = 'draft' (hard-coded).
//   - is_template = false by default; set true when "Make Template" = Yes
//     (planned_date not required for template rows).
//   - Paddocks resolved to spray_job_paddocks; unknown paddock = row error.
//   - Chemicals go into chemical_lines[] JSONB; unknown saved chemical = warning,
//     chemical_id = null but name/rate/unit preserved.
//   - Never writes to spray_records.
//
// See docs/spray-program-import-contract.md for the full spec.
import * as XLSX from "xlsx";
import {
  createSprayJob,
  type SprayJobChemicalLine,
  type SprayJobInput,
} from "@/lib/sprayJobsQuery";
import { fetchSavedChemicalsForVineyard, type SavedChemical } from "@/lib/savedChemicalsQuery";
import { fetchVineyardTeamMembers } from "@/lib/sprayJobsQuery";
import { fetchList } from "@/lib/queries";

export const MAX_CHEMICALS = 6;

export const ALLOWED_UNITS = [
  "L/ha", "mL/ha", "kg/ha", "g/ha", "L/100L", "mL/100L", "g/100L",
] as const;
export type AllowedUnit = (typeof ALLOWED_UNITS)[number];

export const RECOMMENDED_OPERATION_TYPES = [
  "Fungicide", "Insecticide", "Herbicide", "Nutrient", "Other",
] as const;

// Spray Program sheet layout: 2 instruction rows + header row + data rows.
// Header row is 0-indexed = 2 (Excel row 3); data starts at Excel row 4.
export const TEMPLATE_HEADER_ROW_INDEX = 2;
export const TEMPLATE_FIRST_DATA_EXCEL_ROW = TEMPLATE_HEADER_ROW_INDEX + 2;

export const REQUIRED_HEADERS = [
  "Job Name", "Paddocks", "Chemical 1 Name",
] as const;

const CHEM_SUFFIXES = ["Name", "Rate", "Unit"];

export function templateHeaders(): string[] {
  const base = [
    "Job Name",
    "Planned Date",
    "Make Template",
    "Paddocks",
    "Operation Type",
    "Growth Stage",
    "Water Rate (L/ha)",
    "Equipment",
    "Tractor",
    "Operator Email",
    "Target / Pest or Disease (optional)",
    "Notes",
  ];
  const chem: string[] = [];
  for (let i = 1; i <= MAX_CHEMICALS; i++) {
    for (const s of CHEM_SUFFIXES) chem.push(`Chemical ${i} ${s}`);
  }
  return [...base, ...chem];
}

// ---------------- Parse / validate ----------------

export interface ImportedChemicalLine {
  name: string;
  rate: number;
  unit: string;
  resolved_chemical_id: string | null;
  active_ingredient: string | null;
}

export interface ImportedRow {
  excelRow: number;
  name: string;
  is_template: boolean;
  planned_date: string | null;
  paddockNames: string[];
  paddockIds: string[];
  operation_type: string | null;
  target: string | null;
  growth_stage_code: string | null;
  spray_rate_per_ha: number | null;
  equipment_id: string | null;
  tractor_id: string | null;
  operator_user_id: string | null;
  notes: string | null;
  chemical_lines: ImportedChemicalLine[];

  errors: string[];
  warnings: string[];
}

export interface ImportContext {
  vineyardId: string;
  paddocks: Map<string, { id: string; name: string }>;
  equipment: Map<string, string>;
  tractors: Map<string, string>;
  membersByEmail: Map<string, string>;
  chemicalsByName: Map<string, SavedChemical>;
}

export async function buildImportContext(vineyardId: string): Promise<ImportContext> {
  const [paddockRows, equipRows, tractorRows, members, chems] = await Promise.all([
    fetchList("paddocks", vineyardId),
    fetchList("spray_equipment", vineyardId),
    fetchList("tractors", vineyardId),
    fetchVineyardTeamMembers(vineyardId),
    fetchSavedChemicalsForVineyard(vineyardId),
  ]);
  const paddocks = new Map<string, { id: string; name: string }>();
  (paddockRows ?? []).forEach((p: any) => {
    const nm = String(p.name ?? p.block_name ?? "").trim();
    if (nm && p.id) paddocks.set(nm.toLowerCase(), { id: p.id, name: nm });
  });
  const equipment = new Map<string, string>();
  (equipRows ?? []).forEach((e: any) => {
    const nm = String(e.name ?? "").trim();
    if (nm && e.id) equipment.set(nm.toLowerCase(), e.id);
  });
  const tractors = new Map<string, string>();
  (tractorRows ?? []).forEach((t: any) => {
    const nm = String(t.name ?? t.display_name ?? t.model ?? "").trim();
    if (nm && t.id) tractors.set(nm.toLowerCase(), t.id);
  });
  const membersByEmail = new Map<string, string>();
  (members ?? []).forEach((m) => {
    if (m.email) membersByEmail.set(m.email.toLowerCase().trim(), m.user_id);
  });
  const chemicalsByName = new Map<string, SavedChemical>();
  (chems.chemicals ?? []).forEach((c) => {
    if (c.name) chemicalsByName.set(c.name.toLowerCase().trim(), c);
  });
  return { vineyardId, paddocks, equipment, tractors, membersByEmail, chemicalsByName };
}

function parseDateCell(v: any): { iso: string | null; raw: string; bad: boolean } {
  if (v == null || v === "") return { iso: null, raw: "", bad: false };
  if (v instanceof Date && !isNaN(v.getTime())) {
    return { iso: v.toISOString().slice(0, 10), raw: String(v), bad: false };
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const iso = `${d.y.toString().padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      return { iso, raw: String(v), bad: false };
    }
    return { iso: null, raw: String(v), bad: true };
  }
  const s = String(v).trim();
  if (!s) return { iso: null, raw: "", bad: false };
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return { iso: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, raw: s, bad: false };
  }
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = "20" + y;
    return {
      iso: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      raw: s, bad: false,
    };
  }
  return { iso: null, raw: s, bad: true };
}

function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseYesNo(v: any): boolean | null {
  const s = str(v);
  if (!s) return false;
  const lc = s.toLowerCase();
  if (["yes", "y", "true", "1"].includes(lc)) return true;
  if (["no", "n", "false", "0"].includes(lc)) return false;
  return null; // unparseable
}

export async function parseAndValidate(
  fileBuffer: ArrayBuffer,
  ctx: ImportContext,
): Promise<ImportedRow[]> {
  const wb = XLSX.read(fileBuffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets["Spray Program"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Workbook has no 'Spray Program' sheet.");

  const headerNames = new Set(templateHeaders());
  const findHeaderRow = (): number => {
    const ref = sheet["!ref"];
    if (!ref) return TEMPLATE_HEADER_ROW_INDEX;
    const range = XLSX.utils.decode_range(ref);
    const maxScan = Math.min(range.e.r, 10);
    for (let r = range.s.r; r <= maxScan; r++) {
      let hits = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "string" && headerNames.has(cell.v.trim())) {
          hits++;
          if (hits >= 3) return r;
        }
      }
    }
    return TEMPLATE_HEADER_ROW_INDEX;
  };
  const headerRowIdx = findHeaderRow();
  const firstDataExcelRow = headerRowIdx + 2;

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: null, raw: true, blankrows: false, range: headerRowIdx,
  });

  const out: ImportedRow[] = [];

  rows.forEach((raw, i) => {
    const excelRow = i + firstDataExcelRow;
    const errors: string[] = [];
    const warnings: string[] = [];

    const get = (k: string) => raw[k];

    const anyVal = Object.values(raw).some((v) => v != null && String(v).trim() !== "");
    if (!anyVal) return;

    // Support legacy "Name" header as well as "Job Name".
    const name = str(get("Job Name")) ?? str(get("Name"));
    if (!name) errors.push("Job Name is required");
    if (name && name.length > 200) errors.push("Job Name must be ≤ 200 characters");

    // Make Template
    const tmplParsed = parseYesNo(get("Make Template"));
    if (tmplParsed === null) {
      errors.push(`Make Template must be Yes or No (got "${get("Make Template")}")`);
    }
    const is_template = tmplParsed === true;

    const dateCell = parseDateCell(get("Planned Date"));
    if (dateCell.bad) errors.push(`Planned Date '${dateCell.raw}' is not a valid date`);
    if (!is_template && !dateCell.iso && !dateCell.bad) {
      errors.push("Planned Date is required (unless Make Template = Yes)");
    }

    const paddocksRaw = str(get("Paddocks"));
    const paddockNames: string[] = [];
    const paddockIds: string[] = [];
    if (!paddocksRaw) {
      errors.push("Paddocks is required");
    } else {
      const names = Array.from(new Set(
        paddocksRaw.split(";").map((x) => x.trim()).filter(Boolean),
      ));
      for (const nm of names) {
        const hit = ctx.paddocks.get(nm.toLowerCase());
        if (!hit) {
          errors.push(`Paddock "${nm}" not found in this vineyard`);
        } else {
          paddockNames.push(hit.name);
          paddockIds.push(hit.id);
        }
      }
    }

    const operation_type = str(get("Operation Type"));
    const target =
      str(get("Target / Pest or Disease (optional)")) ?? str(get("Target"));

    let growth_stage_code = str(get("Growth Stage"));
    if (growth_stage_code) {
      growth_stage_code = growth_stage_code.toUpperCase().replace(/\s+/g, "");
      if (!/^EL\d{1,2}$/.test(growth_stage_code)) {
        errors.push(`Growth Stage "${growth_stage_code}" must match EL00–EL99`);
      }
    }

    const positiveNum = (key: string, label: string): number | null => {
      const v = get(key);
      if (v == null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        errors.push(`${label} must be a positive number (got "${v}")`);
        return null;
      }
      return n;
    };

    const spray_rate_per_ha = positiveNum("Water Rate (L/ha)", "Water Rate (L/ha)");

    let equipment_id: string | null = null;
    const equipName = str(get("Equipment"));
    if (equipName) {
      equipment_id = ctx.equipment.get(equipName.toLowerCase()) ?? null;
      if (!equipment_id) warnings.push(`Equipment "${equipName}" not found — field left blank`);
    }
    let tractor_id: string | null = null;
    const tractorName = str(get("Tractor"));
    if (tractorName) {
      tractor_id = ctx.tractors.get(tractorName.toLowerCase()) ?? null;
      if (!tractor_id) warnings.push(`Tractor "${tractorName}" not found — field left blank`);
    }
    let operator_user_id: string | null = null;
    const opEmail = str(get("Operator Email"));
    if (opEmail) {
      operator_user_id = ctx.membersByEmail.get(opEmail.toLowerCase()) ?? null;
      if (!operator_user_id) warnings.push(`Operator email "${opEmail}" not a member — field left blank`);
    }

    const notes = str(get("Notes"));

    const chemical_lines: ImportedChemicalLine[] = [];
    for (let c = 1; c <= MAX_CHEMICALS; c++) {
      const cName = str(get(`Chemical ${c} Name`));
      if (!cName) continue;
      const cRateRaw = get(`Chemical ${c} Rate`);
      const cUnitRaw = str(get(`Chemical ${c} Unit`));
      if (cRateRaw == null || cRateRaw === "" || !cUnitRaw) {
        errors.push(`Chemical ${c}: Rate and Unit are required when Name is set`);
        continue;
      }
      const rate = Number(cRateRaw);
      if (!Number.isFinite(rate) || rate <= 0) {
        errors.push(`Chemical ${c}: Rate must be a positive number (got "${cRateRaw}")`);
        continue;
      }
      const unitMatch = ALLOWED_UNITS.find((u) => u.toLowerCase() === cUnitRaw.toLowerCase());
      if (!unitMatch) {
        errors.push(`Chemical ${c}: Unit "${cUnitRaw}" not allowed (use ${ALLOWED_UNITS.join(", ")})`);
        continue;
      }
      const match = ctx.chemicalsByName.get(cName.toLowerCase());
      let resolved_chemical_id: string | null = null;
      if (match) resolved_chemical_id = match.id;
      else warnings.push(`Chemical "${cName}" not in saved chemicals — imported with no link`);

      chemical_lines.push({
        name: cName,
        rate,
        unit: unitMatch,
        resolved_chemical_id,
        active_ingredient: match?.active_ingredient ?? null,
      });
    }

    out.push({
      excelRow,
      name: name ?? "",
      is_template,
      planned_date: is_template ? null : dateCell.iso,
      paddockNames,
      paddockIds,
      operation_type,
      target,
      growth_stage_code,
      spray_rate_per_ha,
      equipment_id,
      tractor_id,
      operator_user_id,
      notes,
      chemical_lines,
      errors,
      warnings,
    });
  });

  return out;
}

// ---------------- Insert ----------------

export interface ImportResult {
  row: ImportedRow;
  status: "imported" | "imported_with_warnings" | "rejected" | "failed";
  jobId?: string;
  error?: string;
}

export async function importRows(
  rows: ImportedRow[],
  ctx: ImportContext,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const row of rows) {
    if (row.errors.length) {
      results.push({ row, status: "rejected", error: row.errors.join("; ") });
      continue;
    }
    try {
      const lines: SprayJobChemicalLine[] = row.chemical_lines.map((c) => ({
        chemical_id: c.resolved_chemical_id,
        savedChemicalId: c.resolved_chemical_id,
        name: c.name,
        active_ingredient: c.active_ingredient,
        rate: c.rate,
        unit: c.unit,
        water_rate: null,
        notes: null,
      }));
      const input: SprayJobInput = {
        vineyard_id: ctx.vineyardId,
        name: row.name,
        is_template: row.is_template,
        planned_date: row.planned_date,
        status: "draft",
        operation_type: row.operation_type,
        target: row.target,
        growth_stage_code: row.growth_stage_code,
        spray_rate_per_ha: row.spray_rate_per_ha,
        water_volume: null,
        concentration_factor: null,
        row_spacing_metres: null,
        vsp_canopy_size: null,
        vsp_canopy_density: null,
        equipment_id: row.equipment_id,
        tractor_id: row.tractor_id,
        operator_user_id: row.operator_user_id,
        notes: row.notes,
        chemical_lines: lines,
      };
      const job = await createSprayJob(input, row.paddockIds);
      results.push({
        row,
        status: row.warnings.length ? "imported_with_warnings" : "imported",
        jobId: job.id,
      });
    } catch (e: any) {
      results.push({ row, status: "failed", error: e?.message ?? String(e) });
    }
  }
  return results;
}
