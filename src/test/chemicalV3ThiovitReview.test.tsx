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

import { issueActions, labelFingerprintView } from "@/lib/chemicalV3Review";
import { formatV3Resistance, readV3Resistance, suggestV3Resistance } from "@/lib/chemicalV3Resistance";
import { V3ReviewDecisions } from "@/components/chemicals/V3ReviewDecisions";
import { V3ResistanceField } from "@/components/chemicals/V3ResistanceField";

const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });

const labelIssue = { issue_id: "L", issue_key: "field:manufacturer_label", action_type: "confirm_manufacturer_label", status: "open" };
const ratesIssue = { issue_id: "R", issue_key: "field:vineyard_rates", action_type: "resolve_vineyard_rates", status: "open" };

describe("THIOVIT review actions", () => {
  it("1. FRAC M2 renders for THIOVIT", () => {
    const r = readV3Resistance({ activity_group_scheme: "frac", activity_groups: ["M2"], resistance_classification_state: "classified",
      resistance_group_source: "Syngenta manufacturer label + VineTrack activity group reference v2" });
    expect(formatV3Resistance(r)).toBe("FRAC M2");
    expect(r.state).toBe("classified");
  });
  it("2. unresolved Sulphur suggests FRAC M2 from the existing reference", () => {
    const row = { resistance_classification_state: "unresolved", active_ingredients: [{ name: "Sulphur", concentration: 800 }] };
    expect(suggestV3Resistance(row)).toEqual({ scheme: "frac", groups: ["M2"], commonName: "Inorganic (multi-site)" });
    const onSave = vi.fn();
    render(<V3ResistanceField row={row} editable busy={false} onSave={onSave} msg={null} />);
    expect(screen.getByTestId("v3-resistance-suggestion").textContent).toContain("FRAC M2");
    fireEvent.click(screen.getByText("Use FRAC M2"));
    expect(onSave).toHaveBeenCalledWith({ state: "classified", scheme: "frac", groups: "M2" });
    expect(fs.readFileSync("src/lib/chemicalV3Resistance.ts", "utf8")).toContain('from "@/lib/activityGroupReference"');
  });
  it("3. manufacturer_label issue uses confirm_official_link", async () => {
    wrap(<V3ReviewDecisions revisionId="rev" issues={[labelIssue]} loading={false} error={null} highlight={false} labelUrl="https://syngenta/label" />);
    expect(screen.getByText("Open Manufacturer Label").closest("a")?.getAttribute("href")).toBe("https://syngenta/label");
    expect(screen.queryByText("Reviewed")).toBeNull();
    fireEvent.click(screen.getByText("Confirm official manufacturer label"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_resolve_review_issue",
      { p_issue_id: "L", p_decision: "confirm_official_link", p_note: null, p_payload: null }));
  });
  it("4. missing SHA is amber before, informational after link confirmation", () => {
    expect(labelFingerprintView({}, [labelIssue])).toMatchObject({ tone: "review", value: "Not captured" });
    expect(labelFingerprintView({}, [{ ...labelIssue, status: "resolved", resolution_code: "confirm_official_link" }]))
      .toEqual({ tone: "na", value: "Not captured — manufacturer-hosted viewer", note: null });
    expect(labelFingerprintView({ label_sha256: "abc" }, []).tone).toBe("ok");
    expect(page).not.toContain('label="Label fingerprint / SHA"');
  });
  it("5. vineyard_rates issue does not show Reviewed", () => {
    expect(issueActions(ratesIssue).map((a) => a.label)).toEqual(["+ Add vineyard rate", "Confirm no vineyard rate", "Needs correction"]);
    wrap(<V3ReviewDecisions revisionId="rev" issues={[ratesIssue]} loading={false} error={null} highlight={false} onAddRate={() => {}} rateCount={0} />);
    expect(screen.queryByText("Reviewed")).toBeNull();
    expect(screen.getByText("No usable vineyard rate has been recorded yet.")).toBeTruthy();
  });
  it("6. Add vineyard rate opens the rate editor without an RPC; confirm-no-rate asks first", async () => {
    const onAddRate = vi.fn();
    wrap(<V3ReviewDecisions revisionId="rev" issues={[ratesIssue]} loading={false} error={null} highlight={false} onAddRate={onAddRate} rateCount={0} />);
    fireEvent.click(screen.getByText("+ Add vineyard rate"));
    expect(onAddRate).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("chemical_v3_resolve_review_issue", expect.anything());
    const conf = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByText("Confirm no vineyard rate"));
    expect(conf).toHaveBeenCalledWith(expect.stringContaining("no vineyard/grapevine use rate"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_resolve_review_issue",
      { p_issue_id: "R", p_decision: "confirm_no_vineyard_rates", p_note: null, p_payload: null }));
    expect(page).toContain("onAddRate={canEdit ? openAddRate : undefined}");
    expect(page).toContain("setDraft(emptyRateDraft(\"per_hectare\"))");
  });
  it("7. generic resolve_field sends resolved", () => {
    expect(issueActions({ issue_key: "field:product_form", action_type: "resolve_field" })[0].decision).toBe("resolved");
  });
  it("8. acknowledge still sends acknowledged", () => {
    expect(issueActions({ issue_key: "former_product_name", action_type: "acknowledge" })[0].decision).toBe("acknowledged");
  });
  it("9. rate save reloads review issues", () => {
    const save = page.slice(page.indexOf("const rateMut"), page.indexOf("const savedQ"));
    expect(save).toContain('queryKey: ["chemical-v3-issues", revisionId]');
  });
  it("10. V1/V2/Master code is not touched by the review module", () => {
    for (const f of ["src/lib/chemicalV3Review.ts", "src/components/chemicals/V3ReviewDecisions.tsx"]) {
      const s = fs.readFileSync(f, "utf8");
      expect(s).not.toMatch(/master_chemicals|chemical-info-lookup|chemicalSearchV2/);
    }
  });
});
