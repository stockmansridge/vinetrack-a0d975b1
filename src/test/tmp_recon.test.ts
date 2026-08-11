// TEMPORARY reconciliation harness against a production data dump.
import { describe, it } from "vitest";
import fs from "node:fs";
import { buildYieldFacts, aggregate, byBlock, byVariety } from "@/lib/yieldAnalytics";
import { extractHistoricalBlockRows } from "@/lib/yieldReportsQuery";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";

describe("recon", () => {
  it("reconciles", () => {
    const d = JSON.parse(fs.readFileSync("/tmp/yield_dump.json", "utf8"));
    const blocks = d.paddocks
      .filter((p: any) => !p.deleted_at)
      .map((p: any) => {
        const m = deriveMetrics(p);
        return { id: p.id, name: p.name, areaHa: m.areaHa > 0 ? m.areaHa : null, alloc: p.variety_allocations };
      });
    console.log("BLOCKS", blocks.map((b: any) => `${b.name}=${b.areaHa?.toFixed(4)}`).join(" | "));

    const ds = buildUnifiedCostDataset({
      vineyardId: d.vineyardId,
      tripAllocations: d.tripCosts,
      pruningRows: [],
    });
    const costRows = ds.rows.map((r) => ({
      vintage_year: r.vintage_year,
      block_id: r.block_id,
      variety: r.variety,
      total_cost: r.total_cost,
    }));
    console.log("COST rows", costRows.length, "total", costRows.reduce((a, c) => a + c.total_cost, 0));
    const costYield = new Map<string, number>();
    for (const r of ds.rows) {
      const k = `${r.vintage_year}|${r.block_name}`;
      costYield.set(k, (costYield.get(k) ?? 0) + (r.yield_tonnes ?? 0));
    }
    console.log("COST yield_tonnes by block", JSON.stringify([...costYield]));

    const facts = buildYieldFacts({
      historicalRows: extractHistoricalBlockRows(d.historical),
      pickingTotals: d.picking,
      blocks,
      costRows,
    });
    const agg = aggregate(facts);
    console.log("TOTALS", JSON.stringify(agg));
    console.log(
      "BY BLOCK",
      JSON.stringify(
        byBlock(facts).map((g) => ({
          b: g.label,
          t: g.tonnes,
          ha: g.areaHa,
          tph: g.tonnesPerHa,
          rev: g.revenue,
          price: g.pricePerTonne,
          revHa: g.revenuePerHa,
          cost: g.cost,
          cpt: g.costPerTonne,
        })),
        null,
        1,
      ),
    );
    const raw = d.picking.reduce((a: number, r: any) => a + Number(r.actual_yield_tonnes), 0);
    const rawVal = d.picking.reduce((a: number, r: any) => a + Number(r.total_grape_value ?? 0), 0);
    const pricedT = d.picking
      .filter((r: any) => r.total_grape_value)
      .reduce((a: number, r: any) => a + Number(r.actual_yield_tonnes), 0);
    console.log("RAW tonnes", raw, "raw value", rawVal, "priced tonnes", pricedT, "raw $/t", rawVal / pricedT);
  });
});
