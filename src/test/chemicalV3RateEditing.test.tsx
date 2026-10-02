import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import { buildRateOptionArgs, draftFromOption, emptyRateDraft, isV3RevisionEditable } from "@/lib/chemicalV3";
import { RateColumn } from "@/components/chemicals/V3ReviewData";

describe("V3 admin rate editing", () => {
  it("single stores value with null min/max", () => {
    const r = buildRateOptionArgs("rev1", { ...emptyRateDraft("per_hectare"), value: "3", unit: "L/ha", targets: "Phalaris\nRyegrass" });
    expect("args" in r && r.args).toMatchObject({ p_revision_id: "rev1", p_option_id: null, p_basis: "per_hectare", p_value: 3, p_min_value: null, p_max_value: null, p_unit: "L/ha", p_targets: ["Phalaris", "Ryegrass"] });
  });
  it("range stores min/max with null value and never converts basis", () => {
    const r = buildRateOptionArgs("rev1", { ...emptyRateDraft("per_100_litres"), rateType: "range", value: "9", min: "500", max: "1000", unit: "mL/100 L" });
    expect("args" in r && r.args).toMatchObject({ p_basis: "per_100_litres", p_value: null, p_min_value: 500, p_max_value: 1000, p_unit: "mL/100 L" });
  });
  it("rejects missing unit, non-numeric and inverted ranges", () => {
    expect(buildRateOptionArgs("r", { ...emptyRateDraft("per_hectare"), value: "3" })).toHaveProperty("error");
    expect(buildRateOptionArgs("r", { ...emptyRateDraft("per_hectare"), value: "abc", unit: "L/ha" })).toHaveProperty("error");
    expect(buildRateOptionArgs("r", { ...emptyRateDraft("per_hectare"), rateType: "range", min: "6", max: "3", unit: "L/ha" })).toHaveProperty("error");
  });
  it("draftFromOption keeps id, basis and range", () => {
    const d = draftFromOption({ id: "o1", basis: "per_100_litres", min_value: 500, max_value: 1000, unit: "mL/100 L", targets: ["A", "B"] }, "per_hectare");
    expect(d).toMatchObject({ optionId: "o1", basis: "per_100_litres", rateType: "range", min: "500", max: "1000", targets: "A\nB" });
  });
  it("only pending/needs-attention revisions are editable", () => {
    expect(isV3RevisionEditable("pending_review")).toBe(true);
    expect(isV3RevisionEditable("needs_attention")).toBe(true);
    expect(isV3RevisionEditable("approved")).toBe(false);
  });
  it("cards show Edit/Delete and Add only when handlers given", () => {
    const onEdit = vi.fn(), onDelete = vi.fn(), onAdd = vi.fn();
    const { rerender } = render(<RateColumn title="Per hectare" items={[{ id: "o1", value: 3, unit: "L/ha" }]} />);
    expect(screen.queryByText("Edit")).toBeNull();
    rerender(<RateColumn title="Per hectare" items={[{ id: "o1", value: 3, unit: "L/ha" }]} edit={{ onEdit, onDelete }} onAdd={onAdd} addLabel="+ Add per hectare rate" />);
    fireEvent.click(screen.getByText("Edit")); fireEvent.click(screen.getByText("Delete")); fireEvent.click(screen.getByText("+ Add per hectare rate"));
    expect(onEdit).toHaveBeenCalled(); expect(onDelete).toHaveBeenCalled(); expect(onAdd).toHaveBeenCalled();
  });
  it("uses the two admin RPCs and reloads the revision", () => {
    const lib = fs.readFileSync("src/lib/chemicalV3.ts", "utf8");
    expect(lib).toContain("chemical_v3_admin_save_rate_option");
    expect(lib).toContain("chemical_v3_admin_delete_rate_option");
    const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
    expect(page).toContain('invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] })');
  });
});
