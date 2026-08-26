// Regression fix: Spray wizard Tractor picker must contain ONLY genuine
// public.tractors rows. Vineyard Machines must never leak into this dropdown
// because spray_jobs.tractor_id is a foreign key to public.tractors.id.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchList = vi.fn();
const fetchVineyardTeamMembers = vi.fn();

vi.mock("@/lib/queries", () => ({
  fetchList: (...args: unknown[]) => fetchList(...args),
  fetchCount: vi.fn(),
  fetchOne: vi.fn(),
}));

vi.mock("@/lib/sprayJobsQuery", () => ({
  fetchVineyardTeamMembers: (...args: unknown[]) => fetchVineyardTeamMembers(...args),
  memberLabel: (u: any) => u?.full_name ?? "Member",
}));

import { useWizardLookups } from "@/components/spray/wizard/useWizardLookups";
import { EquipmentStep } from "@/components/spray/wizard/EquipmentStep";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { emptySprayApplication } from "@/lib/sprayApplicationDomain";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function wrapper(ui: React.ReactElement) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  );
}

function TestLookups({ vineyardId, onLookups }: { vineyardId: string; onLookups: (l: any) => void }) {
  const lookups = useWizardLookups(vineyardId);
  onLookups(lookups);
  return null;
}

const tractors = [
  { id: "tractor-1", name: "New Holland T4" },
  { id: "tractor-2", name: "Fendt 211" },
];

const vineyardMachines = [
  { id: "machine-atv", name: "Polaris ATV", machine_type: "atv" },
  { id: "machine-harvester", name: "Braud Harvester", machine_type: "harvester" },
  { id: "machine-ssv", name: "Can-Am", machine_type: "side_by_side" },
];

beforeEach(() => {
  fetchList.mockReset();
  fetchVineyardTeamMembers.mockReset();
  fetchVineyardTeamMembers.mockResolvedValue([]);
  fetchList.mockImplementation((table: string) => {
    if (table === "tractors") return Promise.resolve(tractors);
    if (table === "spray_equipment") return Promise.resolve([]);
    if (table === "paddocks") return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

describe("useWizardLookups tractor source", () => {
  it("contains only genuine tractors from public.tractors", async () => {
    let lookups: any;
    render(wrapper(<TestLookups vineyardId="v1" onLookups={(l) => (lookups = l)} />));
    await new Promise((r) => setTimeout(r, 10));
    const names = Array.from(lookups.maps.tractors.values());
    expect(names).toContain("New Holland T4");
    expect(names).toContain("Fendt 211");
    expect(names).not.toContain("Polaris ATV");
    expect(names).not.toContain("Braud Harvester");
    expect(names).not.toContain("Can-Am");
  });

  it("does not import fetchActiveVineyardMachines for the tractor lookup", () => {
    const file = src("src/components/spray/wizard/useWizardLookups.ts");
    expect(file).not.toContain("fetchActiveVineyardMachines");
    expect(file).toContain('queryKey: ["tractors-list", vineyardId]');
    expect(file).toContain('queryFn: () => fetchList("tractors", vineyardId!)');
  });

  it("never exposes a vineyard machine id as a tractor option", async () => {
    let lookups: any;
    render(wrapper(<TestLookups vineyardId="v1" onLookups={(l) => (lookups = l)} />));
    await new Promise((r) => setTimeout(r, 10));
    for (const m of vineyardMachines) {
      expect(lookups.maps.tractors.has(m.id)).toBe(false);
    }
  });
});

describe("EquipmentStep Tractor field", () => {
  it("shows only genuine tractor options in the Tractor dropdown", async () => {
    const lookups: any = {
      paddocks: [],
      tractors,
      equipment: [],
      members: [],
      maps: {
        paddocks: new Map(),
        tractors: new Map(tractors.map((t) => [t.id, t.name])),
        equipment: new Map(),
        members: new Map(),
      },
    };
    const app = emptySprayApplication();
    render(
      wrapper(
        <EquipmentStep
          app={app as any}
          patch={() => {}}
          update={() => {}}
          geometry={{} as any}
          calc={{ products: [], carrier: {} } as any}
          intelligenceById={new Map()}
          vineyardId="v1"
          canEdit
          lookups={lookups}
        />,
      ),
    );
    const trigger = screen.getByRole("combobox", { name: /tractor/i });
    fireEvent.click(trigger);
    const options = within(document.body).getAllByRole("option");
    const texts = options.map((o) => o.textContent);
    expect(texts).toContain("New Holland T4");
    expect(texts).toContain("Fendt 211");
    expect(texts).not.toContain("Polaris ATV");
    expect(texts).not.toContain("Braud Harvester");
    expect(texts).not.toContain("Can-Am");
  });
});

describe("Spray job save identity", () => {
  it("writes the selected tractor id to tractor_id", () => {
    const app = { ...emptySprayApplication(), tractorId: "tractor-1", vineyardId: "v1" };
    const { input } = toSprayJobInput({
      application: app as any,
      geometry: {
        grossAreaHa: 0,
        treatedAreaHa: 0,
        canonicalRowLengthMetres: 0,
        rowSpacingMetres: 0,
        geometrySource: "manual",
        geometryQuality: "exact",
      } as any,
      calculation: { carrier: { totalCarrierLitres: 0, concentrationFactor: 1 } } as any,
    });
    expect(input.tractor_id).toBe("tractor-1");
  });

  it("does not introduce a machine_id column", () => {
    const file = src("src/lib/sprayApplicationSave.ts");
    expect(file).not.toContain("machine_id");
  });
});
