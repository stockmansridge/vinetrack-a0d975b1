import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { buildSprayReportPdf } from "@/lib/sprayReportPdf";
import { AU_FORMATTERS } from "@/lib/regionFormatters";
import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import fixture from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";

describe("sample pdf", () => {
  it("renders the acceptance amounts", () => {
    const raw: any = JSON.parse(JSON.stringify(fixture));
    raw.tanks = [
      { tankNumber: 1, plannedWaterLitres: 1500, actualWaterLitres: 1500, chemicals: [
        { plannedChemicalId: "p1", savedChemicalId: "oil", name: "Sacoa oil", unit: "Litres", plannedAmountBase: 35714.28, actualAmountBase: null, matchSource: "plannedChemicalId" },
        { plannedChemicalId: "p2", savedChemicalId: "thio", name: "Thiovit Jet", unit: "Kg", plannedAmountBase: 8928.571, actualAmountBase: 0, matchSource: "savedChemicalId" } ] },
      { tankNumber: 2, plannedWaterLitres: 343.9, actualWaterLitres: null, chemicals: [
        { plannedChemicalId: "p1", savedChemicalId: "oil", name: "Sacoa oil", unit: "Litres", plannedAmountBase: 8189, actualAmountBase: null, matchSource: "plannedChemicalId" },
        { plannedChemicalId: "p2", savedChemicalId: "thio", name: "Thiovit Jet", unit: "Kg", plannedAmountBase: 2047, actualAmountBase: null, matchSource: "savedChemicalId" } ] },
    ];
    raw.cost = { totalCost: 412.5, fuelLitres: 23.4, engineHours: 3.1, treatedAreaHa: 4.2 };
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(errors).toEqual([]);
    const doc = buildSprayReportPdf(payload!, { formatters: AU_FORMATTERS, routeWarning: "Route unavailable — no recorded path points for this trip." });
    const buf = Buffer.from(doc.output("arraybuffer"));
    writeFileSync("/mnt/documents/SprayReport-sample.pdf", buf);
    const text = (doc as any).internal.pages.flat().join(" ");
    for (const s of ["35.714 L", "8.189 L", "43.903 L", "8.929 kg", "10.976 kg", "1,500 L", "343.9 L", "Not added", "Not recorded"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("35714");
  });
});
