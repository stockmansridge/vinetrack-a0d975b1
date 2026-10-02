import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) } }));
const queue = vi.fn();
vi.mock("@/lib/chemicalV3", async (orig) => ({ ...(await orig<any>()), v3ReviewQueue: () => queue() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { V3CatalogueMatch } from "@/components/chemicals/V3CatalogueMatch";
import { catalogueMatchOf, V3_MATCH_RPC } from "@/lib/chemicalV3Review";

const stifle = {
  revision_id: "rev-pending", product_name: "STIFLE DORMANT SPRAY OIL", review_status: "pending_review",
  catalogue_match_product_id: "prod-approved", catalogue_match_revision_id: "rev-approved",
  catalogue_match_name: "STIFLE™ DORMANT SPRAY OIL", catalogue_match_manufacturer: "SACOA Pty Ltd",
  catalogue_match_score: 1, catalogue_match_reason: "same_product_approved_revision",
};

function setup(row: any, isAdmin = true) {
  queue.mockResolvedValue([row]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const onMatched = vi.fn();
  render(<QueryClientProvider client={qc}><V3CatalogueMatch revisionId={row.revision_id} isAdmin={isAdmin} onMatched={onMatched} /></QueryClientProvider>);
  return { spy, onMatched };
}

describe("catalogue close matches", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); queue.mockReset(); });

  it("search dialog suppresses 'not found' and shows catalogue matches before AI discovery", () => {
    const src = readFileSync("src/components/chemicals/ChemicalSearchDialog.tsx", "utf8");
    expect(src).toContain("Matches in the VineTrack catalogue");
    expect(src).toMatch(/results\.length === 0 && \(\s*<div[^>]*chemical-search-miss/);
    expect(src.indexOf("Matches in the VineTrack catalogue")).toBeLessThan(src.indexOf("Find a different product"));
    expect(src).not.toMatch(/fuzzy|levenshtein/i);
  });

  it("exact-product and same-registration matches are high confidence; close name is possible", () => {
    expect(catalogueMatchOf(stifle)?.confidence).toBe("high");
    expect(catalogueMatchOf({ ...stifle, catalogue_match_reason: "same_registration" })?.confidence).toBe("high");
    expect(catalogueMatchOf({ ...stifle, catalogue_match_reason: "close_name_manufacturer" })?.confidence).toBe("possible");
    expect(catalogueMatchOf({ revision_id: "x" })).toBeNull();
  });

  it("Stifle shows Already in catalogue and matching calls the exact RPC then refetches", async () => {
    const { spy, onMatched } = setup(stifle);
    expect(await screen.findByText("Already in the VineTrack catalogue")).toBeTruthy();
    expect(screen.getByText("SACOA Pty Ltd")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Use existing catalogue product" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Use existing catalogue product" }));
    await waitFor(() => expect(onMatched).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith(V3_MATCH_RPC, { p_revision_id: "rev-pending", p_catalogue_product_id: "prod-approved", p_note: null });
    const keys = spy.mock.calls.map((c: any) => c[0].queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["chemical-v3-queue", "chemical-v3-approved", "saved_chemicals"]));
  });

  it("same-registration also shows Already in catalogue", async () => {
    setup({ ...stifle, catalogue_match_reason: "same_registration" });
    expect(await screen.findByText("Already in the VineTrack catalogue")).toBeTruthy();
  });

  it("close-name shows Possible catalogue match", async () => {
    setup({ ...stifle, catalogue_match_reason: "close_name_manufacturer" });
    expect(await screen.findByText("Possible catalogue match")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Match to this catalogue product" })).toBeTruthy();
  });

  it("admin may continue normal review instead", async () => {
    setup(stifle);
    fireEvent.click(await screen.findByRole("button", { name: "Review this new revision instead" }));
    expect(screen.queryByTestId("v3-catalogue-match")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("non-admins never see match controls", async () => {
    setup(stifle, false);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("v3-catalogue-match")).toBeNull();
    expect(readFileSync("src/components/chemicals/ChemicalSearchDialog.tsx", "utf8")).not.toContain("V3CatalogueMatch");
  });
});
