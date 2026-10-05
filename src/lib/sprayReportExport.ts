// Single portal entry point for every spraying export (Trips, Spray Records,
// Documents, Reports). Always reads the canonical `get_spray_report_v1` payload;
// a spraying trip is never sent to the generic Trip Report.
import type { RegionFormatters } from "./regionFormatters";
import { extractPathPoints } from "./tripReport";
import { fetchSprayReportV1, SPRAY_RECORD_UNAVAILABLE_MESSAGE } from "./sprayReportV1";
import { resolveSprayRoute, ROUTE_RENDER_FAILED_MESSAGE } from "./sprayReportRoute";
import { saveSprayReportPdf } from "./sprayReportPdf";
import { EMPTY_BRANDING, loadSprayReportBranding } from "./sprayReportBranding";
import type { SprayReportPayloadV1 } from "./sprayReportV1";
import { fetchChemicalSeasonPrices } from "./chemicalSeasonPricing";
import { fetchVineyardSeasonSettings, vintageForDate } from "./vineyardSeasonSettingsQuery";
import {
  overlaySprayReportCost,
  plannedTanksFromSprayRecord,
  resolveChemicalCost,
  selectChemicalUsage,
  tanksFromSprayReportPayload,
} from "./chemicalCostResolver";
import { supabase } from "@/integrations/ios-supabase/client";

/**
 * Display-only seasonal chemical cost for an Owner/Manager Spray Report PDF.
 * Quantities come from the canonical payload tanks (actual when complete,
 * else planned); prices from SQL 264 with p_as_of = null. A genuine legacy
 * snapshot is read from the spray record's own planned line only.
 */
export async function resolveSprayReportCostOverlay(
  payload: SprayReportPayloadV1,
): Promise<Record<string, unknown> | null> {
  if (!payload.cost) return null;
  const vineyardId = payload.identity.vineyardId;
  const start = payload.identity.startUtc ?? null;
  if (!vineyardId || !start) return null;
  const season = await fetchVineyardSeasonSettings(vineyardId);
  const vintage = vintageForDate(new Date(start), season.season_start_month, season.season_start_day);
  const prices = await fetchChemicalSeasonPrices(vineyardId, vintage, null);

  const legacy = new Map<string, number>();
  if (payload.identity.sprayRecordId) {
    const { data } = await (supabase as any)
      .from("spray_records")
      .select("tanks")
      .eq("id", payload.identity.sprayRecordId)
      .maybeSingle();
    for (const t of plannedTanksFromSprayRecord(data?.tanks)) {
      for (const l of t.lines) {
        if (l.plannedChemicalId && l.legacyCostPerUnit != null) legacy.set(l.plannedChemicalId, l.legacyCostPerUnit);
      }
    }
  }
  const { planned, actual } = tanksFromSprayReportPayload(payload, legacy);
  const sel = selectChemicalUsage(planned, actual);
  const res = resolveChemicalCost(sel.lines, prices, sel.lines.length ? sel.quantityBasis : null);
  return overlaySprayReportCost(payload.cost as Record<string, unknown>, res);
}

export interface DownloadSprayReportOptions {
  tripId: string;
  formatters?: RegionFormatters;
  /** Raw trip path points, used only for the one-time fallback route image. */
  pathPoints?: unknown;
  /**
   * Owner/Manager only. When true and the canonical payload carries a cost,
   * the chemical cost is re-resolved from SQL 264 (final vintage price) for
   * the PDF. Never requested for other roles.
   */
  canSeeCosts?: boolean;
}

export interface DownloadSprayReportResult {
  ok: boolean;
  filename?: string;
  error?: string;
}

export async function downloadSprayReport(
  opts: DownloadSprayReportOptions,
): Promise<DownloadSprayReportResult> {
  if (!opts.tripId) return { ok: false, error: SPRAY_RECORD_UNAVAILABLE_MESSAGE };

  const { payload, error } = await fetchSprayReportV1(opts.tripId);
  if (!payload) return { ok: false, error: error ?? SPRAY_RECORD_UNAVAILABLE_MESSAGE };

  let routeImage = null;
  let routeWarning: string | null = null;
  try {
    const resolved = await resolveSprayRoute(payload, extractPathPoints(opts.pathPoints));
    routeImage = resolved.image;
    routeWarning = resolved.warning;
  } catch {
    routeImage = null;
    routeWarning = ROUTE_RENDER_FAILED_MESSAGE;
  }

  // Branding uses the TRIP's vineyard, never the currently selected one.
  const branding = await loadSprayReportBranding(payload.identity.vineyardId).catch(
    () => EMPTY_BRANDING,
  );

  let costOverlay: Record<string, unknown> | null = null;
  if (opts.canSeeCosts && payload.cost && typeof payload.cost === "object") {
    costOverlay = await resolveSprayReportCostOverlay(payload).catch(() => null);
  }

  const filename = saveSprayReportPdf(payload, {
    formatters: opts.formatters,
    routeImage,
    routeWarning,
    branding,
    costOverlay,
  });
  return { ok: true, filename };
}
