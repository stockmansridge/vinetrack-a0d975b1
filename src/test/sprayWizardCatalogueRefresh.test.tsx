import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));
vi.mock("@/lib/savedChemicalsQuery", () => ({ fetchSavedChemicalsForVineyard: vi.fn() }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => false }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ memberships: [], currentCountry: "AU" }) }));
vi.mock("@/hooks/useVineyardSprayTargets", () => ({ useVineyardSprayTargets: () => ({ labels: new Map() }) }));
vi.mock("@/hooks/useResistanceAssessment", () => ({
  useResistanceAssessment: () => ({ overallStatus: null, requiresAcknowledgement: false, blocks: [] }),
}));
vi.mock("@/lib/sprayApplicationDraft", async () => ({
  ...await vi.importActual<object>("@/lib/sprayApplicationDraft"),
  evaluateSaveGate: () => ({ canSave: true, fatal: [], warnings: [], info: [], blockingReasons: [] }),
}));
vi.mock("@/components/chemicals/ChemicalSearchDialog", () => ({
  ChemicalSearchDialog: ({ open }: { open: boolean }) => {
    const [value, setValue] = useState("");
    return open ? <div role="dialog" aria-label="Chemical search"><input aria-label="Product lookup" value={value} onChange={(e) => setValue(e.target.value)} /></div> : null;
  },
}));
vi.mock("@/components/chemicals/ChemicalEditorSheet", () => ({ ChemicalEditor: () => null }));

import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";

const fetchChemicals = vi.mocked(fetchSavedChemicalsForVineyard);
const emptyResult = { chemicals: [] } as Awaited<ReturnType<typeof fetchSavedChemicalsForVineyard>>;
const clients: QueryClient[] = [];

function deferredRead() {
  let resolve: (value: typeof emptyResult) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<typeof emptyResult>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function openChemicalForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><SprayJobWizard open onOpenChange={() => {}} vineyardId="v1" job={null} isTemplate={false} canEdit lookups={{ paddocks: [], tractors: [], equipment: [], members: [], maps: { paddocks: new Map(), tractors: new Map(), equipment: new Map(), members: new Map() } }} /></QueryClientProvider>);
  await screen.findByLabelText("Name");
  fireEvent.click(screen.getByRole("button", { name: /7\s*Products/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add chemical" }));
  fireEvent.change(screen.getByLabelText("Product lookup"), { target: { value: "DiPel label lookup" } });
  return client;
}

beforeEach(() => { fetchChemicals.mockReset(); fetchChemicals.mockResolvedValue(emptyResult); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); focusManager.setFocused(undefined); });

describe("Spray wizard background catalogue reads", () => {
  it("retains the open chemical form and typed lookup when returning to the tab", async () => {
    await openChemicalForm();
    const read = deferredRead();
    fetchChemicals.mockReturnValueOnce(read.promise);
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(fetchChemicals).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog", { name: "Chemical search" })).toBeInTheDocument();
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
    expect(screen.getByRole("button", { name: "Create Planned Spray" })).toBeDisabled();
    await act(async () => { read.resolve(emptyResult); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Planned Spray" })).toBeEnabled());
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
  });

  it("retains step-local state through explicit catalogue invalidation", async () => {
    const client = await openChemicalForm();
    const read = deferredRead();
    fetchChemicals.mockReturnValueOnce(read.promise);
    act(() => { void client.invalidateQueries({ queryKey: ["saved-chemicals"] }); });
    await waitFor(() => expect(fetchChemicals).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
    await act(async () => { read.resolve(emptyResult); });
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
  });

  it("keeps work after a failed refresh while blocking save until recovery", async () => {
    const client = await openChemicalForm();
    const read = deferredRead();
    fetchChemicals.mockReturnValueOnce(read.promise);
    act(() => { void client.invalidateQueries({ queryKey: ["saved-chemicals"] }); });
    await waitFor(() => expect(fetchChemicals).toHaveBeenCalledTimes(2));
    await act(async () => { read.reject(new Error("offline")); });
    await waitFor(() => expect(client.getQueryState(["saved-chemicals", "v1", "intelligence"])?.status).toBe("error"));
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
    expect(screen.getByRole("button", { name: "Create Planned Spray" })).toBeDisabled();
    await act(async () => { await client.invalidateQueries({ queryKey: ["saved-chemicals"] }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Planned Spray" })).toBeEnabled());
    expect(screen.getByLabelText("Product lookup")).toHaveValue("DiPel label lookup");
  });
});