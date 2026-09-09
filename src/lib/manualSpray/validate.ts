// Manual spray entry — whole-draft validation.
//
// The complete draft is validated BEFORE any write is attempted. Nothing here
// mutates, converts silently or supplies a default for missing data.
import { unitsForForm, unitDimension, isWireUnit } from "@/lib/manualSpray/units";
import type { ManualSprayDraft } from "@/lib/manualSpray/domain";

export type ManualSprayField =
  | "name"
  | "startAt"
  | "endAt"
  | "tractor"
  | "operator"
  | "sprayUnit"
  | "engineHours"
  | "blocks"
  | "tanks"
  | "water"
  | "chemical";

export interface ManualSprayViolation {
  field: ManualSprayField;
  message: string;
  /** Tank / line identity the violation belongs to, when applicable. */
  tankId?: string;
  lineId?: string;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateManualSpray(draft: ManualSprayDraft): {
  ok: boolean;
  violations: ManualSprayViolation[];
} {
  const v: ManualSprayViolation[] = [];

  if (!draft.name.trim()) v.push({ field: "name", message: "Enter a name for this spray." });
  if (!draft.startAt) v.push({ field: "startAt", message: "Enter the start date and time." });
  if (!draft.endAt) v.push({ field: "endAt", message: "Enter the end date and time." });
  if (draft.startAt && draft.endAt) {
    const s = Date.parse(draft.startAt);
    const e = Date.parse(draft.endAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      v.push({ field: "endAt", message: "Enter valid start and end times." });
    } else if (e <= s) {
      v.push({ field: "endAt", message: "The end time must be after the start time." });
    }
  }

  if (!draft.tractorId) v.push({ field: "tractor", message: "Select the tractor used." });
  if (!draft.operatorUserId) v.push({ field: "operator", message: "Select the operator." });
  if (!draft.sprayEquipmentId) v.push({ field: "sprayUnit", message: "Select the spray unit used." });

  const s = draft.startEngineHours;
  const e = draft.endEngineHours;
  if (s != null && !finite(s)) v.push({ field: "engineHours", message: "Enter a valid start engine-hour reading." });
  if (e != null && !finite(e)) v.push({ field: "engineHours", message: "Enter a valid end engine-hour reading." });
  if (finite(s) && s < 0) v.push({ field: "engineHours", message: "Engine-hour readings cannot be negative." });
  if (finite(e) && e < 0) v.push({ field: "engineHours", message: "Engine-hour readings cannot be negative." });
  if (finite(s) && finite(e) && e < s) {
    v.push({ field: "engineHours", message: "The end engine-hour reading cannot be below the start reading." });
  }

  if (draft.blockIds.length === 0) v.push({ field: "blocks", message: "Select at least one block." });
  if (draft.tanks.length === 0) v.push({ field: "tanks", message: "Add at least one tank." });

  for (const tank of draft.tanks) {
    if (tank.waterLitres == null) {
      v.push({ field: "water", tankId: tank.id, message: `Enter the water used in tank ${tank.displayNumber}.` });
    } else if (!finite(tank.waterLitres) || tank.waterLitres < 0) {
      v.push({ field: "water", tankId: tank.id, message: `Tank ${tank.displayNumber} water must be a number of litres, zero or more.` });
    }
    if (tank.chemicals.length === 0) {
      v.push({ field: "chemical", tankId: tank.id, message: `Add at least one chemical to tank ${tank.displayNumber}.` });
    }
    for (const line of tank.chemicals) {
      const where = `tank ${tank.displayNumber}`;
      if (!line.productName.trim()) {
        v.push({ field: "chemical", tankId: tank.id, lineId: line.id, message: `Enter the product name in ${where}.` });
      }
      if (!isWireUnit(line.unit)) {
        v.push({ field: "chemical", tankId: tank.id, lineId: line.id, message: `Choose a unit for ${line.productName.trim() || "the product"} in ${where}.` });
      } else if (line.physicalForm !== "unknown" && !unitsForForm(line.physicalForm).includes(line.unit)) {
        v.push({
          field: "chemical",
          tankId: tank.id,
          lineId: line.id,
          message: `${line.productName.trim() || "This product"} is ${line.physicalForm}; use ${unitsForForm(line.physicalForm).join(" or ")} in ${where}.`,
        });
      }
      if (line.amount == null) {
        v.push({ field: "chemical", tankId: tank.id, lineId: line.id, message: `Enter the amount of ${line.productName.trim() || "the product"} used in ${where}.` });
      } else if (!finite(line.amount) || line.amount < 0) {
        v.push({ field: "chemical", tankId: tank.id, lineId: line.id, message: `The amount in ${where} must be a number, zero or more.` });
      }
      if (line.unit && !unitDimension(line.unit)) {
        v.push({ field: "chemical", tankId: tank.id, lineId: line.id, message: `Unsupported unit in ${where}.` });
      }
    }
  }

  return { ok: v.length === 0, violations: v };
}
