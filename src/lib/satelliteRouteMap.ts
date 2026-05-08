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

export async function composeSatelliteRouteImage(
  points: LatLng[],
  targetW = 900,
  targetH = 540,
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

  ctx.strokeStyle = "#1E5AC8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = toCanvas(points[i]);
    ctx.lineTo(x, y);
  }
  ctx.stroke();

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
  drawMarker(sx, sy, "#22A046");
  drawMarker(ex, ey, "#D23232");

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
