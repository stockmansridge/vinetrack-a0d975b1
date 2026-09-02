// Rasterise a BlockHeat grid into a PNG data URL for a Leaflet ImageOverlay.
// Browser-only helper (uses <canvas>); kept out of the pure logic module.
import { elColour, type BlockHeat } from "@/lib/growthHeatmap";

export function blockHeatDataUrl(block: BlockHeat, maxAlpha = 0.72): string | null {
  if (!block.grid || !block.gridBounds) return null;
  const rows = block.grid.length;
  const cols = block.grid[0]?.length ?? 0;
  if (!rows || !cols) return null;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);

  for (let i = 0; i < rows; i++) {
    // Grid row 0 is the southern edge; canvas row 0 is the northern edge.
    const y = rows - 1 - i;
    for (let j = 0; j < cols; j++) {
      const el = block.grid[i][j];
      const idx = (y * cols + j) * 4;
      if (el == null) {
        img.data[idx + 3] = 0;
        continue;
      }
      const c = elColour(el);
      const w = block.weightGrid?.[i]?.[j] ?? 1;
      img.data[idx] = c.r;
      img.data[idx + 1] = c.g;
      img.data[idx + 2] = c.b;
      img.data[idx + 3] = Math.round(255 * maxAlpha * Math.max(0.12, Math.min(1, w ?? 1)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
