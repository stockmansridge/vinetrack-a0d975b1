// Read-only diagnostic helpers for the Pins page.
import type { PinRecord } from "@/components/PinDetailPanel";

export const validCoord = (lat?: number | null, lng?: number | null) =>
  lat != null &&
  lng != null &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

export { pinDisplayTitle } from "@/lib/pinStyle";

export interface PinsDiagnostics {
  selectedVineyardId: string | null;
  pinsCount: number;
  withCoordsCount: number;
  newestCreatedAt: string | null;
  paddockPolygonCount: number;
}

export function buildPinsDiagnostics(
  selectedVineyardId: string | null,
  pins: PinRecord[],
  paddockPolygonCount: number,
): PinsDiagnostics {
  const withCoordsCount = pins.filter((p) => validCoord(p.latitude, p.longitude)).length;
  const newestCreatedAt = pins
    .map((p) => p.created_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  return {
    selectedVineyardId,
    pinsCount: pins.length,
    withCoordsCount,
    newestCreatedAt,
    paddockPolygonCount,
  };
}
