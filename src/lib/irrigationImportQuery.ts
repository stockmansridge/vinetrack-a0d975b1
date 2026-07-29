// Irrigation Records — Phase 2A import data layer (SQL 142 contract).
//
// The portal never inserts irrigation sessions and never recalculates
// volumes, thresholds or duplicate state locally. Every read and write goes
// through the SQL 142 security-definer RPCs (System Administrator gated) or
// the `parse-galcon-irrigation-import` Edge Function on the shared VineTrack
// project. This module is the only place those calls are made.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { friendlyError } from "@/lib/irrigationQuery";

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(name, args);

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(friendlyError(error.message ?? String(error)));
  return data as T;
}

// ---------------------------------------------------------------------------
// Types — mirrors of the SQL 142 jsonb shapes
// ---------------------------------------------------------------------------

export interface ImportProvider {
  provider_id: string;
  display_name: string;
  supported_file_types: string[];
  max_file_size_bytes: number;
  max_source_rows: number;
  required_headers: string[];
  optional_headers?: string[];
  date_format?: string;
  time_format?: string;
  volume_units?: string;
  flow_units?: string;
  default_import_thresholds?: {
    minimum_import_volume_litres: number;
    comparison: VolumeComparison;
    exclude_test_programs: boolean;
  };
  parser_edge_function?: string;
}

export type VolumeComparison = "greater_than" | "greater_than_or_equal";

export interface ImportProviderSettings {
  vineyard_id?: string;
  provider?: string;
  external_controller_key?: string | null;
  external_controller_name?: string | null;
  minimum_volume_litres: number;
  volume_comparison: VolumeComparison;
  exclude_test_programs: boolean;
  timezone?: string | null;
}

export interface ImportBatch {
  batch_id?: string;
  id?: string;
  vineyard_id?: string;
  provider?: string;
  status?: string;
  file_name?: string;
  file_sha256?: string;
  external_controller_key?: string | null;
  external_controller_name?: string | null;
  source_rows?: number;
  created_at?: string;
  committed_at?: string | null;
  reversed_at?: string | null;
  revalidation_only?: boolean;
  imported_sessions?: number;
  [k: string]: unknown;
}

export interface ImportPreview {
  total_source_rows: number;
  eligible_completed: number;
  below_threshold: number;
  at_threshold: number;
  test_program: number;
  cancelled: number;
  controller_errors: number;
  zero_activity: number;
  needs_review: number;
  parse_errors: number;
  unmapped_valves: number;
  exact_duplicates: number;
  possible_changed_duplicates: number;
  selected_for_import: number;
  already_imported: number;
  distinct_valves: number;
  threshold_litres: number;
  volume_comparison: VolumeComparison;
  exclude_test_programs: boolean;
  threshold_explanation?: string | null;
  batch?: ImportBatch;
  [k: string]: unknown;
}

export interface ParseResult {
  ok: boolean;
  batch_id: string;
  duplicate_file?: boolean;
  message?: string;
  batch?: ImportBatch;
  file?: {
    name?: string;
    sha256?: string;
    size_bytes?: number;
    worksheet?: string;
    unit_name?: string;
    source_rows?: number;
    rows_with_parse_errors?: number;
  };
  preview?: ImportPreview;
}

export type ValveMappingStatus = "saved" | "conflict" | "ignored" | "suggested" | "unmapped";

export interface ImportValve {
  external_station_code: string | null;
  external_valve_number: number | null;
  external_valve_name: string;
  external_valve_label?: string | null;
  row_count: number;
  status: ValveMappingStatus;
  mapping_id?: string | null;
  irrigation_valve_id?: string | null;
  vinetrack_valve_name?: string | null;
  is_ignored?: boolean | null;
  mapping_source?: string | null;
  valve_is_active?: boolean | null;

  name_changed?: boolean;
  previous_external_name?: string | null;
  suggested_valve_id?: string | null;
  suggested_valve_name?: string | null;
}

