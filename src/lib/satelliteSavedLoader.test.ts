import { afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { bounded, decodeSavedImage, retrySaved, runSavedQueue, SavedAssetError, SavedObjectUrls, validatePng, validRasterBounds } from "./satelliteSavedLoader";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;
const png = () => {
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  new DataView(bytes.buffer).setUint32(16, 1); new DataView(bytes.buffer).setUint32(20, 1);
  return new NodeBlob([bytes], { type: "image/png" }) as unknown as Blob;
};

describe("bounded saved-display queue", () => {
  it("publishes seven displays while the first stalls; limits concurrency to three; defers all analysis", async () => {
    let release = () => {}; let active = 0; let peak = 0;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const finished: string[] = [];
    const work = runSavedQueue(Array.from({ length: 8 }, (_, i) => `d${i}`), ["a0", "d1"], (id) => id,
      async (id) => {
        active++; peak = Math.max(peak, active);
        if (id === "d0") await first;
        finished.push(id); active--;
      }, signal());
    await vi.waitFor(() => expect(finished).toHaveLength(7));
    expect(finished).not.toContain("a0"); expect(peak).toBeLessThanOrEqual(3);
    release(); await work;
    expect(finished.slice(0, 8).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `d${i}`));
    expect(finished.filter((id) => id === "d1")).toHaveLength(1);
    expect(finished.at(-1)).toBe("a0");
  });

  it("continues partial success after one terminal failure", async () => {
    const loaded: number[] = [];
    await runSavedQueue([0,1,2,3,4,5,6,7], [], String, async (id) => {
      if (id === 0) throw new SavedAssetError("Not found", 404); loaded.push(id);
    }, signal());
    expect(loaded).toHaveLength(7);
  });

  it("cancels old date/layer/vineyard work before queued work or prefetch starts", async () => {
    const controller = new AbortController(); const started: string[] = [];
    await runSavedQueue(["old1", "old2"], ["adjacent"], String, async (id) => {
      started.push(id); controller.abort();
    }, controller.signal, 1);
    expect(started).toEqual(["old1"]);
  });

  it("times out even a non-abortable network/cache adapter", async () => {
    vi.useFakeTimers();
    const pending = bounded(() => new Promise(() => {}), signal(), 12_000, "Raster");
    const assertion = expect(pending).rejects.toThrow("Raster timed out");
    await vi.advanceTimersByTimeAsync(12_000); await assertion;
  });

  it.each([401,403,404])("does not retry HTTP %i", async (status) => {
    const work = vi.fn().mockRejectedValue(new SavedAssetError(`HTTP ${status}`, status));
    await expect(retrySaved(work, signal())).rejects.toThrow(`HTTP ${status}`);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it.each([429,500,503,undefined])("caps transient %s retries at two", async (status) => {
    vi.useFakeTimers();
    const work = vi.fn().mockRejectedValue(new SavedAssetError("Temporary failure", status));
    const pending = retrySaved(work, signal());
    const assertion = expect(pending).rejects.toThrow("Temporary failure");
    await vi.advanceTimersByTimeAsync(1_000); await assertion;
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("caps unresponsive requests and cancels their underlying signals", async () => {
    vi.useFakeTimers(); const requests: AbortSignal[] = [];
    const work = vi.fn((child: AbortSignal) => { requests.push(child); return new Promise(() => {}); });
    const pending = retrySaved(work, signal(), 100);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1_000); await assertion;
    expect(work).toHaveBeenCalledTimes(2); expect(requests.every((child) => child.aborted)).toBe(true);
  });
});

describe("PNG/bounds/decode/URL safety", () => {
  it("accepts PNG header; rejects HTML, corrupt bytes and invalid bounds", async () => {
    await expect(validatePng(png())).resolves.toBeUndefined();
    await expect(validatePng(new NodeBlob(["<html>"], { type: "text/html" }) as unknown as Blob)).rejects.toThrow("Expected PNG");
    await expect(validatePng(new NodeBlob(["broken"], { type: "image/png" }) as unknown as Blob)).rejects.toThrow("PNG bytes");
    expect(validRasterBounds({ north: 1, south: 0, east: 1, west: 0 })).toBe(true);
    expect(validRasterBounds({ north: NaN, south: 0, east: 1, west: 0 })).toBe(false);
    expect(validRasterBounds({ north: 1, south: 2, east: 1, west: 0 })).toBe(false);
    expect(validRasterBounds(null)).toBe(false);
  });

  it("bounds an unresponsive image decoder", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", class { src = ""; onload = null; onerror = null; });
    const pending = decodeSavedImage("blob:test", signal());
    const assertion = expect(pending).rejects.toThrow("PNG decode timed out");
    await vi.advanceTimersByTimeAsync(8_000); await assertion;
  });

  it("decodes cached bytes without network and cleans handlers", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Image", class {
      naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    await decodeSavedImage("blob:cached", signal()); expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes replacement and unmounted object URLs exactly once", () => {
    const create = vi.fn().mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    const revoke = vi.fn(); vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const urls = new SavedObjectUrls(); urls.replace("asset", png()); urls.replace("asset", png()); urls.clear();
    expect(revoke.mock.calls).toEqual([["blob:old"], ["blob:new"]]); expect(urls.urls.size).toBe(0);
  });
});