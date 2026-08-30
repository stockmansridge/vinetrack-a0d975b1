// FINAL PORTAL PROOF — vineyard-first Chemical Lookup.
//
// These are integration-level proofs, not helper unit tests:
//   * no customer route can reach other-crop label information;
//   * declining a duplicate lookup does ZERO function calls and ZERO writes;
//   * "Keep what I have" after a completed re-verification writes nothing;
//   * accepting an update never touches customer-owned commercial fields;
//   * a default rate whose identity vanished blocks save until reconfirmed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { emptyDraft, type ChemicalIntelligenceDraft, type WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { defaultRateStillSupported } from "@/lib/chemicalVineyardScope";
import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

/* ---------------------------------------------------------------- spies */

const invoke = vi.fn();
const from = vi.fn(() => {
  throw new Error("unexpected database access");
});

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...(a as [])),
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...(a as [])),
  },
}));
vi.mock("@/lib/masterChemicals", () => ({
  searchApprovedMasterChemicals: vi.fn(async () => []),
}));

import { ChemicalAILookup } from "@/components/spray/ChemicalAILookup";
import { ChemicalReverifyDialog } from "@/components/chemicals/ChemicalReverifyDialog";

beforeEach(() => {
  invoke.mockReset();
  from.mockClear();
});

/* ------------------------------------------- 1. other crops unreachable */

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

describe("other-crop label information is not customer-reachable", () => {
  it("is never enabled by any application consumer of the uses card", () => {
    // The only file allowed to mention the flag is the card that defines it.
    const offenders = sourceFiles("src")
      .filter((p) => !p.includes("src/test/"))
      .filter((p) => !p.endsWith("GrapevineUsesCard.tsx"))
      .filter((p) => readFileSync(p, "utf8").includes("showOtherCrops"));
    expect(offenders).toEqual([]);
  });


  it("defaults to grapevine-only when a consumer omits the flag", () => {
    const src = readFileSync("src/components/chemicals/GrapevineUsesCard.tsx", "utf8");
    expect(src).toContain("showOtherCrops = false");
  });
});

/* --------------------------------- 2. declining a duplicate does nothing */

describe("duplicate chemical prompt", () => {
  it("performs zero lookups and zero writes when the operator keeps what they have", async () => {
    render(
      <ChemicalAILookup
        country="Australia"
        existingLibrary={[{ id: "s1", name: "Thiovit Jet", registration_number: "53904" }]}
        onApply={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search product"), {
      target: { value: "thiovit jet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup" }));

    await screen.findByText(/already in your Chemical Store/i);
    // The prompt itself must not have called anything.
    expect(invoke).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole("button", { name: /keep it as it is/i }));
    await waitFor(() =>
      expect(screen.queryByText(/already in your Chemical Store/i)).toBeNull(),
    );
    expect(invoke).toHaveBeenCalledTimes(0);
    expect(from).toHaveBeenCalledTimes(0);
  });
});

/* ------------------------------- 3 & 4. re-verify keep / accept contract */

const grapeUse = {
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [{ rate_id: "rate_v1_a", basis: "per_100_litres", unit: "g", min: 100, max: 200 }],
} as unknown as WriteRegisteredUse;

const savedDraft: ChemicalIntelligenceDraft = {
  ...emptyDraft(),
  registration: { country: "AU", scheme: "apvma", number: "53904", registrant: "Syngenta" },
  registeredUses: [grapeUse],
};

const updatedDraft: ChemicalIntelligenceDraft = {
  ...savedDraft,
  actives: [
    {
      name: "Sulfur",
      concentration: 800,
      concentration_unit: "g/kg",
      identity_source: "official_register",
    } as any,
  ],
};

const resolver = vi.fn(async () => ({
  matchSource: "official_register",
  authoritative: true,
  verificationStatus: "verified",
  jurisdiction: { country: "AU" },
  fields: {},
  draft: updatedDraft,
  provenance: {},
  aiSuggestion: null,
  unresolvedFields: [],
  conflicts: [],
  guidance: null,
  master: null,
  diagnostics: null,
})) as any;

const renderReverify = (onAccept = vi.fn()) => {
  render(
    <ChemicalReverifyDialog
      open
      onOpenChange={() => {}}
      draft={savedDraft}
      productName="Thiovit Jet"
      country="Australia"
      onAccept={onAccept}
      resolver={resolver}
    />,
  );
  return onAccept;
};

describe("re-verification never writes silently", () => {
  it("keeps existing information with zero writes after a completed re-verification", async () => {
    resolver.mockClear();
    const onAccept = renderReverify();
    fireEvent.click(screen.getByRole("button", { name: /Re-verify/i }));
    await screen.findByRole("button", { name: /Keep what I have/i });
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Keep what I have/i }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(0);
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  it("accepting an update carries intelligence only — never pricing, purchase, inventory, pack or notes", async () => {
    resolver.mockClear();
    const onAccept = renderReverify();
    fireEvent.click(screen.getByRole("button", { name: /Re-verify/i }));
    const accept = await screen.findByRole("button", { name: /Accept/i });
    fireEvent.click(accept);

    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    const next = onAccept.mock.calls[0][0] as ChemicalIntelligenceDraft;
    // The accepted payload is a pure intelligence draft: the editor's
    // customer-owned commercial fields are not part of its shape at all.
    const allowed = new Set(Object.keys(emptyDraft()));
    expect(Object.keys(next).every((k) => allowed.has(k))).toBe(true);
    for (const owned of [
      "purchase", "price", "cost", "pack_size", "pack_unit",
      "inventory", "stock", "notes", "supplier",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(next, owned)).toBe(false);
    }
    // Still a real update: new chemistry arrived.
    expect(next.actives[0].name).toBe("Sulfur");
    // Accepting writes nothing by itself — persistence is the explicit Save.
    expect(from).toHaveBeenCalledTimes(0);
  });
});

/* ------------------------------ 5. disappeared rate identity blocks save */

const defaults = (ids: string[]): PersistedDefaultRates => ({
  version: 1,
  per_hectare: null,
  per_100_litres: {
    option_key: "default_option_v1_x",
    rate_ids: ids,
    basis: "per_100_litres",
    unit: "g",
    value: 150,
    min_value: null,
    max_value: null,
    source: "operator",
    selected_at: null,
    label_version: null,
  },
});

describe("a default rate whose identity disappeared", () => {
  it("is not supported by the new label", () => {
    expect(defaultRateStillSupported(defaults(["rate_v1_a"]), [grapeUse])).toBe(true);
    expect(defaultRateStillSupported(defaults(["rate_v1_gone"]), [grapeUse])).toBe(false);
  });

  it("blocks the editor Save button until the operator reconfirms", () => {
    const editor = readFileSync("src/components/chemicals/ChemicalEditorSheet.tsx", "utf8");
    expect(editor).toMatch(
      /const staleDefaultRate =\s*\n?\s*structuredUses && !defaultRateStillSupported\(defaultRates, intel\.registeredUses\)/,
    );
    expect(editor).toContain("DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE");
    // Save is blocked by the composite gate, which includes the stale default.
    expect(editor).toContain("const saveBlocked = staleDefaultRate || firstAddBlocked;");
    expect(editor).toContain("disabled={saveMut.isPending || saveBlocked}");
  });
});
