import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { checkInsightsAccess, checkVintageNoteAddAccess } from "@/lib/scoutReports";
import { accessibleViews, ACTIVITIES, type NavViewer } from "@/lib/navigationConfig";
import { canAccessRoute } from "@/lib/rolePermissions";
import { guardMutation, readOnlyStore, ReadOnlyBlockedError } from "@/lib/vineyardWriteAccess";

const missing = { data: null, error: { code: "PGRST202", message: "function not found" } };
const viewer = (over: Partial<NavViewer> = {}): NavViewer => ({
  role: "owner",
  isSystemAdmin: false,
  irrigation: { records: true, reports: true, setup: true },
  hasAccountBilling: true,
  vineyardCountry: "Australia",
  ...over,
});
const observationPaths = (v: NavViewer) =>
  accessibleViews(ACTIVITIES.find((a) => a.id === "observations")!, v).map((x) => x.path);

beforeEach(() => rpc.mockReset());

describe("Scout Reports / Vintage Notes — customer navigation", () => {
  for (const role of ["owner", "manager", "supervisor", "operator"]) {
    it(`shows both to a non-admin ${role}, without unrelated preview modules`, () => {
      const paths = observationPaths(viewer({ role }));
      expect(paths).toContain("/observations/scout-reports");
      expect(paths).toContain("/observations/vintage-notes");
      expect(paths).not.toContain("/tools/satellite-mapping");
      expect(canAccessRoute("/observations/scout-reports", role)).toBe(true);
      expect(canAccessRoute("/observations/vintage-notes", role)).toBe(true);
    });
  }
});

describe("read access preflight", () => {
  it("uses the member helper for the selected vineyard", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkInsightsAccess("vy-a")).toBe("allowed");
    expect(rpc).toHaveBeenCalledWith("can_view_vineyard_insights", { p_vineyard_id: "vy-a" });
  });

  it("denies an inaccessible vineyard", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkInsightsAccess("vy-b")).toBe("denied");
  });

  it("falls back to the legacy System Admin gate when the helper isn't deployed", async () => {
    rpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: false, error: null });
    expect(await checkInsightsAccess("vy-a")).toBe("denied");
    expect(rpc).toHaveBeenLastCalledWith("can_use_vineyard_insights", { p_vineyard_id: "vy-a" });
  });

  it("reports unknown (never empty) on other errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "500" } });
    expect(await checkInsightsAccess("vy-a")).toBe("unknown");
  });
});

describe("Vintage Notes add access", () => {
  it("Operators are read-only without asking the backend", async () => {
    expect(await checkVintageNoteAddAccess("vy-a", "operator", "allowed")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "manager", "supervisor"]) {
    it(`${role} may add when the backend agrees`, async () => {
      rpc.mockResolvedValueOnce({ data: true, error: null });
      expect(await checkVintageNoteAddAccess("vy-a", role, "allowed")).toBe(true);
      expect(rpc).toHaveBeenCalledWith("can_add_vintage_notes", { p_vineyard_id: "vy-a" });
    });
  }

  it("backend denial or error fails closed", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkVintageNoteAddAccess("vy-b", "manager", "allowed")).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "500" } });
    expect(await checkVintageNoteAddAccess("vy-a", "manager", "allowed")).toBe(false);
  });

  it("before the helper is deployed, requires confirmed read access", async () => {
    rpc.mockResolvedValue(missing);
    expect(await checkVintageNoteAddAccess("vy-a", "manager", "allowed")).toBe(true);
    expect(await checkVintageNoteAddAccess("vy-a", "manager", "denied")).toBe(false);
  });
});

describe("read-only expired trial", () => {
  it("blocks the Vintage Note save, which goes through the guarded useMutation", () => {
    const src = readFileSync("src/pages/observations/VintageNotesPage.tsx", "utf8");
    expect(src).toMatch(/useMutation\(\{\s*mutationFn: async \(\) => \{[\s\S]*insertVintageNote/);
    expect(src).not.toMatch(/allowReadOnly|ALLOW_READ_ONLY/);
    readOnlyStore.setReadOnly(true, "trial_expired");
    expect(() => guardMutation(undefined)).toThrow(ReadOnlyBlockedError);
    readOnlyStore.setReadOnly(false);
  });

  it("Scout Reports pages never write", () => {
    for (const f of ["ScoutReportsPage", "ScoutReportDetailPage"]) {
      const src = readFileSync(`src/pages/observations/${f}.tsx`, "utf8");
      expect(src).not.toMatch(/useMutation|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
  });
});
