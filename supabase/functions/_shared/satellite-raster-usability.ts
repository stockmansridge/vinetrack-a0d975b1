// Byte-level usability counts for published rasters. A decodable file is not
// imagery: production 1 Aug 2026 PNGs were 100% alpha 0 and TIFFs 100% -9999.
export function countVisibleRgba(data: ArrayLike<number>, channels: number): number {
  if (channels !== 4 && channels !== 2) return Math.floor(data.length / Math.max(1, channels));
  let n = 0;
  for (let i = channels - 1; i < data.length; i += channels) if (data[i] > 0) n++;
  return n;
}
export function countValidCells(values: ArrayLike<number>, noData: number, range: [number, number] | null): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v !== noData && (!range || (v >= range[0] && v <= range[1]))) n++;
  }
  return n;
}
