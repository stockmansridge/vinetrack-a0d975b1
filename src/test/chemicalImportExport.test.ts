import { describe, it, expect } from "vitest";
import { buildChemicalsCsv, planChemicalImport } from "@/lib/chemicalImportExport";

const existing: any[] = [
  { id: "c1", vineyard_id: "v", name: "Copper", manufacturer: "Nufarm Australia Pty Ltd", notes: "keep", rate_per_ha: 2 },
];

describe("chemical import/export", () => {
  it("export round-trips as unchanged", () => {
    const p = planChemicalImport(buildChemicalsCsv(existing), existing);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].action).toBe("unchanged");
  });
  it("matches by name + manufacturer, blank keeps value, new rows create", () => {
    const p = planChemicalImport("name,manufacturer,notes,rate_per_ha\ncopper,Nufarm,,3\nSulphur,X,,\n", existing);
    expect(p.rows[0]).toMatchObject({ action: "update", id: "c1", changes: ["rate_per_ha"] });
    expect(p.rows[0].input.notes).toBeUndefined();
    expect(p.rows[1].action).toBe("create");
  });
  it("never writes pricing, stock or default rates", () => {
    const p = planChemicalImport("name,price_per_pack,default_rates\nNew,9,x\n", existing);
    expect(Object.keys(p.rows[0].input)).toEqual(["name"]);
  });
  it("rejects bad ids, rates, categories and links", () => {
    const p = planChemicalImport("internal_id,name,rate_per_ha,product_category,label_url\nzz,A,,,\n,B,abc,,\n,C,,Spaceship,\n,D,,,ftp://x\n", existing);
    expect(p.rows).toHaveLength(0);
    expect(p.errors).toHaveLength(4);
  });
});
