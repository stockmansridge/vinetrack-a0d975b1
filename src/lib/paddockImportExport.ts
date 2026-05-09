// CSV export & import for paddocks/blocks.
// - Export: includes commonly edited setup fields plus computed metrics
//   (read-only hints) and per-row length overrides (compact format).
// - Import: parses CSV, validates, supports add-new / update-matching /
//   replace-all (soft archive only — never hard delete).
// Operational geometry (polygon_points, rows[]) is NEVER altered by import.
// Per-row length overrides are calculation-only data; trip tracking is
// untouched.
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
  /** Calculation-only per-row overrides JSONB.
   *  Shape: { "<rowNumber>": <lengthM>, ... } e.g. { "1": 245, "3.5": 244.2 }. */
  row_length_overrides?: Record<string, number> | null;
  variety_allocations?: any;
  polygon_points?: any;
  rows?: any;
  deleted_at?: string | null;
  updated_at?: string | null;
}

// Per-row exact length override entries (calculation-only).
// rowNumber matches the iOS row.number / rowNumber identifier (decimal allowed).
export interface RowLengthOverride {
  rowNumber: number;
  lengthM: number;
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
  // Per-row exact lengths — calculation only. Compact format:
  //   "1:245;2:244.2;3.5:243.8"
  "row_lengths_override_m",
  // Computed (export-only hints; ignored on import)
  "area_ha_computed",
  "row_count_computed",
  "total_row_length_m_computed",
] as const;

type CsvCol = (typeof CSV_COLUMNS)[number];

function csvEscape(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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

// ---------- Per-row override (de)serialisation ----------

/** "1:245;2:244.2" → [{rowNumber:1,lengthM:245}, ...].
 *  Empty/whitespace returns []. Throws on malformed entry. */
export function parseRowLengthOverrides(raw: string | null | undefined): RowLengthOverride[] {
  if (!raw) return [];
  const t = String(raw).trim();
  if (!t) return [];
  const out: RowLengthOverride[] = [];
  const parts = t.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.split(":");
    if (m.length !== 2) throw new Error(`Bad entry "${part}" (expected rowNumber:length)`);
    const rowNumber = Number(m[0].trim());
    const lengthM = Number(m[1].trim());
    if (!Number.isFinite(rowNumber)) throw new Error(`Bad row number "${m[0]}"`);
    if (!Number.isFinite(lengthM)) throw new Error(`Bad length "${m[1]}"`);
    if (lengthM <= 0) throw new Error(`Length must be > 0 (row ${rowNumber})`);
    out.push({ rowNumber, lengthM });
  }
  return out;
}

export function serializeRowLengthOverrides(arr: RowLengthOverride[]): string {
  return arr
    .slice()
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((o) => `${o.rowNumber}:${Number(o.lengthM.toFixed(2))}`)
    .join(";");
}

export function buildPaddocksCsv(paddocks: PaddockRow[], vineyardName: string): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of paddocks) {
    const m = deriveMetrics(p);
    const a = firstAlloc(p);
    // Per-row overrides are not yet persisted in the iOS schema; export blank
    // here. (Once a sidecar/iOS column exists, populate from that source.)
    const rowOverridesSerialized = "";
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
      row_lengths_override_m: rowOverridesSerialized,
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
  // Header + a single illustrative comment row (commented via leading #)
  return (
    CSV_COLUMNS.join(",") +
    "\n" +
    `# Example row,My Vineyard,Pinot Noir,2008,Pinot Noir,115,SO4,3,1.5,,,7,2.3,0.6,,,1:245;2:244.2;3.5:243.8,,,\n`
  );
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
  // Strip trailing fully-empty rows and `# …` comment rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows.filter((r) => !(r.length && r[0].trimStart().startsWith("#")));
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
    /** Per-row length overrides parsed from `row_lengths_override_m`. */
    row_lengths_override?: RowLengthOverride[];
    /** Whether the column was present (even if empty). Used to differentiate
     *  "leave alone" vs "explicitly clear". */
    row_lengths_override_provided?: boolean;
  };
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  duplicateNames: string[];
  unknownColumns: string[];
}