export type RowValidationStatus = "eligible" | "excluded" | "needs_review" | "error";

export type RowClassification =
  | "completed"
  | "ended_manually"
  | "cancelled_manual"
  | "cancelled_error"
  | "cancelled_not_enabled"
  | "paused"
  | "continued"
  | "low_flow_error"
  | "high_flow_error"
  | "no_flow_error"
  | "test"
  | "zero_activity"
  | "below_volume_threshold"
  | "at_volume_threshold"
  | "needs_review"
  | "unknown_comment";

export type DuplicateStatus =
  | "new"
  | "duplicate_imported"
  | "duplicate_ignored"
  | "duplicate_reviewed"
  | "possible_duplicate_changed_values";

export interface ImportRow {
  /** Live payload uses `id`; this is the value passed to row overrides. */
  id: string;
  source_row_number?: number | null;
  parsed_date?: string | null;
  parsed_start_time?: string | null;
  parsed_end_time?: string | null;
  parsed_duration_seconds?: number | null;
  program_name?: string | null;
  source_comment?: string | null;
  external_valve_name?: string | null;
  external_valve_label?: string | null;
  external_station_code?: string | null;
  external_valve_number?: number | null;
  vinetrack_valve_name?: string | null;
  matched_valve_id?: string | null;
  matched_mapping_id?: string | null;
  created_session_id?: string | null;
  is_reversed?: boolean | null;
  validation_errors?: string[] | null;
  validation_warnings?: string[] | null;
  classification: RowClassification;

  validation_status: RowValidationStatus;
  primary_exclusion_reason?: string | null;
  additional_reason_codes?: string[] | null;
  duplicate_status?: DuplicateStatus | null;
  duplicate_reference?: string | null;
  water_flow_reconciliation?: string | null;
  expected_water_litres?: number | null;
  original_water_value?: number | null;
  original_water_unit?: string | null;
  original_flow_value?: number | null;
  original_flow_unit?: string | null;
  parsed_water_litres?: number | null;
  parsed_flow_litres_per_hour?: number | null;
  threshold_explanation?: string | null;
  override_threshold?: boolean | null;
  override_test?: boolean | null;
  [k: string]: unknown;
}

export interface CommitResult {
  imported: number;
  already_imported: number;
  skipped_duplicate: number;
  needs_review: number;
  results: Array<{
    row_id: string;
    status: "imported" | "already_imported" | "skipped_duplicate" | "needs_review" | "skipped";
    session_id?: string | null;
    reason?: string | null;
  }>;
}

export interface ReversalImpact {
  sessions_affected: number;
  total_water_litres_removed?: number | null;
  date_range_from?: string | null;
  date_range_to?: string | null;
  valves_affected?: Array<string | { valve_name?: string; name?: string }> | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asArray = <T,>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const candidate = (data as Record<string, unknown>).items ?? (data as Record<string, unknown>).rows;
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
};

export const batchId = (batch: ImportBatch | undefined | null): string | null =>
  (batch?.batch_id as string) ?? (batch?.id as string) ?? null;

export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney";

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** m³ label for a litre value, matching the contract's copy ("1.0 m³"). */
export const litresToCubicLabel = (litres: number | null | undefined): string =>
  litres == null ? "—" : `${(litres / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 3 })} m³`;

