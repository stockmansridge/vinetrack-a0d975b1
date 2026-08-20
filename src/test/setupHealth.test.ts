import { describe, expect, it } from "vitest";
import {
  deriveSetupHealth,
  EMPTY_SETUP_FACTS,
  type SetupBlockFact,
  type SetupHealthFacts,
} from "@/lib/guide/setupHealth";

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
      spray: { chemicals: 0, sprayEquipment: 0, operationalEvidence: 3 },
      irrigation: { applicable: true, systemsOk: false, valvesOk: false, allocationsOk: false },
    });
    expect(s.readinessPct).toBe(0);
    expect(s.status).toBe("action_required");
  });

  it("reports partial block completion in vineyard language", () => {
    const blocks = [block(), block(), block({ hasRows: false })];
    const s = deriveSetupHealth({ ...complete(), blocks });
    const rows = s.checks.find((c) => c.id === "vineyard.rows")!;
    expect(rows.status).toBe("action_required");
    expect(rows.detail).toBe("2 of 3 blocks have row setup");
    expect(s.readinessPct).toBeLessThan(100);
  });

  it("counts one row penalty only, regardless of geometry sub-fields", () => {
    const s = deriveSetupHealth({ ...complete(), blocks: [block({ hasRows: false })] });
    expect(s.checks.filter((c) => c.status === "action_required").map((c) => c.id)).toEqual([
      "vineyard.rows",
    ]);
    expect(s.actionsRequired).toBe(1);
  });

  // --- Spray applicability (Stage 3.1 §3) ------------------------------------

  it("does not make spray required when only catalogue chemicals exist", () => {
    const s = deriveSetupHealth({
      ...complete(),
      spray: { chemicals: 12, sprayEquipment: 0, operationalEvidence: 0 },
    });
    expect(s.groupsById.spray.status).toBe("not_applicable");
    expect(s.groupsById.spray.totalRequired).toBe(0);
    expect(s.readinessPct).toBe(100);
  });

  it("does not make spray required when only a sprayer exists", () => {
    const s = deriveSetupHealth({
      ...complete(),
      spray: { chemicals: 0, sprayEquipment: 2, operationalEvidence: 0 },
    });
    expect(s.groupsById.spray.status).toBe("not_applicable");
    expect(s.readinessPct).toBe(100);
  });

  it("makes spray required once there is a real spray job or record", () => {
    const s = deriveSetupHealth({
      ...complete(),
      spray: { chemicals: 0, sprayEquipment: 0, operationalEvidence: 1 },
    });
    const chem = s.checks.find((c) => c.id === "spray.chemicals")!;
    expect(chem.applicable).toBe(true);
    expect(chem.status).toBe("action_required");
    expect(s.groupsById.spray.totalRequired).toBe(2);
  });

  it("does not double-penalise a missing sprayer via generic equipment", () => {
    const s = deriveSetupHealth({
      ...complete(),
      equipment: { tractors: 0, machines: 0, sprayEquipment: 0, other: 0 },
      spray: { chemicals: 3, sprayEquipment: 0, operationalEvidence: 5 },
    });
    const failing = s.checks.filter((c) => c.status === "action_required").map((c) => c.id);
    expect(failing).toEqual(["spray.equipment"]);
    expect(s.checks.find((c) => c.id === "equipment.registered")!.status).toBe("recommended");
    expect(s.checks.find((c) => c.id === "equipment.registered")!.countsTowardReadiness).toBe(false);
  });

  // --- Irrigation -----------------------------------------------------------

  it("excludes irrigation checks for a dryland vineyard", () => {
    const s = deriveSetupHealth({
      ...complete(),
      irrigation: { applicable: false, systemsOk: false, valvesOk: false, allocationsOk: false },
    });
    expect(s.groupsById.irrigation.status).toBe("not_applicable");
    expect(s.readinessPct).toBe(100);
  });

  it("evaluates configuration for an irrigated vineyard", () => {
    const s = deriveSetupHealth({
      ...complete(),
      irrigation: { applicable: true, systemsOk: true, valvesOk: true, allocationsOk: false },
    });
    expect(s.checks.find((c) => c.id === "irrigation.allocations")!.status).toBe("action_required");
    expect(s.groupsById.irrigation.totalRequired).toBe(3);
  });

  it("treats an unreadable irrigation aggregate as unknown, not failed", () => {
    const s = deriveSetupHealth({ ...complete(), irrigation: null });
    const check = s.checks.find((c) => c.id === "irrigation.systems")!;
    expect(check.status).toBe("not_checked");
    expect(check.sourceState).toBe("unreadable");
    expect(check.countsTowardReadiness).toBe(false);
    expect(s.readinessPct).toBe(100);
  });

  // --- Weather / team / planting -------------------------------------------

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

  it("lets a solo vineyard reach 100%", () => {
    const s = deriveSetupHealth({ ...complete(), team: { members: 1, owners: 1 } });
    expect(s.checks.find((c) => c.id === "team.owner")!.status).toBe("complete");
    expect(s.readinessPct).toBe(100);
  });

  it("keeps missing clone/rootstock as recommended only", () => {
    const s = deriveSetupHealth({
      ...complete(),
      blocks: [block({ hasPlantingDetail: false }), block()],
    });
    const detail = s.checks.find((c) => c.id === "vineyard.planting_detail")!;
    expect(detail.status).toBe("recommended");
    expect(detail.countsTowardReadiness).toBe(false);
    expect(s.readinessPct).toBe(100);
  });

  it("marks unreadable weather configuration as not checked rather than failed", () => {
    const s = deriveSetupHealth({ ...complete(), weather: null });
    const weather = s.checks.find((c) => c.id === "weather.source")!;
    expect(weather.status).toBe("not_checked");
    expect(weather.sourceState).toBe("unreadable");
    expect(weather.countsTowardReadiness).toBe(false);
    expect(s.readinessPct).toBe(100);
    expect(s.status).toBe("not_checked");
  });

  it("keeps a configured weather source complete regardless of provider health", () => {
    // Provider health is never an input: the same configured fact stays green.
    const s = deriveSetupHealth({ ...complete(), weather: { anyConfigured: true } });
    expect(s.checks.find((c) => c.id === "weather.source")!.status).toBe("complete");
  });

  it("excludes unknown sources from the denominator", () => {
    const s = deriveSetupHealth({ ...complete(), vineyard: null, weather: null });
    const counted = s.checks.filter((c) => c.countsTowardReadiness).map((c) => c.id);
    expect(counted).not.toContain("vineyard.profile");
    expect(counted).not.toContain("weather.source");
    expect(s.totalRequired).toBe(counted.length);
  });

  it("only counts applicable required checks in the denominator", () => {
    const s = deriveSetupHealth(complete());
    const counted = s.checks.filter((c) => c.countsTowardReadiness);
    expect(counted.every((c) => c.importance === "required" && c.applicable)).toBe(true);
    expect(s.totalRequired).toBe(13);
    expect(s.completedRequired).toBe(13);
  });
});
