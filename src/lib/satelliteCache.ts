// Tiny IndexedDB-backed cache for the crop-health page.
//
// Two logical stores:
//   - manifest       : keyed by `crop-health-manifest:{vineyardId}`
//                      value = { manifest, cachedAt }
//   - asset-blob     : keyed by `crop-health-asset:{assetId}:{processingVersion}`
//                      value = { blob, contentType, etag, cachedAt }
//
// No external dependency — hand-rolled wrapper. Safe in browsers without
// IndexedDB (all methods degrade to no-op / null).

import type { ManifestResponse } from "./satelliteManifest";

const DB_NAME = "vinetrack-crop-health";
const DB_VERSION = 1;
const MANIFEST_STORE = "manifest";
const ASSET_STORE = "asset-blob";

interface CachedManifest {
  key: string;
  manifest: ManifestResponse;
  cachedAt: string;
}
interface CachedAssetBlob {
  key: string;
  blob: Blob;
  contentType: string | null;
  etag: string;
  cachedAt: string;
}

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIdb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
        db.createObjectStore(MANIFEST_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store);
        if (result instanceof Promise) {
          result.then((v) => resolve(v)).catch(() => resolve(null));
        } else {
          result.onsuccess = () => resolve(result.result as T);
          result.onerror = () => resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}

// ---- Manifest ----
export async function readCachedManifest(vineyardId: string): Promise<ManifestResponse | null> {
  const key = `crop-health-manifest:${vineyardId}`;
  const row = await withStore<CachedManifest>(MANIFEST_STORE, "readonly", (s) => s.get(key));
  return row?.manifest ?? null;
}

export async function writeCachedManifest(vineyardId: string, manifest: ManifestResponse): Promise<void> {
  const key = `crop-health-manifest:${vineyardId}`;
  const value: CachedManifest = { key, manifest, cachedAt: new Date().toISOString() };
  await withStore(MANIFEST_STORE, "readwrite", (s) => s.put(value));
}

// ---- Asset blobs ----
function assetKey(assetId: string, processingVersion: string | null): string {
  return `crop-health-asset:${assetId}:${processingVersion ?? "unknown"}`;
}

export async function readCachedAsset(
  assetId: string,
  processingVersion: string | null,
): Promise<CachedAssetBlob | null> {
  const key = assetKey(assetId, processingVersion);
  const row = await withStore<CachedAssetBlob>(ASSET_STORE, "readonly", (s) => s.get(key));
  return row ?? null;
}

export async function writeCachedAsset(
  assetId: string,
  processingVersion: string | null,
  etag: string,
  blob: Blob,
  contentType: string | null,
): Promise<void> {
  const key = assetKey(assetId, processingVersion);
  const value: CachedAssetBlob = {
    key,
    blob,
    contentType,
    etag,
    cachedAt: new Date().toISOString(),
  };
  await withStore(ASSET_STORE, "readwrite", (s) => s.put(value));
}

export async function deleteCachedAsset(
  assetId: string,
  processingVersion: string | null,
): Promise<void> {
  const key = assetKey(assetId, processingVersion);
  await withStore(ASSET_STORE, "readwrite", (s) => s.delete(key));
}

/** Fetch an asset via cache-first with HTTP 304 revalidation.
 *
 * Order of operations:
 *   1. IndexedDB probe by (assetId, processingVersion) -> hit returns blob
 *      with zero network. Callers should probe first via `readCachedAsset` if
 *      they want the cachedAt/etag timestamp before spinning up the fetch.
 *   2. Miss: call `fetchBytes(ifNoneMatch)` — the stable authenticated asset
 *      endpoint returns 200 with bytes (immutable Cache-Control) OR 304 if
 *      the browser already has a matching HTTP cache entry.
 */
export interface FetchBytesResult {
  status: 200 | 304;
  blob: Blob | null;
  etag: string | null;
  contentType: string | null;
}

export async function getAssetBlob(
  assetId: string,
  processingVersion: string | null,
  fetchBytes: (ifNoneMatch: string | null) => Promise<FetchBytesResult>,
): Promise<Blob | null> {
  const cached = await readCachedAsset(assetId, processingVersion);
  if (cached) return cached.blob;
  try {
    const result = await fetchBytes(null);
    if (result.status === 304 || !result.blob) return null;
    await writeCachedAsset(
      assetId,
      processingVersion,
      result.etag ?? `${assetId}:${processingVersion ?? "unknown"}`,
      result.blob,
      result.contentType,
    );
    return result.blob;
  } catch {
    return null;
  }
}