export const COMPARISON_LABEL: Record<VolumeComparison, string> = {
  greater_than: "more than",
  greater_than_or_equal: "at least",
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useImportProviders() {
  return useQuery({
    queryKey: ["irrigation-import", "providers"],
    staleTime: 5 * 60_000,
    queryFn: async () => asArray<ImportProvider>(await call("list_irrigation_import_providers")),
  });
}

export function useImportProviderSettings(
  vineyardId: string | null,
  provider: string,
  controllerKey: string | null,
) {
  return useQuery({
    queryKey: ["irrigation-import", "settings", vineyardId, provider, controllerKey ?? ""],
    enabled: !!vineyardId,
    queryFn: async () =>
      (await call<ImportProviderSettings>("get_irrigation_import_provider_settings", {
        p_vineyard_id: vineyardId,
        p_provider: provider,
        p_external_controller_key: controllerKey ?? "",
      })) ?? null,
  });
}

export function useSaveImportProviderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      vineyardId: string;
      provider: string;
      controllerKey: string | null;
      controllerName?: string | null;
      minimumVolumeLitres: number;
      volumeComparison: VolumeComparison;
      excludeTestPrograms: boolean;
      timezone?: string | null;
    }) =>
      call<ImportProviderSettings>("set_irrigation_import_provider_settings", {
        p_vineyard_id: args.vineyardId,
        p_provider: args.provider,
        p_external_controller_key: args.controllerKey ?? "",
        p_external_controller_name: args.controllerName ?? null,
        p_minimum_volume_litres: args.minimumVolumeLitres,
        p_volume_comparison: args.volumeComparison,
        p_exclude_test_programs: args.excludeTestPrograms,
        p_timezone: args.timezone ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["irrigation-import", "settings"] }),
  });
}

/** Upload + parse through the deployed Edge Function (forwards the user JWT). */
export function useParseImportFile() {
  return useMutation({
    mutationFn: async (args: {
      vineyardId: string;
      provider: string;
      /** Edge Function name from the provider registry (`parser_edge_function`). */
      parserEdgeFunction: string;
      file: File;
      timezone?: string;
      allowRevalidation?: boolean;
    }): Promise<ParseResult> => {
      const file_base64 = await fileToBase64(args.file);
      const { data, error } = await supabase.functions.invoke(args.parserEdgeFunction, {
        body: {
          vineyard_id: args.vineyardId,
          provider: args.provider,
          file_name: args.file.name,
          file_base64,
          timezone: args.timezone ?? browserTimezone(),
          allow_revalidation: !!args.allowRevalidation,
        },
      });
      if (error) {
        let detail = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          const body = await ctx.text().catch(() => "");
          if (body) {
            try {
              const parsed = JSON.parse(body);
              detail = [parsed.error, parsed.message, parsed.missing_headers?.length ? `Missing columns: ${parsed.missing_headers.join(", ")}` : null]
                .filter(Boolean)
                .join(" — ") || body;
            } catch {
              detail = body;
            }
          }
        }
        throw new Error(detail);
      }
      return data as ParseResult;
    },
  });
}

export function useImportValves(batch: string | null) {
  return useQuery({
    queryKey: ["irrigation-import", "valves", batch],
    enabled: !!batch,
    queryFn: async () => asArray<ImportValve>(await call("list_irrigation_import_valves", { p_batch_id: batch })),
  });
}

export function useSetValveMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      vineyardId: string;
      provider: string;
      controllerKey: string | null;
      controllerName?: string | null;
      externalValveName: string;
      externalStationCode?: string | null;
      externalValveNumber?: number | null;
      irrigationValveId: string | null;
      ignore?: boolean;
      confirmChange?: boolean;
    }) =>
      call("set_irrigation_controller_valve_mapping", {
        p_vineyard_id: args.vineyardId,
        p_provider: args.provider,
        p_external_controller_key: args.controllerKey ?? "",
        p_external_valve_name: args.externalValveName,
        p_external_station_code: args.externalStationCode ?? null,
        p_external_valve_number: args.externalValveNumber ?? null,
        p_external_controller_name: args.controllerName ?? null,
        p_irrigation_valve_id: args.irrigationValveId,
        p_ignore: !!args.ignore,
        p_confirm_change: !!args.confirmChange,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["irrigation-import", "valves"] });
      qc.invalidateQueries({ queryKey: ["irrigation-import", "rows"] });
      qc.invalidateQueries({ queryKey: ["irrigation-import", "preview"] });
    },
  });
}

