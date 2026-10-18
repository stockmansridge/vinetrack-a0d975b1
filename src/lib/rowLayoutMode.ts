// Operational row layout of a block — derived ONLY from the block's own
// operational data, never from a contour draft. Today every operational row is
// a straight startPoint/endPoint line, so this is always "straight"; a future
// shared operational geometry mode (Rork) will be read here.
import { parseRows } from "@/lib/paddockGeometry";

export type OperationalRowLayout = "straight";

export function operationalLayoutFor(paddock: any): { layout: OperationalRowLayout; rowCount: number } {
  return { layout: "straight", rowCount: parseRows(paddock?.rows).length };
}

export const OPERATIONAL_LAYOUT_LABEL: Record<OperationalRowLayout, string> = { straight: "Straight (active)" };
