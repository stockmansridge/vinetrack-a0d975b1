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
  /** Metres per pixel actually used (always a power-of-two multiple of base). */
  resolutionM: number;
}

/**
 * Snap a WGS84 bbox onto the global EPSG:3857 grid.
 * `baseResM` is the desired metres/pixel; if the resulting raster would exceed
 * `maxPx` on a side the resolution is doubled (keeping grid alignment) until it
 * fits — never scaled by an arbitrary factor, which would break alignment.
 */
export function alignBboxToGrid(
  bboxWgs84: [number, number, number, number],
  baseResM: number,
  maxPx: number,
  padPixels = 1,
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
    if ((width <= maxPx && height <= maxPx) || i === 7) {
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
