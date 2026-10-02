import { describe, it, expect } from "vitest";
import { buildRateOptionArgs, emptyRateDraft } from "@/lib/chemicalV3";

const ok = (r: ReturnType<typeof buildRateOptionArgs>) => { if ("error" in r) throw new Error(r.error); return r.args; };

describe("V3 rate save RPC contract", () => {
  it("screenshot case: single 15 L/ha", () => {
    const a = ok(buildRateOptionArgs("rev1", { ...emptyRateDraft("per_hectare"), value: "15", unit: "L/ha" }));
    expect(a).toEqual({ p_revision_id: "rev1", p_option_id: null, p_basis: "per_hectare", p_unit: "L/ha", p_value: 15, p_min_value: null, p_max_value: null, p_targets: [], p_application_method: null, p_condition: null, p_raw_text: null, p_needs_review: false });
    expect(a).not.toHaveProperty("p_method");
  });
  it("range, edit, targets per line, method", () => {
    const a = ok(buildRateOptionArgs("rev1", { ...emptyRateDraft("per_100_litres"), optionId: "opt9", rateType: "range", min: "500", max: "1000", unit: "mL/100 L", targets: " Phalaris \n\nRyegrass\n", method: "Handgun" }));
    expect(a.p_value).toBeNull(); expect(a.p_min_value).toBe(500); expect(a.p_max_value).toBe(1000);
    expect(a.p_option_id).toBe("opt9"); expect(a.p_targets).toEqual(["Phalaris", "Ryegrass"]);
    expect(a.p_application_method).toBe("Handgun"); expect(a).not.toHaveProperty("p_method");
  });
});
