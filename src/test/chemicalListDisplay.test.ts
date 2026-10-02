import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { v3UseTargets, usedForOf, labelLinkOf, V3_DISPLAY_COLUMNS } from "@/lib/chemicalV3Display";
const rev = (uses: any) => ({ id: "r", front_label_image_path: "p.jpg", manufacturer_label_url: "https://m.example/label.pdf", manufacturer_product_url: null, vineyard_uses: uses });
const read = (p: string) => readFileSync(p, "utf8");

describe("Chemicals list display enrichment", () => {
  it("flattens and de-duplicates vineyard use targets", () => {
    const r = rev([{ targets: ["Black spot", "Downy mildew"] }, { targets: [{ name: "downy mildew" }, "Phomopsis Cane and Leaf spot"] }]);
    expect(v3UseTargets(r)).toEqual(["Black spot", "Downy mildew", "Phomopsis Cane and Leaf spot"]);
  });
  it("Belanty-style single target", () => {
    expect(usedForOf({}, rev([{ targets: ["Powdery mildew"] }]), "Fungicide")).toEqual(["Powdery mildew"]);
  });
  it("manual chemicals fall back to problem, never the category, never invented", () => {
    expect(usedForOf({ problem: "Botrytis" }, null, "Fungicide")).toEqual(["Botrytis"]);
    expect(usedForOf({ use: "Fungicide" }, null, "Fungicide")).toEqual([]);
    expect(usedForOf({}, null, null)).toEqual([]);
  });
  it("label link prefers saved label_url, falls back to revision manufacturer label", () => {
    expect(labelLinkOf({ label_url: "https://a/x.pdf" }, rev([]))).toBe("https://a/x.pdf");
    expect(labelLinkOf({}, rev([]))).toBe("https://m.example/label.pdf");
  });
  it("reads the revision table read-only with the image column", () => {
    expect(V3_DISPLAY_COLUMNS).toContain("front_label_image_path");
    const src = read("src/lib/chemicalV3Display.ts");
    expect(src).not.toMatch(/\.(insert|update|upsert)\(/);
  });
  it("search includes targets; Inventory link + page are pilot gated; stock only from RPC", () => {
    const page = read("src/pages/setup/SavedChemicalsPage.tsx");
    expect(page).toContain("...usedFor(c)]");
    expect(page).toMatch(/inventoryPilot && \(\s*<Button variant="outline" asChild>/);
    const inv = read("src/pages/setup/ChemicalInventoryPage.tsx");
    expect(inv).toContain("canUseInventoryPilot(isAdmin)");
    expect(inv).toContain("fetchInventorySummary(c.id)");
    expect(inv).toContain("<ChemicalInventoryPanel");
  });
});
