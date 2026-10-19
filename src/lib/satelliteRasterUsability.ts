// Saved-raster "usable imagery" gate for Crop Health Maps.
//
// A stored asset row plus a valid PNG/TIFF header is NOT proof of imagery.
// Production evidence (19 Oct 2026): every Stockman's Ridge 1 Aug display PNG
// decoded to 100% alpha=0 pixels and every NDVI analysis TIFF to 100% -9999
// cells. This module decodes the real bytes and classifies them so the page
// never reports such a date as downloaded / image-available.
//
// Pure and deterministic: no fetching, no React, no DOM.

import { decode } from "fast-png";
import { SavedAssetError } from "./satelliteSavedLoader";

export const VERIFIED_NATIVE_VERSION = "sentinel2-v7-exact-native-pilot";

/**
 * verified — real visible pixels, record dimensions match, native 10 m UTM
 *            grid and acquisition-linked processing version.
 * legacy   — real visible pixels and matching dimensions, but produced by an
 *            older pipeline without native-grid / exact-source verification.
 * blank    — stored and decodable, but contains no meaningful pixels.
 * invalid  — bytes undecodable or contradict the asset record.
 */
export type RasterVerdictKind = "verified" | "legacy" | "blank" | "invalid";

export interface RasterVerdict {
  kind: RasterVerdictKind;
  message: string;
}

export class UnusableRasterError extends SavedAssetError {
  constructor(public readonly kind: "blank" | "invalid", message: string) {
    super(message);
    this.name = "UnusableRasterError";
  }
}

export interface DisplayInspection {
  width: number;
  height: number;
  totalPixels: number;
  /** alpha > 0 */
  visiblePixels: number;
  transparentPixels: number;
  distinctVisibleColours: number;
}

export function inspectDisplayPng(bytes: Uint8Array): DisplayInspection {
  let img: ReturnType<typeof decode>;
  try {
    img = decode(bytes);
  } catch (e) {
    throw new UnusableRasterError("invalid", `Saved PNG could not be decoded (${(e as Error)?.message ?? "unknown"})`);
  }
  const { width, height, channels } = img;
  const data = img.data as ArrayLike<number>;
  const total = width * height;
  if (!width || !height || data.length < total * channels) {
    throw new UnusableRasterError("invalid", "Saved PNG has no pixel data");
  }
  const hasAlpha = channels === 4 || channels === 2;
  const maxA = img.depth === 16 ? 65535 : 255;
  let visible = 0;
  const colours = new Set<number>();
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const a = hasAlpha ? data[o + channels - 1] : maxA;
    if (a > 0) {
      visible++;
      if (colours.size < 4096) {
        colours.add(channels >= 3 ? data[o] * 65536 + data[o + 1] * 256 + data[o + 2] : data[o]);
      }
    }
  }
  return {
    width, height, totalPixels: total, visiblePixels: visible,
    transparentPixels: total - visible, distinctVisibleColours: colours.size,
  };
}

export interface AnalyticalInspection {
  width: number;
  height: number;
  cells: number;
  validCells: number;
  noDataCells: number;
  nanCells: number;
  outOfRangeCells: number;
  min: number | null;
  max: number | null;
}

/** Range only enforced for indices with a hard physical range. */
export function analyticalRangeFor(index: string): [number, number] | null {
  return index === "NDVI" ? [-1, 1] : null;
}

export function inspectAnalyticalValues(
  values: ArrayLike<number>, width: number, height: number,
  noData: number | null, range: [number, number] | null,
): AnalyticalInspection {
  let valid = 0, nod = 0, nan = 0, oor = 0;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) { nan++; continue; }
    if (noData != null && v === noData) { nod++; continue; }
    if (!Number.isFinite(v) || (range && (v < range[0] || v > range[1]))) { oor++; continue; }
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    width, height, cells: values.length, validCells: valid, noDataCells: nod,
    nanCells: nan, outOfRangeCells: oor,
    min: valid ? min : null, max: valid ? max : null,
  };
}

interface Expect {
  width?: number | null;
  height?: number | null;
  processingVersion?: string | null;
}

function dimsMismatch(w: number, h: number, e: Expect): string | null {
  if (e.width != null && e.height != null && (e.width !== w || e.height !== h)) {
    return `Saved bytes are ${w}×${h} px but the record says ${e.width}×${e.height} px`;
  }
  return null;
}

