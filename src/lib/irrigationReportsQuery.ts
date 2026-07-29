// Irrigation Records — Portal Phase 2B reporting data layer (SQL 147).
//
// Every figure rendered by the reporting centre comes from these RPCs on the
// shared VineTrack project. The portal NEVER recalculates totals, depths,
// effective irrigation, rainfall combinations or percentages: the server is
// authoritative and the UI only converts canonical units for display.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { friendlyError } from "@/lib/irrigationQuery";

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(friendlyError(error.message ?? String(error)));
  return data as T;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type WarningSeverity = "info" | "warning" | "error";

export interface ReportWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  affected_count?: number | null;
}

export interface UnitContext {
  volume?: string;
  flow?: string;
  area?: string;
  area_detail?: string;
  depth?: string;
  rainfall?: string;
  duration?: string;
}

export interface ReportEnvelopeBase {
  report: string;
  vineyard_id: string;
  vintage_year: number;
  period_start: string;
  period_end: string;
  timezone: string | null;
  generated_at: string;
  unit_context: UnitContext;
  filters_applied: Record<string, unknown>;
  warnings: ReportWarning[] | null;
}

export type RowEnvelope<Row> = ReportEnvelopeBase & {
  rows: Row[] | null;
  total_litres?: number | null;
};

export type DataQuality = "complete" | "mostly_complete" | "partial" | "limited";

export const DATA_QUALITY_LABEL: Record<DataQuality, string> = {
  complete: "Complete",
  mostly_complete: "Mostly complete",
  partial: "Partial",
  limited: "Limited",
};

// ---------------------------------------------------------------------------
// Filters (§6 — identical parameter names on every RPC)
// ---------------------------------------------------------------------------

export interface IrrigationReportFilters {
  vintage_year: number | null;
  date_from: string | null;
  date_to: string | null;
  system_id: string | null;
  water_source: string | null;
  valve_id: string | null;
  block_id: string | null;
  variety_id: string | null;
  source_type: string | null;
  source_group: string | null;
  calculation_method: string | null;
  measurement_group: string | null;
  include_estimated: boolean;
  include_imported: boolean;
  include_reversed: boolean;
}

export const DEFAULT_REPORT_FILTERS: IrrigationReportFilters = {
  vintage_year: null,
  date_from: null,
  date_to: null,
  system_id: null,
  water_source: null,
  valve_id: null,
  block_id: null,
  variety_id: null,
  source_type: null,
  source_group: null,
  calculation_method: null,
  measurement_group: null,
  include_estimated: true,
  include_imported: true,
  include_reversed: false,
};

export function filterArgs(
  vineyardId: string | null,
  f: IrrigationReportFilters,
): Record<string, unknown> {
  return {
    p_vineyard_id: vineyardId,
    p_vintage_year: f.vintage_year,
    p_date_from: f.date_from,
    p_date_to: f.date_to,
    p_system_id: f.system_id,
    p_water_source: f.water_source,
    p_valve_id: f.valve_id,
    p_block_id: f.block_id,
    p_variety_id: f.variety_id,
    p_source_type: f.source_type,
    p_source_group: f.source_group,
    p_calculation_method: f.calculation_method,
    p_measurement_group: f.measurement_group,
    p_include_estimated: f.include_estimated,
    p_include_imported: f.include_imported,
    p_include_reversed: f.include_reversed,
  };
}

