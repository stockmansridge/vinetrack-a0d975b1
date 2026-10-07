// Optional row-line import for Contour Row Mapping drafts.
// Supported: GeoJSON LineString / MultiLineString (RFC 7946, WGS84 lon,lat)
// and KML LineString / MultiGeometry (WGS84). One feature = one logical
// row; multi-geometries keep their parts as one row. Remote links
// (NetworkLink) are never fetched; DOCTYPE/ENTITY declarations rejected.
import type { LatLng } from "./geometry";
import { isFiniteLL, projectionForPolygon, pointInPolygonXY, distToRingXY } from "./geometry";
import { LIMITS } from "./draft";

export const IMPORT_LIMITS = { maxBytes: 5_000_000, maxRows: LIMITS.maxRows, maxVertices: 100_000 };

export interface ImportedLine {
  featureIndex: number;
  name: string | null;
  suggestedNumber: number | null;
  parts: LatLng[][];
}
export interface LineImportResult { format: "geojson" | "kml"; lines: ImportedLine[]; warnings: string[] }

function numberFrom(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") { const m = v.trim().match(/^(?:row\s*)?(\d{1,5})$/i); if (m) return Number(m[1]); }
  return null;
}

function checkPart(pts: LatLng[], where: string): LatLng[] {
  if (pts.length < 2) throw new Error(`${where}: a line needs at least two points.`);
  if (!pts.every(isFiniteLL)) throw new Error(`${where}: coordinates are outside the valid latitude/longitude range.`);
  return pts;
}

const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function fromGeoJsonCoords(c: unknown, where: string): LatLng[] {
  if (!Array.isArray(c)) throw new Error(`${where}: missing coordinates.`);
  return checkPart(c.map((p: unknown) => {
    // Only real JSON numbers are accepted (null/""/"138.7" are rejected, never coerced).
    if (!Array.isArray(p) || p.length < 2 || p.length > 4 || !p.every(finiteNum)) throw new Error(`${where}: each coordinate must be [longitude, latitude] numbers.`);
    return { lng: p[0], lat: p[1] };
  }), where);
}

const CRS_OK = /^(urn:ogc:def:crs:OGC:(1\.3:)?CRS84|urn:ogc:def:crs:EPSG::4326|EPSG:4326)$/i;
function checkCrs(o: any, where: string) {
  if (o == null || typeof o !== "object" || !("crs" in o) || o.crs == null) return;
  const name = o.crs?.properties?.name;
  if (typeof name !== "string" || !CRS_OK.test(name.trim()))
    throw new Error(`${where}: unsupported coordinate system (${typeof name === "string" ? name : "unknown"}). Export the file in WGS84 (EPSG:4326).`);
}

export function parseGeoJsonLines(text: string): LineImportResult {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("This file is not valid GeoJSON."); }
  if (j == null || typeof j !== "object" || Array.isArray(j)) throw new Error("This file is not a GeoJSON object.");
  checkCrs(j, "File");
  let feats: any[];
  if (j.type === "FeatureCollection") {
    if (!Array.isArray(j.features)) throw new Error("This FeatureCollection has no features list.");
    feats = j.features;
  } else if (j.type === "Feature") feats = [j];
  else if (j.type === "LineString" || j.type === "MultiLineString") feats = [{ type: "Feature", geometry: j, properties: {} }];
  else throw new Error(`Unsupported GeoJSON type (${typeof j.type === "string" ? j.type : "missing"}). Use LineString, MultiLineString, Feature or FeatureCollection.`);
  const warnings: string[] = [];
  const lines: ImportedLine[] = [];
  feats.forEach((f, i) => {
    const where = `Feature ${i + 1}`;
    if (f == null || typeof f !== "object" || Array.isArray(f) || f.type !== "Feature") throw new Error(`${where} is not a valid GeoJSON Feature.`);
    checkCrs(f, where);
    const g = f.geometry;
    if (g != null) checkCrs(g, where);
    const props = f.properties != null && typeof f.properties === "object" ? f.properties : {};
    const name = typeof props.name === "string" ? props.name : null;
    const num = numberFrom(props.row_number ?? props.row ?? props.number ?? props.name);
    if (g?.type === "LineString") lines.push({ featureIndex: i, name, suggestedNumber: num, parts: [fromGeoJsonCoords(g.coordinates, where)] });
    else if (g?.type === "MultiLineString") {
      if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) throw new Error(`${where}: the MultiLineString has no lines.`);
      lines.push({ featureIndex: i, name, suggestedNumber: num, parts: g.coordinates.map((c: unknown, k: number) => fromGeoJsonCoords(c, `${where} part ${k + 1}`)) });
    }
    else warnings.push(`${where} is a ${g?.type ?? "missing geometry"} and was skipped — only lines are imported. Use Boundary import for block polygons.`);
  });
  return finish("geojson", lines, warnings);
}

