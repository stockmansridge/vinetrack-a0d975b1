import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fail: false }));
vi.mock("@/integrations/ios-supabase/client", () => {
  const rows = [{ id: "f1", name: "Calcium Nitrate", product_category: "fertiliser", product_form: "solid", use: null }];
  const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r) };
  return { supabase: { from: () => c } };
});
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ memberships: [], currentCountry: "AU" }) }));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => true }));
vi.mock("@/lib/savedChemicalsQuery", () => ({ fetchSavedChemicalsForVineyard: async () => ({ chemicals: [] }) }));
vi.mock("@/components/chemicals/ChemicalSearchDialog", () => ({
  ChemicalSearchDialog: (p: any) => p.open ? (
    <div role="dialog" aria-label="Chemical Search">
      <button onClick={() => p.onManual(null)}>Enter manually</button>
      <button onClick={() => p.onOpenChange(false)}>Cancel search</button>
    </div>
  ) : null,
}));
vi.mock("@/components/chemicals/ChemicalEditorSheet", () => ({
  ChemicalEditor: (p: any) => p.open ? (
    <div role="dialog" aria-label="Add Chemical editor">
      <div>{h.fail ? "Save failed" : ""}</div>
      <button onClick={() => {
        if (h.fail) return; // existing editor shows its own error toast and stays open
        p.onSaved({ id: "new1", name: "Kelp Max", product_category: "biological", product_form: "liquid", use: null, rate_per_100l: 5 });
      }}>Save chemical</button>
      <button onClick={() => p.onOpenChange(false)}>Cancel editor</button>
    </div>
  ) : null,
}));

import { FertigationProductsStep } from "@/components/spray/wizard/FertigationSteps";
import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";
import { emptySprayApplication, type SprayApplication } from "@/lib/sprayApplicationDomain";

const base = (): SprayApplication => ({
  ...emptySprayApplication(), vineyardId: "v", isTemplate: true, name: "Nutrition step",
  operationType: "fertigation" as any, growthStageCode: "EL27", notes: "keep me",
  products: [
    { savedChemicalId: "f1", productName: "Calcium Nitrate", rate: 20, unit: null, rateBasis: null, activityGroups: [], verificationStatus: "unverified" as any, fertigationRateBasis: "per_hectare", fertigationRateUnit: "kg/ha" },
  ],
});

let latest: SprayApplication;
function Harness({ initial }: { initial: SprayApplication }) {
  const [app, setApp] = useState(initial);
  latest = app;
  return (
    <FertigationProductsStep
      {...({ app, update: (fn: any) => setApp((a) => fn(a)), patch: (p: any) => setApp((a) => ({ ...a, ...p })), canEdit: true, vineyardId: "v" } as any)}
    />
  );
}
const mount = (initial = base()) =>
  render(<QueryClientProvider client={new QueryClient()}><Harness initial={initial} /></QueryClientProvider>);
const openManual = () => {
  fireEvent.click(screen.getByRole("button", { name: /Add Chemical/ }));
  fireEvent.click(screen.getByText("Enter manually"));
};

describe("Fertigation Products — inline Add Chemical", () => {
  it("1. opens the shared Add Chemical workflow in a dialog without leaving the wizard; both buttons stay distinct", () => {
    mount();
    expect(screen.getByRole("button", { name: /Add product/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add Chemical/ }));
    expect(screen.getByRole("dialog", { name: "Chemical Search" })).toBeTruthy();
    expect(screen.getAllByTestId("fertigation-line")).toHaveLength(1);
  });
  it("2. cancel returns the exact draft with no extra blank line", () => {
    mount();
    const before = JSON.stringify(latest);
    fireEvent.click(screen.getByRole("button", { name: /Add Chemical/ }));
    fireEvent.click(screen.getByText("Cancel search"));
    openManual();
    fireEvent.click(screen.getByText("Cancel editor"));
    expect(JSON.stringify(latest)).toBe(before);
  });
  it("3–5,7. new chemical is appended, selected, shown, existing rows kept, no basis invented", async () => {
    mount();
    openManual();
    await act(async () => { fireEvent.click(screen.getByText("Save chemical")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(latest.products).toHaveLength(2);
    expect(latest.products[0]).toMatchObject({ savedChemicalId: "f1", rate: 20, fertigationRateBasis: "per_hectare", fertigationRateUnit: "kg/ha" });
    expect(latest.products[1]).toMatchObject({ savedChemicalId: "new1", productName: "Kelp Max", fertigationRateBasis: null, fertigationRateUnit: null, rate: null, rateBasis: null });
    expect(latest).toMatchObject({ name: "Nutrition step", growthStageCode: "EL27", notes: "keep me" });
    expect(screen.getAllByTestId("fertigation-line")).toHaveLength(2);
  });
  it("4. binds into the empty row the user was working on", async () => {
    const init = base();
    init.products.push({ savedChemicalId: null, productName: null, rate: 3, unit: null, rateBasis: null, activityGroups: [], verificationStatus: "unverified" as any, fertigationRateBasis: null, fertigationRateUnit: null });
    mount(init);
    fireEvent.focus(screen.getAllByLabelText("Planned rate")[1]);
    openManual();
    await act(async () => { fireEvent.click(screen.getByText("Save chemical")); });
    expect(latest.products).toHaveLength(2);
    expect(latest.products[1]).toMatchObject({ savedChemicalId: "new1", rate: 3, fertigationRateBasis: null });
  });
  it("6. creation failure leaves the draft untouched", () => {
    h.fail = true;
    mount();
    const before = JSON.stringify(latest);
    openManual();
    fireEvent.click(screen.getByText("Save chemical"));
    expect(screen.getByText("Save failed")).toBeTruthy();
    expect(JSON.stringify(latest)).toBe(before);
    h.fail = false;
  });
  it("8. non-Fertigation Products step is unchanged (still uses its own step)", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/components/spray/wizard/ProductsStep.tsx", "utf8"));
    expect(src).not.toMatch(/FertigationSteps/);
    expect(SprayJobWizard).toBeTruthy();
  });
});
