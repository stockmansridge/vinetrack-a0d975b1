import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
const { rpc, read } = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }) }),
} }));
import { buildIngredients, ingredientDrafts, saveAndConfirmV3Ingredients, V3_INGREDIENT_SAVING_ENABLED } from "@/lib/chemicalV3Ingredients";
import { isV3RevisionEditable } from "@/lib/chemicalV3";
import { V3IngredientsField } from "@/components/chemicals/V3IngredientsField";
const ingredients = [{ name: "Sulphur", concentration: 800, concentration_unit: "g/kg", source: "Label" }];
beforeEach(() => { rpc.mockReset(); read.mockReset(); rpc.mockResolvedValue({ error: null }); });
function wrap(editable = true) {
  const blocked = vi.fn();
  const result = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <TooltipProvider><V3IngredientsField revisionId="rev" value={[]} editable={editable} approvalBusy={false} onApprovalBlocked={blocked} /></TooltipProvider>
  </QueryClientProvider>);
  return { ...result, blocked };
}
describe("Chemical V3 ingredient correction", () => {
  it("preserves label metadata, concentration and units for multiple ingredients", () => {
    const rows = [...ingredients, { name: "Second", concentration: 100, concentration_unit: "g/L", source: "Label" }];
    expect(buildIngredients(ingredientDrafts(rows))).toEqual(rows);
  });
  it("keeps legacy aliases and supports removal", () => {
    const drafts = ingredientDrafts([{ ingredient: "Old", concentration: 10, unit: "%", evidence: { url: "label" } }]);
    drafts[0].name = "New"; drafts[0].concentration = "20";
    expect(buildIngredients(drafts)[0]).toMatchObject({ ingredient: "New", name: "New", concentration: 20, unit: "%", concentration_unit: "%", evidence: { url: "label" } });
    expect(buildIngredients([])).toEqual([]);
  });
  it.each(["", "0", "-1", "NaN", "Infinity"])("rejects invalid concentration %s", (concentration) => {
    expect(() => buildIngredients([{ name: "Sulphur", concentration, unit: "g/kg", original: {} }])).toThrow(/concentration/);
  });
  it("requires name and label unit without converting", () => {
    expect(() => buildIngredients([{ name: " ", concentration: "800", unit: "g/kg", original: {} }])).toThrow(/name/);
    expect(() => buildIngredients([{ name: "Sulphur", concentration: "800", unit: " ", original: {} }])).toThrow(/unit/);
  });
  it("limits revision editing to the existing awaiting-approval statuses", () => {
    expect(isV3RevisionEditable("pending_review")).toBe(true);
    expect(isV3RevisionEditable("needs_attention")).toBe(true);
    for (const status of ["approved", "rejected", "superseded", ""]) expect(isV3RevisionEditable(status)).toBe(false);
  });
  it("uses the shared RPC and reads saved ingredients back before confirming", async () => {
    read.mockResolvedValue({ data: { id: "rev", review_status: "pending_review", active_ingredients: ingredients }, error: null });
    const result = await saveAndConfirmV3Ingredients("rev", ingredientDrafts(ingredients));
    expect(rpc).toHaveBeenCalledWith("chemical_v3_admin_set_active_ingredients", { p_revision_id: "rev", p_active_ingredients: ingredients });
    expect(result.active_ingredients).toEqual(ingredients);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { id: "other", review_status: "pending_review", active_ingredients: ingredients },
    { id: "rev", review_status: "approved", active_ingredients: ingredients },
    { id: "rev", review_status: "pending_review", active_ingredients: [] },
  ])("refuses unconfirmed/mismatched revision %#", async (data) => {
    read.mockResolvedValue({ data, error: null });
    await expect(saveAndConfirmV3Ingredients("rev", ingredientDrafts(ingredients))).rejects.toThrow(/could not be confirmed/);
  });
  it("surfaces RPC and reload errors without claiming confirmation", async () => {
    rpc.mockResolvedValue({ error: new Error("Not authorised") });
    await expect(saveAndConfirmV3Ingredients("rev", ingredientDrafts(ingredients))).rejects.toThrow("Not authorised");
    expect(read).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ error: null }); read.mockResolvedValue({ error: new Error("Read denied") });
    await expect(saveAndConfirmV3Ingredients("rev", ingredientDrafts(ingredients))).rejects.toThrow("Read denied");
  });
  it("allows drafting multiple ingredients but keeps live saving release-gated", async () => {
    const { blocked } = wrap();
    expect(V3_INGREDIENT_SAVING_ENABLED).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));
    fireEvent.change(screen.getByLabelText("Ingredient 1 name"), { target: { value: "Sulphur" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add ingredient$/ }));
    expect(screen.getByLabelText("Ingredient 2 concentration")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove ingredient 2" }));
    expect(screen.queryByLabelText("Ingredient 2 concentration")).toBeNull();
    expect((screen.getByRole("button", { name: "Save Ingredients" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("non-admin or immutable revision gets no editing controls or save calls", () => {
    wrap(false);
    expect(screen.queryByRole("button", { name: "Add ingredients" })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});