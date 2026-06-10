// Generates the .xlsx template for Spray Program import.
// Pre-populates reference tabs (Blocks / Chemicals / Equipment / Tractors /
// Instructions & Allowed Values) from the current vineyard's data so users
// can copy exact names into the Spray Program sheet.
import * as XLSX from "xlsx";
import {
  templateHeaders, ALLOWED_UNITS,
  RECOMMENDED_OPERATION_TYPES, MAX_CHEMICALS,
  TEMPLATE_HEADER_ROW_INDEX, REQUIRED_HEADERS,
} from "./sprayProgramImport";
import { fetchList } from "@/lib/queries";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { deriveMetrics, parseVarietyAllocations } from "@/lib/paddockGeometry";

function aoaSheet(rows: any[][]) {
  return XLSX.utils.aoa_to_sheet(rows);
}

const INSTRUCTION_BANNER =
  "Fill in one spray job per row. Use the reference tabs (Blocks, Chemicals, Equipment, Tractors, Instructions & Allowed Values) to copy exact names — names must match for the import to link correctly. Each row creates a DRAFT spray job, or a reusable TEMPLATE if Make Template = Yes.";

const REQUIRED_NOTE =
  "Required columns: " + REQUIRED_HEADERS.join(", ") +
  ". Planned Date is required unless Make Template = Yes. All other fields are optional.";

function exampleRows(): any[][] {
  const headers = templateHeaders();
  const blank = () => new Array(headers.length).fill("");
  const set = (row: any[], h: string, v: any) => {
    const i = headers.indexOf(h);
    if (i >= 0) row[i] = v;
  };

  // Example 1: a normal planned spray job.
  const job = blank();
  set(job, "Job Name", "EL23 PM Cover Spray");
  set(job, "Planned Date", "2026-11-12");
  set(job, "Make Template", "No");
  set(job, "Blocks", "Block A; Block B");
  set(job, "Operation Type", "Fungicide");
  set(job, "Growth Stage", "EL23");
  set(job, "Water Rate (L/ha)", 500);
  set(job, "Equipment", "");
  set(job, "Tractor", "");
  set(job, "Operator Email", "");
  set(job, "Target / Pest or Disease (optional)", "Powdery mildew");
  set(job, "Notes", "Pre-flowering cover");
  set(job, "Chemical 1 Name", "Kocide Blue Xtra");
  set(job, "Chemical 1 Rate", 2.5);
  set(job, "Chemical 1 Unit", "kg/ha");
  set(job, "Chemical 2 Name", "Sulphur 800");
  set(job, "Chemical 2 Rate", 3);
  set(job, "Chemical 2 Unit", "kg/ha");

  // Example 2: a reusable template (no planned date).
  const tmpl = blank();
  set(tmpl, "Job Name", "Standard PM Cover Template");
  set(tmpl, "Planned Date", "");
  set(tmpl, "Make Template", "Yes");
  set(tmpl, "Blocks", "Block A");
  set(tmpl, "Operation Type", "Fungicide");
  set(tmpl, "Growth Stage", "EL23");
  set(tmpl, "Water Rate (L/ha)", 500);
  set(tmpl, "Notes", "Reusable template");
  set(tmpl, "Chemical 1 Name", "Kocide Blue Xtra");
  set(tmpl, "Chemical 1 Rate", 2.5);
  set(tmpl, "Chemical 1 Unit", "kg/ha");

  return [job, tmpl];
}

function varietySummary(p: any): string {
  const allocs = parseVarietyAllocations(p?.variety_allocations);
  if (!allocs.length) {
    const fallback = (p?.variety ?? "").toString().trim();
    return fallback || "Not set";
  }
  const parts = allocs
    .filter((a) => (a.variety ?? "").toString().trim().length > 0)
    .map((a) => {
      const name = String(a.variety).trim();
      const pct = typeof a.percent === "number" && Number.isFinite(a.percent)
        ? ` ${Math.round(a.percent)}%`
        : "";
      return `${name}${pct}`;
    });
  return parts.length ? parts.join(", ") : "Not set";
}

