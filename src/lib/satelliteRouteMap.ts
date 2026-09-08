// Build a satellite-tile-backed route map image (PNG data URL) for PDF embed.
// Uses Esri World Imagery (no API key; attribution required).
// Returns null if any tile fails to load.

export interface LatLng { lat: number; lng: number }

const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const TILE_SIZE = 256;
const ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

function project(lat: number, lng: number, z: number) {
  const scale = Math.pow(2, z) * TILE_SIZE;
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile load failed: ${url}`));
    img.src = url;
  });
}

export interface SatelliteRouteResult {
  dataUrl: string;
  attribution: string;
  width: number;
  height: number;
}

/**
 * Spray Report route style `spray-route-red-green-v1`: hybrid (satellite)
 * background, red → orange → yellow → lime → green chronology, red start
 * (oldest), green finish (newest). Defined once here so every exporter and the
 * interactive Trips / Live Dashboard map draw the identical style.
 */
export const SPRAY_ROUTE_CHRONOLOGY_STOPS = [
  "#D7263D",
  "#F46036",
  "#F4C542",
  "#8DBF3F",
  "#2E9B4F",
] as const;

/** Red = oldest / Start. */
export const SPRAY_ROUTE_START_COLOUR = SPRAY_ROUTE_CHRONOLOGY_STOPS[0];
/** Green = newest / Finish. */
export const SPRAY_ROUTE_FINISH_COLOUR =
  SPRAY_ROUTE_CHRONOLOGY_STOPS[SPRAY_ROUTE_CHRONOLOGY_STOPS.length - 1];

/**
 * Chronology colour for segment `i` (the leg ending at points[i]) of a route
 * with `count` points. Shared by the PNG renderer and the interactive map so
 * both show the same ordering semantics.
 */
export function chronologyStopIndex(i: number, count: number): number {
  const stops = SPRAY_ROUTE_CHRONOLOGY_STOPS.length;
  const t = (i - 1) / Math.max(count - 2, 1);
  return Math.max(0, Math.min(stops - 1, Math.floor(t * stops)));
}

export interface RouteChronologySegment {
  /** Index of the first point of this contiguous same-colour run. */
  startIndex: number;
  /** Index of the last point of this run. */
  endIndex: number;
  colour: string;
}

/**
 * Split an ordered route into contiguous runs sharing one chronology colour.
 * Segments always cover the whole route (no gaps) and are time-ordered.
 */
export function routeChronologySegments(count: number): RouteChronologySegment[] {
  if (count < 2) return [];
  const out: RouteChronologySegment[] = [];
  let runStart = 0;
  let runStop = chronologyStopIndex(1, count);
  for (let i = 2; i < count; i++) {
    const stop = chronologyStopIndex(i, count);
    if (stop !== runStop) {
      out.push({
        startIndex: runStart,
        endIndex: i - 1,
        colour: SPRAY_ROUTE_CHRONOLOGY_STOPS[runStop],
      });
      runStart = i - 1;
      runStop = stop;
    }
  }
  out.push({
    startIndex: runStart,
    endIndex: count - 1,
    colour: SPRAY_ROUTE_CHRONOLOGY_STOPS[runStop],
  });
  return out;
}


export interface RouteImageOptions {
  /** Draw the five-stop red→green chronology instead of the flat blue line. */
  chronology?: boolean;
  /** Start marker colour (chronology style uses red start / green finish). */
  startColour?: string;
  endColour?: string;
}

export async function composeSatelliteRouteImage(
  points: LatLng[],
  targetW = 900,
  targetH = 540,
  options?: RouteImageOptions,
): Promise<SatelliteRouteResult | null> {

  if (!points || points.length < 2) return null;

  // Bounds with padding
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (!isFinite(minLat) || !isFinite(minLng)) return null;
  const padLat = Math.max((maxLat - minLat) * 0.15, 0.0005);
  const padLng = Math.max((maxLng - minLng) * 0.15, 0.0005);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  // Pick the largest zoom where bbox fits in target
  let chosenZ = 0;
  for (let z = 19; z >= 1; z--) {
    const a = project(maxLat, minLng, z);
    const b = project(minLat, maxLng, z);
    const w = b.x - a.x;
    const h = b.y - a.y;
    if (w <= targetW && h <= targetH) { chosenZ = z; break; }
  }
  if (chosenZ === 0) chosenZ = 1;

  const topLeft = project(maxLat, minLng, chosenZ);
  const bottomRight = project(minLat, maxLng, chosenZ);
  const bboxW = Math.ceil(bottomRight.x - topLeft.x);
  const bboxH = Math.ceil(bottomRight.y - topLeft.y);

  const tileMinX = Math.floor(topLeft.x / TILE_SIZE);
  const tileMaxX = Math.floor((topLeft.x + bboxW) / TILE_SIZE);
  const tileMinY = Math.floor(topLeft.y / TILE_SIZE);
  const tileMaxY = Math.floor((topLeft.y + bboxH) / TILE_SIZE);

  const totalTiles = (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1);
  // Safety: don't compose absurdly large grids.
  if (totalTiles > 40) return null;

  const canvas = document.createElement("canvas");
  canvas.width = bboxW;
  canvas.height = bboxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Load all tiles in parallel; fail fast if any tile is missing.
  const tasks: Promise<void>[] = [];
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      tasks.push(
        loadImage(TILE_URL(chosenZ, tx, ty)).then((img) => {
          const dx = tx * TILE_SIZE - topLeft.x;
          const dy = ty * TILE_SIZE - topLeft.y;
          ctx.drawImage(img, dx, dy);
        }),
      );
    }
  }
  try {
    await Promise.all(tasks);
  } catch {
    return null;
  }

  // Project route to canvas pixels
  const toCanvas = (p: LatLng) => {
    const q = project(p.lat, p.lng, chosenZ);
    return [q.x - topLeft.x, q.y - topLeft.y] as const;
  };

  // Halo + line for visibility on satellite imagery
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  const [sx0, sy0] = toCanvas(points[0]);
  ctx.moveTo(sx0, sy0);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = toCanvas(points[i]);
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (options?.chronology) {
    // Five-stop chronology: each segment is coloured by its position in time.
    ctx.lineWidth = 3;
    for (let i = 1; i < points.length; i++) {
      ctx.strokeStyle =
        SPRAY_ROUTE_CHRONOLOGY_STOPS[chronologyStopIndex(i, points.length)];
      const [px, py] = toCanvas(points[i - 1]);
      const [x, y] = toCanvas(points[i]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

  } else {
    ctx.strokeStyle = "#1E5AC8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = toCanvas(points[i]);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const drawMarker = (cx: number, cy: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const [sx, sy] = toCanvas(points[0]);
  const [ex, ey] = toCanvas(points[points.length - 1]);
  const startColour = options?.startColour ?? (options?.chronology ? "#D7263D" : "#22A046");
  const endColour = options?.endColour ?? (options?.chronology ? "#2E9B4F" : "#D23232");
  drawMarker(sx, sy, startColour);
  drawMarker(ex, ey, endColour);


  // Attribution strip
  const attrH = 16;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, bboxH - attrH, bboxW, attrH);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "10px Helvetica, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(ATTRIBUTION, 6, bboxH - attrH / 2);

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/png");
  } catch {
    // Tainted canvas (CORS) → fail gracefully
    return null;
  }
  return { dataUrl, attribution: ATTRIBUTION, width: bboxW, height: bboxH };
}