function num(s: string | undefined, opts: { nonNeg?: boolean; positive?: boolean } = {}): number | null | "INVALID" {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "INVALID";
  if (opts.positive && n <= 0) return "INVALID";
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

    // row_length_override: must be > 0 if provided
    const numericChecks: [string, number | null | "INVALID"][] = [
      ["row_width", num(get("row_width_m"), { positive: true })],
      ["vine_spacing", num(get("vine_spacing_m"), { positive: true })],
      ["row_offset", num(get("row_offset_m"), { nonNeg: true })],
      ["row_direction", num(get("row_direction_deg"))],
      ["intermediate_post_spacing", num(get("intermediate_post_spacing_m"), { positive: true })],
      ["flow_per_emitter", num(get("flow_per_emitter_lh"), { positive: true })],
      ["emitter_spacing", num(get("emitter_spacing_m"), { positive: true })],
      ["row_length_override", num(get("row_length_override_m"), { positive: true })],
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
      if (v === "INVALID") errors.push(`Invalid numeric value for ${k} (must be a positive number)`);
      else (values as any)[k] = v;
    }
    for (const [k, v] of intChecks) {
      if (v === "INVALID") errors.push(`Invalid integer for ${k}`);
      else (values as any)[k] = v;
    }

    if (values.planting_year != null && (values.planting_year < 1800 || values.planting_year > 2100)) {
      warnings.push(`Planting year ${values.planting_year} looks unusual`);
    }

    // Per-row length overrides (calculation only)
    const rawOverride = get("row_lengths_override_m");
    if (rawOverride !== undefined) {
      values.row_lengths_override_provided = true;
      if (rawOverride === "") {
        values.row_lengths_override = [];
      } else {
        try {
          const parsed = parseRowLengthOverrides(rawOverride);
          // Duplicate row numbers within entry
          const seen = new Set<number>();
          for (const e of parsed) {
            if (seen.has(e.rowNumber)) {
              errors.push(`Duplicate row override for row ${e.rowNumber}`);
            }
            seen.add(e.rowNumber);
          }
          values.row_lengths_override = parsed;
        } catch (e: any) {
          errors.push(`row_lengths_override_m: ${e?.message ?? "invalid format"}`);
        }
      }
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
  // Diagnostics for per-row override changes (preview-only until persistence
  // storage is decided — see notice in dialog).
  rowOverrideChanges: {
    blockName: string;
    count: number;
    cleared: boolean;
  }[];
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
  // IMPORTANT: never write polygon_points or rows from import — operational
  // geometry is owned by the iOS app and must not be altered here.
  // variety/clone/rootstock → variety_allocations[0] only when no existing alloc
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

  const plan: ApplyPlan = {
    toInsert: [],
    toUpdate: [],
    toSkip: [],
    toArchive: [],
    rowOverrideChanges: [],
  };

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
    // Collect per-row override changes for preview
    if (row.values.row_lengths_override_provided) {
      const overrides = row.values.row_lengths_override ?? [];
      plan.rowOverrideChanges.push({
        blockName: row.values.name,
        count: overrides.length,
        cleared: overrides.length === 0,
      });
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
  rowOverridesQueued: number;
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
    rowOverridesQueued: plan.rowOverrideChanges.reduce((s, c) => s + c.count, 0),
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

  // Archive (soft delete) for replace-all — never hard delete.
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

  // NOTE: Per-row length overrides are not yet persisted. Storage location is
  // pending (see PaddockImportExportDialog notice). They are validated and
  // surfaced in the preview so admins can review the data shape today.
  return result;
}

export function safeFileBase(s: string): string {
  return (s.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Vineyard");
}
