import { describe, it, expect, vi } from "vitest";

const rpc = vi.fn();
const save = vi.fn(() => "x.pdf");
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/sprayReportV1", async (orig) => ({
  ...(await orig<any>()),
  fetchSprayReportV1: vi.fn(async () => ({
    payload: { identity: { vineyardId: "v", sprayRecordId: "s", tripId: "t" }, trip: { startUtc: "2026-01-01T00:00:00Z" }, tanks: [] },
  })),
}));
vi.mock("@/lib/sprayReportRoute", () => ({ resolveSprayRoute: vi.fn(async () => ({ image: null, warning: null })), ROUTE_RENDER_FAILED_MESSAGE: "x" }));
vi.mock("@/lib/sprayReportBranding", () => ({ EMPTY_BRANDING: {}, loadSprayReportBranding: vi.fn(async () => ({})) }));
vi.mock("@/lib/sprayReportPdf", () => ({ saveSprayReportPdf: (...a: unknown[]) => save(...(a as [])) }));

import { downloadSprayReport } from "@/lib/sprayReportExport";

describe("57: non-financial Spray Report export", () => {
  it("never requests SQL 264 pricing or adds a cost overlay without cost permission", async () => {
    await downloadSprayReport({ tripId: "t", canSeeCosts: false });
    expect(rpc).not.toHaveBeenCalled();
    expect((save.mock.calls[0] as any[])[1].costOverlay).toBeNull();
  });
});
