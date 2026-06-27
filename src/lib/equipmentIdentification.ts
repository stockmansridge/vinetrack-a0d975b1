// Shared helpers for displaying equipment identification subtitles
// (Serial number / VIN number). Used by Tractors, Spray Equipment,
// Vineyard Machines and Other Equipment list rows.

export function equipmentIdSubtitle(
  serial?: string | null,
  vin?: string | null,
): string {
  const s = (serial ?? "").trim();
  const v = (vin ?? "").trim();
  if (s && v) return `S/N ${s} · VIN ${v}`;
  if (s) return `S/N ${s}`;
  if (v) return `VIN ${v}`;
  return "";
}
