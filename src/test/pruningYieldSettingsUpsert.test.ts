// Canonical write path: upsert on the (vineyard_id, paddock_id) block key.
import { describe, it, expect, vi } from "vitest";

let upsertRow: any = { id: "r1", vineyard_id: "v1", paddock_id: "p1" };
const upsert = vi.fn(() => ({
  select: () => ({ maybeSingle: async () => ({ data: upsertRow, error: null }) }),
}));
// Stale-write re-read path (SQL 185): select().eq().is()
const selectRows = vi.fn(async () => ({
  data: [{ id: "r1", vineyard_id: "v1", paddock_id: "p1", prune_method: "cane" }],
  error: null,
}));
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert,
      select: () => ({ eq: () => ({ is: () => selectRows() }) }),
    }),
  },
}));

import { savePruningYieldSettings } from "@/lib/pruningYieldSettingsQuery";


describe("savePruningYieldSettings", () => {
  it("upserts on the block key and persists inputs only", async () => {
    await savePruningYieldSettings({
      vineyardId: "v1",
      paddockId: "p1",
      pruneMethod: "spur",
      bunchesPerBud: 1.5,
      budsPerSpur: 2,
      spursPerVine: 6,
      budsPerCane: 10,
      canesPerVine: 4,
      vinesPerHa: 2000,
      bunchWeightGrams: 120,
    });
    const [payload, opts] = upsert.mock.calls[0] as any[];
    expect(opts.onConflict).toBe("vineyard_id,paddock_id");
    expect(payload.paddock_id).toBe("p1");
    expect(payload.client_updated_at).toBeTruthy();
    expect(Object.keys(payload).sort()).toEqual(
      [
        "buds_per_cane",
        "buds_per_spur",
        "bunch_weight_grams",
        "bunches_per_bud",
        "canes_per_vine",
        "client_updated_at",
        "id",
        "paddock_id",
        "prune_method",
        "spurs_per_vine",
        "vineyard_id",
        "vines_per_ha",
      ].sort(),
    );
  });

  it("rejects an unscoped save", async () => {
    await expect(
      savePruningYieldSettings({ vineyardId: "v1", paddockId: "" } as any),
    ).rejects.toThrow();
  });
});
