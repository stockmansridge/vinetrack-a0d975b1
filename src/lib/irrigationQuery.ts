// Irrigation Records — Portal Phase 1 data layer.
//
// Every call goes to the shared VineTrack Supabase project through the
// SQL 125 RPC contract. The portal never recalculates volumes, allocations
// or reporting figures locally: the server is authoritative and the UI only
// renders what the RPCs return.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(name, args);

/** Unwrap a Supabase RPC response, throwing the raw Postgres message. */
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(friendlyError(error.message ?? String(error)));
  return data as T;
}

/** SQL 125 raises `code: message` style errors — surface the readable part. */
export function friendlyError(message: string): string {
  const m = /^([a-z_]+):\s*(.+)$/i.exec(message.trim());
  if (m) return m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return message;
}

// ---------------------------------------------------------------------------
// Types (mirrors of the SQL 125 jsonb shapes)
// ---------------------------------------------------------------------------

export type CalculationMethod =
  | "configured_flow"
  | "session_flow"
  | "total_volume"
  | "meter_readings";

export const CALCULATION_METHOD_LABEL: Record<CalculationMethod, string> = {
  configured_flow: "Configured valve flow rate",
  session_flow: "Flow rate for this session",
  total_volume: "Total volume used",
  meter_readings: "Water meter readings",
};

export type AllocationMethod =
  | "manual_percentage"
  | "emitter_count"
  | "vine_count"
  | "irrigated_area"
  | "rows";

export const ALLOCATION_METHOD_LABEL: Record<AllocationMethod, string> = {
  manual_percentage: "Manual percentage",
  emitter_count: "Emitter count",
  vine_count: "Vine count",
  irrigated_area: "Irrigated area",
  rows: "Rows",
};


