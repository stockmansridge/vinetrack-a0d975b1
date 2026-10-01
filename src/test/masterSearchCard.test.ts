import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  normaliseMasterSearchHit, compactRateIndicator, visibleMasterHits, isCandidateHit,
} from "@/lib/chemicalSearchV2";

const duo = JSON.parse(fs.readFileSync("src/test/fixtures/weedmaster-rev2.sanitised.json", "utf8"));
const duoRow = duo.master ?? duo.record ?? duo;

describe("compact Master search card", () => {
  it("DUO shows one indicator, not the flattened rate list", () => {
    const hit = normaliseMasterSearchHit(duoRow)!;
    expect(hit.rates.length).toBeGreaterThan(10);
    expect(hit.rateSummary).toMatch(/^Vineyard rates available: \/ha and \/100 L · \d+ registered vineyard rate entries$/);
    expect(hit.rateSummary).not.toContain("·  ");
    expect(hit.rateSummary.split("·")).toHaveLength(2);
  });
  it("empty rates give no indicator", () => expect(compactRateIndicator([])).toBe(""));
  it("DST 62723 and DUO 53576 stay separate hits", () => {
    const dst = { ...duoRow, id: "dst-id", registered_product_name: "NUFARM WEEDMASTER DST HERBICIDE", registration_number: "62723", review_status: "approved" };
    const hits = [normaliseMasterSearchHit(duoRow)!, normaliseMasterSearchHit(dst)!];
    expect(new Set(hits.map((h) => h.registrationNumber)).size).toBe(2);
    expect(new Set(hits.map((h) => h.id)).size).toBe(2);
  });
  it("customers see approved only; admins see labelled candidates", () => {
    const cand = normaliseMasterSearchHit({ ...duoRow, review_status: "candidate" })!;
    const appr = normaliseMasterSearchHit({ ...duoRow, id: "a", review_status: "approved" })!;
    expect(visibleMasterHits([cand, appr], false)).toEqual([appr]);
    expect(visibleMasterHits([cand, appr], true)).toHaveLength(2);
    expect(isCandidateHit(cand)).toBe(true);
    expect(isCandidateHit(appr)).toBe(false);
  });
});
