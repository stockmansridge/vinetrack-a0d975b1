import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSavedChemicalsForVineyard, updateSavedChemical, createSavedChemical } from "@/lib/savedChemicalsQuery";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { v3RevisionIdOf } from "@/lib/chemicalV3Display";
import { v3EntryBadge } from "@/lib/chemicalInventory";

const h = vi.hoisted(() => ({ rows: [] as any[], error: null as any, calls: [] as any[], payload: null as any }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const filters: any[] = [];
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      is: (k: string, v: unknown) => { filters.push([k, "is", v]); return q; },
      not: (k: string, op: string, v: unknown) => { filters.push([k, "not", op, v]); return q; },
      update: (payload: any) => { if (table !== "saved_chemicals") throw new Error("View write"); h.payload = payload; return q; },
      insert: () => { throw new Error("Unexpected insert"); },
      single: async () => { h.calls.push({ table, filters, write: true }); return { data: { id: "c1" }, error: h.error }; },
      then: (resolve: any) => { h.calls.push({ table, filters }); return Promise.resolve({ data: h.rows, error: h.error }).then(resolve); },
    };
    return q;
  },
} }));

const preferred = { amount: 300, unit: "g", basis: "per_100_litres", note: "Operator choice" };
const rates = [{ min_value: 200, max_value: 600, unit: "g", basis: "per_100_litres" }, { value: 600, unit: "g", basis: "per_100_litres" }];
const row = {
  id: "c1", vineyard_id: "v1", name: "THIOVIT Jet vineyard alias", notes: "Keep notes", deleted_at: null,
  chemical_v3_product_id: "p1", chemical_v3_revision_id: "e310", saved_catalogue_revision_id: "e310", effective_catalogue_revision_id: "358",
  catalogue_snapshot_differs: true, vineyard_rate_override_evidence: true,
  sync_version: 4, updated_at: "2026-11-01T00:00:00Z", vineyard_preferred_rate: preferred,
  registered_uses: [{ crop: "Grapes", target: "Powdery mildew", rates, restrictions: "Do not exceed label maximum" }],
  rates: { per_hectare: [], per_100_litres: rates }, active_ingredient: "Sulfur 800 g/kg", label_url: "https://example.test/approved.pdf",
  purchase: { costPerBaseUnit: 12 }, inventory_quantity: 5, default_rates: null,
};
beforeEach(() => { h.rows = [structuredClone(row)]; h.calls = []; h.error = null; h.payload = null; });

describe("v3.1.9 effective catalogue boundary", () => {
  it("reads the effective view only with vineyard and active tombstone filters; retains both Thiovit /100L options", async () => {
    const result = await fetchSavedChemicalsForVineyard("v1");
    expect(h.calls).toEqual([{ table: "saved_chemicals_effective", filters: [["vineyard_id", "v1"], ["deleted_at", "is", null]] }]);
    expect(result.chemicals[0].rates.per_100_litres).toEqual(rates);
    const intel = toChemicalIntelligence(result.chemicals[0]);
    expect(intel.registeredUses[0].rates).toHaveLength(2);
    expect(v3RevisionIdOf(result.chemicals[0])).toBe("358");
  });
  it("writes only changed notes to the guarded base row then refetches live evidence, preserving preferred rate, inventory and costs", async () => {
    h.rows = [{ ...row, notes: "New notes" }];
    const result = await updateSavedChemical("c1", { name: row.name, notes: "New notes", active_ingredient: row.active_ingredient, label_url: row.label_url, intelligence: { registered_uses: row.registered_uses } as any }, row);
    expect(Object.keys(h.payload).sort()).toEqual(["client_updated_at", "notes"]);
    expect(h.payload.notes).toBe("New notes");
    expect(h.calls[0]).toEqual({ table: "saved_chemicals", write: true, filters: [["id", "c1"], ["vineyard_id", "v1"], ["sync_version", 4], ["updated_at", row.updated_at], ["chemical_v3_revision_id", "e310"], ["chemical_v3_product_id", "p1"]] });
    expect(h.calls[1].table).toBe("saved_chemicals_effective");
    expect(result.vineyard_preferred_rate).toEqual(preferred);
    expect(result.purchase).toEqual(row.purchase);
    expect(result.inventory_quantity).toBe(5);
    expect(result.chemical_v3_revision_id).toBe("e310");
  });
  it("preferred-only edits cannot overwrite notes or catalogue evidence", async () => {
    await updateSavedChemical("c1", { name: row.name, notes: row.notes, vineyard_preferred_rate: { ...preferred, amount: 400 }, restrictions: "Effective condition" }, row);
    expect(Object.keys(h.payload).sort()).toEqual(["client_updated_at", "vineyard_preferred_rate"]);
    expect(h.payload.vineyard_preferred_rate.amount).toBe(400);
  });
  it("rejects an effective full-row insert or update before touching the database", async () => {
    await expect(updateSavedChemical("c1", row as any)).rejects.toThrow("cannot be written back");
    await expect(createSavedChemical("v1", row as any)).rejects.toThrow("cannot be written back");
    expect(h.calls).toEqual([]);
  });
  it("rejects cross-vineyard results and does not fall back to raw data on refused reads", async () => {
    h.rows = [{ ...row, vineyard_id: "v2" }];
    await expect(fetchSavedChemicalsForVineyard("v1")).rejects.toThrow("inconsistent vineyard scope");
    h.error = new Error("RLS read refused");
    await expect(fetchSavedChemicalsForVineyard("v1")).rejects.toThrow("RLS read refused");
    expect(h.calls.every((c) => c.table === "saved_chemicals_effective")).toBe(true);
  });
  it("unapproved fallback retains original evidence without displaying a pinned revision as current approval", async () => {
    h.rows = [{ ...row, effective_catalogue_revision_id: null, rates: { per_100_litres: [] }, registered_uses: [] }];
    const result = await fetchSavedChemicalsForVineyard("v1");
    expect(result.chemicals[0].rates.per_100_litres).toEqual([]);
    expect(v3RevisionIdOf(result.chemicals[0])).toBeNull();
    expect(v3EntryBadge(result.chemicals[0])?.tone).toBe("pending");
    expect(result.chemicals[0].notes).toBe("Keep notes");
  });
  it("does not select a dose from live catalogue ranges; only the retained explicit preferred rate may prefill", () => {
    const intel = toChemicalIntelligence({ ...row, vineyard_preferred_rate: null });
    const line = productLineFromChemical({ savedChemicalId: "c1", productName: row.name, unit: "g", intelligence: intel });
    expect(line.rate).toBeNull();
    const chosen = productLineFromChemical({ savedChemicalId: "c1", productName: row.name, unit: "g", intelligence: toChemicalIntelligence(row) });
    expect(chosen.rate).toBe(300);
    expect(chosen.rateBasis).toBe("per100L");
  });
});