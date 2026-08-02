// Shared imagery grid + masking helpers for Crop Health Maps.
//
// Every raster VineTrack stores must live on ONE global pixel grid so that
// imagery for adjacent paddocks lines up exactly and never overlaps:
//   * CRS            : EPSG:3857 (Web Mercator — the CRS MapKit renders in)
//   * origin         : the EPSG:3857 origin (0, 0)
//   * pixel size     : a fixed metre value (10 m native, coarsened by whole
//                      power-of-two steps for very large paddocks)
//   * bbox           : snapped outward to whole multiples of the pixel size
//
// Two paddocks that touch therefore share identical pixel edges: there is no
// sub-pixel offset, no resampling difference and no stacking seam.
//
// After the provider returns the rectangular raster we apply the saved paddock
// polygon as a TRUE raster mask (scanline rasterisation into the alpha
// channel), so nothing outside the polygon is ever rendered.

import { decode as decodePng, encode as encodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";
import type { LatLng } from "./satellite-cdse.ts";

const EARTH_R = 6378137;
export const GRID_CRS = "EPSG:3857";
export const GRID_CRS_URI = "http://www.opengis.net/def/crs/EPSG/0/3857";

export function lngToMercX(lng: number): number {
  return (EARTH_R * lng * Math.PI) / 180;
}
export function latToMercY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return EARTH_R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}
export function mercXToLng(x: number): number {
  return (x / EARTH_R) * (180 / Math.PI);
}
export function mercYToLat(y: number): number {
  return (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
}

export interface AlignedGrid {
  /** Snapped bbox in EPSG:3857 metres: [west, south, east, north]. */
  bbox3857: [number, number, number, number];
  /** The same snapped bbox expressed in WGS84 degrees (for storage/display). */
  bboxWgs84: [number, number, number, number];
  bounds: { north: number; south: number; east: number; west: number };
  width: number;
  height: number;
  /** Metres per pixel actually used. */
  resolutionM: number;
  /** Metres per pixel that were REQUESTED (the product's native size). */
  baseResolutionM: number;
  /**
   * True when the requested resolution had to be coarsened to fit `maxPx`.
   * Analytical rasters pass `allowCoarsen: false` so this can never happen for
   * measurement data — the request fails loudly instead of silently losing
   * spatial resolution.
   */
  coarsened: boolean;
}

/**
 * Snap a WGS84 bbox onto the global EPSG:3857 grid.
 * `baseResM` is the desired metres/pixel. When `allowCoarsen` is true and the
 * raster would exceed `maxPx` on a side the resolution is doubled (keeping grid
 * alignment) until it fits. When false (analytical rasters) the exact native
 * pixel size is always preserved and the caller gets `coarsened: false` with
 * the true pixel dimensions — never a rounded-up cell size.
 */
export function alignBboxToGrid(
  bboxWgs84: [number, number, number, number],
  baseResM: number,
  maxPx: number,
  padPixels = 1,
  allowCoarsen = true,
): AlignedGrid {
  const [w, s, e, n] = bboxWgs84;
  const xMin = lngToMercX(w);
  const xMax = lngToMercX(e);
  const yMin = latToMercY(s);
  const yMax = latToMercY(n);

  let res = baseResM;
  for (let i = 0; i < 8; i++) {
    const west = Math.floor(xMin / res) * res - padPixels * res;
    const south = Math.floor(yMin / res) * res - padPixels * res;
    const east = Math.ceil(xMax / res) * res + padPixels * res;
    const north = Math.ceil(yMax / res) * res + padPixels * res;
    const width = Math.max(16, Math.round((east - west) / res));
    const height = Math.max(16, Math.round((north - south) / res));
    if (!allowCoarsen || (width <= maxPx && height <= maxPx) || i === 7) {
      return {
        bbox3857: [west, south, east, north],
        bboxWgs84: [mercXToLng(west), mercYToLat(south), mercXToLng(east), mercYToLat(north)],
        bounds: {
          west: mercXToLng(west),
          south: mercYToLat(south),
          east: mercXToLng(east),
          north: mercYToLat(north),
        },
        width,
        height,
        resolutionM: res,
        baseResolutionM: baseResM,
        coarsened: res !== baseResM,
      };
    }
    res *= 2;
  }
  // Unreachable — the loop always returns.
  throw new Error("grid_alignment_failed");
}


/**
 * Rasterise polygon rings into a per-pixel inside/outside mask using the
 * even-odd scanline rule (so interior holes are excluded automatically).
 * Rings are supplied in lat/lng and converted to the same EPSG:3857 grid the
 * raster was requested on, so mask and imagery are pixel-exact.
 */
export function rasterisePolygonMask(
  polys: LatLng[][][],
  grid: AlignedGrid,
): Uint8Array {
  const { width, height, bbox3857, resolutionM } = grid;
  const [west, , , north] = bbox3857;
  const mask = new Uint8Array(width * height);

  type Edge = { x0: number; y0: number; x1: number; y1: number };
  const edges: Edge[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map((p) => ({ x: lngToMercX(p.lng), y: latToMercY(p.lat) }));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a.y === b.y) continue;
        edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      }
    }
  }
  if (edges.length === 0) return mask;

  const xs: number[] = [];
  for (let row = 0; row < height; row++) {
    // Pixel-centre Y in EPSG:3857 metres (raster rows run north → south).
    const yc = north - (row + 0.5) * resolutionM;
    xs.length = 0;
    for (const ed of edges) {
      const yLo = Math.min(ed.y0, ed.y1);
      const yHi = Math.max(ed.y0, ed.y1);
      if (yc < yLo || yc >= yHi) continue;
      const t = (yc - ed.y0) / (ed.y1 - ed.y0);
      xs.push(ed.x0 + t * (ed.x1 - ed.x0));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = xs[i];
      const xEnd = xs[i + 1];
      let colStart = Math.ceil((xStart - west) / resolutionM - 0.5);
      let colEnd = Math.floor((xEnd - west) / resolutionM - 0.5);
      if (colEnd < 0 || colStart >= width) continue;
      if (colStart < 0) colStart = 0;
      if (colEnd >= width) colEnd = width - 1;
      const base = row * width;
      for (let c = colStart; c <= colEnd; c++) mask[base + c] = 1;
    }
  }
  return mask;
}

