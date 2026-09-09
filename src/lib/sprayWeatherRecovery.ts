// Historical hourly weather recovery for a spray trip.
//
// The portal never invents an observation: it asks the authorised recovery
// action to fill any scheduled hour that is still missing. Missing slots are
// themselves the retry queue, so a transient failure simply leaves the slot
// missing rather than marking it unavailable.
import { supabase } from "@/integrations/ios-supabase/client";
import type { SprayReportWeather } from "@/lib/sprayReportV1";

export const WEATHER_RECOVERY_FAILED =
  "Historical weather couldn't be retrieved just now. Recorded observations are unchanged — try again shortly.";
export const WEATHER_RECOVERY_UNSUPPORTED =
  "This weather source doesn't offer an hourly history, so past hours stay as not recorded.";
export const WEATHER_RECOVERY_NONE =
  "No further observations were available for the missing hours.";

export type WeatherRecoveryOutcome =
  | { kind: "recovered"; captured: number; message: string }
  | { kind: "pending"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "failed"; message: string; diagnostic: string };

/**
 * Deployed response contract. `captured` counts genuine persisted observations;
 * there is no `filled` field.
 */
export interface WeatherRecoveryResponse {
  success?: boolean;
  captured?: number;
  pending?: number;
  unavailable?: number;
  provider?: string | null;
  stationId?: string | null;
  errors?: unknown[];
  supported?: boolean;
  status?: string;
}

/** Ask the authorised recovery action to fill missing scheduled hours. */
export async function recoverSprayWeather(
  tripId: string,
  through: string = new Date().toISOString(),
): Promise<WeatherRecoveryOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke("spray-weather-recovery", {
      body: { tripId, through },
    });
    if (error) {
      return {
        kind: "failed",
        message: WEATHER_RECOVERY_FAILED,
        diagnostic: `spray-weather-recovery invoke failed: ${error.message}`,
      };
    }
    const res = (data ?? {}) as WeatherRecoveryResponse;
    if (res.supported === false || res.status === "unsupported_provider") {
      return { kind: "unsupported", message: WEATHER_RECOVERY_UNSUPPORTED };
    }
    const captured = typeof res.captured === "number" ? res.captured : 0;
    if (captured > 0) {
      return {
        kind: "recovered",
        captured,
        message: `${captured} past ${captured === 1 ? "hour" : "hours"} of weather retrieved.`,
      };
    }
    if ((res.pending ?? 0) > 0) {
      return {
        kind: "pending",
        message: "Some hours are still waiting on the weather station — try again later.",
      };
    }
    if ((res.unavailable ?? 0) > 0) {
      return {
        kind: "pending",
        message: "The weather station holds no records for those hours, so they stay as not recorded.",
      };
    }
    return { kind: "pending", message: WEATHER_RECOVERY_NONE };
  } catch (e) {
    return {
      kind: "failed",
      message: WEATHER_RECOVERY_FAILED,
      diagnostic: `spray-weather-recovery threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Readable provenance for one weather row. */
export function weatherProvenanceLabel(w: SprayReportWeather): string {
  const bits: string[] = [];
  if (w.stationId) bits.push(`Station ${w.stationId}`);
  switch (w.retrievalMode) {
    case "live":
      bits.push("recorded live");
      break;
    case "historical_archive":
      bits.push("retrieved from the station's hourly history");
      break;
    case "legacy_snapshot":
      bits.push("saved with the original spray record");
      break;
    case "unavailable":
      bits.push("no observation available");
      break;
    default:
      break;
  }
  return bits.join(" · ");
}
