// Single portal entry point for every spraying export (Trips, Spray Records,
// Documents, Reports). Always reads the canonical `get_spray_report_v1` payload;
// a spraying trip is never sent to the generic Trip Report.
import type { RegionFormatters } from "./regionFormatters";
import { extractPathPoints } from "./tripReport";
import { fetchSprayReportV1, SPRAY_RECORD_UNAVAILABLE_MESSAGE } from "./sprayReportV1";
import { resolveSprayRoute, ROUTE_RENDER_FAILED_MESSAGE } from "./sprayReportRoute";
import { saveSprayReportPdf } from "./sprayReportPdf";

export interface DownloadSprayReportOptions {
  tripId: string;
  formatters?: RegionFormatters;
  /** Raw trip path points, used only for the one-time fallback route image. */
  pathPoints?: unknown;
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

  const filename = saveSprayReportPdf(payload, {
    formatters: opts.formatters,
    routeImage,
    routeWarning,
  });
  return { ok: true, filename };
}
