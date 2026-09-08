// The portal never writes the route bucket or its metadata itself: generation
// and registration go through the authenticated route-upload function, and the
// canonical bytes it returns are what gets embedded.
import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = { download: vi.fn(), upload: vi.fn() };
const invoke = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    storage: { from: () => storage },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: vi.fn(),
  },
}));

const compose = vi.fn();
vi.mock("@/lib/satelliteRouteMap", () => ({
  composeSatelliteRouteImage: (...args: unknown[]) => compose(...args),
}));

import {
  resolveSprayRoute,
  canonicalRouteHash,
  ROUTE_WIDTH,
  ROUTE_HEIGHT,
  ROUTE_NO_PATH_POINTS_MESSAGE,
  ROUTE_DOWNLOAD_FAILED_MESSAGE,
  ROUTE_LOCAL_ONLY_MESSAGE,
  ROUTE_HASH_MISMATCH_MESSAGE,
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

function canonicalRoute(objectPath: string, sha256: string) {
  return {
    bucket: SPRAY_REPORT_ASSET_BUCKET,
    objectPath,
    sha256,
    routeHash: "hash",
    styleVersion: SPRAY_ROUTE_STYLE_VERSION,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  compose.mockResolvedValue({ dataUrl: PNG_DATA_URL, width: ROUTE_WIDTH, height: ROUTE_HEIGHT });
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
    const res = await resolveSprayRoute(payload(canonicalRoute(`${TRIP}/existing.png`, "")), POINTS);
    expect(res.image?.generated).toBe(false);
    expect(res.warning).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("surfaces a download failure honestly for an existing image", async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: "nope" } });
    const res = await resolveSprayRoute(payload(canonicalRoute(`${TRIP}/existing.png`, "")), POINTS);
    expect(res.image).toBeNull();
    expect(res.warning).toBe(ROUTE_DOWNLOAD_FAILED_MESSAGE);
  });

  it("refuses an existing image whose bytes do not match its checksum", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["x"]), error: null });
    const res = await resolveSprayRoute(
      payload(canonicalRoute(`${TRIP}/existing.png`, "a".repeat(64))),
      POINTS,
    );
    expect(res.image).toBeNull();
    expect(res.warning).toBe(ROUTE_HASH_MISMATCH_MESSAGE);
  });

  it("sends the canonical route input to the authenticated upload function", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["stored"]), error: null });
    invoke.mockResolvedValue({ data: { route: canonicalRoute(`${TRIP}/canonical.png`, "") }, error: null });
    const res = await resolveSprayRoute(payload(), POINTS);

    const [fn, opts] = invoke.mock.calls[0] as [string, any];
    expect(fn).toBe("spray-report-route-upload");
    expect(opts.body.tripId).toBe(TRIP);
    expect(opts.body.routeHash).toBe(await canonicalRouteHash(POINTS));
    expect(opts.body.width).toBe(1030);
    expect(opts.body.height).toBe(700);
    expect(opts.body.coordinates).toHaveLength(3);
    expect(opts.body.coordinates[0]).toEqual({ latitude: -33.1, longitude: 149.1 });
    // The registered bytes are embedded, never the local composition.
    expect(res.image?.generated).toBe(false);
    expect(res.route?.objectPath).toBe(`${TRIP}/canonical.png`);
    expect(res.warning).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("embeds the concurrent winner returned by the function", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["winner"]), error: null });
    invoke.mockResolvedValue({ data: { route: canonicalRoute(`${TRIP}/winner.png`, "") }, error: null });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(res.route?.objectPath).toBe(`${TRIP}/winner.png`);
    expect(storage.download).toHaveBeenCalledWith(`${TRIP}/winner.png`);
  });

  it("says plainly when only a local image could be shown", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "not_authorized" } });
    const res = await resolveSprayRoute(payload(), POINTS);
    expect(res.warning).toBe(ROUTE_LOCAL_ONLY_MESSAGE);
    expect(res.image?.generated).toBe(true);
    expect(res.route).toBeNull();
  });

  it("warns honestly when there are no recorded path points", async () => {
    const res = await resolveSprayRoute(payload(), []);
    expect(res.image).toBeNull();
    expect(res.warning).toBe(ROUTE_NO_PATH_POINTS_MESSAGE);
    expect(compose).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
