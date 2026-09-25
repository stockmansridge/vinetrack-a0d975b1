import { describe, expect, it } from "vitest";
import { buildEquipmentCsv, buildEquipmentTemplateCsv, planEquipmentImport, applyEquipmentImport, EQUIPMENT_CLASSES, type ExistingEquipment } from "@/lib/equipmentImportExport";

const existing: ExistingEquipment[] = [
  { cls: "tractor", id: "t1", name: "Tractor 1", make: "JD", fuel_usage_l_per_hour: 6 },
  { cls: "spray_equipment", id: "s1", name: "Sprayer 1", tank_capacity_litres: 1500 },
];

describe("equipment import/export", () => {
  it("template parses into four new rows", () => {
    const p = planEquipmentImport(buildEquipmentTemplateCsv(), [], [...EQUIPMENT_CLASSES]);
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => r.cls)).toEqual(["tractor", "spray_equipment", "vineyard_machine", "other_asset"]);
  });
  it("export round-trips as updates and respects selected classes", () => {
    const csv = buildEquipmentCsv(existing, ["tractor"]);
    expect(csv).not.toContain("Sprayer 1");
    const p = planEquipmentImport(buildEquipmentCsv(existing, [...EQUIPMENT_CLASSES]), existing, ["spray_equipment"]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].action).toBe("update");
    expect(p.skippedClasses).toBe(1);
  });
  it("validates required fields and unknown ids", () => {
    const csv = "equipment_class,internal_id,name,tank_capacity_litres,machine_type\nspray_equipment,,New sprayer,,\nvineyard_machine,,Quad,,spaceship\ntractor,zzz,X,,\nfoo,,Y,,\n";
    const p = planEquipmentImport(csv, existing, [...EQUIPMENT_CLASSES]);
    expect(p.rows).toHaveLength(0);
    expect(p.errors).toHaveLength(4);
  });
  it("blank cells keep existing values on update", async () => {
    const p = planEquipmentImport("equipment_class,name\ntractor,Tractor 1\n", existing, [...EQUIPMENT_CLASSES]);
    let saved: any;
    const noop = async () => {};
    const r = await applyEquipmentImport(p, { saveTractor: async (t) => { saved = t; }, insertSpray: noop, updateSpray: noop, createMachine: noop, updateMachine: noop, createItem: noop, updateItem: noop });
    expect(r.updated).toBe(1);
    expect(saved).toMatchObject({ id: "t1", brand: "JD", fuel_usage_l_per_hour: 6 });
  });
});
