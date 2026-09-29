import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const fetchMock = vi.fn();
const approveMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    rpc: (...a: any[]) => rpc(...a),
  },
}));
vi.mock("@/lib/masterChemicals", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterChemicals")>();
  return {
    ...mod,
    fetchMasterChemical: (...a: any[]) => fetchMock(...a),
    setMasterReviewStatus: (...a: any[]) => approveMock(...a),
  };
});
vi.mock("@/lib/masterWorkbench", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterWorkbench")>();
  return { ...mod, masterIssues: vi.fn(() => []) };
});
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: any[]) => toastMock(...a) }));

import { MasterCurationDrawer } from "@/components/chemicals/MasterCurationDrawer";

const row = {
  id: "m1", registered_product_name: "Prod", registrant: "Old Co", product_category: "fungicide",
  form_type: "SC", label_reference: null, review_status: "candidate", viticulture_rates: [],
} as any;

describe("successful correction whose read-back fails (real adapter)", () => {
  it("does not approve, advance or claim nothing saved", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    fetchMock.mockRejectedValue(new Error("network down"));
    const onNextAttention = vi.fn();
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MasterCurationDrawer row={row} open onOpenChange={vi.fn()} onNextAttention={onNextAttention} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByDisplayValue("Old Co"), { target: { value: "New Co" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve & Next/ }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());

    expect(rpc).toHaveBeenCalledTimes(1); // the write is not repeated
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(approveMock).not.toHaveBeenCalled();
    expect(onNextAttention).not.toHaveBeenCalled();
    const t = toastMock.mock.calls.at(-1)![0];
    expect(t.title).toBe("Save not confirmed — not approved");
    expect(`${t.title} ${t.description}`).not.toMatch(/Not saved/);
    expect(screen.getByDisplayValue("New Co")).not.toBeDisabled(); // draft preserved
  });
});