/** Only the filters the user actually applied (mirrors filters_applied). */
export function activeFilterCount(f: IrrigationReportFilters): number {
  let n = 0;
  if (f.date_from || f.date_to) n++;
  for (const key of [
    "system_id",
    "water_source",
    "valve_id",
    "block_id",
    "variety_id",
    "source_type",
    "source_group",
    "calculation_method",
    "measurement_group",
  ] as const) {
    if (f[key]) n++;
  }
  if (!f.include_estimated) n++;
  if (!f.include_imported) n++;
  if (f.include_reversed) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Row shapes (§8)
// ---------------------------------------------------------------------------

export interface VintageOverview extends ReportEnvelopeBase {
  total_litres: number | null;
  effective_litres: number | null;
  directly_reported_litres: number | null;
  directly_measured_litres: number | null;
  calculated_litres: number | null;
  estimated_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  average_session_litres: number | null;

  total_runtime_minutes: number | null;
  session_count: number | null;
  average_session_minutes: number | null;
  longest_session_minutes: number | null;
  shortest_session_minutes: number | null;

  systems_used: number | null;
  water_sources_used: number | null;
  valves_used: number | null;
  blocks_irrigated: number | null;
  varieties_irrigated: number | null;
  serviced_area_hectares: number | null;
  serviced_area_m2: number | null;
  serviced_vines: number | null;

  litres_per_hectare: number | null;
  litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  normalisation_basis: string | null;

  first_irrigation_date: string | null;
  last_irrigation_date: string | null;
  days_since_last_irrigation: number | null;
  highest_use_day: string | null;
  highest_use_day_litres: number | null;
  highest_use_month: string | null;
  highest_use_month_litres: number | null;

  previous_vintage_year: number | null;
  previous_total_litres: number | null;
  volume_difference_litres: number | null;
  volume_difference_percent: number | null;
  previous_depth_mm: number | null;
  depth_difference_mm: number | null;
  previous_runtime_minutes: number | null;
  runtime_difference_minutes: number | null;
  previous_session_count: number | null;
  session_count_difference: number | null;

  rainfall_mm: number | null;
  rainfall_data_complete: boolean | null;
  data_quality: DataQuality | null;
}

export interface PeriodRow {
  period_key: string;
  period_start: string | null;
  period_end: string | null;
  period_label?: string | null;
  week_number?: number | null;
  month_key?: string | null;
  month_label?: string | null;
  month_start?: string | null;
  month_end?: string | null;

  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  estimated_litres: number | null;
  directly_reported_litres: number | null;
  runtime_minutes: number | null;
  session_count: number | null;
  valves_used?: number | null;
  blocks_irrigated?: number | null;
  serviced_area_hectares?: number | null;
  litres_per_hectare?: number | null;
  litres_per_vine?: number | null;
  irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  rainfall_mm: number | null;
  combined_water_input_mm: number | null;
  rainfall_data_complete: boolean | null;

  previous_vintage_total_litres?: number | null;
  previous_vintage_depth_mm?: number | null;
  difference_litres?: number | null;
  difference_percent?: number | null;
}

export interface ValveReportRow {
  valve_id: string;
  valve_name: string | null;
  valve_number: string | null;
  system_id: string | null;
  system_name: string | null;
  water_source: string | null;
  allocation_method: string | null;
  automatic_flow_source: string | null;
  session_count: number | null;
  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  estimated_litres: number | null;
  directly_reported_litres: number | null;
  runtime_minutes: number | null;
  average_session_minutes: number | null;
  average_flow_litres_per_hour: number | null;
  blocks_supplied: number | null;
  rows_supplied: number | null;
  first_use_date: string | null;
  last_use_date: string | null;
  days_since_last_use: number | null;
  percent_of_vineyard_total: number | null;
  warnings?: ReportWarning[] | null;
}

export interface BlockReportRow {
  block_id: string;
  block_name: string | null;
  variety_id: string | null;
  variety_name: string | null;
  session_count: number | null;
  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  estimated_litres: number | null;
  runtime_minutes: number | null;
  serviced_area_hectares: number | null;
  serviced_area_m2: number | null;
  serviced_vines: number | null;
  litres_per_hectare: number | null;
  litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  rainfall_mm: number | null;
  combined_water_input_mm: number | null;
  first_irrigation_date: string | null;
  last_irrigation_date: string | null;
  previous_vintage_litres: number | null;
  difference_litres: number | null;
  difference_percent: number | null;
  warnings?: ReportWarning[] | null;
}

export interface VarietyReportRow {
  variety_id: string | null;
  variety_name: string | null;
  block_count: number | null;
  session_count: number | null;
  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  serviced_area_hectares: number | null;
  serviced_vines: number | null;
  litres_per_hectare: number | null;
  litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
  rainfall_mm: number | null;
  combined_water_input_mm: number | null;
  previous_vintage_litres: number | null;
  difference_litres: number | null;
  difference_percent: number | null;
  warnings?: ReportWarning[] | null;
}

export interface WaterSourceRow {
  water_source: string | null;
  system_count: number | null;
  valve_count: number | null;
  session_count: number | null;
  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  estimated_litres: number | null;
  directly_reported_litres: number | null;
  runtime_minutes: number | null;
  percent_of_vineyard_total: number | null;
  first_use_date: string | null;
  last_use_date: string | null;
}

export interface CalculationSourceRow {
  calculation_method: string | null;
  calculation_label: string | null;
  measurement_group: string | null;
  measurement_label: string | null;
  session_count: number | null;
  total_litres: number | null;
  percent_of_total_litres: number | null;
  runtime_minutes: number | null;
}

export interface RecordSourceRow {
  source_type: string | null;
  source_label: string | null;
  source_group: string | null;
  session_count: number | null;
  total_litres: number | null;
  percent_of_total_litres: number | null;
  first_recorded_at: string | null;
  last_recorded_at: string | null;
}

export type RainfallGrouping = "day" | "week" | "month" | "vintage";

export interface RainfallRow {
  period_key: string;
  period_start: string | null;
  period_end: string | null;
  period_label?: string | null;
  rainfall_mm: number | null;
  gross_irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  combined_water_input_mm: number | null;
  irrigation_percent_of_combined: number | null;
  rainfall_percent_of_combined: number | null;
  rainfall_data_complete: boolean | null;
}

export interface TrendRow {
  vintage_year: number;
  period_start: string | null;
  period_end: string | null;
  total_litres: number | null;
  effective_litres: number | null;
  manual_litres: number | null;
  imported_litres: number | null;
  estimated_litres: number | null;
  directly_reported_litres: number | null;
  runtime_minutes: number | null;
  session_count: number | null;
  serviced_area_hectares: number | null;
  litres_per_hectare: number | null;
  litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  rainfall_mm: number | null;
  combined_water_input_mm: number | null;
  data_quality: DataQuality | null;
  warnings?: ReportWarning[] | null;
}

export interface ReportSession {
  id: string;
  session_date: string;
  started_at: string | null;
  finished_at: string | null;
  duration_minutes: number | null;
  total_volume_litres: number | null;
  effective_volume_litres: number | null;
  valve_id: string | null;
  valve_name: string | null;
  system_name: string | null;
  water_source: string | null;
  status: string | null;
  source_type: string | null;
  source_group: string | null;
  source_label: string | null;
  calculation_method: string | null;
  calculation_label: string | null;
  measurement_group: string | null;
  notes: string | null;
}

export interface ReportSessionsResponse {
  sessions: ReportSession[] | null;
  total_count: number | null;
  vintage_year: number | null;
  generated_at: string | null;
  warnings?: ReportWarning[] | null;
}

// ---------------------------------------------------------------------------
// Hooks — each report loads on demand (the active tab only)
// ---------------------------------------------------------------------------

const STALE = 60_000;

function reportQuery<T>(
  key: string,
  fn: string,
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled: boolean,
  extra: Record<string, unknown> = {},
) {
  return {
    queryKey: ["irrigation-report", key, vineyardId, filters, extra] as const,
    enabled: !!vineyardId && enabled,
    staleTime: STALE,
    queryFn: () => call<T>(fn, { ...filterArgs(vineyardId, filters), ...extra }),
  };
}

export function useVintageOverview(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<VintageOverview>(
      "overview",
      "get_irrigation_vintage_overview",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useDailyReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  includeZeroDays: boolean,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<PeriodRow>>(
      "daily",
      "get_irrigation_daily_report",
      vineyardId,
      filters,
      enabled,
      { p_include_zero_days: includeZeroDays },
    ),
  );
}

export function useWeeklyReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  includeZeroWeeks: boolean,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<PeriodRow>>(
      "weekly",
      "get_irrigation_weekly_summary",
      vineyardId,
      filters,
      enabled,
      { p_include_zero_weeks: includeZeroWeeks },
    ),
  );
}

