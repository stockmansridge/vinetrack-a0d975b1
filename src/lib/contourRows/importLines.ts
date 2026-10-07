// Optional row-line import for Contour Row Mapping drafts.
// Supported: GeoJSON LineString / MultiLineString (RFC 7946, WGS84 lon,lat)
// and KML LineString / MultiGeometry (WGS84). One feature = one logical
// row; multi-geometries keep their parts as one row. Remote links
// (NetworkLink) are never fetched; DOCTYPE/ENTITY declarations rejected.
import type { LatLng } from "./geometry";
import { isFiniteLL } from "./geometry";
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

function fromGeoJsonCoords(c: unknown, where: string): LatLng[] {
  if (!Array.isArray(c)) throw new Error(`${where}: missing coordinates.`);
  return checkPart(c.map((p: any) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error(`${where}: malformed coordinate.`);
    return { lng: Number(p[0]), lat: Number(p[1]) };
  }), where);
}

export function parseGeoJsonLines(text: string): LineImportResult {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("This file is not valid GeoJSON."); }
  const crs = j?.crs?.properties?.name;
  if (crs && !/CRS84|EPSG:?:?4326/i.test(String(crs)))
    throw new Error(`Unsupported coordinate system (${crs}). Export the file in WGS84 (EPSG:4326).`);
  const feats: any[] = j?.type === "FeatureCollection" ? j.features ?? []
    : j?.type === "Feature" ? [j] : j?.type ? [{ type: "Feature", geometry: j, properties: {} }] : [];
  const warnings: string[] = [];
  const lines: ImportedLine[] = [];
  feats.forEach((f, i) => {
    const g = f?.geometry; const where = `Feature ${i + 1}`;
    const props = f?.properties ?? {};
    const name = typeof props.name === "string" ? props.name : null;
    const num = numberFrom(props.row_number ?? props.row ?? props.number ?? props.name);
    if (g?.type === "LineString") lines.push({ featureIndex: i, name, suggestedNumber: num, parts: [fromGeoJsonCoords(g.coordinates, where)] });
    else if (g?.type === "MultiLineString") lines.push({ featureIndex: i, name, suggestedNumber: num, parts: (g.coordinates ?? []).map((c: unknown, k: number) => fromGeoJsonCoords(c, `${where} part ${k + 1}`)) });
    else warnings.push(`${where} is a ${g?.type ?? "missing geometry"} and was skipped — only lines are imported. Use Boundary import for block polygons.`);
  });
  return finish("geojson", lines, warnings);
}

function parseKmlCoords(s: string, where: string): LatLng[] {
  return checkPart(s.trim().split(/\s+/).filter(Boolean).map((t) => {
    const [lng, lat] = t.split(",").map(Number);
    return { lng, lat };
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
