// Export block/paddock boundaries to GeoJSON or KML.
// - GeoJSON is round-trip compatible with paddockBoundaryImport (matches on
//   properties.name).
// - Polygon points in the DB can be stored as either {latitude, longitude}
//   or {lat, lng}; both shapes are handled.

export interface BoundaryPaddockExportRow {
  id: string;
  vineyard_id?: string | null;
  name: string | null;
  polygon_points: any;
  row_direction?: number | null;
  row_width?: number | null;
  vine_spacing?: number | null;
  variety_allocations?: any;
}

type LL = { lat: number; lng: number };

function toLatLng(pt: any): LL | null {
  if (!pt || typeof pt !== "object") return null;
  const lat = typeof pt.lat === "number" ? pt.lat : typeof pt.latitude === "number" ? pt.latitude : null;
  const lng = typeof pt.lng === "number" ? pt.lng : typeof pt.longitude === "number" ? pt.longitude : null;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function ring(points: any): LL[] {
  if (!Array.isArray(points)) return [];
  const out: LL[] = [];
  for (const p of points) {
    const ll = toLatLng(p);
    if (ll) out.push(ll);
  }
  return out;
}

export interface BoundaryExportStats {
  total: number;
  withPolygon: number;
  withoutPolygon: number;
  missing: string[]; // names of paddocks with no polygon
}

export function summarizeBoundaries(paddocks: BoundaryPaddockExportRow[]): BoundaryExportStats {
  let withPolygon = 0;
  const missing: string[] = [];
  for (const p of paddocks) {
    const r = ring(p.polygon_points);
    if (r.length >= 3) withPolygon++;
    else missing.push(p.name ?? "(unnamed)");
  }
  return {
    total: paddocks.length,
    withPolygon,
    withoutPolygon: missing.length,
    missing,
  };
}

export function buildBoundariesGeoJson(
  paddocks: BoundaryPaddockExportRow[],
  meta: { vineyardId: string | null; vineyardName: string },
): string {
  const features: any[] = [];
  for (const p of paddocks) {
    const r = ring(p.polygon_points);
    if (r.length < 3) continue;
    // Close the ring for GeoJSON
    const coords = r.map((pt) => [pt.lng, pt.lat]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
    const props: Record<string, any> = {
      name: p.name ?? "",
      block_id: p.id,
      vineyard_id: p.vineyard_id ?? meta.vineyardId,
      vineyard_name: meta.vineyardName,
    };
    if (p.row_direction != null) props.row_direction = p.row_direction;
    if (p.row_width != null) props.row_width = p.row_width;
    if (p.vine_spacing != null) props.vine_spacing = p.vine_spacing;
    if (Array.isArray(p.variety_allocations) && p.variety_allocations.length) {
      props.variety_allocations = p.variety_allocations;
    }
    features.push({
      type: "Feature",
      properties: props,
      geometry: { type: "Polygon", coordinates: [coords] },
    });
  }
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: meta.vineyardName,
      features,
    },
    null,
    2,
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

export function buildBoundariesKml(
  paddocks: BoundaryPaddockExportRow[],
  meta: { vineyardId: string | null; vineyardName: string },
): string {
  const placemarks: string[] = [];
  for (const p of paddocks) {
    const r = ring(p.polygon_points);
    if (r.length < 3) continue;
    const ringPts = r.slice();
    // Close ring
    if (
      ringPts[0].lat !== ringPts[ringPts.length - 1].lat ||
      ringPts[0].lng !== ringPts[ringPts.length - 1].lng
    ) {
      ringPts.push(ringPts[0]);
    }
    const coordText = ringPts.map((pt) => `${pt.lng},${pt.lat},0`).join(" ");
    const extData: string[] = [
      `<Data name="block_id"><value>${escapeXml(p.id)}</value></Data>`,
      `<Data name="vineyard_id"><value>${escapeXml(p.vineyard_id ?? meta.vineyardId ?? "")}</value></Data>`,
    ];
    if (p.row_direction != null)
      extData.push(`<Data name="row_direction"><value>${p.row_direction}</value></Data>`);
    if (p.row_width != null)
      extData.push(`<Data name="row_width"><value>${p.row_width}</value></Data>`);
    if (p.vine_spacing != null)
      extData.push(`<Data name="vine_spacing"><value>${p.vine_spacing}</value></Data>`);
    if (Array.isArray(p.variety_allocations) && p.variety_allocations.length) {
      extData.push(
        `<Data name="variety_allocations"><value>${escapeXml(
          JSON.stringify(p.variety_allocations),
        )}</value></Data>`,
      );
    }
    placemarks.push(
      `<Placemark>
  <name>${escapeXml(p.name ?? "")}</name>
  <ExtendedData>${extData.join("")}</ExtendedData>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordText}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(meta.vineyardName)}</name>
${placemarks.join("\n")}
</Document>
</kml>`;
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
