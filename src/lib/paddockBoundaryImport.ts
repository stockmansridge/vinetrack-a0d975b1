// Boundary import for paddocks from KML or GeoJSON.
// - Parses one feature per polygon, matches to existing paddocks by name.
// - Writes ONLY polygon_points (canonical {lat,lng}[]). Never touches rows,
//   setup fields, allocations, or anything else.
// - Match strategy: exact (case-insensitive) on paddock name. Unmatched
//   features and unmatched paddocks are surfaced in the preview.

import { supabase } from "@/integrations/ios-supabase/client";

export type LatLng = { lat: number; lng: number };

export interface BoundaryFeature {
  name: string;
  points: LatLng[]; // outer ring, closed or open accepted
  source: "kml" | "geojson";
}

export interface ParsedBoundaries {
  features: BoundaryFeature[];
  warnings: string[];
}

const isNum = (n: any): n is number => typeof n === "number" && Number.isFinite(n);

function ringFromCoords(coords: any[]): LatLng[] {
  // GeoJSON rings are [lng, lat] tuples
  const out: LatLng[] = [];
  for (const c of coords) {
    if (Array.isArray(c) && isNum(c[0]) && isNum(c[1])) {
      out.push({ lat: c[1], lng: c[0] });
    }
  }
  // strip closing duplicate point
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) out.pop();
  }
  return out;
}

// ---------- GeoJSON ----------

export function parseGeoJson(text: string): ParsedBoundaries {
  const warnings: string[] = [];
  const features: BoundaryFeature[] = [];
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`Invalid GeoJSON: ${e?.message ?? "parse failed"}`);
  }
  const collection: any[] =
    json?.type === "FeatureCollection" && Array.isArray(json.features)
      ? json.features
      : json?.type === "Feature"
        ? [json]
        : Array.isArray(json)
          ? json
          : [];
  if (!collection.length) {
    warnings.push("No features found in GeoJSON");
  }
  for (const f of collection) {
    const props = f?.properties ?? {};
    const name = String(
      props.name ?? props.Name ?? props.NAME ?? props.block ?? props.Block ?? props.title ?? "",
    ).trim();
    const geom = f?.geometry;
    if (!geom) continue;
    const ringsList: any[][] = [];
    if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
      ringsList.push(geom.coordinates[0] ?? []);
    } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      // pick the largest outer ring by point count
      let best: any[] = [];
      for (const poly of geom.coordinates) {
        const outer = poly?.[0] ?? [];
        if (outer.length > best.length) best = outer;
      }
      ringsList.push(best);
      if (geom.coordinates.length > 1) {
        warnings.push(`"${name || "(unnamed)"}": MultiPolygon — using largest ring`);
      }
    } else {
      continue;
    }
    for (const ring of ringsList) {
      const pts = ringFromCoords(ring);
      if (pts.length >= 3) {
        features.push({ name, points: pts, source: "geojson" });
      }
    }
  }
  return { features, warnings };
}

// ---------- KML ----------

export function parseKml(text: string): ParsedBoundaries {
  const warnings: string[] = [];
  const features: BoundaryFeature[] = [];
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserErr = doc.querySelector("parsererror");
  if (parserErr) throw new Error("Invalid KML/XML");

  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  if (!placemarks.length) warnings.push("No <Placemark> elements found in KML");

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName("name")[0];
    const name = (nameEl?.textContent ?? "").trim();
    // Collect every <Polygon><outerBoundaryIs><LinearRing><coordinates>
    const polys = Array.from(pm.getElementsByTagName("Polygon"));
    if (polys.length === 0) continue;
    // Pick the polygon with the most coords
    let best: { coords: string; count: number } = { coords: "", count: 0 };
    for (const poly of polys) {
      const outer = poly.getElementsByTagName("outerBoundaryIs")[0];
      const coordsEl = outer?.getElementsByTagName("coordinates")[0];
      const txt = (coordsEl?.textContent ?? "").trim();
      const count = txt.split(/\s+/).filter(Boolean).length;
      if (count > best.count) best = { coords: txt, count };
    }
    if (!best.coords) continue;
    if (polys.length > 1) {
      warnings.push(`"${name || "(unnamed)"}": multiple polygons — using largest`);
    }
    const tuples = best.coords.split(/\s+/).filter(Boolean);
    const coords: any[] = [];
    for (const tup of tuples) {
      const parts = tup.split(",").map((s) => Number(s.trim()));
      if (parts.length >= 2 && isNum(parts[0]) && isNum(parts[1])) {
        coords.push([parts[0], parts[1]]); // lng, lat
      }
    }
    const pts = ringFromCoords(coords);
    if (pts.length >= 3) {
      features.push({ name, points: pts, source: "kml" });
    }
  }
  return { features, warnings };
}

