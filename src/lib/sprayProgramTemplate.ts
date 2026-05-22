// Generates the .xlsx template for Spray Program import.
// Pre-populates reference tabs (Blocks / Chemicals / Equipment / Allowed Values)
// from the current vineyard's data so users can match names exactly.
import * as XLSX from "xlsx";
import {
  templateHeaders, ALLOWED_UNITS, VSP_CANOPY_SIZES, VSP_CANOPY_DENSITIES,
  RECOMMENDED_OPERATION_TYPES, MAX_CHEMICALS,
} from "./sprayProgramImport";
import { fetchList } from "@/lib/queries";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";

function aoaSheet(rows: any[][]) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function exampleRow(): any[] {
  const headers = templateHeaders();
  const out: any[] = new Array(headers.length).fill("");
  const set = (h: string, v: any) => {
    const i = headers.indexOf(h);
    if (i >= 0) out[i] = v;
  };
  set("Name", "EL23 PM Cover Spray");
  set("Planned Date", "2026-11-12");
  set("Paddocks", "Block A; Block B");
  set("Operation Type", "Fungicide");
  set("Target", "Powdery mildew");
  set("Growth Stage", "EL23");
  set("Water Rate (L/ha)", 500);
  set("Water Volume (L)", 1500);
  set("Concentration Factor", 1.0);
  set("Row Spacing (m)", 2.7);
  set("VSP Canopy Size", "Medium");
  set("VSP Canopy Density", "Low");
  set("Equipment", "");
  set("Tractor", "");
  set("Operator Email", "");
  set("Notes", "Pre-flowering cover");
  set("Chemical 1 Name", "Kocide Blue Xtra");
  set("Chemical 1 Active Ingredient", "Copper hydroxide");
  set("Chemical 1 Rate", 2.5);
  set("Chemical 1 Unit", "kg/ha");
  set("Chemical 1 Water Rate (L/ha)", 500);
  set("Chemical 1 Notes", "Wettable");
  set("Chemical 2 Name", "Sulphur 800");
  set("Chemical 2 Rate", 3);
  set("Chemical 2 Unit", "kg/ha");
  return out;
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

  // Spray Program
  const headers = templateHeaders();
  const programRows: any[][] = [headers, exampleRow()];
  const program = aoaSheet(programRows);
  program["!cols"] = headers.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, program, "Spray Program");

  // Blocks
  const blockHeaders = ["Block Name", "Block ID", "Variety", "Area ha"];
  const blockRows = [blockHeaders, ...((paddocks ?? []) as any[]).map((p) => [
    p.name ?? p.block_name ?? "",
    p.id ?? "",
    p.variety ?? "",
    p.area_hectares ?? p.area_ha ?? "",
  ])];
  XLSX.utils.book_append_sheet(wb, aoaSheet(blockRows), "Blocks");

  // Chemicals
  const chemHeaders = [
    "Product Name", "Saved Chemical ID", "Active Ingredient",
    "Default Rate", "Unit", "Restrictions",
  ];
  const chemRows = [chemHeaders, ...(chems.chemicals ?? []).map((c) => [
    c.name ?? "",
    c.id ?? "",
    c.active_ingredient ?? "",
    c.rate_per_ha ?? "",
    c.unit ?? "",
    c.restrictions ?? "",
  ])];
  XLSX.utils.book_append_sheet(wb, aoaSheet(chemRows), "Chemicals");

  // Equipment
  const equipHeaders = ["Equipment Name", "Equipment ID", "Type"];
  const equipRows = [equipHeaders, ...((equipment ?? []) as any[]).map((e) => [
    e.name ?? "", e.id ?? "", e.type ?? "",
  ])];
  XLSX.utils.book_append_sheet(wb, aoaSheet(equipRows), "Equipment");

  // Tractors (handy reference)
  const tractorHeaders = ["Tractor Name", "Tractor ID"];
  const tractorRows = [tractorHeaders, ...((tractors ?? []) as any[]).map((t) => [
    t.name ?? t.display_name ?? t.model ?? "", t.id ?? "",
  ])];
  XLSX.utils.book_append_sheet(wb, aoaSheet(tractorRows), "Tractors");

  // Allowed Values
  const av: any[][] = [
    ["Field", "Allowed values"],
    ["Status (forced on import)", "draft"],
    ["Operation Type (recommended)", RECOMMENDED_OPERATION_TYPES.join(", ")],
    ["Units", ALLOWED_UNITS.join(", ")],
    ["VSP Canopy Size", VSP_CANOPY_SIZES.join(", ")],
    ["VSP Canopy Density", VSP_CANOPY_DENSITIES.join(", ")],
    ["Growth Stage", "EL0 through EL47 (uppercase, no space, e.g. EL23)"],
    ["Paddocks", "Semicolon-separated names, must match Blocks tab exactly"],
    ["Max chemicals per job", String(MAX_CHEMICALS)],
    [],
    ["Notes", ""],
    ["", "All imports become draft planned jobs. They will not appear as completed spray records."],
    ["", "Unknown paddock = row rejected. Unknown chemical = imported with warning, no saved-chemical link."],
    ["", "Equipment / Tractor / Operator must match this vineyard exactly (case-insensitive) or the field is left blank."],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet(av), "Allowed Values");

  const safe = (opts.vineyardName ?? "Vineyard")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Vineyard";
  const filename = `VineTrack_Spray_Program_Template_${safe}_${year}.xlsx`;
  XLSX.writeFile(wb, filename);
}
