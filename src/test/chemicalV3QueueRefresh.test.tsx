import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

const rpc = vi.fn(); const invoke = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc: (...a: any[]) => rpc(...a),
  functions: { invoke: (...a: any[]) => invoke(...a) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), order: async () => ({ data: [], error: null }) }), order: async () => ({ data: [], error: null }) }) }),
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
} }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v", memberships: [] }) }));
vi.mock("@/lib/chemicalInventory", async (orig) => ({ ...(await orig() as any), fetchProductCategories: async () => [] }));

import { ReviewQueue } from "@/pages/admin/ChemicalV3LabPage";

const rows = [
  { revision_id: "r1", job_id: "j1", status: "pending_review", product_name: "THIOVIT Jet", product_category: "Fungicide (Group M2)" },
  { revision_id: "r1", job_id: "j1", status: "pending_review", product_name: "THIOVIT Jet" },
  { revision_id: "r0", job_id: "j0", status: "superseded", product_name: "Old" },
];

describe("Pending Review refresh", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: rows, error: null }); });
  const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReviewQueue onOpen={vi.fn()} /></QueryClientProvider>);

  it("renders one row per revision, no superseded, category falls back to free text, Re-search in Actions", async () => {
    mount();
    await screen.findByText("THIOVIT Jet");
    expect(screen.getAllByTestId("v3-review-row")).toHaveLength(1);
    expect(screen.queryByText("Old")).toBeNull();
    expect(screen.getByText("Fungicide (Group M2)")).toBeTruthy();
    expect(screen.getByText("Re-search")).toBeTruthy();
  });
  it("manual Refresh refetches the queue RPC only", async () => {
    mount();
    await screen.findByText("THIOVIT Jet");
    const n = rpc.mock.calls.filter((c) => c[0] === "chemical_v3_admin_review_queue").length;
    fireEvent.click(screen.getByTestId("v3-queue-refresh"));
    await waitFor(() => expect(rpc.mock.calls.filter((c) => c[0] === "chemical_v3_admin_review_queue").length).toBe(n + 1));
    expect(invoke).not.toHaveBeenCalled();
  });
  it("completed re-search invalidates the queue", () => {
    expect(readFileSync("src/components/chemicals/V3ReSearchButton.tsx", "utf8")).toMatch(/invalidateQueries\(\{ queryKey: \["chemical-v3-queue"\] \}\)/);
  });
});
