// Execute checked-in Edge handlers with in-memory services only. This does not
// establish which code is deployed, and never invokes a hosted function.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";

function handler(name: string, services: Record<string, unknown>) {
  const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
  const local = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/, "");
  const js = ts.transpileModule(local, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let serve: ((req: Request) => Promise<Response>) | undefined;
  const names = ["Deno", ...Object.keys(services)];
  new Function(...names, js)({ serve: (fn: typeof serve) => { serve = fn; } }, ...Object.values(services));
  if (!serve) throw new Error("No handler registered");
  return serve;
}
const jsonOk = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const jsonError = (status: number, code: string, message: string) => new Response(JSON.stringify({ code, message }), { status });
function table(rows: unknown[]) {
  const q: any = { then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve) };
  for (const key of ["select", "eq", "in", "order", "limit", "range"]) q[key] = () => q;
  return q;
}
it("runs the manifest source on eight paddocks with both generations and no summaries, without job writes", async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
  const indices = ["TRUE_COLOUR", "NDVI", "EVI", "GNDVI", "MSAVI", "NDRE", "RECI", "GCI", "RENDVI", "NDMI", "PSRI"];
  const v6 = "sentinel2-v6-native-10m", v3 = "sentinel2-v3-eleven-layers";
  const scenes = ids.map((id) => ({ id: `s-${id}`, paddock_id: id, acquired_at: "2026-08-01T01:00:00Z", processing_status: "complete", paddock_valid_coverage_pct: null, paddock_cloud_cover_pct: null, scene_cloud_cover_pct: null, provider_scene_id: `source-${id}` }));
  const assets = ids.flatMap((id) => [v3, v6].flatMap((version) => indices.flatMap((index) => ["DISPLAY_RASTER", ...(index === "TRUE_COLOUR" ? [] : ["ANALYTICAL_RASTER"])].map((kind) => ({
    id: `${id}-${version}-${index}-${kind}`, satellite_scene_id: `s-${id}`, index_type: index, asset_type: kind, processing_version: version, storage_path: `${id}/saved.png`, mime_type: kind === "DISPLAY_RASTER" ? "image/png" : "image/tiff", bounds: { north: -33, south: -34, east: 150, west: 149 }, native_resolution_m: ["NDRE", "RECI", "RENDVI", "NDMI", "PSRI"].includes(index) ? 20 : 10,
  })))));
  const manifest = ids.map((id) => ({ paddock_id: id, vineyard_id: "fixture", package_status: "partial", latest_processing_version: v3, missing_summary_count: 10, missing_display_count: 0, missing_analytical_count: 0, updated_at: "2026-10-19T00:00:00Z" }));
  const records: Record<string, unknown[]> = { satellite_paddock_manifest: manifest, satellite_scenes: scenes, satellite_raster_assets: assets, satellite_index_summaries: [], satellite_refresh_jobs: [], paddocks: ids.map((id) => ({ id })) };
  const rpc = vi.fn(() => { throw new Error("A read handler must not call job RPCs"); });
  const run = handler("satellite-get-manifest", { corsHeaders: {}, jsonOk, jsonError, verifySystemAdmin: async () => ({ ok: true }), getServiceClient: () => ({ from: (name: string) => table(records[name] ?? []), rpc }) });
  const response = await run(new Request("https://offline.invalid/manifest", { method: "POST", body: JSON.stringify({ vineyard_id: "fixture", active_paddock_ids: ids }) }));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.manifest_version).toBe("v3");
  expect(data.recommended_default_date).toBe("2026-08-01");
  expect(data.date_coverage[0].paddocks).toHaveLength(8);
  for (const paddock of data.date_coverage[0].paddocks) {
    const ndvi = paddock.layers.find((l: any) => l.index_type === "NDVI");
    expect(ndvi.display.processing_version).toBe(v6); expect(ndvi.analytical.processing_version).toBe(v6);
    expect(ndvi.summary).toBeNull(); expect(paddock.acquisition_date).toBe("2026-08-01");
  }
  expect(data.paddocks.every((p: any) => p.package_status === "partial" && p.missing_summary_count === 10)).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});
it("asset URL source resolves the asset ID to private storage and returns its 600-second signed contract", async () => {
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://offline.invalid/private-signed" }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: { storage_path: "fixture/saved.png" }, error: null }) }));
  const bucket = vi.fn(() => ({ createSignedUrl: sign }));
  const auth = vi.fn(async (req: Request) => ({ ok: req.headers.get("Authorization") === "Bearer offline-fixture", status: 401, message: "Not signed in" }));
  const run = handler("satellite-get-asset-url", { corsHeaders: {}, jsonOk, jsonError, verifySystemAdmin: auth, getServiceClient: () => ({ from: () => ({ select: () => ({ eq }) }), storage: { from: bucket } }) });
  const response = await run(new Request("https://offline.invalid/asset", { method: "POST", headers: { Authorization: "Bearer offline-fixture" }, body: JSON.stringify({ asset_id: "fixture-asset" }) }));
  expect(await response.json()).toEqual({ signed_url: "https://offline.invalid/private-signed", expires_in: 600 });
  expect(eq).toHaveBeenCalledWith("id", "fixture-asset"); expect(bucket).toHaveBeenCalledWith("satellite-assets"); expect(sign).toHaveBeenCalledWith("fixture/saved.png", 600);
  const denied = await run(new Request("https://offline.invalid/asset", { method: "POST", body: "{}" }));
  expect(denied.status).toBe(401); await denied.text(); expect(sign).toHaveBeenCalledTimes(1);
});