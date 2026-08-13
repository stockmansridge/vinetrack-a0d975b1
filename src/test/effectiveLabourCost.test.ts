// SQL 189 regression: the backend effective labour cost is the single answer
// for "what did this Work Task cost?" across every portal surface.
import { describe, it, expect } from "vitest";
import { resolveEffectiveLabourCost, type EffectiveLabourCostRow } from "@/lib/effectiveLabourCost";

const view = (over: Partial<EffectiveLabourCostRow>): EffectiveLabourCostRow => ({
  work_task_id: "task-1",
  vineyard_id: "v1",
  costing_method: "piece_rate",
  piece_rate_per_vine: 0.55,
  piece_vine_count: 250,
  piece_rate_total_cost: 137.5,
  labour_line_cost: 0,
  effective_labour_cost: 137.5,
  labour_cost_source: "piece_rate",
  ...over,
});

const pieceTask = {
  costing_method: "piece_rate",
  piece_rate_per_vine: 0.55,
  piece_vine_count: 250,
  piece_rate_total_cost: 137.5,
};

describe("SQL 189 effective labour cost", () => {
  it("piece rate task with zero labour lines costs $137.50", () => {
    const r = resolveEffectiveLabourCost(pieceTask, null, view({}));
    expect(r.cost).toBe(137.5);
    expect(r.source).toBe("piece_rate");
    expect(r.cost! / r.pieceVineCount!).toBeCloseTo(0.55, 10);
  });

  it("operational hours logged as labour lines never change piece rate cost", () => {
    const r = resolveEffectiveLabourCost(pieceTask, 400, view({ labour_line_cost: 400 }));
    expect(r.cost).toBe(137.5);
  });

  it("hourly task keeps the rated labour-line total (2 × 8 × $30 = $480)", () => {
    const r = resolveEffectiveLabourCost(
      { costing_method: "hourly" },
      480,
      view({
        costing_method: "hourly",
        piece_rate_per_vine: null,
        piece_vine_count: null,
        piece_rate_total_cost: null,
        labour_line_cost: 480,
        effective_labour_cost: 480,
        labour_cost_source: "labour_lines",
      }),
    );
    expect(r.cost).toBe(480);
    expect(r.source).toBe("labour_lines");
  });

  it("unknown cost stays null and is never coerced to $0.00", () => {
    const r = resolveEffectiveLabourCost(
      { costing_method: "hourly" },
      null,
      view({
        costing_method: "hourly",
        piece_rate_total_cost: null,
        labour_line_cost: null,
        effective_labour_cost: null,
        labour_cost_source: null,
      }),
    );
    expect(r.cost).toBeNull();
    expect(r.source).toBe("none");
  });

  it("a genuine zero cost is preserved as 0, not null", () => {
    const r = resolveEffectiveLabourCost(
      { costing_method: "hourly" },
      0,
      view({
        costing_method: "hourly",
        effective_labour_cost: 0,
        labour_cost_source: "labour_lines",
      }),
    );
    expect(r.cost).toBe(0);
  });

  it("falls back to the local SQL 188 rule when the view row is unavailable", () => {
    const piece = resolveEffectiveLabourCost(pieceTask, 0, null);
    expect(piece.cost).toBe(137.5);
    expect(piece.fromBackend).toBe(false);

    const legacy = resolveEffectiveLabourCost({}, 455, null);
    expect(legacy.cost).toBe(455);
  });

  it("historical snapshot values come from the stored job, not current rows", () => {
    const r = resolveEffectiveLabourCost(
      { costing_method: "piece_rate", piece_rate_per_vine: 0.9, piece_vine_count: 999 },
      null,
      view({}),
    );
    expect(r.pieceVineCount).toBe(250);
    expect(r.pieceRatePerVine).toBe(0.55);
    expect(r.cost).toBe(137.5);
  });
});