export interface IrrigationSystem {
  id: string;
  vineyard_id: string;
  name: string;
  water_source: string | null;
  controller_provider: string | null;
  controller_name: string | null;
  external_controller_id: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface IrrigationValve {
  id: string;
  vineyard_id: string;
  irrigation_system_id: string;
  system_name?: string | null;
  name: string;
  valve_number: string | null;
  configured_flow_litres_per_hour: number | null;
  measured_flow_litres_per_hour: number | null;
  is_active: boolean;
  notes: string | null;
  active_block_count?: number | null;
}

export interface IrrigationValveBlock {
  id: string;
  valve_id: string;
  block_id: string;
  block_name?: string | null;
  allocation_method: AllocationMethod;
  allocation_percentage: number | null;
  serviced_area_m2: number | null;
  serviced_vine_count: number | null;
  serviced_emitter_count: number | null;
  row_start: number | null;
  row_end: number | null;
  configured_flow_litres_per_hour: number | null;
  is_active: boolean;
  /** SQL 126 additions */
  uses_rows?: boolean | null;
  row_count?: number | null;
  weighting_basis?: string | null;
  updated_at?: string | null;
}


export interface SetupStatus {
  season: {
    season_start_month: number;
    season_start_day: number;
    current_vintage_year: number;
  };
  required: {
    season_settings_ok: boolean;
    active_block_count: number;
    blocks_ok: boolean;
    active_system_count: number;
    systems_ok: boolean;
    active_valve_count: number;
    valves_ok: boolean;
    fully_allocated_valve_count: number;
    allocations_ok: boolean;
    valves_with_configured_flow: number;
  };
  recommended: {
    total_active_blocks: number;
    blocks_with_area: number;
    blocks_with_vine_count: number;
    blocks_with_vine_spacing: number;
    blocks_with_dripper_output: number;
    blocks_with_dripper_spacing: number;
    blocks_with_efficiency: number;
  };
  valves: Array<{
    valve_id: string;
    valve_name: string;
    block_count: number;
    allocation_total: number;
    allocation_ok: boolean;
    has_configured_flow: boolean;
    /** SQL 126 additions */
    uses_rows?: boolean | null;
    row_count?: number | null;
    weighting_basis?: string | null;
    is_operational?: boolean | null;
  }>;
  is_operational: boolean;
}

export interface ValveValidation {
  valve_id: string;
  valve_name: string;
  can_record: boolean;
  has_configured_flow: boolean;
  configured_flow_litres_per_hour: number | null;
  measured_flow_litres_per_hour: number | null;
  requires_volume_entry: boolean;
  allocations: Array<Record<string, any>>;
  allocation_total: number;
  issues: string[];
  /** SQL 126 additions */
  uses_rows?: boolean | null;
  row_count?: number | null;
  weighting_basis?: string | null;
  warnings?: string[] | null;
}

export interface PreviewBlock {
  block_id: string;
  block_name: string;
  variety_id: string | null;
  variety_name: string | null;
  allocation_method: AllocationMethod;
  allocation_percentage: number;
  allocated_volume_litres: number;
  effective_volume_litres: number | null;
  serviced_area_m2: number | null;
  serviced_vine_count: number | null;
  water_litres_per_vine: number | null;
  water_litres_per_hectare: number | null;
  irrigation_depth_mm: number | null;
  effective_irrigation_depth_mm: number | null;
  /** SQL 126 additions */
  row_count?: number | null;
  rows?: Array<Record<string, any>> | null;
  weighting_basis?: string | null;
}

export interface IrrigationPreview {
  total_volume_litres: number;
  effective_volume_litres: number | null;
  irrigation_efficiency_percent: number | null;
  blocks: PreviewBlock[];
  warnings: string[];
  irrigation_system_id: string;
  irrigation_system_name: string;
  valve_id: string;
  valve_name: string;
  flow_litres_per_hour_used: number | null;
  configuration_snapshot: Record<string, any>;
  session_date: string;
  duration_minutes: number;
  vintage_year: number;
  /** SQL 126 additions */
  uses_rows?: boolean | null;
  row_count?: number | null;
  weighting_basis?: string | null;
}


export interface IrrigationSessionBlock extends PreviewBlock {
  id: string;
  session_id: string;
}

export interface IrrigationSession {
  id: string;
  vineyard_id: string;
  irrigation_system_id: string;
  system_name?: string | null;
  valve_id: string;
  valve_name?: string | null;
  session_date: string;
  vintage_year: number;
  started_at: string | null;
  finished_at: string | null;
  duration_minutes: number;
  calculation_method: CalculationMethod;
  flow_litres_per_hour: number | null;
  meter_start_litres: number | null;
  meter_finish_litres: number | null;
  total_volume_litres: number;
  effective_volume_litres: number | null;
  irrigation_efficiency_percent: number | null;
  status: string;
  source_type: string;
  notes: string | null;
  configuration_snapshot: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  blocks: IrrigationSessionBlock[];
  duplicate?: boolean;
}

export interface VintageSummary {
  vineyard_id: string;
  vintage_year: number;
  total_volume_litres: number;
  effective_volume_litres: number | null;
  total_runtime_minutes: number;
  session_count: number;
  average_session_minutes: number | null;
  month_volume_litres: number;
  month_session_count: number;
  month_runtime_minutes: number;
  water_litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
}

export interface ValveSummaryRow {
  valve_id: string;
  valve_name: string;
  system_name: string;
  total_volume_litres: number;
  total_runtime_minutes: number;
  session_count: number;
  last_irrigation_date: string | null;
}

export interface BlockSummaryRow {
  block_id: string;
  block_name: string;
  total_volume_litres: number;
  effective_volume_litres: number | null;
  session_count: number;
  last_irrigation_date: string | null;
  water_litres_per_vine: number | null;
  water_litres_per_hectare: number | null;
  irrigation_depth_mm: number | null;
}

export interface VarietySummaryRow {
  variety_name: string;
  total_volume_litres: number;
  total_serviced_area_m2: number | null;
  total_serviced_vines: number | null;
  average_water_litres_per_hectare: number | null;
  average_water_litres_per_vine: number | null;
  irrigation_depth_mm: number | null;
}

export interface DailySummaryRow {
  date: string;
  total_volume_litres: number;
  runtime_minutes: number;
  session_count: number;
}

export interface MonthlySummaryRow {
  month: string;
  total_volume_litres: number;
  runtime_minutes: number;
  session_count: number;
  irrigation_depth_mm: number | null;
}

// ---------------------------------------------------------------------------
// Access gate
// ---------------------------------------------------------------------------

export function useIrrigationAccess(vineyardId: string | null) {
  const q = useQuery({
    queryKey: ["irrigation", "access", vineyardId],
    enabled: !!vineyardId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("has_irrigation_records_access", {
        p_vineyard_id: vineyardId,
      });
      if (error) return false;
      return Boolean(data);
    },
  });
  return { hasAccess: !!q.data, loading: !!vineyardId && q.isLoading };
}

// ---------------------------------------------------------------------------
// Setup — systems, valves, connections
// ---------------------------------------------------------------------------

