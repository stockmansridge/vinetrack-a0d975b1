import { afterEach, expect, it, vi } from "vitest";
import { fetchAssetBytes } from "./satelliteManifest";
import { retrySaved } from "./satelliteSavedLoader";
const api = vi.hoisted(() => ({ invoke: vi.fn(), session: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { auth: { getSession: api.session } } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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