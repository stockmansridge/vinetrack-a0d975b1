import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = { download: vi.fn(), upload: vi.fn() };
const rpc = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    storage: { from: () => storage },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const compose = vi.fn();
vi.mock("@/lib/satelliteRouteMap", () => ({
  composeSatelliteRouteImage: (...args: unknown[]) => compose(...args),
}));

import {
  resolveSprayRoute,
  routeObjectPath,
  routeHashForPoints,
  ROUTE_NO_PATH_POINTS_MESSAGE,
  ROUTE_DOWNLOAD_FAILED_MESSAGE,
  ROUTE_UPLOAD_FAILED_MESSAGE,
  ROUTE_REGISTER_FAILED_MESSAGE,
} from "@/lib/sprayReportRoute";
import { SPRAY_REPORT_ASSET_BUCKET, SPRAY_ROUTE_STYLE_VERSION } from "@/lib/sprayReportV1";

const TRIP = "11111111-2222-3333-4444-555555555555";

function payload(route: any = null): any {
  return {
    identity: { tripId: TRIP, vineyardId: "vy-1", vineyardTimeZone: "Australia/Sydney" },
    route,
  };
}

const POINTS = [
  { lat: -33.1, lng: 149.1 },
  { lat: -33.2, lng: 149.2 },
  { lat: -33.3, lng: 149.3 },
];

const PNG_DATA_URL = "data:image/png;base64,aGVsbG8=";

beforeEach(() => {
  vi.clearAllMocks();
  compose.mockResolvedValue({ dataUrl: PNG_DATA_URL, width: 1100, height: 660 });
  storage.upload.mockResolvedValue({ error: null, data: {} });
  (globalThis as any).FileReader = class {
    result = PNG_DATA_URL;
    onload: any = null;
    onerror: any = null;
    readAsDataURL() {
      this.onload?.();
    }
  };
});

describe("spray report route asset", () => {
  it("reuses the saved private image identified by the payload", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["x"]), error: null });
    const res = await resolveSprayRoute(
      payload({
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        objectPath: `${TRIP}/existing.png`,
        sha256: "a".repeat(64),
        routeHash: "h",
        styleVersion: SPRAY_ROUTE_STYLE_VERSION,
      }),
      POINTS,
    );
    expect(res.image?.generated).toBe(false);
    expect(res.warning).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a download failure honestly for an existing image", async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: "nope" } });
    const res = await resolveSprayRoute(
      payload({
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        objectPath: `${TRIP}/existing.png`,
        sha256: "a".repeat(64),
        routeHash: "h",
        styleVersion: SPRAY_ROUTE_STYLE_VERSION,
      }),
      POINTS,
    );
    expect(res.image).toBeNull();
    expect(res.warning).toBe(ROUTE_DOWNLOAD_FAILED_MESSAGE);
  });

  it("generates, uploads trip-scoped without overwrite, and registers through the RPC", async () => {
    const objectPath = routeObjectPath(payload(), routeHashForPoints(POINTS));
    rpc.mockResolvedValue({
      data: {
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        objectPath,
        sha256: "b".repeat(64),
        routeHash: routeHashForPoints(POINTS),
        styleVersion: SPRAY_ROUTE_STYLE_VERSION,
      },
      error: null,
    });
    const res = await resolveSprayRoute(payload(), POINTS);

    expect(objectPath.startsWith(`${TRIP}/`)).toBe(true);
    expect(storage.upload).toHaveBeenCalledWith(
      objectPath,
      expect.anything(),
      expect.objectContaining({ upsert: false }),
    );
    const [fn, args] = rpc.mock.calls[0] as [string, any];
    expect(fn).toBe("register_spray_report_route_asset_v1");
    expect(args.p_trip_id).toBe(TRIP);
    expect(args.p_bucket).toBe("trip-report-assets");
    expect(args.p_object_path).toBe(objectPath);
    expect(args.p_style_version).toBe("spray-route-red-green-v1");
    expect(args.p_route_hash).toBeTruthy();
    expect(args.p_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.image?.generated).toBe(true);
    expect(res.warning).toBeNull();
  });

  it("retries registration after a duplicate upload rather than overwriting", async () => {
    storage.upload.mockResolvedValue({ error: { message: "The resource already exists" } });
    const objectPath = routeObjectPath(payload(), routeHashForPoints(POINTS));
    rpc.mockResolvedValue({
      data: {
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        objectPath,
        sha256: "b".repeat(64),
        routeHash: routeHashForPoints(POINTS),
        styleVersion: SPRAY_ROUTE_STYLE_VERSION,
      },
      error: null,
    });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(rpc).toHaveBeenCalled();
    expect(res.warning).toBeNull();
  });

  it("embeds the concurrent winner returned by the RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        bucket: SPRAY_REPORT_ASSET_BUCKET,
        objectPath: `${TRIP}/winner.png`,
        sha256: "c".repeat(64),
        routeHash: "other",
        styleVersion: SPRAY_ROUTE_STYLE_VERSION,
      },
      error: null,
    });
    storage.download.mockResolvedValue({ data: new Blob(["y"]), error: null });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(res.route?.objectPath).toBe(`${TRIP}/winner.png`);
    expect(res.image?.generated).toBe(false);
  });

  it("reports authorization failures from the RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_authorized" } });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(res.warning).toBe(ROUTE_REGISTER_FAILED_MESSAGE);
    expect(res.image?.generated).toBe(true);
  });

  it("reports storage upload failures", async () => {
    storage.upload.mockResolvedValue({ error: { message: "storage down" } });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(res.warning).toBe(ROUTE_UPLOAD_FAILED_MESSAGE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("warns honestly when there are no recorded path points", async () => {
    const res = await resolveSprayRoute(payload(), []);
    expect(res.image).toBeNull();
    expect(res.warning).toBe(ROUTE_NO_PATH_POINTS_MESSAGE);
    expect(compose).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
