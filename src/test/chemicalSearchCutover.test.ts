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
    expect(NOT_SEEN_BEFORE).toBe("We haven't seen this product before.");
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
  it("inventory stays System Admin only on the Chemicals page", () => {
    expect(page).toContain("canUseInventoryPilot(isSystemAdmin)");
  });
});
