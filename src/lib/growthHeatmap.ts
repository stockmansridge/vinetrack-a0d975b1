// Ripeness Heatmap — pure, deterministic logic.
//
// Derived reporting only. Reads existing Growth Stage observations
// (see `growthStageRecordsQuery.ts`) and existing block polygons
// (`paddocks.polygon_points`). No writes, no new data sources.
//
// Documented rules (single source of truth for the Portal):
//  * EL scale is FIXED at EL 1 → EL 43. Colours never rescale to the data.
//  * An observation qualifies for a timeline date D when it is not
//    soft-deleted, has a parseable EL stage in [1, 43], has valid GPS and
//    its OBSERVATION timestamp (not updated_at) is on or before D.
//  * Recency: weight = 0.5 ^ (ageDays / RECENCY_HALF_LIFE_DAYS), tapered to
//    exactly 0 at RECENCY_MAX_AGE_DAYS. An observation older than that has
//    ZERO influence on the heat surface — it stays visible as a recorded
//    historical pin (rendered as stale) but never implies live coverage.
//  * Blocks are interpolated independently and clipped to their polygon.

import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";
import type { LatLng } from "@/lib/paddockGeometry";

export const EL_MIN = 1;
export const EL_MAX = 43;
export const RECENCY_HALF_LIFE_DAYS = 21;
/** Beyond this age an observation has zero heat-surface influence. */
export const RECENCY_MAX_AGE_DAYS = 84;
/** Final linear taper window so influence reaches zero smoothly. */
export const RECENCY_TAPER_DAYS = 14;
/** Inverse-distance weighting exponent. */
export const IDW_POWER = 2;


export type RGB = { r: number; g: number; b: number };

/** Fixed EL colour scale — identical for every vineyard, block and vintage. */
export const EL_COLOUR_STOPS: { el: number; rgb: RGB; label: string }[] = [
  { el: 1, rgb: { r: 220, g: 38, b: 38 }, label: "EL 1 — dormant" },
  { el: 12, rgb: { r: 234, g: 129, b: 24 }, label: "EL 12 — early development" },
  { el: 23, rgb: { r: 234, g: 199, b: 24 }, label: "EL 23 — mid-season" },
  { el: 35, rgb: { r: 132, g: 204, b: 22 }, label: "EL 35 — advanced" },
  { el: 43, rgb: { r: 22, g: 143, b: 60 }, label: "EL 43 — harvest ripe" },
];

/**
 * Parse a stored growth stage code into a numeric EL value.
 * Accepts "23", "EL23", "E-L 23", "e l 23". Returns null for anything
 * missing, non-numeric or outside EL 1–43 — NEVER 0 and never EL 1.
 */
export function parseElStage(code: unknown): number | null {
  if (code == null) return null;
  const s = String(code).trim();
  if (!s) return null;
  const cleaned = s.replace(/^e\s*-?\s*l\s*/i, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n < EL_MIN || n > EL_MAX) return null;
  return n;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Fixed-scale EL → colour. Clamped to EL 1–43, smoothly interpolated. */
export function elColour(el: number): RGB {
  const v = clamp(el, EL_MIN, EL_MAX);
  const stops = EL_COLOUR_STOPS;
  if (v <= stops[0].el) return { ...stops[0].rgb };
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (v <= cur.el) {
      const t = (v - prev.el) / (cur.el - prev.el);
      return {
        r: mix(prev.rgb.r, cur.rgb.r, t),
        g: mix(prev.rgb.g, cur.rgb.g, t),
        b: mix(prev.rgb.b, cur.rgb.b, t),
      };
    }
  }
  return { ...stops[stops.length - 1].rgb };
}

export const rgbCss = (c: RGB) => `rgb(${c.r}, ${c.g}, ${c.b})`;
export const elColourCss = (el: number) => rgbCss(elColour(el));

// ---------------------------------------------------------------- observations

export interface HeatObservation {
  id: string;
  paddockId: string | null;
  /** true only when the canonical placement says the record is assigned. */
  assigned: boolean;
  el: number;
  lat: number;
  lng: number;
  /** ISO observation timestamp (date/completed_at/created_at, never updated_at). */
  dateISO: string;
  record: GrowthStageRecord;
}

