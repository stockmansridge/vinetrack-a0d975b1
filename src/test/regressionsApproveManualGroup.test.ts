import { describe, expect, it, vi } from "vitest";
import {
  approveWithCorrections,
  buildMasterCurationPatch,
  CORRECTIONS_SAVED_APPROVAL_FAILED,
} from "@/lib/masterCuration";
import { masterIssues } from "@/lib/masterWorkbench";
import {
  resistanceGroupDisplay,
  toChemicalIntelligence,
  RESISTANCE_MANUAL_WARNING,
  RESISTANCE_UNKNOWN_TEXT,
} from "@/lib/chemicalIntelligence";

vi.mock("@/lib/masterWorkbench", async (orig) => {
  const mod = await orig<typeof import("@/lib/masterWorkbench")>();
  return { ...mod, masterIssues: vi.fn(() => []) };
});

const row = {
  id: "m1",
  registered_product_name: "Prod",
  registrant: "Old Co",
  product_category: "fungicide",
  form_type: "SC",
  label_reference: null,
  viticulture_rates: [{ rate: 1 }],
} as any;

describe("Approve & Next preserves manual corrections", () => {
  it("saves changed fields before approving, then approves the saved record", async () => {
    const order: string[] = [];
    const saved = { ...row, registrant: "New Co", revision: 2 };
    const save = vi.fn(async () => (order.push("save"), { outcome: "ok", message: "", row: saved, raw: null } as any));
    const approve = vi.fn(async () => void order.push("approve"));
    const res = await approveWithCorrections({ row, identity: { registrant: "New Co" }, reason: "" }, { save, approve });
    expect(order).toEqual(["save", "approve"]);
    expect(res).toMatchObject({ outcome: "approved", saved: true, row: saved });
    expect(masterIssues).toHaveBeenLastCalledWith(saved);
  });

  it("does not approve when the save is refused (resolved non-ok outcome)", async () => {
    const approve = vi.fn();
    const res = await approveWithCorrections(
      { row, identity: { registrant: "New Co" } },
      { save: async () => ({ outcome: "conflict", message: "Stale revision", row: null, raw: null }) as any, approve },
    );
    expect(res).toEqual({ outcome: "save_failed", message: "Stale revision" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("does not approve when the save throws", async () => {
    const approve = vi.fn();
    const res = await approveWithCorrections(
      { row, identity: { registrant: "New Co" } },
      { save: async () => { throw new Error("offline"); }, approve },
    );
    expect(res.outcome).toBe("save_failed");
    expect(approve).not.toHaveBeenCalled();
  });

  it("distinguishes saved corrections from a failed approval", async () => {
    const res = await approveWithCorrections(
      { row, identity: { registrant: "New Co" } },
      {
        save: async () => ({ outcome: "ok", message: "", row: { ...row, registrant: "New Co" }, raw: null }) as any,
        approve: async () => { throw new Error("denied"); },
      },
    );
    expect(res.outcome).toBe("approve_failed");
    if (res.outcome === "approve_failed") {
      expect(res.saved).toBe(true);
      expect(res.message.startsWith(CORRECTIONS_SAVED_APPROVAL_FAILED)).toBe(true);
    }
  });

  it("sends no correction write when nothing changed", async () => {
    const save = vi.fn();
    const approve = vi.fn(async () => {});
    const res = await approveWithCorrections({ row, identity: { registrant: "Old Co" } }, { save, approve });
    expect(save).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledWith("m1", null);
    expect(res).toMatchObject({ outcome: "approved", saved: false });
  });

  it("never includes rates or protected fields in the patch", () => {
    const patch = buildMasterCurationPatch({
      row,
      identity: {
        registrant: "New Co",
        viticulture_rates: [],
        registered_uses: [],
        default_rates: {},
        registration_number: "123",
        verification_status: "verified",
      } as any,
    });
    expect(patch).toEqual({ registrant: "New Co" });
  });
});

describe("Manually entered resistance group stays visible, unverified", () => {
  // Shape the manual builder persists: unverified, no structured groups, free-text group.
  const manual = {
    id: "c1",
    name: "My Fungicide",
    verification_status: "unverified",
    resistance_classification_state: "unresolved",
    activity_groups: null,
    active_ingredients: [],
    chemical_group: "Group 3",
  };

  it("shows the entered text with the unverified warning (list + details share this)", () => {
    const chem = toChemicalIntelligence(manual);
    expect(chem.structured).toBe(true); // global meaning unchanged
    const d = resistanceGroupDisplay(chem);
    expect(d.kind).toBe("manual");
    expect(d.text).toContain("Group 3");
    expect(d.warning).toBe(RESISTANCE_MANUAL_WARNING);
    expect(chem.resistanceClassificationState).toBe("unresolved");
  });

  it("survives a reload round-trip", () => {
    const reloaded = JSON.parse(JSON.stringify(manual));
    expect(resistanceGroupDisplay(toChemicalIntelligence(reloaded)).text).toContain("Group 3");
  });

  it("empty group text stays 'Resistance group unknown'", () => {
    const d = resistanceGroupDisplay(toChemicalIntelligence({ ...manual, chemical_group: "  " }));
    expect(d.text).toBe(RESISTANCE_UNKNOWN_TEXT);
  });

  it("authoritative structured groups take precedence over legacy text", () => {
    const d = resistanceGroupDisplay(
      toChemicalIntelligence({
        ...manual,
        resistance_classification_state: "classified",
        activity_groups: [{ scheme: "FRAC", code: "11" }],
      }),
    );
    expect(d.kind).toBe("groups");
    expect(d.text).toContain("11");
    expect(d.text).not.toContain("Group 3");
  });

  it("unresolved with structured group evidence does not promote legacy text", () => {
    const d = resistanceGroupDisplay(
      toChemicalIntelligence({ ...manual, activity_groups: [{ scheme: "FRAC", code: "11" }] }),
    );
    expect(d.kind).toBe("unresolved");
  });

  it("explicit not_applicable is preserved", () => {
    const d = resistanceGroupDisplay(
      toChemicalIntelligence({ ...manual, resistance_classification_state: "not_applicable" }),
    );
    expect(d.kind).toBe("not_applicable");
  });
});
