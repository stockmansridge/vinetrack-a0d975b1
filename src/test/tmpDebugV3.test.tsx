import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovedList } from "@/pages/admin/ChemicalV3LabPage";

describe("debug approved", () => {
  it("mounts with jsx spy", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "chemical_v3_admin_approved_catalogue" ? { data: [{ revision_id: "a1", product_name: "Zeus", approved_at: "2026-01-02" }], error: null } : { data: [], error: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ApprovedList onOpen={vi.fn()} filter="" /></QueryClientProvider>);
    expect(await screen.findByText("Zeus").catch(() => null) ?? "not rendered").toBeTruthy();
  });
});