const validLat = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90 && n !== 0;
const validLng = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180 && n !== 0;

/** Observation timestamp — explicitly NOT `updated_at`. */
export function observationDate(r: GrowthStageRecord): string | null {
  return r.date ?? r.completed_at ?? r.created_at ?? null;
}

export interface ToObservationOptions {
  /** pin_id → canonical assignment. Absent entry = treat record's own block. */
  assignedById?: Map<string, boolean>;
}

/**
 * Normalise raw records into heat observations. Drops soft-deleted rows,
 * rows without a usable EL stage, and rows without valid coordinates.
 */
export function toObservations(
  records: GrowthStageRecord[],
  opts: ToObservationOptions = {},
): HeatObservation[] {
  const out: HeatObservation[] = [];
  for (const r of records) {
    if ((r as any).deleted_at) continue;
    const el = parseElStage(r.growth_stage_code);
    if (el == null) continue;
    const lat = r.latitude;
    const lng = r.longitude;
    if (!validLat(lat) || !validLng(lng)) continue;
    const dateISO = observationDate(r);
    if (!dateISO) continue;
    const explicit = opts.assignedById?.get(r.id);
    const assigned = explicit === undefined ? !!r.paddock_id : explicit && !!r.paddock_id;
    out.push({
      id: r.id,
      paddockId: assigned ? r.paddock_id ?? null : null,
      assigned,
      el,
      lat,
      lng,
      dateISO,
      record: r,
    });
  }
  return out;
}

const dayKey = (iso: string) => String(iso).slice(0, 10);

/** Filter to the vintage season window [startISO, endISO] inclusive of days. */
export function filterToVintage(
  obs: HeatObservation[],
  startISO: string,
  endISO: string,
): HeatObservation[] {
  const s = dayKey(startISO);
  const e = dayKey(endISO);
  return obs.filter((o) => {
    const d = dayKey(o.dateISO);
    return d >= s && d <= e;
  });
}

/** Observations on or before the timeline date. Future never leaks backwards. */
export function qualifyingAt(obs: HeatObservation[], dateISO: string): HeatObservation[] {
  const d = dayKey(dateISO);
  return obs.filter((o) => dayKey(o.dateISO) <= d);
}

