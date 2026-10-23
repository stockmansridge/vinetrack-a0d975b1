import { describe, expect, it } from "vitest";
import { headlineCostMetrics, resolveCostReportPhysicalArea } from "@/lib/costReportPhysicalArea";
import { buildVarietyMap } from "@/lib/varietyResolver";
import type { ReportBlock } from "@/lib/workTaskReportAllocation";

const varietyMap = buildVarietyMap([]);
const scope = { varietyMap };
const blocks: ReportBlock[] = [
  { id: "a", name: "Shiraz", area_ha: 2, variety_allocations: [{ name: "Shiraz", percent: 100 }] },
  { id: "b", name: "Mixed", area_ha: 4, variety_allocations: [{ name: "Shiraz", percent: 25 }, { name: "Merlot", percent: 75 }] },
];
const work = { total_cost: 200, allocation_area_ha: 2 };

describe("headline Cost / ha uses unique physical scope", () => {
  it("preserves Stockmans total and treated area while using 6.14908359375 physical hectares", () => {
    const physical = resolveCostReportPhysicalArea([{ id: "vineyard-fixture", name: "Owner supplied physical area", area_ha: 6.14908359375 }], scope);
    const result = headlineCostMetrics([{ total_cost: 18957.79, allocation_area_ha: 37.27 }], physical);
    expect(result.total).toBe(18957.79);
    expect(result.treatedArea).toBe(37.27);
    expect(result.costPerHa).toBeCloseTo(3083.03, 2);
  });
  it("counts a 2 ha block once despite three operations", () => {
    const physical = resolveCostReportPhysicalArea([blocks[0]], scope);
    expect(physical.areaHa).toBe(2);
    expect(headlineCostMetrics([work, work, work], physical)).toEqual({ total: 600, treatedArea: 6, costPerHa: 300 });
  });
  it("counts two different block identities once each, including unworked blocks", () => {
    const physical = resolveCostReportPhysicalArea([...blocks, blocks[0]], scope);
    expect(physical.areaHa).toBe(6);
    expect(physical.blockIds).toEqual(["a", "b"]);
    expect(headlineCostMetrics([work, work], physical).costPerHa).toBeCloseTo(400 / 6, 8);
  });
  it("uses only the selected block physical area once", () => {
    const physical = resolveCostReportPhysicalArea(blocks, { ...scope, blockNames: ["Shiraz"] });
    expect(physical.areaHa).toBe(2);
    expect(headlineCostMetrics([work, work, work], physical).costPerHa).toBe(300);
  });
  it("supports a selected subset without double-counting repeated selections", () => {
    expect(resolveCostReportPhysicalArea(blocks, { ...scope, blockNames: ["Shiraz", "Mixed", "Shiraz"] }).areaHa).toBe(6);
  });
  it("fails closed for an incomplete physical area rather than using treated area", () => {
    const physical = resolveCostReportPhysicalArea([blocks[0], { id: "unknown", name: "Unknown" }], scope);
    expect(physical.areaHa).toBeNull();
    expect(physical.warnings.length).toBeGreaterThan(0);
    expect(headlineCostMetrics([work, work, work], physical)).toEqual({ total: 600, treatedArea: 6, costPerHa: null });
  });
  it("does not turn an unloaded or missing selected block into a partial denominator", () => {
    expect(resolveCostReportPhysicalArea(undefined, scope).areaHa).toBeNull();
    expect(resolveCostReportPhysicalArea(blocks, { ...scope, blockNames: ["Shiraz", "Missing"] }).areaHa).toBeNull();
  });
  it("uses stored positive block area ahead of mapped geometry, otherwise geometry", () => {
    const polygon = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }];
    const block = { id: "geometry", name: "Mapped", area_ha: 2, polygon_points: polygon };
    expect(resolveCostReportPhysicalArea([block], scope).areaHa).toBe(2);
    expect(resolveCostReportPhysicalArea([{ ...block, area_ha: -1 }], scope).areaHa).toBeCloseTo(1.2392029, 5);
  });
  it("uses reliably recorded variety physical shares, not primary-variety labels", () => {
    const physical = resolveCostReportPhysicalArea(blocks, { ...scope, variety: "Shiraz" });
    expect(physical.areaHa).toBe(3);
    expect(headlineCostMetrics([work, work, work], physical).costPerHa).toBe(200);
    expect(resolveCostReportPhysicalArea(blocks, { ...scope, variety: "Merlot", blockNames: ["Mixed"] }).areaHa).toBe(3);
  });
  it("refuses guessed or incomplete variety percentages", () => {
    for (const allocations of [[], [{ name: "Shiraz" }], [{ name: "Shiraz", percent: 25 }], [{ name: "Shiraz", percent: 100 }, { percent: 0 }]]) {
      const physical = resolveCostReportPhysicalArea([{ ...blocks[0], variety_allocations: allocations }], { ...scope, variety: "Shiraz" });
      expect(physical.areaHa).toBeNull();
      expect(physical.warnings.length).toBeGreaterThan(0);
    }
  });
  it("does not modify Work Task/Trip input costs or operational areas", () => {
    const rows = Object.freeze([Object.freeze(work), Object.freeze({ total_cost: 75, allocation_area_ha: 1 })]);
    expect(headlineCostMetrics(rows, resolveCostReportPhysicalArea([blocks[0]], scope))).toEqual({ total: 275, treatedArea: 3, costPerHa: 137.5 });
    expect(rows).toEqual([work, { total_cost: 75, allocation_area_ha: 1 }]);
  });
});