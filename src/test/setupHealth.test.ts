import { describe, expect, it } from "vitest";
import {
  deriveSetupHealth,
  EMPTY_SETUP_FACTS,
  type SetupHealthFacts,
} from "@/lib/guide/setupHealth";

const block = (over: Partial<SetupHealthFacts["blocks"] extends (infer T)[] | null ? T : never> = {}) => ({
  id: Math.random().toString(36).slice(2),
  name: "Block",
  hasBoundary: true,
  hasRows: true,
  hasPlanting: true,
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
  spray: { chemicals: 4, sprayEquipment: 1, usageEvidence: 10 },
  irrigation: { applicable: true, systemsOk: true, valvesOk: true, allocationsOk: true },
  preferences: { seasonConfigured: true },
});

describe("deriveSetupHealth", () => {
  it("is unresolved before facts arrive", () => {
    const s = deriveSetupHealth(EMPTY_SETUP_FACTS);
    expect(s.resolved).toBe(false);
    expect(s.status).toBe("not_checked");
    expect(s.readinessPct).toBeNull();
  });

  it("reports 100% when everything applicable is complete", () => {
    const s = deriveSetupHealth(complete());
    expect(s.readinessPct).toBe(100);
    expect(s.status).toBe("complete");
    expect(s.actionsRequired).toBe(0);
  });

  it("reports 0% when nothing required is done", () => {
    const s = deriveSetupHealth({
      ...complete(),
      vineyard: { name: "", hasLocation: false },
      blocks: [],
      weather: { anyConfigured: false },
      team: { members: 0, owners: 0 },
      spray: { chemicals: 0, sprayEquipment: 0, usageEvidence: 3 },
      irrigation: { applicable: true, systemsOk: false, valvesOk: false, allocationsOk: false },
    });
    expect(s.readinessPct).toBe(0);
    expect(s.status).toBe("action_required");
  });

  it("reports partial block completion honestly", () => {
    const blocks = [block(), block(), block({ hasRows: false })];
    const s = deriveSetupHealth({ ...complete(), blocks });
    const rows = s.checks.find((c) => c.id === "vineyard.rows")!;
    expect(rows.status).toBe("action_required");
    expect(rows.detail).toBe("2 of 3 blocks have rows");
    expect(s.readinessPct).toBeLessThan(100);
  });

  it("excludes spray checks when there is no spray usage evidence", () => {
    const s = deriveSetupHealth({
      ...complete(),
      spray: { chemicals: 0, sprayEquipment: 0, usageEvidence: 0 },
    });
    const spray = s.groupsById.spray;
    expect(spray.status).toBe("not_applicable");
    expect(spray.totalRequired).toBe(0);
    expect(s.readinessPct).toBe(100);
  });

  it("excludes irrigation checks for a dryland vineyard", () => {
    const s = deriveSetupHealth({
      ...complete(),
      irrigation: { applicable: false, systemsOk: false, valvesOk: false, allocationsOk: false },
    });
    expect(s.groupsById.irrigation.status).toBe("not_applicable");
    expect(s.readinessPct).toBe(100);
  });

  it("keeps recommended and optional items out of the percentage", () => {
    const s = deriveSetupHealth({
      ...complete(),
      equipment: { tractors: 0, machines: 0, sprayEquipment: 0, other: 0 },
      team: { members: 1, owners: 1 },
      preferences: { seasonConfigured: false },
    });
    expect(s.readinessPct).toBe(100);
    expect(s.status).toBe("recommended");
    expect(s.recommendedOutstanding).toBeGreaterThan(0);
  });

  it("marks unreadable sources as not checked rather than failed", () => {
    const s = deriveSetupHealth({ ...complete(), weather: null });
    const weather = s.checks.find((c) => c.id === "weather.source")!;
    expect(weather.status).toBe("not_checked");
    expect(weather.countsTowardReadiness).toBe(false);
    expect(s.status).toBe("not_checked");
  });
});