/** Distinct recorded observation days, ascending — used to snap the slider. */
export function observationDays(obs: HeatObservation[]): string[] {
  return Array.from(new Set(obs.map((o) => dayKey(o.dateISO)))).sort();
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${dayKey(fromISO)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(toISO)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Documented deterministic recency rule.
 *  age 0            → 1 (full influence on the observation date)
 *  age 21 (1 half-life) → 0.5, decaying exponentially thereafter
 *  age >= 84        → 0 (no influence on the heat surface at all)
 * The final 14 days before the cut-off taper linearly so influence reaches
 * zero smoothly rather than stepping off a cliff.
 */
export function recencyWeight(ageDays: number): number {
  const age = Math.max(0, ageDays);
  if (age >= RECENCY_MAX_AGE_DAYS) return 0;
  const decay = Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS);
  const taper = clamp((RECENCY_MAX_AGE_DAYS - age) / RECENCY_TAPER_DAYS, 0, 1);
  return decay * taper;
}

/** True when the observation still influences the heat surface at `atDateISO`. */
export function isInfluencing(obs: HeatObservation, atDateISO: string): boolean {
  const age = daysBetween(obs.dateISO, atDateISO);
  return age >= 0 && recencyWeight(age) > 0;
}

/** Split qualifying observations into those still driving the surface and stale ones. */
export function partitionByInfluence(obs: HeatObservation[], atDateISO: string) {
  const influencing: HeatObservation[] = [];
  const stale: HeatObservation[] = [];
  for (const o of obs) (isInfluencing(o, atDateISO) ? influencing : stale).push(o);
  return { influencing, stale };
}


/** "Typical recorded stage" — median of the qualifying RECORDED observations. */
export function medianStage(obs: HeatObservation[]): number | null {
  if (!obs.length) return null;
  const v = obs.map((o) => o.el).sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------------------------------------------------------------- geometry

export function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat, xi = poly[i].lng;
    const yj = poly[j].lat, xj = poly[j].lng;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: LatLng[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of poly) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

// ---------------------------------------------------------------- block model

export type BlockHeatMode = "none" | "stale" | "halo" | "gradient" | "surface" | "no_polygon";

export interface BlockHeat {
  paddockId: string;
  paddockName: string;
  polygon: LatLng[];
  /** Every qualifying observation on or before the date (incl. stale ones). */
  observations: HeatObservation[];
  /** Subset still influencing the heat surface (age < RECENCY_MAX_AGE_DAYS). */
  influencing: HeatObservation[];
  /** Qualifying but too old to influence the surface — shown as stale pins. */
  stale: HeatObservation[];
  mode: BlockHeatMode;
  /** Median EL of this block's influencing observations. */
  medianEl: number | null;
  /** Grid of interpolated EL values (null = outside polygon). */
  grid: (number | null)[][] | null;
  /** Matching recency weight per cell, for opacity. */
  weightGrid: (number | null)[][] | null;
  gridBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
}

export function blockHeatMode(
  count: number,
  hasPolygon: boolean,
  totalObservations = count,
): BlockHeatMode {
  if (!hasPolygon) return "no_polygon";
  if (count <= 0) return totalObservations > 0 ? "stale" : "none";
  if (count === 1) return "halo";
  if (count === 2) return "gradient";
  return "surface";
}

export interface BuildBlockHeatInput {
  paddockId: string;
  paddockName: string;
  polygon: LatLng[];
  observations: HeatObservation[];
  /** Timeline date, used for the recency rule. */
  atDateISO: string;
  /** Grid resolution per axis. */
  resolution?: number;
}

/**
 * Interpolate one block, independently of every other block. Only this
 * block's own observations are ever passed in, so colour can never bleed
 * across a shared boundary, a road or the vineyard edge.
 */
export function buildBlockHeat(input: BuildBlockHeatInput): BlockHeat {
  const { paddockId, paddockName, polygon, observations, atDateISO } = input;
  const resolution = input.resolution ?? 48;
  const hasPolygon = polygon.length >= 3;
  const { influencing, stale } = partitionByInfluence(observations, atDateISO);
  const mode = blockHeatMode(influencing.length, hasPolygon, observations.length);
  const base: BlockHeat = {
    paddockId,
    paddockName,
    polygon,
    observations,
    influencing,
    stale,
    mode,
    medianEl: medianStage(influencing),
    grid: null,
    weightGrid: null,
    gridBounds: null,
  };
  if (!hasPolygon || influencing.length === 0) return base;

  const b = polygonBounds(polygon);
  const grid: (number | null)[][] = [];
  const weightGrid: (number | null)[][] = [];
  const latStep = (b.maxLat - b.minLat) / (resolution - 1);
  const lngStep = (b.maxLng - b.minLng) / (resolution - 1);

  const pts = influencing.map((o) => ({
    lat: o.lat,
    lng: o.lng,
    el: o.el,
    w: recencyWeight(daysBetween(o.dateISO, atDateISO)),
  }));


  // Sparse data must not fabricate coverage: a single observation renders a
  // localised halo, two observations a localised gradient between them.
  const diag = Math.sqrt(
    Math.pow(b.maxLat - b.minLat, 2) + Math.pow((b.maxLng - b.minLng) * Math.cos((b.minLat * Math.PI) / 180), 2),
  );
  const maxInfluence =
    mode === "halo" ? diag * 0.22 : mode === "gradient" ? diag * 0.35 : Infinity;

  for (let i = 0; i < resolution; i++) {

    const lat = b.minLat + latStep * i;
    const rowVals: (number | null)[] = [];
    const rowW: (number | null)[] = [];
    for (let j = 0; j < resolution; j++) {
      const lng = b.minLng + lngStep * j;
      if (!pointInPolygon({ lat, lng }, polygon)) {
        rowVals.push(null);
        rowW.push(null);
        continue;
      }
      let num = 0;
      let den = 0;
      let wNum = 0;
      let nearest = Infinity;
      let exact: { el: number; w: number } | null = null;
      for (const p of pts) {
        const dLat = lat - p.lat;
        const dLng = (lng - p.lng) * Math.cos((lat * Math.PI) / 180);
        const d2 = dLat * dLat + dLng * dLng;
        nearest = Math.min(nearest, Math.sqrt(d2));
        if (d2 < 1e-14) {
          exact = { el: p.el, w: p.w };
          break;
        }
        const wDist = 1 / Math.pow(Math.sqrt(d2), IDW_POWER);
        const w = wDist * p.w;
        num += p.el * w;
        den += w;
        wNum += p.w * wDist;
      }
      if (!exact && nearest > maxInfluence) {
        rowVals.push(null);
        rowW.push(null);
      } else if (exact) {
        rowVals.push(exact.el);
        rowW.push(exact.w);
      } else if (den > 0) {
        rowVals.push(num / den);
        // Fade with distance inside a sparse halo/gradient so edges soften.
        const falloff = Number.isFinite(maxInfluence)
          ? clamp(1 - nearest / maxInfluence, 0, 1)
          : 1;
        rowW.push(clamp((wNum / (den || 1)) * falloff, 0, 1));
      } else {
        rowVals.push(null);
        rowW.push(null);
      }

    }
    grid.push(rowVals);
    weightGrid.push(rowW);
  }

  return { ...base, grid, weightGrid, gridBounds: b };
}

export interface BuildHeatModelInput {
  observations: HeatObservation[];
  blocks: { id: string; name: string; polygon: LatLng[] }[];
  atDateISO: string;
  /** null / "all" = every block. */
  blockFilter?: string | null;
  resolution?: number;
}

export interface HeatModel {
  blocks: BlockHeat[];
  /** Observations with valid coordinates but no canonical block. */
  unassigned: HeatObservation[];
  /** All qualifying observations for the date (assigned + unassigned). */
  qualifying: HeatObservation[];
  medianEl: number | null;
}

/**
 * Build the whole map model for one timeline date. Each block is computed
 * independently — there is deliberately no vineyard-wide surface.
 */
export function buildHeatModel(input: BuildHeatModelInput): HeatModel {
  const { observations, blocks, atDateISO } = input;
  const filter = input.blockFilter && input.blockFilter !== "all" ? input.blockFilter : null;
  const qualifyingAll = qualifyingAt(observations, atDateISO);
  const qualifying = filter
    ? qualifyingAll.filter((o) => o.paddockId === filter)
    : qualifyingAll;

  const byBlock = new Map<string, HeatObservation[]>();
  for (const o of qualifying) {
    if (!o.assigned || !o.paddockId) continue;
    const list = byBlock.get(o.paddockId) ?? [];
    list.push(o);
    byBlock.set(o.paddockId, list);
  }

  const wanted = filter ? blocks.filter((b) => b.id === filter) : blocks;
  const heat = wanted.map((b) =>
    buildBlockHeat({
      paddockId: b.id,
      paddockName: b.name,
      polygon: b.polygon,
      observations: byBlock.get(b.id) ?? [],
      atDateISO,
      resolution: input.resolution,
    }),
  );

  return {
    blocks: heat,
    unassigned: filter ? [] : qualifying.filter((o) => !o.assigned || !o.paddockId),
    qualifying,
    medianEl: medianStage(qualifying),
  };
}

// ---------------------------------------------------------------- formatting

export const formatEl = (el: number | null | undefined): string =>
  el == null ? "—" : `E-L ${Number.isInteger(el) ? el : el.toFixed(1)}`;

export function ageLabel(observationISO: string, atDateISO: string): string {
  const d = daysBetween(observationISO, atDateISO);
  if (d <= 0) return "Recorded on this date";
  if (d === 1) return "1 day before selected date";
  return `${d} days before selected date`;
}