export function useMonthlyReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<PeriodRow>>(
      "monthly",
      "get_irrigation_monthly_report",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useValveReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<ValveReportRow>>(
      "valve",
      "get_irrigation_valve_report",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useBlockReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<BlockReportRow>>(
      "block",
      "get_irrigation_block_report",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useVarietyReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<VarietyReportRow>>(
      "variety",
      "get_irrigation_variety_report",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useWaterSourceReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<WaterSourceRow>>(
      "water-source",
      "get_irrigation_water_source_summary",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useCalculationSourceReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<CalculationSourceRow>>(
      "calculation-source",
      "get_irrigation_calculation_source_summary",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useRecordSourceReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<RecordSourceRow>>(
      "record-source",
      "get_irrigation_record_source_summary",
      vineyardId,
      filters,
      enabled,
    ),
  );
}

export function useRainfallReport(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  groupBy: RainfallGrouping,
  enabled = true,
) {
  return useQuery(
    reportQuery<RowEnvelope<RainfallRow>>(
      "rainfall",
      "get_irrigation_rainfall_summary",
      vineyardId,
      filters,
      enabled,
      { p_group_by: groupBy },
    ),
  );
}

/** Trends take no date filters (§8.12) — vintage window + count only. */
export function useVintageTrends(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  vintageCount: number,
  enabled = true,
) {
  const trendFilters: IrrigationReportFilters = {
    ...filters,
    date_from: null,
    date_to: null,
  };
  const args = filterArgs(vineyardId, trendFilters);
  delete (args as any).p_date_from;
  delete (args as any).p_date_to;
  return useQuery({
    queryKey: ["irrigation-report", "trends", vineyardId, trendFilters, vintageCount],
    enabled: !!vineyardId && enabled,
    staleTime: STALE,
    queryFn: () =>
      call<RowEnvelope<TrendRow>>("get_irrigation_vintage_trends", {
        ...args,
        p_vintage_count: vintageCount,
      }),
  });
}

export interface DrillDown {
  title: string;
  /** Filter overrides applied on top of the active report filters. */
  overrides: Partial<IrrigationReportFilters>;
}

export function useReportSessions(
  vineyardId: string | null,
  filters: IrrigationReportFilters,
  drill: DrillDown | null,
  limit = 50,
  offset = 0,
) {
  const merged: IrrigationReportFilters = { ...filters, ...(drill?.overrides ?? {}) };
  return useQuery({
    queryKey: ["irrigation-report", "sessions", vineyardId, merged, limit, offset],
    enabled: !!vineyardId && !!drill,
    staleTime: STALE,
    queryFn: () =>
      call<ReportSessionsResponse>("list_irrigation_report_sessions", {
        ...filterArgs(vineyardId, merged),
        p_limit: limit,
        p_offset: offset,
      }),
  });
}

/** Invalidate every Phase 2B report (records changed, import committed…). */
export function useInvalidateIrrigationReports() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["irrigation-report"] });
}
