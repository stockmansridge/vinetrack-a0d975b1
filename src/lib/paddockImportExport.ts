// CSV export & import for paddocks/blocks.
// - Export: includes commonly edited setup fields plus computed metrics (read-only hints).
// - Import: parses CSV, validates, supports add-new / update-matching / replace-all (soft delete).
// Writes use the existing Supabase RLS; only operational roles can apply.
import { supabase } from "@/integrations/ios-supabase/client";
import { deriveMetrics } from "./paddockGeometry";

export interface PaddockRow {
  id?: string | null;
  vineyard_id?: string | null;
  name?: string | null;
  planting_year?: number | null;
  row_width?: number | null;
  vine_spacing?: number | null;
  row_offset?: number | null;
  row_direction?: number | null;
  intermediate_post_spacing?: number | null;
  flow_per_emitter?: number | null;
  emitter_spacing?: number | null;
  vine_count_override?: number | null;
  row_length_override?: number | null;
  variety_allocations?: any;
  polygon_points?: any;
  rows?: any;
  deleted_at?: string | null;
  updated_at?: string | null;
}

// Columns in import/export CSV. Order matters.
export const CSV_COLUMNS = [
  "internal_id",
  "vineyard_name",
  "name",
  "planting_year",
  "variety",
  "clone",
  "rootstock",
  "row_width_m",
  "vine_spacing_m",
  "row_offset_m",
  "row_direction_deg",
  "intermediate_post_spacing_m",
  "flow_per_emitter_lh",
  "emitter_spacing_m",
  "vine_count_override",
  "row_length_override_m",
  // Computed (export-only hints; ignored on import)
  "area_ha_computed",
  "row_count_computed",
  "total_row_length_m_computed",
] as const;

type CsvCol = (typeof CSV_COLUMNS)[number];

