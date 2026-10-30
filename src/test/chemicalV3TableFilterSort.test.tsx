// Focused: page filter + column sorting on the Chemical Catalogue Review tables.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

import { ReviewQueue, ApprovedList } from "@/pages/admin/ChemicalV3LabPage";

const queueRows = [
  { revision_id: "r1", status: "pending_review", product_name: "Belanty", manufacturer: "Bayer", country_code: "AU", warning_count: 2 },
  { revision_id: "r2", status: "pending_review", product_name: "THIOVIT Jet", manufacturer: "Sumitomo", country_code: "AU", warning_count: 0 },
  { revision_id: "r3", status: "pending_review", product_name: "Altacor", manufacturer: "FMC", country_code: "NZ", warning_count: 5 },
];
const approvedRows = [
  { revision_id: "a1", product_name: "Zeus", manufacturer: "X", approved_at: "2026-01-02", warning_count: 1 },
  { revision_id: "a2", product_name: "Altacor", manufacturer: "Y", approved_at: "2026-03-01", warning_count: 0 },
];

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const mountQueue = (filter = "") =>
  render(<QueryClientProvider client={client()}><ReviewQueue onOpen={vi.fn()} filter={filter} /></QueryClientProvider>);
const mountApproved = (filter = "") =>
  render(<QueryClientProvider client={client()}><ApprovedList onOpen={vi.fn()} filter={filter} /></QueryClientProvider>);

const firstRow = () => (screen.getAllByTestId("v3-review-row")[0] as HTMLElement).textContent ?? "";
const firstApprovedRow = () => (screen.getAllByTestId("v3-approved-row")[0] as HTMLElement).textContent ?? "";
const clickHeader = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));

describe("Pending Review filter + column sort", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "chemical_v3_admin_review_queue") return { data: queueRows, error: null };
      if (name === "chemical_v3_admin_review_queue_requesters") return { data: null, error: { code: "42883" } };
      return { data: [], error: null };
    });
  });

  it("unfiltered table keeps the original queue order", async () => {
    mountQueue();
    await screen.findByText("Belanty");
    expect(screen.getAllByTestId("v3-review-row")).toHaveLength(3);
    expect(firstRow()).toMatch(/^Belanty/);
  });

  it("filter narrows rows by product name (case-insensitive)", async () => {
    mountQueue("thio");
    await screen.findByText("THIOVIT Jet");
    expect(screen.getAllByTestId("v3-review-row")).toHaveLength(1);
  });

  it("filter with no matches shows the no-match message, not the empty-queue message", async () => {
    mountQueue("zzz-nothing");
    await screen.findByText(/No chemicals match/);
    expect(screen.queryByText("Nothing waiting for review.")).toBeNull();
  });

  it("Product header sorts asc, then desc, then third click clears back to queue order", async () => {
    mountQueue();
    await screen.findByText("Belanty");
    clickHeader("Product");
    expect(firstRow()).toMatch(/^Altacor/);
    clickHeader("Product");
    expect(firstRow()).toMatch(/^THIOVIT/);
    clickHeader("Product");
    expect(firstRow()).toMatch(/^Belanty/);
  });

  it("Warnings header sorts numerically ascending", async () => {
    mountQueue();
    await screen.findByText("Belanty");
    clickHeader("Warnings");
    expect(firstRow()).toMatch(/^THIOVIT/);
    clickHeader("Warnings");
    expect(firstRow()).toMatch(/^Altacor/);
  });
});

describe("Approved list filter + column sort", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) =>
      name === "chemical_v3_admin_approved_catalogue" ? { data: approvedRows, error: null } : { data: [], error: null });
  });

  it("unfiltered keeps data order; filter narrows rows", async () => {
    mountApproved();
    await screen.findByText("Zeus");
    expect(firstApprovedRow()).toMatch(/^Zeus/);
    mountApproved("altacor");
    await screen.findByText("Altacor");
    expect(screen.getAllByTestId("v3-approved-row")).toHaveLength(1);
  });

  it("Approved date header sorts by date, newest first on second click", async () => {
    mountApproved();
    await screen.findByText("Zeus");
    clickHeader("Approved date");
    expect(firstApprovedRow()).toMatch(/^Zeus/); // older (Jan) first ascending
    clickHeader("Approved date");
    expect(firstApprovedRow()).toMatch(/^Altacor/); // newer (Mar) first descending
  });

  it("approved filter with no matches shows its no-match message", async () => {
    mountApproved("zzz-nothing");
    await screen.findByText(/No approved products match/);
  });
});
