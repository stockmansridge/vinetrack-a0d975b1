import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  customerStage, customerError, isCustomerAddable, addedMessage, OWNER_MANAGER_ONLY,
  PENDING_REVIEW_LABEL, NOT_SEEN_BEFORE, DISCOVERY_NOTE,
} from "@/lib/chemicalSearchPublic";
import { v3EntryBadge } from "@/lib/chemicalInventory";

const src = (p: string) => readFileSync(p, "utf8");
const dialog = src("src/components/chemicals/ChemicalSearchDialog.tsx");
const page = src("src/pages/setup/SavedChemicalsPage.tsx");
const step = src("src/components/spray/wizard/ProductsStep.tsx");
const strings = (s: string) => (s.split("\n").filter((l) => !/^\s*(import|} from)/.test(l)).join("\n").match(/"[^"\n]*"|>[^<>{}\n]+</g) ?? []).join("\n");

describe("Chemical Search production cutover", () => {
  it("Chemicals page uses the new search, not V2", () => {
    expect(page).toContain("<ChemicalSearchDialog");
    expect(page).toContain("Add Chemical");
    expect(page).not.toContain("AddChemicalV2Dialog");
    expect(page).not.toContain("useChemicalSearchV2");
    expect(page).toContain('manualOnly={editing === "new"}');
  });
  it("Spray ProductsStep uses the new search and binds by exact id", () => {
    expect(step).toContain("<ChemicalSearchDialog");
    expect(step).toMatch(/c\.id === savedChemicalId/);
    expect(step).toContain("manualOnly");
    expect(step).toContain("ChemicalStoreCombobox");
  });
  it("dialog never calls legacy lookups or shows admin tools / V3", () => {
    for (const bad of ["chemical-info-lookup", "search_master_chemicals_v2", "web_lookup_v2", "ChemicalAILookup", "approveV3", "rejectV3", "V3ReviewDecisions", "Opening stock"]) {
      expect(dialog).not.toContain(bad);
    }
    expect(strings(dialog)).not.toMatch(/V3|Prototype/);
  });
  it("customer wording", () => {
    expect(NOT_SEEN_BEFORE).toBe("We couldn't find this product in VineTrack yet.");
    expect(dialog).toContain("<Sparkles");
    expect(dialog).toContain("NOT_SEEN_BEFORE_DETAIL");
    expect(PENDING_REVIEW_LABEL).toBe("Pending VineTrack review");
    expect(DISCOVERY_NOTE).not.toMatch(/V3/);
    for (const s of ["searching", "label_download", "extracting", "directions", "rates", "pending_review"]) {
      expect(customerStage(s)).not.toMatch(/V3|_/);
    }
    expect(customerError({ message: "PGRST301 chemical_v3_x" }, "discovery")).not.toMatch(/PGRST|v3/i);
    expect(customerError({ message: "permission denied" }, "add")).toBe(OWNER_MANAGER_ONLY);
    expect(addedMessage(false, "Stockman's Ridge")).toBe("Added to Stockman's Ridge");
    expect(addedMessage(true, "X")).toBe("Already in this vineyard chemical list");
  });
  it("pending_review and needs_attention are addable", () => {
    expect(isCustomerAddable("pending_review")).toBe(true);
    expect(isCustomerAddable("needs_attention")).toBe(true);
    expect(isCustomerAddable("rejected")).toBe(false);
  });
  it("saved-chemical badges contain no V3", () => {
    expect(v3EntryBadge({ entry_source: "chemical_v3_candidate" })?.label).toBe("Pending review");
    expect(v3EntryBadge({ entry_source: "chemical_v3_catalogue" })?.label).toBe("VineTrack catalogue");
  });
  it("inventory follows Owner/Manager on the Chemicals page", () => {
    expect(page).toContain("canManageChemicalInventory(currentRole)");
  });
});

import { parseInventorySummary } from "@/lib/chemicalInventory";
describe("Inventory & Purchases correction", () => {
  const lab = readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
  it("wording and alphabetical order", () => {
    expect(lab).toContain("Select a chemical to review its stock and purchase history.");
    expect(lab).not.toMatch(/listed first/);
    expect(lab).not.toMatch(/Number\(!v3EntryBadge/);
  });
  it("tracking_status needs_opening_stock never shows zero", () => {
    const s = parseInventorySummary({ tracking_status: "needs_opening_stock", stock_status: "out_of_stock", current_quantity: 0 });
    expect(s.state).toBe("needs_opening_stock");
    expect(s.quantity).toBeNull();
  });
});

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
describe("Full Portal production cutover", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (!p.startsWith("src/test")) walk(p); }
      else if (/\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk("src");
  const prod = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  it("no production code reaches the old lookup systems", () => {
    for (const bad of [
      '"chemical-info-lookup"', "search_master_chemicals_v2", "web_lookup_v2",
      "AddChemicalV2Dialog", "useChemicalSearchV2", "ChemicalAILookup",
      "chemicalStagedLookup", "chemicalSearchFlow", "chemicalLookupRequest",
      "chemicalLookupResolver", "chemicalReverifyLookup", "MasterUpdateDialog", "fetchMasterChemical",
    ]) {
      for (const [f, s] of prod) {
        const code = s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
        expect(code.includes(bad), `${f} → ${bad}`).toBe(false);
      }
    }
  });
  it("obsolete files are deleted", () => {
    for (const f of [
      "src/components/chemicals/AddChemicalV2Dialog.tsx", "src/components/spray/ChemicalAILookup.tsx",
      "src/lib/chemicalSearchV2.ts", "src/lib/chemicalStagedLookup.ts", "src/lib/chemicalReverifyLookup.ts",
      "src/lib/chemicalSearchFlow.ts", "src/lib/chemicalLookupRequest.ts", "src/lib/chemicalLookupResolver.ts",
      "src/components/chemicals/MasterUpdateDialog.tsx", "src/pages/admin/MasterCataloguePage.tsx",
    ]) expect(existsSync(f), f).toBe(false);
  });
  it("ChemicalEditor is edit/manual only and has no re-verify", () => {
    const ed = src("src/components/chemicals/ChemicalEditorSheet.tsx");
    expect(ed).not.toMatch(/ChemicalReverifyDialog|Check for updates|Review update/);
    expect(src("src/components/chemicals/ChemicalIntelligenceEditor.tsx")).not.toMatch(/Re-verify|ChemicalReverifyDialog/);
  });
  it("Store picker stays local; Catalogue Review stays System Admin; old Master nav gone", () => {
    expect(src("src/components/spray/ChemicalStoreCombobox.tsx")).not.toMatch(/functions\.invoke|rpc\(/);
    const nav = src("src/lib/navigationConfig.ts");
    expect(nav).not.toContain("/admin/master-catalogue");
    expect(nav).toContain("Chemical Catalogue Review");
    expect(src("src/App.tsx")).not.toContain("MasterCataloguePage");
  });
  it("customer search has no System Admin gate", () => {
    expect(dialog).not.toMatch(/useIsSystemAdmin|isSystemAdmin/);
  });
});