function csvEscape(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (/[\",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function firstAlloc(p: PaddockRow): { variety?: string; clone?: string; rootstock?: string } {
  const arr = Array.isArray(p.variety_allocations) ? p.variety_allocations : [];
  const a = arr[0];
  if (!a || typeof a !== "object") return {};
  return {
    variety: a.variety ?? undefined,
    clone: a.clone ?? undefined,
    rootstock: a.rootstock ?? undefined,
  };
}

export function buildPaddocksCsv(paddocks: PaddockRow[], vineyardName: string): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of paddocks) {
    const m = deriveMetrics(p);
    const a = firstAlloc(p);
    const row: Record<CsvCol, any> = {
      internal_id: p.id ?? "",
      vineyard_name: vineyardName,
      name: p.name ?? "",
      planting_year: p.planting_year ?? "",
      variety: a.variety ?? "",
      clone: a.clone ?? "",
      rootstock: a.rootstock ?? "",
      row_width_m: p.row_width ?? "",
      vine_spacing_m: p.vine_spacing ?? "",
      row_offset_m: p.row_offset ?? "",
      row_direction_deg: p.row_direction ?? "",
      intermediate_post_spacing_m: p.intermediate_post_spacing ?? "",
      flow_per_emitter_lh: p.flow_per_emitter ?? "",
      emitter_spacing_m: p.emitter_spacing ?? "",
      vine_count_override: p.vine_count_override ?? "",
      row_length_override_m: p.row_length_override ?? "",
      area_ha_computed: m.areaHa > 0 ? m.areaHa.toFixed(4) : "",
      row_count_computed: m.rowCount || "",
      total_row_length_m_computed:
        m.totalRowLengthM > 0 ? Math.round(m.totalRowLengthM) : "",
    };
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\n");
}

export function buildPaddocksTemplateCsv(): string {
  return CSV_COLUMNS.join(",") + "\n";
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- CSV parser ----------

/** Minimal RFC4180-ish CSV parser supporting quoted fields, commas, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;
  const t = text.replace(/\r\n?/g, "\n");
  while (i < t.length) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  // Strip trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

// ---------- Import validation ----------

export interface ParsedImportRow {
  rowIndex: number; // 1-based, excluding header
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  values: {
    internal_id?: string;
    name: string;
    planting_year?: number | null;
    variety?: string;
    clone?: string;
    rootstock?: string;
    row_width?: number | null;
    vine_spacing?: number | null;
    row_offset?: number | null;
    row_direction?: number | null;
    intermediate_post_spacing?: number | null;
    flow_per_emitter?: number | null;
    emitter_spacing?: number | null;
    vine_count_override?: number | null;
    row_length_override?: number | null;
  };
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  duplicateNames: string[];
  unknownColumns: string[];
}

function num(s: string | undefined, opts: { nonNeg?: boolean } = {}): number | null | "INVALID" {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "INVALID";
  if (opts.nonNeg && n < 0) return "INVALID";
  return n;
}

function int(s: string | undefined, opts: { nonNeg?: boolean } = {}): number | null | "INVALID" {
  const v = num(s, opts);
  if (v === null || v === "INVALID") return v;
  if (!Number.isInteger(v)) return Math.trunc(v);
  return v;
}

export function parsePaddocksCsv(text: string): ParsedImport {
  const grid = parseCsv(text);
  if (grid.length === 0) {
    return { rows: [], duplicateNames: [], unknownColumns: [] };
  }
  const header = grid[0].map((h) => h.trim());
  const known = new Set<string>(CSV_COLUMNS as readonly string[]);
  const unknownColumns = header.filter((h) => !known.has(h));
  const idx = (col: string) => header.indexOf(col);

  const rows: ParsedImportRow[] = [];
  const namesSeen = new Map<string, number>();

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const get = (col: string): string | undefined => {
      const i = idx(col);
      return i < 0 ? undefined : (cells[i] ?? "").trim();
    };
    const raw: Record<string, string> = {};
    for (const h of header) raw[h] = get(h) ?? "";

    const errors: string[] = [];
    const warnings: string[] = [];

    const name = (get("name") ?? "").trim();
    if (!name) errors.push("Missing required column 'name'");

    const numericChecks: [string, number | null | "INVALID"][] = [
      ["row_width", num(get("row_width_m"), { nonNeg: true })],
      ["vine_spacing", num(get("vine_spacing_m"), { nonNeg: true })],
      ["row_offset", num(get("row_offset_m"), { nonNeg: true })],
      ["row_direction", num(get("row_direction_deg"))],
      ["intermediate_post_spacing", num(get("intermediate_post_spacing_m"), { nonNeg: true })],
      ["flow_per_emitter", num(get("flow_per_emitter_lh"), { nonNeg: true })],
      ["emitter_spacing", num(get("emitter_spacing_m"), { nonNeg: true })],
      ["row_length_override", num(get("row_length_override_m"), { nonNeg: true })],
    ];
    const intChecks: [string, number | null | "INVALID"][] = [
      ["planting_year", int(get("planting_year"))],
      ["vine_count_override", int(get("vine_count_override"), { nonNeg: true })],
    ];

    const values: ParsedImportRow["values"] = { name };
    values.internal_id = get("internal_id") || undefined;
    values.variety = get("variety") || undefined;
    values.clone = get("clone") || undefined;
    values.rootstock = get("rootstock") || undefined;

    for (const [k, v] of numericChecks) {
      if (v === "INVALID") errors.push(`Invalid numeric value for ${k}`);
      else (values as any)[k] = v;
    }
    for (const [k, v] of intChecks) {
      if (v === "INVALID") errors.push(`Invalid integer for ${k}`);
      else (values as any)[k] = v;
    }

    if (values.planting_year != null && (values.planting_year < 1800 || values.planting_year > 2100)) {
      warnings.push(`Planting year ${values.planting_year} looks unusual`);
    }

    if (name) {
      const lc = name.toLowerCase();
      namesSeen.set(lc, (namesSeen.get(lc) ?? 0) + 1);
    }

    rows.push({ rowIndex: r, raw, errors, warnings, values });
  }

  const duplicateNames = Array.from(namesSeen.entries())
    .filter(([, n]) => n > 1)
    .map(([k]) => k);

  // Tag duplicate-name rows
  for (const row of rows) {
    if (row.values.name && duplicateNames.includes(row.values.name.toLowerCase())) {
      row.warnings.push("Duplicate name in import file");
    }
  }

  return { rows, duplicateNames, unknownColumns };
}

// ---------- Apply import ----------

export type ImportMode = "add-new" | "update-matching" | "replace-all";

export interface ApplyPlan {
  toInsert: ParsedImportRow[];
  toUpdate: { row: ParsedImportRow; existingId: string }[];
  toSkip: { row: ParsedImportRow; reason: string }[];
  toArchive: { id: string; name: string }[]; // for replace-all
}

function dbValuesFromImport(
  v: ParsedImportRow["values"],
  vineyardId: string,
  existing?: PaddockRow,
): Record<string, any> {
  const patch: Record<string, any> = {
    name: v.name,
    vineyard_id: vineyardId,
  };
  // Only set columns that were provided (not undefined). null is allowed.
  const map: Array<[keyof ParsedImportRow["values"], string]> = [
    ["planting_year", "planting_year"],
    ["row_width", "row_width"],
    ["vine_spacing", "vine_spacing"],
    ["row_offset", "row_offset"],
    ["row_direction", "row_direction"],
    ["intermediate_post_spacing", "intermediate_post_spacing"],
    ["flow_per_emitter", "flow_per_emitter"],
    ["emitter_spacing", "emitter_spacing"],
    ["vine_count_override", "vine_count_override"],
    ["row_length_override", "row_length_override"],
  ];
  for (const [from, to] of map) {
    const val = (v as any)[from];
    if (val !== undefined) patch[to] = val;
  }
  // variety/clone/rootstock → variety_allocations[0] only when no existing alloc
  // (keeps production-critical polygon-bound allocations intact).
  if (v.variety || v.clone || v.rootstock) {
    const existingAllocs = Array.isArray(existing?.variety_allocations)
      ? existing!.variety_allocations
      : [];
    if (existingAllocs.length === 0) {
      patch.variety_allocations = [
        {
          id: crypto.randomUUID(),
          variety: v.variety ?? null,
          clone: v.clone ?? null,
          rootstock: v.rootstock ?? null,
          plantingYear: v.planting_year ?? null,
          polygonPoints: [],
          rowIds: [],
        },
      ];
    }
    // If existing allocations are present we preserve them silently to avoid
    // overwriting per-block setup that the portal cannot reconstruct.
  }
  return patch;
}

export function buildApplyPlan(
  parsed: ParsedImport,
  existing: PaddockRow[],
  mode: ImportMode,
): ApplyPlan {
  const byName = new Map<string, PaddockRow>();
  for (const e of existing) {
    if (e.name) byName.set(e.name.trim().toLowerCase(), e);
  }
  const validRows = parsed.rows.filter((r) => r.errors.length === 0);

  const plan: ApplyPlan = { toInsert: [], toUpdate: [], toSkip: [], toArchive: [] };

  for (const row of validRows) {
    const existingMatch = byName.get(row.values.name.toLowerCase());
    if (mode === "add-new") {
      if (existingMatch) {
        plan.toSkip.push({ row, reason: "Name already exists (add-new mode)" });
      } else {
        plan.toInsert.push(row);
      }
    } else if (mode === "update-matching") {
      if (existingMatch) {
        plan.toUpdate.push({ row, existingId: existingMatch.id! });
      } else {
        plan.toSkip.push({ row, reason: "No existing block to update" });
      }
    } else {
      // replace-all: insert new or update matching; archive any existing not in import
      if (existingMatch) {
        plan.toUpdate.push({ row, existingId: existingMatch.id! });
      } else {
        plan.toInsert.push(row);
      }
    }
  }

  for (const row of parsed.rows.filter((r) => r.errors.length > 0)) {
    plan.toSkip.push({ row, reason: row.errors.join("; ") });
  }

  if (mode === "replace-all") {
    const importNames = new Set(
      validRows.map((r) => r.values.name.trim().toLowerCase()),
    );
    for (const e of existing) {
      const lc = e.name?.trim().toLowerCase();
      if (lc && !importNames.has(lc)) {
        plan.toArchive.push({ id: e.id!, name: e.name! });
      }
    }
  }

  return plan;
}

export interface ApplyResult {
  inserted: number;
  updated: number;
  archived: number;
  skipped: number;
  errors: string[];
}

export async function applyImport(
  plan: ApplyPlan,
  existing: PaddockRow[],
  vineyardId: string,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    inserted: 0,
    updated: 0,
    archived: 0,
    skipped: plan.toSkip.length,
    errors: [],
  };
  const existingById = new Map(existing.map((e) => [e.id!, e]));

  // Inserts
  if (plan.toInsert.length) {
    const payload = plan.toInsert.map((r) => dbValuesFromImport(r.values, vineyardId));
    const { error, count } = await supabase
      .from("paddocks")
      .insert(payload, { count: "exact" });
    if (error) result.errors.push(`Insert failed: ${error.message}`);
    else result.inserted = count ?? payload.length;
  }

  // Updates (one-by-one to keep RLS predictable and reuse existing allocs)
  for (const u of plan.toUpdate) {
    const existingRow = existingById.get(u.existingId);
    const patch = dbValuesFromImport(u.row.values, vineyardId, existingRow);
    const { error } = await supabase.from("paddocks").update(patch).eq("id", u.existingId);
    if (error) result.errors.push(`Update ${u.row.values.name}: ${error.message}`);
    else result.updated++;
  }

  // Archive (soft delete) for replace-all
  for (const a of plan.toArchive) {
    const { error } = await (supabase.rpc as any)("soft_delete_paddock", { p_id: a.id });
    if (error) {
      // Fallback: write deleted_at directly if RPC unavailable.
      const fallback = await supabase
        .from("paddocks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", a.id);
      if (fallback.error) {
        result.errors.push(`Archive ${a.name}: ${fallback.error.message}`);
        continue;
      }
    }
    result.archived++;
  }

  return result;
}

export function safeFileBase(s: string): string {
  return (s.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Vineyard");
}
