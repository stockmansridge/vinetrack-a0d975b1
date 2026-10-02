// Container-based stock entry (UI model only).
//
// BACKEND LIMITATION: the current inventory RPCs persist only aggregate
// quantity + unit (purchase and stocktake). container_count, container_size,
// container_unit and opening capacity are NOT stored anywhere yet. These
// helpers turn the container entry into the existing aggregate write; nothing
// container-specific is sent, kept in notes, or saved locally.
// When Rork ships the extended contract, flip CONTAINER_BACKEND_SUPPORTED and
// add the extra args in toPurchaseQuantity's callers — the UI model is ready.
import type { StockUnit } from "@/lib/chemicalInventory";
import { STOCK_UNITS } from "@/lib/chemicalInventory";

export const CONTAINER_BACKEND_SUPPORTED = false;

export interface ContainerDraft { count: string; size: string; unit: StockUnit }

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const asStockUnit = (u?: string | null): StockUnit | undefined =>
  STOCK_UNITS.find((x) => x.toLowerCase() === String(u ?? "").trim().toLowerCase());

/** Count defaults to 1; size/unit from saved_chemicals.pack_size / pack_unit when usable. */
export function defaultContainer(packSize: unknown, packUnit: unknown, fallbackUnit: StockUnit, allowed?: readonly StockUnit[]): ContainerDraft {
  const unit = asStockUnit(String(packUnit ?? ""));
  const size = num(packSize);
  const unitOk = unit && (!allowed || allowed.includes(unit));
  return { count: "1", size: unitOk && size && size > 0 ? String(size) : "", unit: unitOk ? unit! : fallbackUnit };
}

/** count × size, or null when either is missing/invalid. Display + aggregate write only. */
export function containerTotal(d: Pick<ContainerDraft, "count" | "size">): number | null {
  const c = num(d.count), s = num(d.size);
  if (c === null || s === null || c <= 0 || s <= 0) return null;
  return Math.round(c * s * 1000) / 1000;
}

export const formatContainers = (d: ContainerDraft): string | null => {
  const t = containerTotal(d);
  return t === null ? null : `${d.count} × ${d.size} ${d.unit} = ${t} ${d.unit} total`;
};

/** Preview only — the stored unit cost is always worked out by the backend. */
export function previewUnitCost(total: string, qty: number | null): number | null {
  const t = num(total);
  if (t === null || qty === null || qty <= 0 || t < 0) return null;
  return t / qty;
}
