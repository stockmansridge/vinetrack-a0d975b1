// Provider-independent primitives. No network, credentials or legacy writes.
export const PILOT_VINEYARD = "fe952afe-437f-4be7-8cbf-fdd8e630411c";
export const PILOT_VERSION = "sentinel2-v7-exact-native-pilot";
export type PilotLayer = "NDVI" | "TRUE_COLOUR";
export function retryAfterMs(header: string | null, now = Date.now(), cap = 86_400_000): number | null {
  if (!header?.trim()) return null;
  const text = header.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.min(cap, Math.ceil(Number(text)));
  // Numeric negatives/NaN must not accidentally be parsed as calendar dates.
  if (!/[A-Za-z]{3}/.test(text)) return null;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.min(cap, Math.max(0, date - now)) : null;
}
export interface NativeGrid { crs: string; affine: number[]; width: number; height: number; }
export function validateNativeGrid(grid: NativeGrid): void {
  if (!/^EPSG:32[67]\d\d$/.test(grid.crs) || grid.affine.length !== 6 || !grid.affine.every(Number.isFinite)
    || grid.affine[0] !== 10 || grid.affine[1] !== 0 || grid.affine[3] !== 0 || grid.affine[4] !== -10
    || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1
    || grid.width * grid.height > 262144) throw new Error("Unsupported native 10m grid or raster size");
}
export interface SourceBand { item_id: string; href: string; scale: number; offset: number; resolution: number; }
export interface ExactManifest {
  schema_version: 1; item_id: string; collection: string; acquired_at: string;
  baseline: string; cloud_mask_method: "SCL"; bands: Record<string, SourceBand>;
  product_id?: string; cloud_cover?: number; native_grid?: NativeGrid; scl_grid?: NativeGrid; footprint?: number[][];
}
export function validateExactManifest(manifest: ExactManifest, layer: PilotLayer): void {
  if (manifest.schema_version !== 1 || !manifest.item_id || !manifest.collection || !Number.isFinite(Date.parse(manifest.acquired_at))
    || !manifest.baseline || manifest.cloud_mask_method !== "SCL") throw new Error("Incomplete acquisition proof");
  for (const band of layer === "NDVI" ? ["red", "nir", "scl"] : ["red", "green", "blue", "scl"]) {
    const asset = manifest.bands[band];
    if (!asset || asset.item_id !== manifest.item_id || !Number.isFinite(asset.scale) || !Number.isFinite(asset.offset)
      || asset.scale <= 0 || asset.resolution !== (band === "scl" ? 20 : 10)) throw new Error("Source identity/calibration/resolution mismatch");
    const u = new URL(asset.href);
    if (u.protocol !== "https:" || u.hostname !== "sentinel-cogs.s3.us-west-2.amazonaws.com" || u.username || u.password || u.search || u.hash
      || !u.pathname.endsWith(".tif")) throw new Error("Unapproved exact-band source");
  }
}
export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function insidePolygon(x: number, y: number, rings: number[][][]): boolean {
  return rings.length > 0 && pointInRing(x, y, rings[0]) && !rings.slice(1).some((r) => pointInRing(x, y, r));
}
export function validScl(scl: number): boolean { return [4, 5, 6].includes(scl); }
// Deterministic acquisition-quality failure: never retried for the same immutable acquisition/paddock.
export class TerminalQualityError extends Error {
  constructor(public readonly quality: "cloud_obscured" | "insufficient_coverage", public readonly sclHistogram: Record<string, number>, message: string) { super(message); }
}
// Below this share of usable inside-paddock pixels a raster is reported as insufficient coverage, not published.
export const MIN_VALID_COVERAGE_PERCENT = 10;
export function summary(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const percentile = (q: number) => { const p = (n - 1) * q, i = Math.floor(p); return sorted[i] + (sorted[Math.ceil(p)] - sorted[i]) * (p - i); };
  return { valid_pixel_count: n, mean_value: mean, median_value: percentile(.5), minimum_value: sorted[0], maximum_value: sorted[n - 1],
    standard_deviation: Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n),
    percentile_10: percentile(.1), percentile_25: percentile(.25), percentile_75: percentile(.75), percentile_90: percentile(.9) };
}
export function processNativePixels(input: { grid: NativeGrid; layer: PilotLayer; red: number[]; nir?: number[]; green?: number[]; blue?: number[];
  scl: number[]; inside: boolean[]; scales: Record<string, { scale: number; offset: number }>; noData: number; }) {
  validateNativeGrid(input.grid);
  const size = input.grid.width * input.grid.height, bands = input.layer === "NDVI" ? ["red", "nir"] : ["red", "green", "blue"];
  const arrays: Record<string, number[] | undefined> = { red: input.red, nir: input.nir, green: input.green, blue: input.blue };
  if (input.inside.length !== size || input.scl.length !== size || bands.some((b) => arrays[b]?.length !== size || !input.scales[b]
    || !Number.isFinite(input.scales[b].scale) || input.scales[b].scale <= 0 || !Number.isFinite(input.scales[b].offset))) throw new Error("Band/grid/calibration mismatch");
  const analytical = new Float32Array(size).fill(-9999), rgba = new Uint8Array(size * 4), values: number[] = [];
  let paddock = 0, cloudy = 0;
  for (let i = 0; i < size; i++) {
    if (!input.inside[i]) continue;
    paddock++;
    if ([3, 8, 9, 10].includes(input.scl[i])) cloudy++;
    if (!validScl(input.scl[i])) continue;
    const reflectance = bands.map((b) => { const raw = arrays[b]?.[i]; return raw == null || raw === input.noData || !Number.isFinite(raw) ? NaN : raw * input.scales[b].scale + input.scales[b].offset; });
    if (reflectance.some((v) => !Number.isFinite(v) || v < 0 || v > 1.5)) continue;
    if (input.layer === "NDVI") {
      const denom = reflectance[0] + reflectance[1]; if (denom <= 0) continue;
      const v = (reflectance[1] - reflectance[0]) / denom; analytical[i] = v; values.push(analytical[i]);
      const t = (v + 1) / 2; rgba.set([Math.round(255 * (1 - t)), Math.round(255 * t), 40, 255], i * 4);
    } else {
      rgba.set([...reflectance.map((v) => Math.round(255 * Math.min(1, Math.max(0, v / .3)))), 255], i * 4);
      values.push(reflectance[0]);
    }
  }
  return { analytical, rgba, summary: input.layer === "NDVI" ? summary(values) : null, valid_pixel_count: values.length,
    paddock_pixel_count: paddock, cloud_percent: paddock ? 100 * cloudy / paddock : null,
    valid_coverage_percent: paddock ? 100 * values.length / paddock : null };
}