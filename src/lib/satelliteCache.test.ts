import { afterEach, expect, it, vi } from "vitest";
import { getAssetBlob, readCachedAsset, readCachedManifest } from "./satelliteCache";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cached manifest retains its August acquisition date rather than its October cache timestamp", async () => {
  const manifest = { manifest_version: "v3", vineyard_id: "fixture", paddocks: [], newest_saved_date: "2026-08-01", recommended_default_date: "2026-08-01", updated_at: "2026-10-19" };
  const db = { close: vi.fn(), transaction: () => {
    const tx: any = { objectStore: () => ({ get: () => {
      const request: any = {};
      queueMicrotask(() => { request.result = { manifest, cachedAt: "2026-10-19" }; request.onsuccess(); tx.oncomplete(); });
      return request;
    } }) }; return tx;
  } };
  vi.stubGlobal("indexedDB", { open: () => { const request: any = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } });
  expect((await readCachedManifest("fixture"))?.recommended_default_date).toBe("2026-08-01");
});

it("returns an IndexedDB hit without asset network calls", async () => {
  const blob = new Blob(["fixture"]); const close = vi.fn();
  const db = { close, transaction: () => {
    const tx: any = { objectStore: () => ({ get: () => {
      const request: any = {};
      queueMicrotask(() => { request.result = { blob }; request.onsuccess(); tx.oncomplete(); });
      return request;
    } }) }; return tx;
  } };
  vi.stubGlobal("indexedDB", { open: () => {
    const request: any = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request;
  } });
  const fetchBytes = vi.fn();
  expect(await getAssetBlob("a1", "v6", fetchBytes)).toBe(blob);
  expect(fetchBytes).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});

it("a stuck IndexedDB open becomes a miss in 500ms, not an infinite spinner", async () => {
  vi.useFakeTimers(); vi.stubGlobal("indexedDB", { open: () => ({}) });
  const pending = readCachedAsset("a1", "v6"); await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toBeNull();
});

it("a temporary IndexedDB exception cannot prevent downloaded bytes being returned", async () => {
  vi.stubGlobal("indexedDB", { open: () => { throw new Error("Unavailable"); } });
  const blob = new Blob(["fixture"]);
  const fetchBytes = vi.fn().mockResolvedValue({ status: 200, blob, etag: "e", contentType: "image/png" });
  expect(await getAssetBlob("a1", "v6", fetchBytes)).toBe(blob); expect(fetchBytes).toHaveBeenCalledTimes(1);
});