export function judgeDisplay(i: DisplayInspection, e: Expect): RasterVerdict {
  const mismatch = dimsMismatch(i.width, i.height, e);
  if (mismatch) return { kind: "invalid", message: mismatch };
  if (i.visiblePixels === 0) {
    return {
      kind: "blank",
      message: `Saved image is fully transparent (0 of ${i.totalPixels} pixels visible)`,
    };
  }
  if (e.processingVersion === VERIFIED_NATIVE_VERSION) {
    return { kind: "verified", message: `${i.visiblePixels} of ${i.totalPixels} pixels visible` };
  }
  return {
    kind: "legacy",
    message: `${i.visiblePixels} of ${i.totalPixels} pixels visible · older pipeline, native grid not verified`,
  };
}

export interface NativeGridInfo {
  epsg: number;
  resolution: number[];
}

export function isNativeUtm10m(g: NativeGridInfo | null | undefined): boolean {
  if (!g) return false;
  const utm = (g.epsg >= 32601 && g.epsg <= 32660) || (g.epsg >= 32701 && g.epsg <= 32760);
  return utm && Math.abs(Math.abs(g.resolution[0]) - 10) < 1e-6 && Math.abs(Math.abs(g.resolution[1]) - 10) < 1e-6;
}

export function judgeAnalytical(
  i: AnalyticalInspection, e: Expect & { grid?: NativeGridInfo | null },
): RasterVerdict {
  const mismatch = dimsMismatch(i.width, i.height, e);
  if (mismatch) return { kind: "invalid", message: mismatch };
  if (i.cells !== i.width * i.height) {
    return { kind: "invalid", message: `Analysis file has ${i.cells} cells for a ${i.width}×${i.height} grid` };
  }
  if (i.validCells === 0) {
    return {
      kind: "blank",
      message: `Saved analysis file has no valid cells (${i.noDataCells} no-data, ${i.nanCells} NaN, ${i.outOfRangeCells} out of range)`,
    };
  }
  if (e.processingVersion === VERIFIED_NATIVE_VERSION) {
    if (!isNativeUtm10m(e.grid)) {
      return { kind: "invalid", message: "Analysis file is not on the native 10 m UTM grid" };
    }
    return { kind: "verified", message: `${i.validCells} of ${i.cells} cells valid` };
  }
  return { kind: "legacy", message: `${i.validCells} of ${i.cells} cells valid · older pipeline grid` };
}

export function isUsableVerdict(kind: RasterVerdictKind | null | undefined): boolean {
  return kind === "verified" || kind === "legacy";
}

// ---------- Timeline gating ----------

export interface VerdictTimelineEntry {
  date: string;
  status: string;
  paddockCount: number;
  activeCount: number;
  coveragePercent: number;
  note?: string | null;
}

/**
 * Re-derive saved-date coverage from decoded verdicts. Dates whose display
 * assets have not yet been byte-checked keep the server count but are noted
 * as unverified. A date is "available" only when every scoped paddock has a
 * usable image; a date whose checked images are all blank/invalid becomes
 * "stored_blank" — never "available".
 */
export function applyRasterVerdicts<T extends VerdictTimelineEntry>(
  entries: T[],
  displayAssetIdsForDate: (date: string) => string[],
  verdicts: ReadonlyMap<string, RasterVerdict>,
): T[] {
  return entries.map((entry) => {
    if (entry.status !== "available" && entry.status !== "partial") return entry;
    const ids = displayAssetIdsForDate(entry.date);
    if (ids.length === 0) return entry;
    let usable = 0, blank = 0, invalid = 0, unchecked = 0, legacy = 0;
    for (const id of ids) {
      const v = verdicts.get(id);
      if (!v) unchecked++;
      else if (v.kind === "blank") blank++;
      else if (v.kind === "invalid") invalid++;
      else { usable++; if (v.kind === "legacy") legacy++; }
    }
    if (blank + invalid === 0) {
      if (unchecked > 0) return { ...entry, note: entry.note ?? `${unchecked} saved image(s) not yet checked` };
      return legacy > 0 ? { ...entry, note: entry.note ?? "Older processing · native grid not verified" } : entry;
    }
    const known = usable + blank + invalid;
    const paddockCount = usable + unchecked;
    const status = unchecked === 0 && usable === 0
      ? "stored_blank"
      : paddockCount >= entry.activeCount && unchecked === 0 ? "available" : "partial";
    const parts = [
      blank ? `${blank} saved blank` : null,
      invalid ? `${invalid} saved invalid` : null,
      unchecked ? `${unchecked} not yet checked` : null,
    ].filter(Boolean);
    return {
      ...entry,
      status,
      paddockCount: usable,
      coveragePercent: entry.activeCount > 0 ? Math.round((usable / entry.activeCount) * 1000) / 10 : 0,
      note: `${usable} of ${known + unchecked} usable · ${parts.join(" · ")}`,
    } as T;
  });
}
