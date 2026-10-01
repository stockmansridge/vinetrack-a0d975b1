import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { CanonicalRateChoice } from "@/components/chemicals/CanonicalRateChoice";
import { selectableVineyardOptions, targetSummary } from "@/lib/masterRateOptionGroups";
import { decodeCanonicalDefaultRateOptions } from "@/lib/chemicalDefaultRatesContract";
import { hydrateMasterSelection, masterHydrationRequestBody, normaliseMasterSearchHit } from "@/lib/chemicalSearchV2";

const ROW = JSON.parse(readFileSync("src/test/fixtures/weedmaster-rev2.sanitised.json", "utf8")).row;
const cand = normaliseMasterSearchHit({ ...ROW, review_status: "candidate" })!;
const weeds = ["Amaranth", "Barley grass", "Barnyard grass", ...Array.from({ length: 20 }, (_, i) => `Weed ${i}`)];
const opt = (k: string, extra: Record<string, unknown>) => ({ option_key: `default_option_v1_${k}`, rate_ids: [`rate_v1_${k}`], unit: "L", value: null, min_value: null, max_value: null, crops: ["Vineyards"], ...extra });
const PHALARIS = { option_key: "default_option_v1_5f58b1d9f422213e1ecf8632036c1356", rate_ids: ["rate_v1_4efec198ead373a3286939ced245fadf"], direction_ids: ["direction_v1_1363f3205ca7b639cd5f970a03d91785"], basis: "per_100_litres", unit: "mL", value: null, min_value: 500, max_value: 1000, targets: ["Phalaris"], conditions: ["Handgun"], crops: ["Vineyards"] };
const served = {
  master_chemical_id: ROW.id, registration_number: "53576", registration_country: "AU",
  default_rate_options: {
    per_hectare: [
      opt("a", { basis: "per_hectare", min_value: 2, max_value: 3, targets: weeds, conditions: ["Boom"] }),
      opt("b", { basis: "per_hectare", value: 6, targets: ["Johnson grass"], conditions: ["Boom"] }),
      opt("c", { basis: "per_hectare", value: 9, targets: ["Apples"], conditions: ["Boom"], crops: ["Pome fruit"] }),
    ],
    per_100_litres: [opt("d", { basis: "per_100_litres", unit: "mL", min_value: 500, max_value: 700, targets: weeds, conditions: ["Handgun"] }), PHALARIS],
  },
};

describe("canonical Master rate choice", () => {
  it("admin candidate hydration asks for preview; customers never do", async () => {
    expect(masterHydrationRequestBody(cand, "x", { adminCandidatePreview: true })).toMatchObject({ admin_candidate_preview: true, master_chemical_id: ROW.id });
    expect(masterHydrationRequestBody(cand, "x")).not.toHaveProperty("admin_candidate_preview");
    const approved = normaliseMasterSearchHit({ ...ROW, review_status: "approved" })!;
    expect(masterHydrationRequestBody(approved, "x", { adminCandidatePreview: true })).not.toHaveProperty("admin_candidate_preview");
    const res = await hydrateMasterSelection(cand, vi.fn().mockResolvedValue({ data: served, error: null }), { adminCandidatePreview: true });
    expect(res.status).toBe("hydrated");
  });

  it("renders grouped options, not raw rows; non-vineyard excluded; Phalaris own option", () => {
    expect(cand.rates.length).toBeGreaterThan(100);
    const options = selectableVineyardOptions(decodeCanonicalDefaultRateOptions(served.default_rate_options));
    const onSelect = vi.fn();
    render(<CanonicalRateChoice options={options} selections={{ per_hectare: null, per_100_litres: null }} onSelect={onSelect} onClear={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryByText(/9 L\/ha/)).toBeNull();
    expect(screen.getByText("2–3 L/ha — Boom")).toBeTruthy();
    expect(screen.getByText("500–1000 mL/100 L — Handgun")).toBeTruthy();
    expect(screen.getAllByText("Amaranth, Barley grass, Barnyard grass + 20 more")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("Show all")[0]);
    expect(screen.getByText(new RegExp("Weed 19"))).toBeTruthy();
    fireEvent.click(screen.getByLabelText("500–1000 mL/100 L — Handgun"));
    expect(onSelect).toHaveBeenCalledWith("per_100_litres", expect.objectContaining({ option_key: PHALARIS.option_key, rate_ids: PHALARIS.rate_ids, min_value: 500, max_value: 1000 }));
  });

  it("target summary", () => {
    expect(targetSummary(["Phalaris"])).toEqual({ preview: "Phalaris", hiddenCount: 0 });
  });
});
