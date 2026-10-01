// Stale Master hydration race + manual Group 3 round-trip.
import { describe, it, expect } from "vitest";
import { createHydrationGate } from "@/lib/masterHydrationGate";
import { buildManualSavedChemicalInput } from "@/lib/chemicalSearchV2";
import { emptyManualRateDraft } from "@/lib/chemicalManualRate";
import {
  toChemicalIntelligence, resistanceGroupDisplay, RESISTANCE_UNKNOWN_TEXT,
} from "@/lib/chemicalIntelligence";

// Mirrors the dialog's post-await transition: the whole apply (hit,
// selections, notice, hydrating=false) runs only for the current token.
function harness() {
  const gate = createHydrationGate();
  const state = { hit: null as string | null, selections: "none", notice: null as string | null, hydrating: false, step: "search" };
  const deferreds: Record<string, (ok: boolean) => void> = {};
  const invalidate = () => { gate.invalidate(); state.hydrating = false; state.notice = null; };
  const selectMaster = (id: string) => {
    Object.assign(state, { hit: id, selections: "empty", notice: null, step: "master", hydrating: true });
    const token = gate.begin();
    return new Promise<void>((resolve) => {
      deferreds[id] = (ok) => {
        if (gate.isCurrent(token)) {
          Object.assign(state, { hit: `${id}:hydrated`, selections: `${id}-sel`, notice: ok ? null : `${id}-failed`, hydrating: false });
        }
        resolve();
      };
    });
  };
  return {
    state, selectMaster, resolve: (id: string, ok = true) => deferreds[id](ok),
    staged: () => { invalidate(); Object.assign(state, { hit: null, selections: "staged-sel", step: "staged" }); },
    manual: () => { invalidate(); Object.assign(state, { hit: null, step: "manual", selections: "manual" }); },
    close: () => { invalidate(); Object.assign(state, { hit: null, selections: "none", step: "search" }); },
  };
}

describe("stale Master hydration", () => {
  it("A then B, A resolves last → only B", async () => {
    const h = harness(); const a = h.selectMaster("A"); const b = h.selectMaster("B");
    h.resolve("B"); await b; h.resolve("A", false); await a;
    expect(h.state).toMatchObject({ hit: "B:hydrated", selections: "B-sel", notice: null, hydrating: false });
  });
  it("A then staged, A resolves last → staged untouched", async () => {
    const h = harness(); const a = h.selectMaster("A"); h.staged(); h.resolve("A"); await a;
    expect(h.state).toMatchObject({ hit: null, selections: "staged-sel", step: "staged", hydrating: false });
  });
  it("A then manual, A resolves last → manual untouched", async () => {
    const h = harness(); const a = h.selectMaster("A"); h.manual(); h.resolve("A"); await a;
    expect(h.state).toMatchObject({ hit: null, selections: "manual", step: "manual" });
  });
  it("A then B, B pending while A resolves → B still loading", async () => {
    const h = harness(); const a = h.selectMaster("A"); h.selectMaster("B"); h.resolve("A"); await a;
    expect(h.state).toMatchObject({ hit: "B", selections: "empty", hydrating: true, notice: null });
  });
  it("close while pending → late completion ignored", async () => {
    const h = harness(); const a = h.selectMaster("A"); h.close(); h.resolve("A"); await a;
    expect(h.state).toMatchObject({ hit: null, selections: "none", step: "search", hydrating: false });
  });
});

describe("manual Group 3 round-trip", () => {
  const draft = { ...emptyManualRateDraft(), open: true, value: "2" };
  it("shows Group 3 as manual/unverified, never structured", () => {
    const input = buildManualSavedChemicalInput("Test", draft, { activityGroup: "Group 3" })!;
    expect(input.resistance_classification_state).toBe("unresolved");
    const chem = toChemicalIntelligence({ id: "x", ...input });
    const d = resistanceGroupDisplay(chem);
    expect(d.text).toContain("Group 3");
    expect(d.text).toContain("(unverified)");
    expect(d.kind).toBe("manual");
    expect(d.warning).toBeTruthy();
    expect(chem.activityGroups).toHaveLength(0);
  });
  it("no typed group → Resistance group unknown", () => {
    const input = buildManualSavedChemicalInput("Test", draft)!;
    const d = resistanceGroupDisplay(toChemicalIntelligence({ id: "y", ...input }));
    expect(d).toMatchObject({ kind: "unresolved", text: RESISTANCE_UNKNOWN_TEXT });
  });
});