/**
 * Anti-aliased version of `rasterisePolygonMask`: returns per-pixel polygon
 * COVERAGE in 0..255 instead of a hard 0/1 mask. Each raster row is sampled at
 * `subRows` sub-scanlines and horizontal spans contribute fractional coverage
 * to the partially-covered end pixels, so paddock edges render as a clean line
 * rather than a staircase. Interior pixels are still exactly 255 and pixels
 * fully outside are exactly 0 — boundaries stay precise and adjacent paddocks
 * never overlap because both sides use the identical shared grid.
 */
export function rasterisePolygonCoverage(
  polys: LatLng[][][],
  grid: AlignedGrid,
  subRows = 4,
): Uint8Array {
  const { width, height, bbox3857, resolutionM } = grid;
  const [west, , , north] = bbox3857;
  const acc = new Float32Array(width * height);
  const out = new Uint8Array(width * height);

  type Edge = { x0: number; y0: number; x1: number; y1: number };
  const edges: Edge[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map((p) => ({ x: lngToMercX(p.lng), y: latToMercY(p.lat) }));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a.y === b.y) continue;
        edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      }
    }
  }
  if (edges.length === 0) return out;

  const weight = 1 / subRows;
  const xs: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let sr = 0; sr < subRows; sr++) {
      const yc = north - (row + (sr + 0.5) / subRows) * resolutionM;
      xs.length = 0;
      for (const ed of edges) {
        const yLo = Math.min(ed.y0, ed.y1);
        const yHi = Math.max(ed.y0, ed.y1);
        if (yc < yLo || yc >= yHi) continue;
        const t = (yc - ed.y0) / (ed.y1 - ed.y0);
        xs.push(ed.x0 + t * (ed.x1 - ed.x0));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const base = row * width;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        // Span in fractional pixel columns.
        let sx = (xs[i] - west) / resolutionM;
        let ex = (xs[i + 1] - west) / resolutionM;
        if (ex <= 0 || sx >= width) continue;
        if (sx < 0) sx = 0;
        if (ex > width) ex = width;
        const first = Math.floor(sx);
        const last = Math.min(width - 1, Math.ceil(ex) - 1);
        for (let c = first; c <= last; c++) {
          const covered = Math.min(ex, c + 1) - Math.max(sx, c);
          if (covered > 0) acc[base + c] += covered * weight;
        }
      }
    }
  }

  for (let i = 0; i < acc.length; i++) {
    const v = acc[i];
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * Apply an anti-aliased coverage mask (0..255) to an RGBA PNG by multiplying
 * the existing alpha channel. Pixels fully outside the polygon become fully
 * transparent; edge pixels fade proportionally to their true coverage.
 */
export function maskPngToPolygonSoft(
  pngBytes: Uint8Array,
  coverage: Uint8Array,
  grid: AlignedGrid,
): Uint8Array {
  const img = decodePng(pngBytes);
  const { width, height } = img;
  const out = new Uint8Array(img.image);
  const sameSize = width === grid.width && height === grid.height;
  for (let y = 0; y < height; y++) {
    const my = sameSize ? y : Math.min(grid.height - 1, Math.floor((y / height) * grid.height));
    for (let x = 0; x < width; x++) {
      const mx = sameSize ? x : Math.min(grid.width - 1, Math.floor((x / width) * grid.width));
      const cov = coverage[my * grid.width + mx];
      const o = (y * width + x) * 4 + 3;
      out[o] = cov === 255 ? out[o] : Math.round((out[o] * cov) / 255);
    }
  }
  return encodePng(out, width, height);
}

/** Fraction of grid pixels that fall inside the polygon (0..1). */
export function maskCoverage(mask: Uint8Array): number {
  let inside = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) inside++;
  return mask.length ? inside / mask.length : 0;
}

