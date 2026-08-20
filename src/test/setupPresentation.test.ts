import { describe, expect, it } from "vitest";
import {
  deriveSetupHealth,
  EMPTY_SETUP_FACTS,
  type SetupBlockFact,
  type SetupHealthFacts,
} from "@/lib/guide/setupHealth";
import {
  deriveSetupPresentation,
  setupPresentationMeta,
} from "@/lib/guide/setupPresentation";
import { LANDING_GUIDE_AREAS } from "@/lib/guide/guideAreas";

const block = (over: Partial<SetupBlockFact> = {}): SetupBlockFact => ({
  id: Math.random().toString(36).slice(2),
  name: "Block",
  hasBoundary: true,
  hasRows: true,
  hasPlanting: true,
  hasPlantingDetail: true,
  isIrrigated: false,
  ...over,
});

const complete = (): SetupHealthFacts => ({
  resolved: true,
  vineyard: { name: "Test Vineyard", hasLocation: true },
  blocks: [block(), block()],
  weather: { anyConfigured: true },
  equipment: { tractors: 1, machines: 0, sprayEquipment: 1, other: 0 },
  team: { members: 3, owners: 1 },
  spray: { chemicals: 4, sprayEquipment: 1, operationalEvidence: 10 },
  irrigation: { applicable: true, systemsOk: true, valvesOk: true, allocationsOk: true },
  preferences: { seasonConfigured: true },
});

describe("deriveSetupPresentation", () => {
  it("is Complete at 13/13 even when an optional preference is unchecked", () => {
    const summary = deriveSetupHealth({
      ...complete(),
      preferences: { seasonConfigured: false },
    });
    expect(summary.completedRequired).toBe(13);
    expect(summary.totalRequired).toBe(13);

    const p = deriveSetupPresentation(summary);
    expect(p.state).toBe("complete");
    expect(p.percentage).toBe(100);
    expect(p.label).toBe("Complete");
    expect(p.detail).toContain("13 of 13 required checks");
    expect(p.label).not.toMatch(/not checked/i);
    expect(setupPresentationMeta(p)).toBe("100% complete");
  });

  it("stays Complete when recommendations remain outstanding", () => {
    const summary = deriveSetupHealth({
      ...complete(),
      equipment: { tractors: 0, machines: 0, sprayEquipment: 0, other: 0 },
      team: { members: 1, owners: 1 },
    });
    const p = deriveSetupPresentation(summary);
    expect(p.state).toBe("complete");
    expect(p.percentage).toBe(100);
    expect(summary.recommendedOutstanding).toBeGreaterThan(0);
  });

  it("reports Action required with a sub-100 percentage on a required failure", () => {
    const summary = deriveSetupHealth({
      ...complete(),
      blocks: [block(), block({ hasRows: false })],
    });
    const p = deriveSetupPresentation(summary);
    expect(p.state).toBe("action_required");
    expect(p.label).toBe("1 action required");
    expect(p.percentage).toBeLessThan(100);
  });

  it("is neutral (never red) when required sources cannot be read", () => {
    const p = deriveSetupPresentation(deriveSetupHealth(EMPTY_SETUP_FACTS));
    expect(p.state).toBe("unknown");
    expect(p.label).toBe("Unable to check");
    expect(p.percentage).toBeNull();
  });

  it("uses a neutral error state rather than Action required", () => {
    const p = deriveSetupPresentation(deriveSetupHealth(complete()), {
      error: new Error("boom"),
    });
    expect(p.state).toBe("unknown");
    expect(p.label).toBe("Unable to check");
  });

  it("shows a neutral checking state while loading, with no 0%", () => {
    const p = deriveSetupPresentation(deriveSetupHealth(EMPTY_SETUP_FACTS), {
      loading: true,
    });
    expect(p.state).toBe("unknown");
    expect(p.loading).toBe(true);
    expect(p.percentage).toBeNull();
    expect(p.label).toBe("Checking setup…");
  });
});

describe("landing steps", () => {
  it("only the Setup step carries live status; steps 2-7 are neutral", () => {
    const scored = LANDING_GUIDE_AREAS.filter((a) => a.showsSetupStatus);
    expect(scored).toHaveLength(1);
    expect(scored[0].id).toBe("setup");
    expect(LANDING_GUIDE_AREAS.indexOf(scored[0])).toBe(0);
  });
});
