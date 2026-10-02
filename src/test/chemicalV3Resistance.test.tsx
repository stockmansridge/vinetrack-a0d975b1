import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));

import {
  V3_RESISTANCE_NA_TEXT, V3_RESISTANCE_UNRESOLVED_TEXT, formatV3Resistance, formatV3ResistanceSource,
  readV3Resistance, setV3ResistanceGroups,
} from "@/lib/chemicalV3Resistance";
import { parseCategoryRows, v3CategoryLabel } from "@/lib/chemicalInventory";
import { V3ResistanceField } from "@/components/chemicals/V3ResistanceField";

const weedmaster = {
  product_category: "Herbicide (Group 9)", product_category_key: "herbicide",
  activity_groups: ["9"], activity_group_scheme: "hrac", resistance_classification_state: "classified",
  resistance_group_source: "VineTrack activity group reference v2 (FRAC/HRAC/IRAC)",
};
const cats = parseCategoryRows([{ category_key: "herbicide", display_name: "Herbicide", sort_order: 1 }]);
beforeEach(() => rpc.mockReset());

describe("V3 structured resistance", () => {
  it("1-4. Weedmaster: category Herbicide, resistance HRAC 9, separate fields", () => {
    expect(v3CategoryLabel(weedmaster, cats)).toBe("Herbicide");
    expect(v3CategoryLabel(weedmaster, cats)).not.toMatch(/group/i);
    expect(formatV3Resistance(readV3Resistance(weedmaster))).toBe("HRAC 9");
    expect(formatV3ResistanceSource(weedmaster.resistance_group_source)).toBe("VineTrack activity group reference v2");
    // resistance never derived from category text
    expect(readV3Resistance({ product_category: "Herbicide (Group 9)" }).state).toBe("unresolved");
  });
  it("5-6. multiple groups and scheme preserved", () => {
    expect(formatV3Resistance(readV3Resistance({ activity_groups: ["3", "11"], activity_group_scheme: "frac", resistance_classification_state: "classified" }))).toBe("FRAC 3 + 11");
    expect(formatV3Resistance(readV3Resistance({ activity_groups: ["4A"], activity_group_scheme: "irac", resistance_classification_state: "classified" }))).toBe("IRAC 4A");
  });
  it("7. unresolved shows amber with Resolve", () => {
    render(<V3ResistanceField row={{ resistance_classification_state: "unresolved" }} editable busy={false} onSave={() => {}} msg={null} />);
    expect(screen.getByTestId("v3-resistance").dataset.status).toBe("unresolved");
    expect(screen.getByTestId("v3-resistance-value").textContent).toBe(V3_RESISTANCE_UNRESOLVED_TEXT);
    expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
  });
  it("8. not_applicable", () => {
    expect(formatV3Resistance(readV3Resistance({ resistance_classification_state: "not_applicable", activity_group_scheme: "not_applicable", activity_groups: [] }))).toBe(V3_RESISTANCE_NA_TEXT);
  });
  it("9. admin edit calls chemical_v3_set_resistance_groups", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setV3ResistanceGroups("rev1", { state: "classified", scheme: "frac", groups: "3\n11" });
    expect(rpc).toHaveBeenCalledWith("chemical_v3_set_resistance_groups", { p_revision_id: "rev1", p_scheme: "frac", p_groups: ["3", "11"], p_state: "classified", p_source: "system_admin_review" });
    await setV3ResistanceGroups("rev1", { state: "not_applicable", scheme: "", groups: "" });
    expect(rpc).toHaveBeenLastCalledWith("chemical_v3_set_resistance_groups", { p_revision_id: "rev1", p_scheme: "not_applicable", p_groups: [], p_state: "not_applicable", p_source: "system_admin_review" });
  });
  it("10-11. Add to Vineyard untouched; V1/V2/Master don't use the V3 resistance module", () => {
    const inv = fs.readFileSync("src/lib/chemicalInventory.ts", "utf8");
    expect(inv).toContain("chemical_v3_add_to_vineyard");
    expect(inv).not.toContain("activity_groups");
    for (const f of ["src/components/chemicals/AddChemicalV2Dialog.tsx", "src/pages/admin/MasterCataloguePage.tsx"]) {
      if (fs.existsSync(f)) expect(fs.readFileSync(f, "utf8")).not.toContain("chemicalV3Resistance");
    }
  });
  it("editor exposes classification, scheme and groups", () => {
    render(<V3ResistanceField row={weedmaster} editable busy={false} onSave={() => {}} msg={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Resistance classification")).toBeTruthy();
    expect(screen.getByLabelText("Scheme")).toBeTruthy();
    expect((screen.getByLabelText("Groups") as HTMLTextAreaElement).value).toBe("9");
  });
});
