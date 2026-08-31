// Shared selector semantics across the Spray Calculator wizard, plus the
// chemical-search backend ownership guarantee.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationStep } from "@/components/spray/wizard/ApplicationStep";
import { GrowthStageStep } from "@/components/spray/wizard/GrowthStageStep";
import { emptySprayApplication } from "@/lib/sprayApplicationDomain";

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function baseProps(overrides: Record<string, unknown> = {}) {
  const app: any = { ...emptySprayApplication(), ...(overrides.app as object ?? {}) };
  return {
    app,
    patch: (overrides.patch as any) ?? (() => {}),
    update: (overrides.update as any) ?? (() => {}),
    calc: { products: [], carrier: {} } as any,
    geometry: {} as any,
    intelligenceById: new Map(),
    canEdit: true,
    vineyardId: "v1",
  } as any;
}

describe("Application Type uses the shared SelectTile control", () => {
  it("renders real radios with an accessible selected state", () => {
    const props = baseProps({ app: { operationType: "foliar" } });
    render(wrap(<ApplicationStep {...props} />));
    const group = screen.getByRole("radiogroup", { name: /application type/i });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("the whole tile is clickable and selects the type", () => {
    const seen: string[] = [];
    const props = baseProps({
      app: { operationType: "foliar" },
      update: (fn: any) => {
        const next = fn({ ...emptySprayApplication(), operationType: "foliar" });
        seen.push(next.operationType);
      },
    });
    render(wrap(<ApplicationStep {...props} />));
    fireEvent.click(screen.getByRole("radio", { name: /spreader/i }));
    expect(seen).toContain("spreader");
  });

  it("reuses the shared control rather than a second visual implementation", () => {
    const file = src("src/components/spray/wizard/ApplicationStep.tsx");
    expect(file).toContain('from "./controls"');
    expect(file).toContain("<SelectTile");
  });
});

describe("SelectTile affordances", () => {
  const file = src("src/components/spray/wizard/controls.tsx");
  it("has a 2px border, pointer cursor, hover, focus and a radio dot", () => {
    expect(file).toContain('role="radio"');
    expect(file).toContain("border-2");
    expect(file).toContain("cursor-pointer");
    expect(file).toContain("hover:border-primary/60");
    expect(file).toContain("focus-visible:ring-2");
    expect(file).toContain("rounded-full bg-primary");
  });
});

describe("Growth Stage", () => {
  it("uses the shared SelectTile control", () => {
    const file = src("src/components/spray/wizard/GrowthStageStep.tsx");
    expect(file).toContain('from "./controls"');
    expect(file).toContain("<SelectTile");
  });

  it("offers an explicit Not set option that is selected by default", () => {
    render(<GrowthStageStep {...baseProps({ app: { growthStageCode: null } })} />);
    const notSet = screen.getByRole("radio", { name: /not set/i });
    expect(notSet.getAttribute("aria-checked")).toBe("true");
  });

  it("Not set stores null — no sentinel code is invented", () => {
    const patches: any[] = [];
    render(
      <GrowthStageStep
        {...baseProps({ app: { growthStageCode: "EL23" }, patch: (p: any) => patches.push(p) })}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /not set/i }));
    expect(patches).toContainEqual({ growthStageCode: null });
  });

  it("selecting a stage stores the shared E-L code", () => {
    const patches: any[] = [];
    render(<GrowthStageStep {...baseProps({ patch: (p: any) => patches.push(p) })} />);
    const first = screen.getAllByRole("radio")[1];
    fireEvent.click(first);
    expect(patches[0].growthStageCode).toMatch(/^EL/i);
  });
});

describe("chemical search backend ownership", () => {
  it("the portal calls the shared chemical-info-lookup Edge Function", () => {
    const file = src("src/components/spray/ChemicalAILookup.tsx");
    expect(file).toContain('functions.invoke(\n        "chemical-info-lookup"');
  });

  it("the portal has no client-side AI model / OpenAI path", () => {
    for (const p of [
      "src/components/spray/ChemicalAILookup.tsx",
      "src/lib/chemicalReverifyLookup.ts",
      "src/lib/chemicalLookupRequest.ts",
    ]) {
      const file = src(p);
      expect(file).not.toMatch(/api\.openai\.com|ai\.gateway\.lovable\.dev/i);
      expect(file).not.toMatch(/\bgpt-[0-9]/i);
    }
  });

  it("separates the search and label-enrichment wait messages", () => {
    const file = src("src/components/spray/ChemicalAILookup.tsx");
    expect(file).toContain("Searching registered products\u2026");
    expect(file).toContain("Reading the official product label");
    // A shortlist must never be described as a multi-minute operation.
    expect(file).not.toContain("CHEMICAL_LOOKUP_WAIT_MESSAGE");
    expect(file).not.toMatch(/can take a few minutes/i);
  });
});
