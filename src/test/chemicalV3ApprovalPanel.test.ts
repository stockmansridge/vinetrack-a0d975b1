import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { approvalPanelFor, isDecisionsRefusal, findSavedForV3, isPendingQueueRow } from "@/lib/chemicalV3Review";
const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
describe("V3 approval panel", () => {
  it("only pending/needs_attention can decide", () => {
    expect(approvalPanelFor("pending_review")).toBe("decide");
    expect(approvalPanelFor("needs_attention")).toBe("decide");
    expect(approvalPanelFor("approved")).toBe("approved");
    expect(approvalPanelFor("superseded")).toBe("superseded");
    expect(approvalPanelFor("rejected")).toBe("rejected");
    expect(approvalPanelFor(null)).toBe("readonly");
  });
  it("Approve/Reject render only inside the decide branch", () => {
    const i = page.indexOf('approvalPanelFor(status) === "decide"');
    expect(i).toBeGreaterThan(0);
    expect(page.indexOf(">Approve</Button>")).toBeGreaterThan(i);
    expect(page).toContain("Approved for V3 catalogue ✓");
    expect(page).toContain("Superseded revision");
  });
  it("live backend contracts", () => {
    expect(isDecisionsRefusal({ message: "Review decisions are still required before approval" })).toBe(true);
    expect(findSavedForV3([{ id: "s", chemical_v3_revision_id: "rev2" }], { id: "rev2" })?.id).toBe("s");
    expect(findSavedForV3([{ id: "s", chemical_v3_product_id: "p1" }], { id: "rev2", product_id: "p1" })?.id).toBe("s");
    expect(isPendingQueueRow({ review_status: "superseded" })).toBe(false);
  });
});
