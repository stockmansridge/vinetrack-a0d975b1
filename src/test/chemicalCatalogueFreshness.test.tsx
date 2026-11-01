import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchCatalogueFreshness } from "@/lib/chemicalCatalogueFreshness";
import { CatalogueLinkFreshness } from "@/components/chemicals/CatalogueLinkFreshness";
import { useCatalogueReference } from "@/lib/chemicalCatalogueReference";

const db = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, any>>, filters: [] as string[], error: false, writes: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc: db.writes,
  from: (table: string) => {
    const filters: Record<string, string> = {};
    const q = {
      select: () => q,
      eq: (key: string, value: string) => { filters[key] = value; db.filters.push(`${table}:${key}:${value}`); return q; },
      maybeSingle: async () => {
        if (db.error) return { data: null, error: new Error("Read refused") };
        return { data: db.rows[table]?.[filters.id] ?? null, error: null };
      },
      update: db.writes,
    };
    return q;
  },
} }));

const productId = "d0c15ce7-aead-4ccb-870f-2fa3def36b43";
const oldId = "e310e341-7fc5-4f59-a2da-30efdd0f330e";
const newId = "3588437b-1a4a-4c8a-8038-deba45b5f731";
const saved = {
  id: "c1", vineyard_id: "v1", chemical_v3_product_id: productId, chemical_v3_revision_id: oldId,
  sync_version: 4, updated_at: "2026-11-01T00:00:00Z", notes: "Keep me", deleted_at: "2026-10-01T00:00:00Z",
  vineyard_preferred_rate: { amount: 300, unit: "g", basis: "per_100_litres" },
  default_rates: { version: 1, per_hectare: null, per_100_litres: { value: 400, source: "operator" } },
  rates: { per_hectare: [], per_100_litres: [] }, purchase: { history: "preserved" },
};
const revision = { id: newId, product_id: productId, review_status: "approved", default_rate_options: {
  per_hectare: [], per_100_litres: [{ min_value: 200, max_value: 600, unit: "g/100L", targets: ["Powdery mildew"] }, { value: 600, unit: "g/100L", targets: ["Bud mite"] }],
} };
const ref = { state: "approved" as const, productId, revision };
beforeEach(() => {
  db.error = false; db.filters = []; db.writes.mockClear();
  db.rows = {
    saved_chemicals: { c1: structuredClone(saved) },
    chemical_v3_products: { [productId]: { id: productId, status: "approved", approved_revision_id: newId } },
    chemical_v3_product_revisions: { [oldId]: { id: oldId, product_id: productId, review_status: "superseded" }, [newId]: structuredClone(revision) },
  };
});
function Harness({ row = saved, open = true }: { row?: any; open?: boolean }) {
  const query = useCatalogueReference(row, open, "v1");
  return <CatalogueLinkFreshness row={row} query={query} open={open} vineyardId="v1" />;
}
function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>) };
}
describe("linked catalogue freshness", () => {
  it("detects old superseded to current approved with an exact scoped read", async () => {
    expect(await fetchCatalogueFreshness(saved, "v1", ref)).toEqual({ state: "update_available", savedRevisionId: oldId, approvedRevisionId: newId, savedRevisionStatus: "superseded" });
    expect(db.filters).toContain("saved_chemicals:vineyard_id:v1");
  });
  it("same revision is a read-only no-op", async () => {
    const row = { ...saved, chemical_v3_revision_id: newId };
    db.rows.saved_chemicals.c1 = row;
    expect((await fetchCatalogueFreshness(row, "v1", ref)).state).toBe("current");
    expect(db.writes).not.toHaveBeenCalled();
  });
  it("refuses pending targets even if a pointer claims approval", async () => {
    await expect(fetchCatalogueFreshness(saved, "v1", { ...ref, revision: { ...revision, review_status: "pending_review" } })).rejects.toThrow("Approved catalogue");
  });
  it("refuses a linked revision belonging to a different product", async () => {
    db.rows.chemical_v3_product_revisions[oldId].product_id = "wrong";
    await expect(fetchCatalogueFreshness(saved, "v1", ref)).rejects.toThrow("different catalogue product");
  });
  it("refuses wrong vineyard both before reading and in returned data", async () => {
    await expect(fetchCatalogueFreshness(saved, "v2", ref)).rejects.toThrow("vineyard does not match");
    db.rows.saved_chemicals.c1.vineyard_id = "v2";
    await expect(fetchCatalogueFreshness(saved, "v1", ref)).rejects.toThrow("unavailable in this vineyard");
  });
  it("detects newer user edits instead of offering an update", async () => {
    db.rows.saved_chemicals.c1 = { ...saved, sync_version: 5, notes: "Newer edit" };
    expect((await fetchCatalogueFreshness(saved, "v1", ref)).state).toBe("changed");
    expect(db.rows.saved_chemicals.c1.notes).toBe("Newer edit");
  });
  it("never alters notes, preferred/default selections, empty rates, archive or purchase history", async () => {
    const before = structuredClone(db.rows);
    await fetchCatalogueFreshness(saved, "v1", ref);
    expect(db.rows).toEqual(before);
    expect(db.rows.saved_chemicals.c1.vineyard_preferred_rate.amount).toBe(300);
    expect(db.rows.saved_chemicals.c1.rates.per_100_litres).toEqual([]);
    expect(db.writes).not.toHaveBeenCalled();
  });
  it("shows both revision identities and keeps update disabled without a verified RPC", async () => {
    wrap();
    const action = await screen.findByRole("button", { name: "Update linked VineTrack catalogue information" });
    expect(action).toBeDisabled();
    expect(screen.getByText(oldId, { exact: false }).textContent).toContain("Saved vineyard revision");
    expect(screen.getByText(newId, { exact: false }).textContent).toContain("Current approved catalogue revision");
    fireEvent.click(action);
    expect(db.writes).not.toHaveBeenCalled();
  });
  it("pending product refuses an update and no approved link is rendered", async () => {
    db.rows.chemical_v3_products[productId].status = "pending_review";
    const { client } = wrap();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByTestId("catalogue-link-freshness")).toBeNull();
    expect(db.writes).not.toHaveBeenCalled();
  });
  it("failed cached refetch removes the update rather than showing stale approval", async () => {
    const { client } = wrap();
    await screen.findByRole("button", { name: "Update linked VineTrack catalogue information" });
    db.error = true;
    await client.invalidateQueries({ queryKey: ["chemical-catalogue-reference"] });
    await waitFor(() => expect(screen.queryByTestId("catalogue-link-freshness")).toBeNull());
    expect(db.writes).not.toHaveBeenCalled();
  });
});