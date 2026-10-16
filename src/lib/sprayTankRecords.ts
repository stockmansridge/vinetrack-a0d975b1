// Display-only separation of the four different tank facts in a canonical
// Spray Report payload. Nothing here infers one fact from another: a planned
// tank is never a recorded tank, a session is never a confirmed mixture, and
// per-row tank numbers are only what the payload already attributes.
import type { SprayReportPayloadV1 } from "./sprayReportV1";

export interface TankRecordSummary {
  tankNumber: number;
  /** Tank exists in the frozen plan (planned water or a planned chemical). */
  planned: boolean;
  /** Number of recorded tank sessions for this tank number. */
  sessions: number;
  /** A confirmed actual row exists (actual water or an actual chemical amount). */
  actualConfirmed: boolean;
  /** Rows the payload attributes to this tank (never derived from plan). */
  attributedRows: number;
}

export const TANK_ATTRIBUTION_NOT_RECORDED = "Tank attribution not recorded";

export function summarizeTankRecords(p: SprayReportPayloadV1): {
  tanks: TankRecordSummary[];
  rowsWithTank: number;
  rowsWithoutTank: number;
  attributionNote: string | null;
} {
  const nums = new Set<number>();
  for (const t of p.tanks ?? []) nums.add(t.tankNumber);
  for (const s of p.tankSessions ?? []) nums.add(s.tankNumber);

  const tanks = Array.from(nums)
    .sort((a, b) => a - b)
    .map<TankRecordSummary>((n) => {
      const t = (p.tanks ?? []).find((x) => x.tankNumber === n);
      const planned =
        !!t &&
        (t.plannedWaterLitres != null ||
          t.chemicals.some((c) => c.plannedAmountBase != null || !!c.plannedChemicalId));
      const actualConfirmed =
        !!t &&
        ((t.actualId != null && t.actualId !== "") ||
          t.actualWaterLitres != null ||
          t.chemicals.some((c) => c.actualAmountBase != null));
      return {
        tankNumber: n,
        planned,
        sessions: (p.tankSessions ?? []).filter((s) => s.tankNumber === n).length,
        actualConfirmed,
        attributedRows: p.rows.filter((r) => r.tank === n).length,
      };
    });

  const rowsWithTank = p.rows.filter((r) => r.tank != null).length;
  const rowsWithoutTank = p.rows.length - rowsWithTank;
  return {
    tanks,
    rowsWithTank,
    rowsWithoutTank,
    attributionNote:
      p.rows.length && rowsWithoutTank
        ? rowsWithTank
          ? `${TANK_ATTRIBUTION_NOT_RECORDED} for ${rowsWithoutTank} of ${p.rows.length} rows.`
          : `${TANK_ATTRIBUTION_NOT_RECORDED} — row-to-tank links were not captured on this trip.`
        : null,
  };
}
