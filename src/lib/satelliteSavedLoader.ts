// Saved bytes only. No discovery, processing or job APIs belong in this module.
export class SavedAssetError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export function abortError(): Error { return new DOMException("Selection cancelled", "AbortError"); }

/** Also bounds adapters (IDB/decoders) which do not implement AbortSignal. */
export async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, ms: number, label: string,
): Promise<T> {
  if (signal.aborted) throw abortError();
  const child = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const stop = new Promise<never>((_, reject) => {
    cancel = () => { child.abort(); reject(abortError()); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      child.abort(); reject(new SavedAssetError(`${label} timed out`));
    }, ms);
  });
  try { return await Promise.race([work(child.signal), stop]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

export async function retrySaved<T>(
  work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal,
  timeoutMs = 12_000, attempts = 2,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await bounded(work, signal, timeoutMs, "Saved asset request"); }
    catch (error) {
      if (signal.aborted) throw abortError();
      const status = error instanceof SavedAssetError ? error.status : undefined;
      if ((status != null && status !== 429 && status < 500) || attempt + 1 === attempts) throw error;
      await bounded(() => new Promise<void>((resolve) => setTimeout(resolve, 250)), signal, 500, "Retry delay");
    }
  }
  throw new SavedAssetError("Saved asset attempts exhausted");
}

/** Each visible result is published independently. Secondary work cannot start early. */
export async function runSavedQueue<T>(
  visible: T[], secondary: T[], key: (item: T) => string,
  load: (item: T, signal: AbortSignal) => Promise<void>, signal: AbortSignal, concurrency = 3,
): Promise<void> {
  const seen = new Set<string>();
  const stage = async (items: T[]) => {
    const unique = items.filter((item) => {
      const id = key(item); if (seen.has(id)) return false; seen.add(id); return true;
    });
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), unique.length) }, async () => {
      while (!signal.aborted && cursor < unique.length) {
        const item = unique[cursor++];
        try { await load(item, signal); } catch { /* Per-item caller records terminal failure. */ }
      }
    }));
  };
  await stage(visible);
  if (!signal.aborted) await stage(secondary);
}

export function validRasterBounds(bounds: { north: number; south: number; east: number; west: number } | null | undefined): boolean {
  return !!bounds && Object.values(bounds).every(Number.isFinite)
    && bounds.north > bounds.south && bounds.east > bounds.west
    && bounds.north <= 90 && bounds.south >= -90 && bounds.east <= 180 && bounds.west >= -180;
}

export async function validatePng(blob: Blob): Promise<void> {
  if (blob.type && blob.type.split(";")[0] !== "image/png" && blob.type !== "application/octet-stream") {
    throw new SavedAssetError(`Expected PNG, received ${blob.type}`);
  }
  const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b)
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new SavedAssetError("Invalid or empty PNG bytes");
  const dimensions = new DataView(bytes.buffer);
  if (!dimensions.getUint32(16) || !dimensions.getUint32(20)) throw new SavedAssetError("PNG has zero dimensions");
}

export async function decodeSavedImage(url: string, signal: AbortSignal): Promise<void> {
  await bounded((child) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    const clean = () => { image.onload = null; image.onerror = null; child.removeEventListener("abort", cancel); };
    const cancel = () => { clean(); image.src = ""; reject(abortError()); };
    child.addEventListener("abort", cancel, { once: true });
    image.onload = () => {
      clean();
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve();
      else reject(new SavedAssetError("PNG decoded with zero dimensions"));
    };
    image.onerror = () => { clean(); reject(new SavedAssetError("Browser could not decode saved PNG")); };
    image.src = url;
  }), signal, 8_000, "PNG decode");
}

export class SavedObjectUrls {
  readonly urls = new Map<string, string>();
  replace(id: string, blob: Blob): string {
    this.remove(id);
    const url = URL.createObjectURL(blob); this.urls.set(id, url); return url;
  }
  remove(id: string): void {
    const url = this.urls.get(id); if (url) URL.revokeObjectURL(url); this.urls.delete(id);
  }
  clear(): void { for (const id of this.urls.keys()) this.remove(id); }
}