export async function downloadSprayProgramTemplate(opts: {
  vineyardId: string;
  vineyardName: string | null;
}) {
  const year = new Date().getFullYear();
  const [paddocks, equipment, tractors, chems] = await Promise.all([
    fetchList("paddocks", opts.vineyardId),
    fetchList("spray_equipment", opts.vineyardId),
    fetchList("tractors", opts.vineyardId),
    fetchSavedChemicalsForVineyard(opts.vineyardId),
  ]);

  const wb = XLSX.utils.book_new();

  // ----------- Spray Program -----------
  const headers = templateHeaders();
  const blankCols = headers.length - 1;
  const programRows: any[][] = [
    [INSTRUCTION_BANNER, ...Array(blankCols).fill("")],
    [REQUIRED_NOTE, ...Array(blankCols).fill("")],
    headers,
    ...exampleRows(),
  ];
  const program = aoaSheet(programRows);
  program["!cols"] = headers.map((h) => ({
    wch: h.length < 16 ? 18 : Math.min(h.length + 4, 32),
  }));
  program["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];
  (program as any)["!sheetViews"] = [{ state: "frozen", ySplit: TEMPLATE_HEADER_ROW_INDEX + 1 }];
  XLSX.utils.book_append_sheet(wb, program, "Spray Program");

  // ----------- Blocks -----------
  const blockHeaders = [
    "Block Name",
    "Variety / varieties",
    "Area (ha)",
    "Row count",
    "Total row length (m)",
    "Block ID",
  ];
  const blockBody = ((paddocks ?? []) as any[]).map((p) => {
    const m = deriveMetrics(p);
    return [
      p.name ?? p.block_name ?? "",
      varietySummary(p),
      m.areaHa > 0 ? Number(m.areaHa.toFixed(4)) : "",
      m.rowCount > 0 ? m.rowCount : "",
      m.totalRowLengthM > 0 ? Math.round(m.totalRowLengthM) : "",
      p.id ?? "",
    ];
  });
  const blocksSheet = aoaSheet([
    ["Copy block names from column A into the Blocks column of the Spray Program sheet. Separate multiple blocks with a semicolon."],
    [],
    blockHeaders,
    ...blockBody,
  ]);
  blocksSheet["!cols"] = [
    { wch: 28 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 38 },
  ];
  blocksSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: blockHeaders.length - 1 } }];
  XLSX.utils.book_append_sheet(wb, blocksSheet, "Blocks");

  // ----------- Chemicals -----------
  const chemHeaders = [
    "Product Name", "Active Ingredient", "Default Rate", "Unit",
    "Restrictions", "Saved Chemical ID",
  ];
  const chemSheet = aoaSheet([
    ["Copy product names from column A into the Chemical N Name columns. Unknown chemicals will import as a warning with no saved-chemical link."],
    [],
    chemHeaders,
    ...(chems.chemicals ?? []).map((c) => [
      c.name ?? "",
      c.active_ingredient ?? "",
      c.rate_per_ha ?? "",
      c.unit ?? "",
      c.restrictions ?? "",
      c.id ?? "",
    ]),
  ]);
  chemSheet["!cols"] = [{ wch: 32 }, { wch: 28 }, { wch: 14 }, { wch: 10 }, { wch: 28 }, { wch: 38 }];
  chemSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: chemHeaders.length - 1 } }];
  XLSX.utils.book_append_sheet(wb, chemSheet, "Chemicals");

  // ----------- Equipment -----------
  const equipHeaders = ["Equipment Name", "Type", "Equipment ID"];
  const equipSheet = aoaSheet([
    ["Copy equipment names from column A into the Equipment column of the Spray Program sheet (must match exactly)."],
    [],
    equipHeaders,
    ...((equipment ?? []) as any[]).map((e) => [e.name ?? "", e.type ?? "", e.id ?? ""]),
  ]);
  equipSheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 38 }];
  equipSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: equipHeaders.length - 1 } }];
  XLSX.utils.book_append_sheet(wb, equipSheet, "Equipment");

  // ----------- Tractors -----------
  const tractorHeaders = ["Tractor Name", "Tractor ID"];
  const tractorSheet = aoaSheet([
    ["Copy tractor names from column A into the Tractor column of the Spray Program sheet (must match exactly)."],
    [],
    tractorHeaders,
    ...((tractors ?? []) as any[]).map((t) => [
      t.name ?? t.display_name ?? t.model ?? "",
      t.id ?? "",
    ]),
  ]);
  tractorSheet["!cols"] = [{ wch: 28 }, { wch: 38 }];
  tractorSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: tractorHeaders.length - 1 } }];
  XLSX.utils.book_append_sheet(wb, tractorSheet, "Tractors");

  // ----------- Instructions & Allowed Values -----------
  const inst: any[][] = [
    ["How to use this template"],
    [],
    ["1.", "Before downloading: set up blocks, chemicals, equipment, tractors and operators in the app — so the reference tabs are pre-populated with names you can copy."],
    ["2.", "Fill in rows on the Spray Program tab only."],
    ["3.", "Use exact block names from the Blocks tab (semicolon-separated for multiple)."],
    ["4.", "Use exact chemical names from the Chemicals tab where possible."],
    ["5.", "Use exact equipment, tractor and operator names from their reference tabs."],
    ["6.", "Leave optional fields blank if they are not needed."],
    ["7.", "Each row creates one DRAFT spray job — unless Make Template = Yes, which creates a reusable spray template instead."],
    ["8.", "Imported rows never create completed spray records."],
    ["9.", "Check the preview screen before confirming the import."],
    [],
    ["Make Template column"],
    ["•", "No (default) → creates a normal draft spray job. Planned Date is required."],
    ["•", "Yes → creates a reusable spray job template (is_template = true). Planned Date is not required and will be ignored."],
    [],
    ["Important"],
    ["•", "Unknown blocks will stop that row from importing."],
    ["•", "Unknown chemicals are flagged as warnings and imported with no saved-chemical link."],
    ["•", "Existing spray jobs and templates are not overwritten in v1."],
    ["•", "Completed spray records are never created from this import."],
    ["•", "Calculated/system-derived values (row spacing, VSP canopy size & density, concentration factor) come from your block setup and the spray calculator in the app — they are intentionally not part of this template."],
    [],
    ["Required columns"],
    ["", REQUIRED_HEADERS.join(", ") + " (plus Planned Date when Make Template = No)"],
    [],
    ["Allowed values"],
    ["Field", "Allowed values"],
    ["Status (forced on import)", "draft"],
    ["Make Template", "Yes, No"],
    ["Operation Type (recommended)", RECOMMENDED_OPERATION_TYPES.join(", ")],
    ["Chemical Unit", ALLOWED_UNITS.join(", ")],
    ["Growth Stage", "EL0 through EL47 (uppercase, no space, e.g. EL23)"],
    ["Blocks separator", "Semicolon (;) — names must match Blocks tab exactly"],
    ["Max chemicals per job", String(MAX_CHEMICALS)],
  ];
  const instSheet = aoaSheet(inst);
  instSheet["!cols"] = [{ wch: 32 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, instSheet, "Instructions & Allowed Values");

  const safe = (opts.vineyardName ?? "Vineyard")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Vineyard";
  const filename = `VineTrack_Spray_Program_Template_${safe}_${year}.xlsx`;
  XLSX.writeFile(wb, filename);
}
