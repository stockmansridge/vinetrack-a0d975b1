// Stage 3B — wizard shell behaviour: step navigation state retention,
// spreader step visibility and linked spray records on Review.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

vi.mock("@/lib/savedChemicalsQuery", () => ({
  fetchSavedChemicalsForVineyard: vi.fn(async () => ({ chemicals: [] })),
}));

vi.mock("@/lib/sprayJobsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/sprayJobsQuery");
  return {
    ...actual,
    fetchSprayJobs: vi.fn(async () => []),
    fetchSprayJobPaddockIds: vi.fn(async () => ["A"]),
    createSprayJob: vi.fn(async () => ({ id: "new" })),
    updateSprayJob: vi.fn(async () => ({ id: "j1" })),
  };
});

import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";
import type { WizardLookups } from "@/components/spray/wizard/types";

const lookups: WizardLookups = {
  paddocks: [{ id: "A", name: "Block A", area_ha: 10, row_width: 2.5 }],
  tractors: [],
  equipment: [],
  members: [],
  maps: { paddocks: new Map(), tractors: new Map(), equipment: new Map(), members: new Map() },
};

function renderWizard(props: Partial<React.ComponentProps<typeof SprayJobWizard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SprayJobWizard
        open
        onOpenChange={() => {}}
        vineyardId="v1"
        job={null}
        isTemplate={false}
        canEdit
        lookups={lookups}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const step = (label: string) => screen.getByRole("button", { name: new RegExp(`\\d\\s*${label}`, "i") });

describe("Stage 3B wizard shell", () => {
  it("keeps entered values when moving between steps and back", async () => {
    renderWizard();
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Week 14 spray" } });

    fireEvent.click(step("Blocks"));
    await screen.findByText(/Block A/);
    fireEvent.click(step("Carrier"));
    fireEvent.click(step("Application"));

    expect((await screen.findByLabelText("Name")).getAttribute("value")).toBe("Week 14 spray");
  });

  it("hides the Carrier step for a spreader application", async () => {
    renderWizard();
    await screen.findByLabelText("Name");
    expect(step("Carrier")).toBeTruthy();

    fireEvent.click(screen.getByText("Spreader"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /\d\s*Carrier/i })).toBeNull(),
    );
  });

  it("renders linked spray records on Review for an existing job", async () => {
    renderWizard({
      job: { id: "j1", vineyard_id: "v1", name: "Existing", is_template: false, chemical_lines: [] } as any,
      linkedRecords: <div>Linked spray records</div>,
    });
    await screen.findByDisplayValue("Existing");
    fireEvent.click(step("Review"));
    expect(await screen.findByText("Linked spray records")).toBeTruthy();
  });
});
