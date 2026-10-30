import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc: (...a: any[]) => rpc(...a),
  functions: { invoke: vi.fn() },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), order: async () => ({ data: [], error: null }) }), order: async () => ({ data: [], error: null }) }) }),
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
} }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v", memberships: [] }) }));
vi.mock("@/lib/chemicalInventory", async (orig) => ({ ...(await orig() as any), fetchProductCategories: async () => [] }));

import { ApprovedList } from "@/pages/admin/ChemicalV3LabPage";

describe("debug approved", () => {
  it("mounts", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "chemical_v3_admin_approved_catalogue" ? { data: [{ revision_id: "a1", product_name: "Zeus", approved_at: "2026-01-02" }], error: null } : { data: [], error: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ApprovedList onOpen={vi.fn()} filter="" /></QueryClientProvider>);
    await screen.findByText("Zeus");
    expect(true).toBe(true);
  });
});