function parseKmlCoords(s: string, where: string): LatLng[] {
  const NUM = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  return checkPart(s.trim().split(/\s+/).filter(Boolean).map((t) => {
    const c = t.split(",");
    if (c.length < 2 || c.length > 3 || !c.every((x) => NUM.test(x))) throw new Error(`${where}: each coordinate must be "longitude,latitude[,altitude]" numbers.`);
    return { lng: Number(c[0]), lat: Number(c[1]) };
  }), where);
}

export function parseKmlLines(text: string): LineImportResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("This KML contains document type or entity declarations, which are not accepted for security reasons.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This file is not valid KML.");
  const warnings: string[] = [];
  if (doc.getElementsByTagName("NetworkLink").length) warnings.push("Network links were ignored — remote KML is never downloaded.");
  const lines: ImportedLine[] = [];
  Array.from(doc.getElementsByTagName("Placemark")).forEach((pm, i) => {
    const where = `Placemark ${i + 1}`;
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || null;
    const ls = Array.from(pm.getElementsByTagName("LineString"));
    if (!ls.length) { warnings.push(`${where} has no line and was skipped.`); return; }
    const parts = ls.map((l, k) => parseKmlCoords(l.getElementsByTagName("coordinates")[0]?.textContent ?? "", `${where} part ${k + 1}`));
    let num = numberFrom(name);
    for (const d of Array.from(pm.getElementsByTagName("Data"))) {
      if (/^(row|row_number|number)$/i.test(d.getAttribute("name") ?? "")) num = numberFrom(d.getElementsByTagName("value")[0]?.textContent ?? "") ?? num;
    }
    lines.push({ featureIndex: i, name, suggestedNumber: num, parts });
  });
  return finish("kml", lines, warnings);
}

function finish(format: "geojson" | "kml", lines: ImportedLine[], warnings: string[]): LineImportResult {
  if (!lines.length) throw new Error("No row lines were found in this file.");
  if (lines.length > IMPORT_LIMITS.maxRows) throw new Error(`Too many rows (${lines.length}); the limit is ${IMPORT_LIMITS.maxRows}.`);
  const v = lines.reduce((s, l) => s + l.parts.reduce((t, p) => t + p.length, 0), 0);
  if (v > IMPORT_LIMITS.maxVertices) throw new Error(`Too many points (${v}); the limit is ${IMPORT_LIMITS.maxVertices}.`);
  return { format, lines, warnings };
}

export function parseLineFile(name: string, text: string): LineImportResult {
  if (text.length > IMPORT_LIMITS.maxBytes) throw new Error("File is larger than 5 MB.");
  if (/\.kml$/i.test(name)) return parseKmlLines(text);
  if (/\.(geo)?json$/i.test(name)) return parseGeoJsonLines(text);
  if (/\.(kmz|gpx|csv|zip|shp)$/i.test(name)) throw new Error("This format isn't supported yet. Use GeoJSON or KML (not KMZ).");
  throw new Error("Unrecognised file type. Use .geojson, .json or .kml.");
}

/** Heuristic: points look like swapped lat/lng relative to the block. */
export function looksSwapped(lines: ImportedLine[], boundary: LatLng[]): boolean {
  if (!boundary.length) return false;
  const c = { lat: boundary.reduce((s, p) => s + p.lat, 0) / boundary.length, lng: boundary.reduce((s, p) => s + p.lng, 0) / boundary.length };
  const p = lines[0]?.parts[0]?.[0];
  if (!p) return false;
  const d = Math.hypot(p.lat - c.lat, p.lng - c.lng);
  const ds = Math.hypot(p.lng - c.lat, p.lat - c.lng);
  return d > 1 && ds < 0.1;
}

/** Duplicate numbers among assignments and against numbers already used. */
export function duplicateNumbers(assigned: number[], used: Set<number>): number[] {
  const seen = new Set<number>(); const dups = new Set<number>();
  for (const n of assigned) { if (seen.has(n) || used.has(n)) dups.add(n); seen.add(n); }
  return Array.from(dups).sort((a, b) => a - b);
}

/** Lines with any point more than `maxM` metres outside the block. */
export function linesFarOutside(lines: ImportedLine[], boundary: LatLng[], maxM = 100): ImportedLine[] {
  if (boundary.length < 3) return [];
  const proj = projectionForPolygon(boundary);
  const ring = boundary.map(proj.toXY);
  return lines.filter((l) => l.parts.some((p) => p.some((q) => {
    const xy = proj.toXY(q);
    return !pointInPolygonXY(xy, ring) && distToRingXY(xy, ring) > maxM;
  })));
}
