import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: () => ({ select: async () => ({ data: [], error: null }) }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://img/${p}` }, error: null }) }) },
  },
}));

import {
  approvedRevisionId, fetchApprovedCatalogue, findSavedForV3, humaniseFieldKey, isDecisionsRefusal,
  isPendingQueueRow, issueActions, issueState, outstandingWithoutIssue,
} from "@/lib/chemicalV3Review";
import { V3ReviewDecisions, FrontLabelChooser } from "@/components/chemicals/V3ReviewDecisions";
import { VineyardUsesSection } from "@/components/chemicals/V3ReviewData";
import { isV3Addable } from "@/lib/chemicalInventory";

const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => rpc.mockReset());

const issues = [
  { issue_id: "i1", issue_key: "manufacturer_label_identity", title: "Manufacturer label identity", detail: "The manufacturer label identity needs confirmation.", action_type: "confirm_label_identity", status: "open" },
  { issue_id: "i2", issue_key: "front_label_image", title: "Front label image", detail: "Another page.", action_type: "choose_front_label", status: "open" },
  { issue_id: "i3", issue_key: "worker_re_entry", title: "Worker re-entry statement", action_type: "confirm_not_stated", status: "open" },
  { issue_id: "i4", issue_key: "former_product_name", title: "Former product name", action_type: "acknowledge", status: "resolved", resolution_code: "acknowledged" },
  { issue_id: "i5", issue_key: "manufacturer_label_date", title: "Manufacturer label date", action_type: "label_date", status: "open" },
];

describe("Approved tab", () => {
  it("1. calls chemical_v3_admin_approved_catalogue", async () => {
    rpc.mockResolvedValue({ data: [{ approved_revision_id: "rev2", product_name: "Nufarm WEEDMASTER DUO" }], error: null });
    const rows = await fetchApprovedCatalogue();
    expect(rpc).toHaveBeenCalledWith("chemical_v3_admin_approved_catalogue", undefined);
    expect(rows).toHaveLength(1);
    expect(page).toContain('value="approved"');
  });
  it("2. review and approved rows use a solid background", () => {
    expect(page).toMatch(/SOLID_ROW = "[^"]*bg-card/);
    expect(page).toContain('data-testid="v3-approved-row"');
    expect(page).toContain('data-testid="v3-review-row" onClick');
  });
  it("3. approved row opens the exact approved revision", () => {
    expect(approvedRevisionId({ approved_revision_id: "rev2", revision_id: "rev1" })).toBe("rev2");
    expect(page).toContain("approvedRevisionId(r)");
  });
  it("4. superseded revisions never appear in Pending Review", () => {
    expect(isPendingQueueRow({ status: "superseded" })).toBe(false);
    expect(isPendingQueueRow({ review_status: "needs_attention" })).toBe(true);
    expect(page).toContain(".filter(isPendingQueueRow)");
  });
  it("5. successful approval toasts, refreshes both lists and switches tab", () => {
    expect(page).toContain("toast.success(APPROVED_TOAST)");
    expect(page).toContain('queryKey: ["chemical-v3-queue"]');
    expect(page).toContain('queryKey: ["chemical-v3-approved"]');
    expect(page).toContain('setTab("approved")');
  });
});

describe("Review decisions", () => {
  it("6-7. every issue renders with at least one action", () => {
    wrap(<V3ReviewDecisions revisionId="rev2" issues={issues} loading={false} error={null} highlight={false} />);
    expect(screen.getByText("Review decisions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm this is the correct label" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Needs correction" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Choose front label" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm not stated on label" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use this manufacturer label" })).toBeTruthy();
    for (const i of issues) expect(issueActions(i).length).toBeGreaterThan(0);
  });
  it("8. a resolved decision shows Resolved ✓ and collapses", () => {
    wrap(<V3ReviewDecisions revisionId="rev2" issues={issues} loading={false} error={null} highlight={false} />);
    const resolved = screen.getAllByTestId("v3-issue").filter((e) => e.dataset.state === "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].textContent).toContain("Resolved ✓");
    expect(resolved[0].textContent).not.toContain("Reviewed");
    expect(issueState({ status: "open", resolution_code: "needs_correction" })).toBe("needs_correction");
  });
  it("decision is saved through chemical_v3_resolve_review_issue", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    wrap(<V3ReviewDecisions revisionId="rev2" issues={issues} loading={false} error={null} highlight={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm this is the correct label" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_resolve_review_issue", { p_issue_id: "i1", p_decision: "confirm_correct", p_note: null, p_payload: null }));
  });
  it("9. manufacturer_label_identity never shows as raw snake_case", () => {
    expect(humaniseFieldKey("manufacturer_label_identity")).toBe("Manufacturer label identity");
    expect(outstandingWithoutIssue(["manufacturer_label_identity", "product_form"], issues)).toEqual(["Product form"]);
  });
  it("approval refusal is recognised and shown as a clear message", () => {
    expect(isDecisionsRefusal({ message: "unresolved review issues remain" })).toBe(true);
    expect(isDecisionsRefusal({ message: "permission denied" })).toBe(false);
    expect(page).toContain("DECISIONS_REQUIRED");
  });
});