export function useIrrigationSystems(vineyardId: string | null, includeInactive = false) {
  return useQuery({
    queryKey: ["irrigation", "systems", vineyardId, includeInactive],
    enabled: !!vineyardId,
    queryFn: () =>
      call<IrrigationSystem[]>("list_irrigation_systems", {
        p_vineyard_id: vineyardId,
        p_include_inactive: includeInactive,
      }),
  });
}

export function useIrrigationValves(vineyardId: string | null, includeInactive = false) {
  return useQuery({
    queryKey: ["irrigation", "valves", vineyardId, includeInactive],
    enabled: !!vineyardId,
    queryFn: () =>
      call<IrrigationValve[]>("list_irrigation_valves", {
        p_vineyard_id: vineyardId,
        p_include_inactive: includeInactive,
      }),
  });
}

export function useValveBlocks(vineyardId: string | null, valveId: string | null) {
  return useQuery({
    queryKey: ["irrigation", "valve-blocks", vineyardId, valveId],
    enabled: !!vineyardId && !!valveId,
    queryFn: () =>
      call<IrrigationValveBlock[]>("list_irrigation_valve_blocks", {
        p_vineyard_id: vineyardId,
        p_valve_id: valveId,
      }),
  });
}

export function useSetupStatus(vineyardId: string | null) {
  return useQuery({
    queryKey: ["irrigation", "setup-status", vineyardId],
    enabled: !!vineyardId,
    queryFn: () =>
      call<SetupStatus>("get_irrigation_setup_status", { p_vineyard_id: vineyardId }),
  });
}

export function useValveValidation(vineyardId: string | null, valveId: string | null) {
  return useQuery({
    queryKey: ["irrigation", "validate", vineyardId, valveId],
    enabled: !!vineyardId && !!valveId,
    queryFn: () =>
      call<ValveValidation>("validate_irrigation_configuration", {
        p_vineyard_id: vineyardId,
        p_valve_id: valveId,
      }),
  });
}

function useIrrigationInvalidate(vineyardId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["irrigation"] });
    void vineyardId;
  };
}

export function useCreateSystem(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: {
      name: string;
      water_source?: string | null;
      controller_provider?: string | null;
      controller_name?: string | null;
      external_controller_id?: string | null;
      notes?: string | null;
    }) =>
      call<IrrigationSystem>("create_irrigation_system", {
        p_id: crypto.randomUUID(),
        p_vineyard_id: vineyardId,
        p_name: input.name,
        p_water_source: input.water_source ?? null,
        p_controller_provider: input.controller_provider ?? null,
        p_controller_name: input.controller_name ?? null,
        p_external_controller_id: input.external_controller_id ?? null,
        p_notes: input.notes ?? null,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateSystem(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string | null;
      water_source?: string | null;
      controller_provider?: string | null;
      controller_name?: string | null;
      external_controller_id?: string | null;
      notes?: string | null;
      is_active?: boolean | null;
    }) =>
      call<IrrigationSystem>("update_irrigation_system", {
        p_id: input.id,
        p_name: input.name ?? null,
        p_water_source: input.water_source ?? null,
        p_controller_provider: input.controller_provider ?? null,
        p_controller_name: input.controller_name ?? null,
        p_external_controller_id: input.external_controller_id ?? null,
        p_notes: input.notes ?? null,
        p_is_active: input.is_active ?? null,
      }),
    onSuccess: invalidate,
  });
}

export function useCreateValve(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: {
      irrigation_system_id: string;
      name: string;
      valve_number?: string | null;
      configured_flow_litres_per_hour?: number | null;
      measured_flow_litres_per_hour?: number | null;
      notes?: string | null;
    }) =>
      call<IrrigationValve>("create_irrigation_valve", {
        p_id: crypto.randomUUID(),
        p_vineyard_id: vineyardId,
        p_irrigation_system_id: input.irrigation_system_id,
        p_name: input.name,
        p_valve_number: input.valve_number ?? null,
        p_configured_flow_litres_per_hour: input.configured_flow_litres_per_hour ?? null,
        p_measured_flow_litres_per_hour: input.measured_flow_litres_per_hour ?? null,
        p_notes: input.notes ?? null,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateValve(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string | null;
      valve_number?: string | null;
      configured_flow_litres_per_hour?: number | null;
      measured_flow_litres_per_hour?: number | null;
      notes?: string | null;
      is_active?: boolean | null;
      clear_configured_flow?: boolean;
    }) =>
      call<IrrigationValve>("update_irrigation_valve", {
        p_id: input.id,
        p_name: input.name ?? null,
        p_valve_number: input.valve_number ?? null,
        p_configured_flow_litres_per_hour: input.configured_flow_litres_per_hour ?? null,
        p_measured_flow_litres_per_hour: input.measured_flow_litres_per_hour ?? null,
        p_notes: input.notes ?? null,
        p_is_active: input.is_active ?? null,
        p_clear_configured_flow: input.clear_configured_flow ?? false,
      }),
    onSuccess: invalidate,
  });
}