// ---------- Detect + parse ----------

export function parseBoundaryFile(filename: string, text: string): ParsedBoundaries {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".kml")) return parseKml(text);
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) return parseGeoJson(text);
  // Sniff content
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) return parseKml(text);
  return parseGeoJson(text);
}

// ---------- Apply ----------

export interface BoundaryMatch {
  feature: BoundaryFeature;
  paddockId: string | null;
  paddockName: string | null;
  hasExistingPolygon: boolean;
  status: "match-new" | "match-overwrite" | "no-match";
}

export interface BoundaryPlan {
  matches: BoundaryMatch[];
  unmatchedFeatures: BoundaryFeature[];
  unmatchedPaddocks: { id: string; name: string }[];
}

export interface BoundaryPaddockRow {
  id: string;
  name: string | null;
  polygon_points: any;
}

export function buildBoundaryPlan(
  features: BoundaryFeature[],
  paddocks: BoundaryPaddockRow[],
): BoundaryPlan {
  const byName = new Map<string, BoundaryPaddockRow>();
  for (const p of paddocks) {
    if (p.name) byName.set(p.name.trim().toLowerCase(), p);
  }
  const matched = new Set<string>();
  const matches: BoundaryMatch[] = [];
  const unmatchedFeatures: BoundaryFeature[] = [];
  for (const f of features) {
    const key = f.name.trim().toLowerCase();
    const p = key ? byName.get(key) : undefined;
    if (!p) {
      unmatchedFeatures.push(f);
      matches.push({
        feature: f,
        paddockId: null,
        paddockName: null,
        hasExistingPolygon: false,
        status: "no-match",
      });
      continue;
    }
    matched.add(p.id);
    const hasExisting =
      Array.isArray(p.polygon_points) && p.polygon_points.length >= 3;
    matches.push({
      feature: f,
      paddockId: p.id,
      paddockName: p.name,
      hasExistingPolygon: hasExisting,
      status: hasExisting ? "match-overwrite" : "match-new",
    });
  }
  const unmatchedPaddocks = paddocks
    .filter((p) => !matched.has(p.id) && p.name)
    .map((p) => ({ id: p.id, name: p.name! }));
  return { matches, unmatchedFeatures, unmatchedPaddocks };
}

export interface BoundaryApplyResult {
  mapped: number;
  overwritten: number;
  skipped: number;
  errors: string[];
}

export async function applyBoundaryImport(
  plan: BoundaryPlan,
  opts: { overwriteExisting: boolean },
): Promise<BoundaryApplyResult> {
  const result: BoundaryApplyResult = { mapped: 0, overwritten: 0, skipped: 0, errors: [] };
  for (const m of plan.matches) {
    if (!m.paddockId) {
      result.skipped++;
      continue;
    }
    if (m.hasExistingPolygon && !opts.overwriteExisting) {
      result.skipped++;
      continue;
    }
    const { error } = await supabase
      .from("paddocks")
      .update({ polygon_points: m.feature.points })
      .eq("id", m.paddockId);
    if (error) {
      result.errors.push(`${m.paddockName ?? m.feature.name}: ${error.message}`);
      continue;
    }
    if (m.hasExistingPolygon) result.overwritten++;
    else result.mapped++;
  }
  return result;
}