/**
 * Apply the polygon mask to an RGBA PNG: every pixel outside the polygon is
 * written as fully transparent, and the result is re-encoded as PNG. This is a
 * true raster mask — the rectangular provider bounds are never rendered.
 */
export function maskPngToPolygon(
  pngBytes: Uint8Array,
  mask: Uint8Array,
  grid: AlignedGrid,
): Uint8Array {
  const img = decodePng(pngBytes);
  const { width, height } = img;
  if (width !== grid.width || height !== grid.height) {
    // Provider returned a different size than requested — mask by ratio rather
    // than failing, so imagery still renders clipped.
    const out = new Uint8Array(img.image);
    for (let y = 0; y < height; y++) {
      const my = Math.min(grid.height - 1, Math.floor((y / height) * grid.height));
      for (let x = 0; x < width; x++) {
        const mx = Math.min(grid.width - 1, Math.floor((x / width) * grid.width));
        if (!mask[my * grid.width + mx]) out[(y * width + x) * 4 + 3] = 0;
      }
    }
    return encodePng(out, width, height);
  }
  const out = new Uint8Array(img.image);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) out[i * 4 + 3] = 0;
  }
  return encodePng(out, width, height);
}

/**
 * Apply the polygon mask to a single-band Float32 analytical raster by writing
 * the no-data sentinel outside the polygon. Operates on the raw pixel buffer
 * only when the buffer length matches the grid; otherwise it is a no-op.
 */
export function maskFloat32Grid(
  values: Float32Array,
  mask: Uint8Array,
  noDataSentinel: number,
): void {
  if (values.length !== mask.length) return;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) values[i] = noDataSentinel;
}