export interface ValveBlockInput {
  block_id: string;
  allocation_method: AllocationMethod;
  allocation_percentage?: number | null;
  serviced_area_m2?: number | null;
  serviced_vine_count?: number | null;
  serviced_emitter_count?: number | null;
  row_start?: number | null;
  row_end?: number | null;
  configured_flow_litres_per_hour?: number | null;
}

export function useSetValveBlocks(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: { valve_id: string; blocks: ValveBlockInput[] }) =>
      call<unknown>("set_irrigation_valve_blocks", {
        p_vineyard_id: vineyardId,
        p_valve_id: input.valve_id,
        p_blocks: input.blocks,
      }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Row-based allocation (SQL 126)
// ---------------------------------------------------------------------------

export interface SetValveRowsResult {
  valve_id?: string;
  row_count?: number | null;
  weighting_basis?: string | null;
  warnings?: string[] | null;
  blocks?: Array<{
    block_id: string;
    block_name?: string | null;
    row_count?: number | null;
    allocation_percentage?: number | null;
    rows?: Array<Record<string, any>> | null;
  }> | null;
  [key: string]: any;
}

/**
 * All vineyard rows (from paddocks.rows) that can be linked to a valve.
 * Live SQL 126 signature: list_irrigation_available_rows(p_block_id, p_vineyard_id)
 * — p_block_id is null to return every block's rows.
 */
export function useAvailableRows(
  vineyardId: string | null,
  valveId: string | null,
  blockId: string | null = null,
) {
  return useQuery({
    queryKey: ["irrigation", "available-rows", vineyardId, blockId],
    enabled: !!vineyardId && !!valveId,
    queryFn: () =>
      call<unknown>("list_irrigation_available_rows", {
        p_vineyard_id: vineyardId,
        p_block_id: blockId,
      }),
  });
}


/** Rows currently linked to a valve — authoritative selection source. */
export function useValveRows(vineyardId: string | null, valveId: string | null) {
  return useQuery({
    queryKey: ["irrigation", "valve-rows", vineyardId, valveId],
    enabled: !!vineyardId && !!valveId,
    queryFn: () =>
      call<unknown>("list_irrigation_valve_rows", {
        p_vineyard_id: vineyardId,
        p_valve_id: valveId,
      }),
  });
}

/**
 * Saves the exact row UUID set for a valve. SQL 126 derives and writes the
 * corresponding block connections, so set_irrigation_valve_blocks is not
 * called for row-based saves.
 */
export function useSetValveRows(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: { valve_id: string; row_ids: string[] }) =>
      call<SetValveRowsResult>("set_irrigation_valve_rows", {
        p_vineyard_id: vineyardId,
        p_valve_id: input.valve_id,
        p_row_ids: input.row_ids,
      }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Per-valve connection status (read-only summary for the setup screens)
// ---------------------------------------------------------------------------

export interface ValveConnectionSummary {
  valve_id: string;
  loading: boolean;
  configured: boolean;
  method: AllocationMethod | null;
  uses_rows: boolean;
  block_count: number;
  /** Saved row count — authoritative, from list_irrigation_valve_rows. */
  row_count: number;
  /** Saved row numbers (for the compact "90–108" range). */
  row_numbers: number[];
  weighting_basis: string | null;
  allocation_total: number | null;
  last_saved: string | null;
}

function summariseValveBlocks(
  valveId: string,
  blocks: IrrigationValveBlock[] | undefined,
  savedRows: unknown,
  loading: boolean,
): ValveConnectionSummary {
  const active = (blocks ?? []).filter((b) => b.is_active !== false);
  const rowList: any[] = Array.isArray(savedRows)
    ? savedRows
    : Array.isArray((savedRows as any)?.rows)
      ? (savedRows as any).rows
      : Array.isArray((savedRows as any)?.blocks)
        ? (savedRows as any).blocks.flatMap((b: any) => b?.rows ?? [])
        : [];
  const savedRowIds = extractSelectedRowIds(savedRows ?? []);
  const usesRows = active.some((b) => !!b.uses_rows) || savedRowIds.length > 0;
  const rowCount =
    savedRowIds.length > 0
      ? savedRowIds.length
      : active.reduce((s, b) => s + (Number(b.row_count) || 0), 0);
  const rowNumbers = rowList
    .map((r: any) => Number(r?.row_number ?? r?.number))
    .filter((n) => Number.isFinite(n));
  const total = active.reduce(
    (s, b) => s + (b.allocation_percentage == null ? 0 : Number(b.allocation_percentage)),
    0,
  );
  const dates = active.map((b) => b.updated_at).filter(Boolean) as string[];
  const rowBasis =
    rowList.find((r: any) => r?.weighting_basis)?.weighting_basis ??
    (savedRows as any)?.weighting_basis ??
    null;
  return {
    valve_id: valveId,
    loading,
    configured: active.length > 0 || savedRowIds.length > 0,
    method: usesRows ? "rows" : ((active[0]?.allocation_method as AllocationMethod) ?? null),
    uses_rows: usesRows,
    block_count: active.length,
    row_count: rowCount,
    row_numbers: rowNumbers,
    weighting_basis:
      active.find((b) => b.weighting_basis)?.weighting_basis ?? rowBasis ?? null,
    allocation_total: active.length > 0 ? total : null,
    last_saved: dates.length > 0 ? dates.sort().at(-1)! : null,
  };
}

/** Connection status for every valve, used by the Valves tab and the Connections overview. */
export function useValveConnectionSummaries(
  vineyardId: string | null,
  valveIds: string[],
) {
  const blockResults = useQueries({
    queries: valveIds.map((id) => ({
      queryKey: ["irrigation", "valve-blocks", vineyardId, id],
      enabled: !!vineyardId,
      queryFn: () =>
        call<IrrigationValveBlock[]>("list_irrigation_valve_blocks", {
          p_vineyard_id: vineyardId,
          p_valve_id: id,
        }),
    })),
  });

  const rowResults = useQueries({
    queries: valveIds.map((id) => ({
      queryKey: ["irrigation", "valve-rows", vineyardId, id],
      enabled: !!vineyardId,
      queryFn: () =>
        call<unknown>("list_irrigation_valve_rows", {
          p_vineyard_id: vineyardId,
          p_valve_id: id,
        }),
    })),
  });

  const map: Record<string, ValveConnectionSummary> = {};
  valveIds.forEach((id, i) => {
    const b = blockResults[i];
    const r = rowResults[i];
    map[id] = summariseValveBlocks(
      id,
      b?.data as IrrigationValveBlock[] | undefined,
      r?.data,
      !!b?.isLoading || !!r?.isLoading,
    );
  });
  return map;
}






// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface PreviewInput {
  valve_id: string;
  session_date: string;
  duration_minutes: number;
  calculation_method: CalculationMethod;
  flow_litres_per_hour?: number | null;
  meter_start_litres?: number | null;
  meter_finish_litres?: number | null;
  total_volume_litres?: number | null;
}

export function calculatePreview(
  vineyardId: string,
  input: PreviewInput,
): Promise<IrrigationPreview> {
  return call<IrrigationPreview>("calculate_irrigation_preview", {
    p_vineyard_id: vineyardId,
    p_valve_id: input.valve_id,
    p_session_date: input.session_date,
    p_duration_minutes: input.duration_minutes,
    p_calculation_method: input.calculation_method,
    p_flow_litres_per_hour: input.flow_litres_per_hour ?? null,
    p_meter_start_litres: input.meter_start_litres ?? null,
    p_meter_finish_litres: input.meter_finish_litres ?? null,
    p_total_volume_litres: input.total_volume_litres ?? null,
  });
}

export function useRecordSession(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (
      input: PreviewInput & {
        id: string;
        irrigation_system_id: string;
        started_at?: string | null;
        finished_at?: string | null;
        notes?: string | null;
      },
    ) =>
      call<IrrigationSession>("record_irrigation_session", {
        p_id: input.id,
        p_vineyard_id: vineyardId,
        p_irrigation_system_id: input.irrigation_system_id,
        p_valve_id: input.valve_id,
        p_session_date: input.session_date,
        p_duration_minutes: input.duration_minutes,
        p_calculation_method: input.calculation_method,
        p_flow_litres_per_hour: input.flow_litres_per_hour ?? null,
        p_meter_start_litres: input.meter_start_litres ?? null,
        p_meter_finish_litres: input.meter_finish_litres ?? null,
        p_total_volume_litres: input.total_volume_litres ?? null,
        p_started_at: input.started_at ?? null,
        p_finished_at: input.finished_at ?? null,
        p_notes: input.notes ?? null,
        p_source_type: "manual_portal",
        p_original_value: null,
        p_original_unit: null,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateSession(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (input: {
      id: string;
      session_date?: string | null;
      duration_minutes?: number | null;
      calculation_method?: CalculationMethod | null;
      flow_litres_per_hour?: number | null;
      meter_start_litres?: number | null;
      meter_finish_litres?: number | null;
      total_volume_litres?: number | null;
      started_at?: string | null;
      finished_at?: string | null;
      notes?: string | null;
      use_current_configuration?: boolean;
    }) =>
      call<IrrigationSession>("update_irrigation_session", {
        p_id: input.id,
        p_session_date: input.session_date ?? null,
        p_duration_minutes: input.duration_minutes ?? null,
        p_calculation_method: input.calculation_method ?? null,
        p_flow_litres_per_hour: input.flow_litres_per_hour ?? null,
        p_meter_start_litres: input.meter_start_litres ?? null,
        p_meter_finish_litres: input.meter_finish_litres ?? null,
        p_total_volume_litres: input.total_volume_litres ?? null,
        p_started_at: input.started_at ?? null,
        p_finished_at: input.finished_at ?? null,
        p_notes: input.notes ?? null,
        p_use_current_configuration: input.use_current_configuration ?? false,
      }),
    onSuccess: invalidate,
  });
}

export function useReverseSession(vineyardId: string | null) {
  const invalidate = useIrrigationInvalidate(vineyardId);
  return useMutation({
    mutationFn: (id: string) =>
      call<IrrigationSession>("reverse_irrigation_session", { p_id: id }),
    onSuccess: invalidate,
  });
}

export interface SessionFilters {
  vintage_year?: number | null;
  from_date?: string | null;
  to_date?: string | null;
  irrigation_system_id?: string | null;
  valve_id?: string | null;
  block_id?: string | null;
  status?: string | null;
  source_type?: string | null;
  include_reversed?: boolean;
  limit?: number;
  offset?: number;
}

export function useSessions(vineyardId: string | null, filters: SessionFilters) {
  return useQuery({
    queryKey: ["irrigation", "sessions", vineyardId, filters],
    enabled: !!vineyardId,
    queryFn: () =>
      call<{ sessions: IrrigationSession[]; total_count: number }>(
        "list_irrigation_sessions",
        {
          p_vineyard_id: vineyardId,
          p_vintage_year: filters.vintage_year ?? null,
          p_from_date: filters.from_date ?? null,
          p_to_date: filters.to_date ?? null,
          p_irrigation_system_id: filters.irrigation_system_id ?? null,
          p_valve_id: filters.valve_id ?? null,
          p_block_id: filters.block_id ?? null,
          p_status: filters.status ?? null,
          p_source_type: filters.source_type ?? null,
          p_include_reversed: filters.include_reversed ?? false,
          p_limit: filters.limit ?? 50,
          p_offset: filters.offset ?? 0,
        },
      ),
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summaryQuery<T>(
  key: string,
  fn: string,
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return {
    queryKey: ["irrigation", key, vineyardId, vintageYear, includeReversed],
    enabled: !!vineyardId,
    queryFn: () =>
      call<T>(fn, {
        p_vineyard_id: vineyardId,
        p_vintage_year: vintageYear,
        p_include_reversed: includeReversed,
      }),
  };
}

export function useVintageSummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<VintageSummary>(
      "vintage-summary",
      "get_irrigation_vintage_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

export function useValveSummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<ValveSummaryRow[]>(
      "valve-summary",
      "get_irrigation_valve_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

export function useBlockSummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<BlockSummaryRow[]>(
      "block-summary",
      "get_irrigation_block_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

export function useVarietySummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<VarietySummaryRow[]>(
      "variety-summary",
      "get_irrigation_variety_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

export function useDailySummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<DailySummaryRow[]>(
      "daily-summary",
      "get_irrigation_daily_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

export function useMonthlySummary(
  vineyardId: string | null,
  vintageYear: number | null,
  includeReversed = false,
) {
  return useQuery(
    summaryQuery<MonthlySummaryRow[]>(
      "monthly-summary",
      "get_irrigation_monthly_summary",
      vineyardId,
      vintageYear,
      includeReversed,
    ),
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers (display only — never used for calculations)
// ---------------------------------------------------------------------------

export function formatLitres(value: number | null | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ML`;
  if (Math.abs(value) >= 1000)
    return `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kL`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