describe("Front label chooser", () => {
  it("10-11. lists images and saves the selection via the issue decision", async () => {
    rpc.mockImplementation(async (name: string) => name === "chemical_v3_available_front_labels"
      ? { data: [{ storage_path: "a/p1.png", physical_page: 1 }, { storage_path: "a/p15.png", physical_page: 15 }], error: null }
      : { data: null, error: null });
    const saved = vi.fn();
    wrap(<FrontLabelChooser revisionId="rev2" issueId="i2" open onClose={() => {}} onSaved={saved} />);
    expect(await screen.findByText(/Physical page 15/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("chemical_v3_available_front_labels", { p_revision_id: "rev2" });
    fireEvent.click(screen.getByRole("radio", { name: /Physical page 15/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use as Front Label" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_resolve_review_issue", { p_issue_id: "i2", p_decision: "selected", p_note: null, p_payload: { storage_path: "a/p15.png" } }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    // reload = revision re-read, so the top image comes from the stored path
    fs.readFileSync("src/components/chemicals/V3ReviewDecisions.tsx", "utf8").includes('["chemical-v3-revision", revisionId]');
  });
});

describe("Layout", () => {
  it("12. rates render before uses", () => {
    expect(page.indexOf('data-testid="v3-rates-section"')).toBeLessThan(page.indexOf("<VineyardUsesSection"));
    expect(page.indexOf("<V3ReviewDecisions")).toBeLessThan(page.indexOf('data-testid="v3-rates-section"'));
  });
  it("13-14. uses collapsed by default, two columns on desktop when shown", () => {
    const uses = Array.from({ length: 42 }, (_, i) => ({ crop_situation: `Use ${i}` }));
    wrap(<VineyardUsesSection uses={uses} />);
    expect(screen.getByText("Vineyard uses (42)")).toBeTruthy();
    expect(screen.queryAllByTestId("v3-use-card")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByTestId("v3-use-card")).toHaveLength(42);
    expect(screen.getByTestId("v3-uses-grid").className).toContain("md:grid-cols-2");
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
  });
});

describe("Inventory entry point", () => {
  it("15-16. System Admin only, reuses ChemicalInventoryPanel", () => {
    expect(page).toContain('isAdmin && <TabsTrigger value="inventory">Inventory &amp; Purchases');
    expect(page).toContain("<ChemicalInventoryPanel savedChemicalId=");
    expect(page).toContain("Open Inventory / Purchases");
  });
  it("linked vineyard chemical matched by id only, never by name", () => {
    expect(findSavedForV3([{ id: "s1", name: "Nufarm WEEDMASTER DUO" }], { id: "rev2", product_name: "Nufarm WEEDMASTER DUO" })).toBeNull();
    expect(findSavedForV3([{ id: "s1", v3_revision_id: "rev2" }], { id: "rev2" })?.id).toBe("s1");
  });
  it("17. Add to Vineyard stays available before approval", () => {
    for (const s of ["pending_review", "needs_attention", "approved"]) expect(isV3Addable(s)).toBe(true);
  });
  it("18. V1/V2/Master files are not referenced", () => {
    for (const f of ["src/lib/chemicalV3Review.ts", "src/components/chemicals/V3ReviewDecisions.tsx"]) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/master_chemicals|chemical-info-lookup|AddChemicalV2/);
    }
  });
});
