import { afterEach, expect, it, vi } from "vitest";
import { fetchAssetBytes, fetchManifest } from "./satelliteManifest";
import { retrySaved } from "./satelliteSavedLoader";
const api = vi.hoisted(() => ({ invoke: vi.fn(), session: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { auth: { getSession: api.session } } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("accepts the legacy manifest v3 response shape with explicit shared-session auth and abort signal", async () => {
  const fixture = { manifest_version: "v3", vineyard_id: "fixture", updated_at: null, paddocks: [], date_coverage: [], provider_freshness: { provider_check_status: "never_checked", active_job_id: null } };
  api.session.mockResolvedValue({ data: { session: { access_token: "offline-fixture" } } });
  api.invoke.mockResolvedValue({ data: fixture, error: null });
  const signal = new AbortController().signal;
  expect(await fetchManifest("fixture", ["p1"], signal)).toEqual(fixture);
  expect(api.invoke).toHaveBeenCalledWith("satellite-get-manifest", { body: { vineyard_id: "fixture", active_paddock_ids: ["p1"] }, headers: { Authorization: "Bearer offline-fixture" }, signal });
});

it("a cancelled selection invokes neither manifest nor asset delivery", async () => {
  api.session.mockResolvedValue({ data: { session: { access_token: "offline-fixture" } } });
  const controller = new AbortController(); controller.abort();
  await expect(fetchManifest("fixture", [], controller.signal)).rejects.toThrow("Selection cancelled");
  await expect(fetchAssetBytes("fixture", null, controller.signal)).rejects.toThrow("Selection cancelled");
  expect(api.invoke).not.toHaveBeenCalled();
});

it("uses the authenticated saved-URL adapter and propagates cancellation through download", async () => {
  api.session.mockResolvedValue({ data: { session: { access_token: "offline-fixture-not-a-credential" } } });
  api.invoke.mockResolvedValue({ data: { signed_url: "https://offline.invalid/saved.png", expires_in: 60 }, error: null });
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["fixture"], { type: "image/png" }), headers: new Headers() });
  vi.stubGlobal("fetch", fetch); const controller = new AbortController();
  await fetchAssetBytes("fixture-asset", null, controller.signal);
  expect(api.invoke).toHaveBeenCalledWith("satellite-get-asset-url", expect.objectContaining({ body: { asset_id: "fixture-asset" }, signal: controller.signal }));
  expect(fetch).toHaveBeenCalledWith("https://offline.invalid/saved.png", { method: "GET", signal: controller.signal });
});

it("mints a fresh URL on a bounded transient retry rather than reusing an expired link", async () => {
  vi.useFakeTimers();
  api.session.mockResolvedValue({ data: { session: { access_token: "offline-fixture-not-a-credential" } } });
  api.invoke.mockResolvedValueOnce({ data: { signed_url: "https://offline.invalid/first" }, error: null })
    .mockResolvedValueOnce({ data: { signed_url: "https://offline.invalid/second" }, error: null });
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["fixture"]), headers: new Headers() });
  vi.stubGlobal("fetch", fetch);
  const pending = retrySaved((signal) => fetchAssetBytes("fixture-asset", null, signal), new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500); await pending;
  expect(api.invoke).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map((call) => call[0])).toEqual(["https://offline.invalid/first", "https://offline.invalid/second"]);
});

it.each([401,403])("an authenticated URL endpoint HTTP %i is terminal", async (status) => {
  api.session.mockResolvedValue({ data: { session: { access_token: "offline-fixture-not-a-credential" } } });
  api.invoke.mockResolvedValue({ data: null, error: { message: "Restricted", context: new Response(null, { status }) } });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(retrySaved((signal) => fetchAssetBytes("fixture-asset", null, signal), new AbortController().signal)).rejects.toThrow("Restricted");
  expect(api.invoke).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
});
it('delivery diagnostics distinguish signer rejection without exposing a URL', async () => {
  api.session.mockResolvedValue({data:{session:{access_token:'offline-fixture'}}});
  api.invoke.mockResolvedValue({data:null,error:{message:'Restricted',context:new Response(null,{status:403})}});
  const diagnostic=vi.fn();
  await expect(fetchAssetBytes('asset',null,new AbortController().signal,diagnostic)).rejects.toThrow();
  expect(diagnostic.mock.calls.map(c=>c[0])).toEqual([{stage:'signer',status:null,result:'pending'},{stage:'signer',status:403,result:'failed'}]);
});