/** Re-classify a batch. Optional args also persist the batch's own settings. */
export function useValidateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      batchId: string;
      thresholdLitres?: number | null;
      volumeComparison?: VolumeComparison | null;
      excludeTestPrograms?: boolean | null;
    }) =>
      call<ImportPreview>("validate_irrigation_import", {
        p_batch_id: args.batchId,
        p_threshold_litres: args.thresholdLitres ?? null,
        p_volume_comparison: args.volumeComparison ?? null,
        p_exclude_test_programs: args.excludeTestPrograms ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["irrigation-import", "rows"] });
      qc.invalidateQueries({ queryKey: ["irrigation-import", "valves"] });
      qc.invalidateQueries({ queryKey: ["irrigation-import", "preview"] });
    },
  });
}

export function useImportRows(
  batch: string | null,
  filters: { validationStatus?: RowValidationStatus | null; classification?: RowClassification | null; limit?: number; offset?: number },
) {
  const { validationStatus = null, classification = null, limit = 100, offset = 0 } = filters;
  return useQuery({
    queryKey: ["irrigation-import", "rows", batch, validationStatus, classification, limit, offset],
    enabled: !!batch,
    queryFn: async () =>
      asArray<ImportRow>(
        await call("list_irrigation_import_rows", {
          p_batch_id: batch,
          p_validation_status: validationStatus,
          p_classification: classification,
          p_limit: limit,
          p_offset: offset,
          p_include_raw: false,
        }),
      ),
  });
}

export function useSetRowOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      rowId: string;
      overrideThreshold?: boolean;
      overrideTest?: boolean;
      reason: string;
    }) =>
      call<ImportPreview>("set_irrigation_import_row_override", {
        p_row_id: args.rowId,
        p_override_threshold: !!args.overrideThreshold,
        p_override_test: !!args.overrideTest,
        p_reason: args.reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["irrigation-import", "rows"] });
      qc.invalidateQueries({ queryKey: ["irrigation-import", "preview"] });
    },
  });
}

export function useImportPreview(batch: string | null) {
  return useQuery({
    queryKey: ["irrigation-import", "preview", batch],
    enabled: !!batch,
    queryFn: async () => (await call<ImportPreview>("preview_irrigation_import", { p_batch_id: batch })) ?? null,
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { batchId: string; rowIds?: string[] | null; acknowledgeCurrentConfiguration: boolean }) =>
      call<CommitResult>("commit_irrigation_import", {
        p_batch_id: args.batchId,
        p_row_ids: args.rowIds ?? null,
        p_acknowledge_current_configuration: args.acknowledgeCurrentConfiguration,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["irrigation-import"] });
      qc.invalidateQueries({ queryKey: ["irrigation"] });
    },
  });
}

export function useImportBatches(vineyardId: string | null, provider: string | null, limit = 25) {
  return useQuery({
    queryKey: ["irrigation-import", "batches", vineyardId, provider, limit],
    enabled: !!vineyardId,
    queryFn: async () =>
      asArray<ImportBatch>(
        await call("list_irrigation_import_batches", {
          p_vineyard_id: vineyardId,
          p_provider: provider,
          p_limit: limit,
          p_offset: 0,
        }),
      ),
  });
}

export function useImportBatch(batch: string | null) {
  return useQuery({
    queryKey: ["irrigation-import", "batch", batch],
    enabled: !!batch,
    queryFn: async () => (await call<ImportPreview>("get_irrigation_import_batch", { p_batch_id: batch })) ?? null,
  });
}

export function useReverseImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { batchId: string; dryRun: boolean }) =>
      call<ReversalImpact>("reverse_irrigation_import_batch", {
        p_batch_id: args.batchId,
        p_dry_run: args.dryRun,
      }),
    onSuccess: (_d, vars) => {
      if (!vars.dryRun) {
        qc.invalidateQueries({ queryKey: ["irrigation-import"] });
        qc.invalidateQueries({ queryKey: ["irrigation"] });
      }
    },
  });
}
