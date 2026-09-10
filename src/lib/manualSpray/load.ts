// Manual spray entry — edit hydration.
//
// Editing an existing manual application NEVER starts from a fresh draft. The
// saved application's identities (manual entry id, spray record id, trip id,
// tank ids, tank actual ids and chemical line ids) are reloaded and reused, so
// a save is a correction of the same application rather than a second one.
//
// Quantities come from the canonical report (`get_spray_report_v1`); stable
// client-side identities come from the record's own stored `tanks` JSON where
// they were persisted, falling back to the server's actual row ids. Nothing is
// invented for a value the record does not carry.
import { supabase } from "@/integrations/ios-supabase/client";
import { fetchSprayReportV1, isManualEntryReport } from "@/lib/sprayReportV1";
import { normaliseTanks, tankChemicalLines } from "@/lib/sprayRecordChemistry";
import { fromBaseAmount, isWireUnit, type WireUnit } from "@/lib/manualSpray/units";
import { parsePhysicalForm } from "@/lib/chemicalPhysicalForm";
import type {
  ManualChemicalLine,
  ManualSprayDraft,
  ManualTank,
} from "@/lib/manualSpray/domain";

export interface ManualSprayLoadResult {
  draft: ManualSprayDraft | null;
  error: string | null;
}

export const MANUAL_NOT_MANUAL_MESSAGE =
  "This spray record was not recorded as a manual entry, so it can't be edited here.";

const text = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

const pick = (obj: any, keys: string[]): unknown => {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
};

/**
 * Load one saved manual application as an editable draft.
 * `recordRow` may be supplied when the caller already holds the record row.
 */
export async function loadManualSprayDraft(
  sprayRecordId: string,
  recordRow?: Record<string, any> | null,
): Promise<ManualSprayLoadResult> {
  let row = recordRow ?? null;
  if (!row) {
    const { data, error } = await (supabase as any)
      .from("spray_records")
      .select("*")
      .eq("id", sprayRecordId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { draft: null, error: error.message };
    row = data ?? null;
  }
  if (!row) return { draft: null, error: "This spray record could not be found." };
  if (String(row.entry_source ?? "") !== "manual")
    return { draft: null, error: MANUAL_NOT_MANUAL_MESSAGE };

  const tripId = text(row.trip_id);
  if (!tripId) return { draft: null, error: "This manual spray has no linked trip." };

  const { payload, error } = await fetchSprayReportV1(tripId);
  if (!payload) return { draft: null, error: error ?? "Spray report unavailable." };
  if (!isManualEntryReport(payload))
    return { draft: null, error: MANUAL_NOT_MANUAL_MESSAGE };

  const storedTanks = normaliseTanks(row.tanks);
  const storedByNumber = new Map<number, any>();
  storedTanks.forEach((t, i) => {
    const n = Number(pick(t, ["tankNumber", "tank_number", "number"]) ?? i + 1);
    storedByNumber.set(Number.isFinite(n) ? n : i + 1, t);
  });

  const tanks: ManualTank[] = payload.tanks.map((t, i) => {
    const stored = storedByNumber.get(t.tankNumber) ?? storedTanks[i] ?? null;
    const storedLines = tankChemicalLines(stored);
    const actualId = text(t.actualId) ?? text(pick(stored, ["actualId", "actual_id"])) ?? "";
    const chemicals: ManualChemicalLine[] = t.chemicals
      .filter((c) => c.actualAmountBase != null || c.actualChemicalId)
      .map((c, ci) => {
        const storedLine =
          storedLines.find(
            (l: any) =>
              text(pick(l, ["actualChemicalId", "actual_chemical_id"])) ===
              text(c.actualChemicalId),
          ) ??
          storedLines.find(
            (l: any) => text(pick(l, ["savedChemicalId", "saved_chemical_id"])) === text(c.savedChemicalId),
          ) ??
          storedLines[ci] ??
          null;
        const unit: WireUnit | null = isWireUnit(c.unit) ? c.unit : null;
        return {
          id:
            text(pick(storedLine, ["id", "lineId", "line_id"])) ??
            text(c.actualChemicalId) ??
            `${actualId || t.tankNumber}-chem-${ci}`,
          savedChemicalId: text(c.savedChemicalId),
          productName: c.name ?? "",
          category: text(pick(storedLine, ["productCategory", "category"])),
          physicalForm: parsePhysicalForm(
            pick(storedLine, ["physicalForm", "physical_form"]) ??
              (unit === "Kg" || unit === "g" ? "solid" : unit ? "liquid" : null),
          ),
          amount: unit ? fromBaseAmount(c.actualAmountBase, unit) : null,
          unit,
          snapshot: (pick(storedLine, ["chemicalSnapshot", "snapshot"]) as any) ?? null,
          snapshotAt: text(pick(storedLine, ["snapshotAt", "snapshot_at"])),
        };
      });
    return {
      id:
        text(pick(stored, ["id", "tankId", "tank_id"])) ??
        (actualId || `tank-${t.tankNumber}`),
      actualId,
      displayNumber: t.tankNumber ?? i + 1,
      waterLitres: t.actualWaterLitres ?? null,
      chemicals,
    };
  });

  const blockNames: Record<string, string> = {};
  for (const b of payload.blocks ?? []) if (b.blockId) blockNames[b.blockId] = b.name;

  // Provenance is preserved exactly as recorded: a station observation stays a
  // station observation and is never re-labelled as an operator observation.
  const weather = (payload.weather ?? []).map((w) => ({
    provenance: w.sourceKind === "manual" ? ("manual" as const) : ("station" as const),
    stationId: w.stationId ?? null,
    observedAt: w.observedAt ?? null,
    source: w.source ?? null,
    temperature: w.temperatureC,
    humidity: w.humidityPct,
    windSpeed: w.windSpeedKmh,
    windGust: w.windGustKmh,
    windDirection: w.windDirectionDeg == null ? null : String(w.windDirectionDeg),
    rain: w.rainMm,
  }));

  const draft: ManualSprayDraft = {
    id: sprayRecordId,
    manualEntryId:
      text(row.manual_entry_id) ?? text(payload.provenance?.manualEntryId) ?? sprayRecordId,
    sprayRecordId,
    tripId,
    syncVersion: Number.isFinite(Number(row.sync_version)) ? Number(row.sync_version) : 0,
    vineyardTimeZone: payload.identity.vineyardTimeZone ?? null,
    vineyardId: payload.identity.vineyardId,
    name: payload.identity.reference ?? "",
    operationType: text(payload.application?.operationType) ?? "manual_spray",
    startAt: payload.trip.startUtc,
    endAt: payload.trip.endUtc,
    tractorId: payload.equipment.tractorId ?? payload.equipment.machineId ?? null,
    operatorUserId: payload.trip.operatorId ?? null,
    sprayEquipmentId: payload.equipment.sprayEquipmentId ?? null,
    startEngineHours: payload.equipment.startEngineHours,
    endEngineHours: payload.equipment.endEngineHours,
    blockIds: (payload.blocks ?? []).map((b) => b.blockId).filter(Boolean),
    blockNames,
    tanks: tanks.length ? tanks : [],
    weather,
    notes: payload.application?.notes ?? "",
  };


  return { draft, error: null };
}
