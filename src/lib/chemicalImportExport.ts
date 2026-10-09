// CSV export & import for vineyard Saved Chemicals.
//
// Import never deletes, archives, or touches purchasing/pricing, stock,
// default_rates or Chemical Intelligence. Rows match by internal_id, else by
// name + manufacturer (case/suffix-insensitive) within the vineyard. On update
// blank cells keep the existing value. Writes go through the normal
// createSavedChemical / updateSavedChemical helpers.
import { parseCsv } from "@/lib/paddockImportExport";
import { matchProductCategoryKey, productCategoryLabel } from "@/lib/chemicalProductCategory";
import { normaliseManufacturerName } from "@/lib/manufacturerNormalise";
import { validateLabelUrl } from "@/lib/labelUrl";
import type { SavedChemical, SavedChemicalInput } from "@/lib/savedChemicalsQuery";

export const CHEMICAL_CSV_COLUMNS = [
  "internal_id", "name", "manufacturer", "active_ingredient", "chemical_group",
  "product_category", "crop", "problem", "rate_per_ha", "unit",
  "restrictions", "label_url", "product_url", "notes",
] as const;
type Col = (typeof CHEMICAL_CSV_COLUMNS)[number];
type TextField = Exclude<Col, "internal_id" | "rate_per_ha" | "product_category">;

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildChemicalsCsv(list: SavedChemical[]): string {
  const lines = [CHEMICAL_CSV_COLUMNS.join(",")];
  for (const c of list) {
    const row: Record<Col, unknown> = {
      internal_id: c.id, name: c.name, manufacturer: c.manufacturer,
      active_ingredient: c.active_ingredient, chemical_group: c.chemical_group,
      product_category: productCategoryLabel(c.product_category) ?? c.use ?? "",
      crop: c.crop, problem: c.problem, rate_per_ha: c.rate_per_ha, unit: c.unit,
      restrictions: c.restrictions, label_url: c.label_url, product_url: c.product_url, notes: c.notes,
    };
    lines.push(CHEMICAL_CSV_COLUMNS.map((k) => esc(row[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function buildChemicalsTemplateCsv(): string {
  return CHEMICAL_CSV_COLUMNS.join(",") + "\n" +
    ",Example Fungicide,Example Co,Copper hydroxide,FRAC M1,Fungicide,Grapes,Downy mildew,2,Kg/ha,WHP 7 days,https://example.com/label.pdf,,Example row - delete before importing\n";
}

export type ChemicalImportAction = "create" | "update" | "unchanged";
export interface ChemicalImportRow {
  line: number;
  action: ChemicalImportAction;
  id?: string;
  name: string;
  changes: string[];
  input: SavedChemicalInput;
}
export interface ChemicalImportPlan { rows: ChemicalImportRow[]; errors: string[] }

const key = (name?: string | null, mfr?: string | null) =>
  `${String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ")}|${normaliseManufacturerName(mfr)}`;

export function planChemicalImport(text: string, existing: SavedChemical[]): ChemicalImportPlan {
  const grid = parseCsv(text.replace(/^\uFEFF/, "")).filter((r) => r.some((c) => c.trim() !== ""));
  const errors: string[] = [];
  const rows: ChemicalImportRow[] = [];
  if (!grid.length) return { rows, errors: ["The file is empty."] };
  const header = grid[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("name")) return { rows, errors: ["Missing required column: name"] };
  const byId = new Map(existing.map((c) => [c.id, c]));
  const byKey = new Map(existing.map((c) => [key(c.name, c.manufacturer), c]));
  const seen = new Set<string>();

  grid.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: Col) => { const idx = header.indexOf(c); return idx < 0 ? "" : (cells[idx] ?? "").trim(); };
    const id = get("internal_id");
    let match: SavedChemical | undefined;
    if (id) {
      match = byId.get(id);
      if (!match) { errors.push(`Row ${line}: internal_id not found in this vineyard`); return; }
    }
    const name = get("name") || match?.name || "";
    if (!name) { errors.push(`Row ${line}: name is required`); return; }
    match ??= byKey.get(key(name, get("manufacturer")));
    if (match) {
      if (seen.has(match.id)) { errors.push(`Row ${line}: duplicate of an earlier row for "${name}"`); return; }
      seen.add(match.id);
    }

    // Case/spacing-only differences keep the saved spelling.
    const sameName = match && key(name, "") === key(match.name, "");
    const finalName = sameName ? match!.name! : name;
    const input: SavedChemicalInput = { name: finalName };
    const changes: string[] = [];
    const cur = (match ?? {}) as Record<string, unknown>;
    const set = (field: keyof SavedChemicalInput, value: unknown) => {
      (input as unknown as Record<string, unknown>)[field] = value;
      if ((cur[field] ?? null) !== (value ?? null) && !(cur[field] == null && value === "")) changes.push(field);
    };
    if (match && !sameName) changes.push("name");

    let bad = false;
    const texts: TextField[] = ["manufacturer", "active_ingredient", "chemical_group", "crop", "problem", "unit", "restrictions", "notes"];
    for (const f of texts) {
      const v = get(f);
      if (!v) continue;
      // "Nufarm" vs "Nufarm Australia Pty Ltd" is the same maker — keep the saved spelling.
      if (f === "manufacturer" && match && normaliseManufacturerName(v) === normaliseManufacturerName(match.manufacturer)) continue;
      set(f, v);
    }
    for (const f of ["label_url", "product_url"] as const) {
      const v = get(f);
      if (!v) continue;
      const r = validateLabelUrl(v);
      if (!r.ok) { errors.push(`Row ${line}: ${f} - ${r.error}`); bad = true; } else set(f, r.value);
    }
    const cat = get("product_category");
    if (cat) {
      const k = matchProductCategoryKey(cat);
      if (!k) { errors.push(`Row ${line}: unknown product_category "${cat}"`); bad = true; }
      else { set("product_category", k); input.use = productCategoryLabel(k); }
    }
    const rate = get("rate_per_ha");
    if (rate) {
      const n = Number(rate);
      if (!Number.isFinite(n) || n < 0) { errors.push(`Row ${line}: rate_per_ha must be a number`); bad = true; }
      else set("rate_per_ha", n);
    }
    if (bad) return;
    rows.push({
      line, name, input, id: match?.id, changes,
      action: !match ? "create" : changes.length ? "update" : "unchanged",
    });
  });
  return { rows, errors };
}
