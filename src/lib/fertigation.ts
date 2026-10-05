// Fertigation Round 1 (Portal only, System Admin development gate).
//
// One linked operational record:
//   Spray Program → Fertigation Program Step (spray_jobs, is_template,
//   operation_type = 'Fertigation') → Irrigation Session → Fertigation
//   application (fertigation_applications + fertigation_application_products).
//
// The irrigation session is saved first through the unchanged
// record_irrigation_session RPC; the fertigation application is written
// afterwards against the returned session id with its own stable UUIDs, so a
// fertigation failure never affects the irrigation record and a retry never
// duplicates either.
//
// Every RPC here re-checks System Admin + vineyard ownership server-side
// (sql/265). The Portal gate is a convenience, never the authority.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";
import type { PreviewBlock } from "@/lib/irrigationQuery";
import type { SprayJob, SprayJobChemicalLine } from "@/lib/sprayJobsQuery";

/* ------------------------------------------------------------ constants */

/** Canonical stored `spray_jobs.operation_type` value. */
export const FERTIGATION_OPERATION_TYPE = "Fertigation";

export type FertigationRateBasis = "per_hectare" | "per_vine" | "per_irrigation_cycle";

export const FERTIGATION_RATE_BASES: FertigationRateBasis[] = [
  "per_hectare",
  "per_vine",
  "per_irrigation_cycle",
];

export const FERTIGATION_RATE_BASIS_LABEL: Record<FertigationRateBasis, string> = {
  per_hectare: "Per hectare",
  per_vine: "Per vine",
  per_irrigation_cycle: "Per irrigation cycle",
};

/** Allowed rate units per basis. The quantity unit follows from the rate unit. */
export const FERTIGATION_RATE_UNITS: Record<FertigationRateBasis, string[]> = {
  per_hectare: ["kg/ha", "L/ha"],
  per_vine: ["g/vine", "mL/vine"],
  per_irrigation_cycle: ["kg", "L"],
};

/** Saved Chemical categories offered first for a Fertigation Program Step. */
export const FERTIGATION_PRIORITY_CATEGORIES = [
  "fertigation",
  "liquidFertiliser",
  "granularFertiliser",
  "foliarNutrient",
  "biofertiliser",
  "seaweed",
  "humicFulvic",
  "fishHydrolysate",
  "compostTea",
  "soilAmendment",
];

export function isFertigationPriorityCategory(category: unknown): boolean {
  const c = String(category ?? "").trim();
  if (!c) return false;
  const lc = c.toLowerCase();
  return FERTIGATION_PRIORITY_CATEGORIES.some(
    (k) => k.toLowerCase() === lc || lc.includes(k.toLowerCase()) || lc.includes("fertili") || lc.includes("nutrient"),
  );
}

export function normaliseFertigationRateBasis(v: unknown): FertigationRateBasis | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (FERTIGATION_RATE_BASES as string[]).includes(s) ? (s as FertigationRateBasis) : null;
}

export function isFertigationOperationType(v: unknown): boolean {
  return String(v ?? "").trim().toLowerCase() === "fertigation";
}

export function isFertigationProgramStep(job: Pick<SprayJob, "is_template" | "operation_type"> | null | undefined): boolean {
  return !!job && !!job.is_template && isFertigationOperationType(job.operation_type);
}

/** Quantity unit produced by a rate unit (kg/ha → kg, g/vine → kg, mL/vine → L). */
export function quantityUnitForRateUnit(rateUnit: string | null | undefined): "kg" | "L" | null {
  const u = String(rateUnit ?? "").trim().toLowerCase();
  if (u === "kg/ha" || u === "g/vine" || u === "kg") return "kg";
  if (u === "l/ha" || u === "ml/vine" || u === "l") return "L";
  return null;
}

/** Program Step line → fertigation planned line (identity is the Saved Chemical UUID). */
export interface FertigationPlannedLine {
  savedChemicalId: string | null;
  productName: string | null;
  rate: number | null;
  rateBasis: FertigationRateBasis | null;
  rateUnit: string | null;
  productCategory?: string | null;
  productForm?: string | null;
  costPerUnit?: number | null;
}

export function fertigationLinesFromJob(job: SprayJob | null | undefined): FertigationPlannedLine[] {
  return ((job?.chemical_lines ?? []) as Array<SprayJobChemicalLine & Record<string, any>>).map((l) => {
    const rate = Number(l.rate);
    return {
      savedChemicalId: (l.savedChemicalId ?? l.chemical_id ?? null) || null,
      productName: l.name ?? null,
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      rateBasis: normaliseFertigationRateBasis(l.fertigation_rate_basis),
      rateUnit: (l.fertigation_rate_unit as string | null) ?? null,
      productCategory: (l.product_category as string | null) ?? null,
      productForm: (l.product_form as string | null) ?? null,
      costPerUnit: Number.isFinite(Number(l.costPerUnit)) ? Number(l.costPerUnit) : null,
    };
  });
}

export function fertigationRateText(line: Pick<FertigationPlannedLine, "rate" | "rateBasis" | "rateUnit">): string {
  if (line.rate == null || !line.rateUnit) return "Rate not set";
  const base = `${line.rate} ${line.rateUnit}`;
  return line.rateBasis === "per_irrigation_cycle" ? `${base} per irrigation cycle` : base;
}

/* -------------------------------------------------------- quantities */

export interface ServicedTotals {
  /** Σ serviced area in hectares, or null if any block's area is unknown. */
  areaHa: number | null;
  /** Σ serviced vines, or null if any block's vine count is unknown. */
  vines: number | null;
}

/**
 * Totals from the AUTHORITATIVE irrigation allocation rows (preview or saved
 * session blocks). No Portal-side area/vine formula. Any unknown → unknown.
 */
export function servicedTotals(blocks: Pick<PreviewBlock, "serviced_area_m2" | "serviced_vine_count">[] | null | undefined): ServicedTotals {
  const list = blocks ?? [];
  if (list.length === 0) return { areaHa: null, vines: null };
  let m2 = 0;
  let vines = 0;
  let areaKnown = true;
  let vinesKnown = true;
  for (const b of list) {
    const a = Number(b.serviced_area_m2);
    if (b.serviced_area_m2 == null || !Number.isFinite(a) || a <= 0) areaKnown = false;
    else m2 += a;
    const v = Number(b.serviced_vine_count);
    if (b.serviced_vine_count == null || !Number.isFinite(v) || v <= 0) vinesKnown = false;
    else vines += v;
  }
  return { areaHa: areaKnown ? m2 / 10_000 : null, vines: vinesKnown ? vines : null };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Planned quantity in kg or L, or null when it cannot be calculated.
 * Never substitutes zero for an unknown input.
 *   per_hectare:          rate × serviced ha
 *   per_vine:             rate (g or mL) × serviced vines ÷ 1000
 *   per_irrigation_cycle: rate (the entered total)
 */
export function plannedQuantity(
  line: Pick<FertigationPlannedLine, "rate" | "rateBasis" | "rateUnit">,
  totals: ServicedTotals,
): { quantity: number | null; unit: "kg" | "L" | null } {
  const unit = quantityUnitForRateUnit(line.rateUnit);
  const allowed = line.rateBasis ? FERTIGATION_RATE_UNITS[line.rateBasis] : [];
  if (line.rate == null || !(line.rate > 0) || !line.rateBasis || !unit || !allowed.includes(line.rateUnit ?? "")) {
    return { quantity: null, unit };
  }
  if (line.rateBasis === "per_hectare") {
    return { quantity: totals.areaHa == null ? null : r3(line.rate * totals.areaHa), unit };
  }
  if (line.rateBasis === "per_vine") {
    return { quantity: totals.vines == null ? null : r3((line.rate * totals.vines) / 1000), unit };
  }
  return { quantity: r3(line.rate), unit };
}

/* -------------------------------------------- Program Step save gate */

export function fertigationGateReasons(app: {
  name: string | null;
  isTemplate: boolean;
  products: Array<{ savedChemicalId: string | null; rate: number | null; fertigationRateBasis?: FertigationRateBasis | null; fertigationRateUnit?: string | null; productName: string | null }>;
}): string[] {
  const out: string[] = [];
  if (!(app.name ?? "").trim()) out.push("Give this Program Step a name.");
  if (!app.isTemplate) out.push("Fertigation is only available on Program Steps.");
  if (app.products.length === 0) out.push("Add at least one product.");
  for (const p of app.products) {
    const label = p.productName ?? "A product";
    if (!p.savedChemicalId) out.push(`${label} must be chosen from Saved Chemicals.`);
    if (!p.fertigationRateBasis) out.push(`Choose the Fertigation rate basis for ${label}.`);
    else if (!p.fertigationRateUnit || !FERTIGATION_RATE_UNITS[p.fertigationRateBasis].includes(p.fertigationRateUnit))
      out.push(`Choose the rate unit for ${label}.`);
    if (!(Number(p.rate) > 0)) out.push(`Enter a planned rate for ${label}.`);
  }
  return Array.from(new Set(out));
}

/* ---------------------------------------------------- records + RPCs */

export type FertigationStatus = "active" | "reversed";

export interface FertigationApplicationProduct {
  id: string;
  fertigation_application_id: string;
  vineyard_id: string;
  saved_chemical_id: string | null;
  product_name: string;
  product_category: string | null;
  product_form: string | null;
  planned_rate: number | null;
  rate_basis: FertigationRateBasis | null;
  rate_unit: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  quantity_unit: string | null;
  cost_per_unit: number | null;
  product_snapshot: Record<string, any> | null;
  sort_order: number;
}

export interface FertigationApplication {
  id: string;
  vineyard_id: string;
  irrigation_session_id: string;
  program_step_id: string | null;
  program_step_name: string | null;
  growth_stage_code: string | null;
  notes: string | null;
  status: FertigationStatus;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  products: FertigationApplicationProduct[];
  /** Session context — returned by list RPCs for history rows. */
  session_date?: string | null;
  system_name?: string | null;
  valve_name?: string | null;
  duration_minutes?: number | null;
  total_volume_litres?: number | null;
  block_names?: string[] | null;
}

export interface FertigationCapabilities {
  can_use_fertigation: boolean;
}

const rpc = (name: string, args: Record<string, unknown>) => (supabase as any).rpc(name, args);

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message ?? String(error));
  return data as T;
}

export function fetchFertigationCapabilities(vineyardId: string) {
  return call<FertigationCapabilities>("get_fertigation_capabilities", { p_vineyard_id: vineyardId });
}

export function listFertigationProgramSteps(vineyardId: string) {
  return call<SprayJob[]>("list_fertigation_program_steps", { p_vineyard_id: vineyardId });
}

export function getSessionFertigation(vineyardId: string, sessionId: string) {
  return call<FertigationApplication | null>("get_irrigation_session_fertigation", {
    p_vineyard_id: vineyardId,
    p_irrigation_session_id: sessionId,
  });
}

export function listFertigationApplications(args: {
  vineyardId: string;
  vintageYear?: number | null;
  programStepId?: string | null;
  includeReversed?: boolean;
}) {
  return call<FertigationApplication[]>("list_fertigation_applications", {
    p_vineyard_id: args.vineyardId,
    p_vintage_year: args.vintageYear ?? null,
    p_program_step_id: args.programStepId ?? null,
    p_include_reversed: args.includeReversed ?? false,
  });
}

export interface UpsertFertigationInput {
  id: string;
  vineyard_id: string;
  irrigation_session_id: string;
  program_step_id: string;
  program_step_name: string | null;
  growth_stage_code: string | null;
  notes: string | null;
  products: Array<Omit<FertigationApplicationProduct, "fertigation_application_id" | "vineyard_id">>;
}

export function upsertFertigationApplication(input: UpsertFertigationInput) {
  return call<FertigationApplication>("upsert_fertigation_application", {
    p_id: input.id,
    p_vineyard_id: input.vineyard_id,
    p_irrigation_session_id: input.irrigation_session_id,
    p_program_step_id: input.program_step_id,
    p_program_step_name: input.program_step_name,
    p_growth_stage_code: input.growth_stage_code,
    p_notes: input.notes,
    p_products: input.products,
  });
}

export function reverseFertigationApplication(id: string, reason?: string | null) {
  return call<FertigationApplication>("reverse_fertigation_application", {
    p_id: id,
    p_reason: reason ?? null,
  });
}

/* ------------------------------------------------- frozen snapshot */

export interface FertigationDraftProduct {
  /** Stable application-product id kept across retries. */
  id: string;
  line: FertigationPlannedLine;
  /** Actual used, in the quantity unit. Empty = not entered yet. */
  actual: string;
}

/**
 * Build the frozen write payload. The Program Step is copied at execution
 * time, so later Program Step edits never rewrite this application.
 */
export function buildFertigationPayload(args: {
  id: string;
  vineyardId: string;
  sessionId: string;
  step: SprayJob;
  products: FertigationDraftProduct[];
  totals: ServicedTotals;
  notes: string | null;
}): UpsertFertigationInput {
  return {
    id: args.id,
    vineyard_id: args.vineyardId,
    irrigation_session_id: args.sessionId,
    program_step_id: args.step.id,
    program_step_name: args.step.name ?? null,
    growth_stage_code: args.step.growth_stage_code ?? null,
    notes: args.notes,
    products: args.products.map((p, i) => {
      const planned = plannedQuantity(p.line, args.totals);
      const actualNum = p.actual.trim() === "" ? null : Number(p.actual);
      return {
        id: p.id,
        saved_chemical_id: p.line.savedChemicalId,
        product_name: p.line.productName ?? "",
        product_category: p.line.productCategory ?? null,
        product_form: p.line.productForm ?? null,
        planned_rate: p.line.rate,
        rate_basis: p.line.rateBasis,
        rate_unit: p.line.rateUnit,
        planned_quantity: planned.quantity,
        actual_quantity: actualNum != null && Number.isFinite(actualNum) && actualNum >= 0 ? actualNum : null,
        quantity_unit: planned.unit,
        cost_per_unit: p.line.costPerUnit ?? null,
        product_snapshot: {
          program_step_id: args.step.id,
          program_step_name: args.step.name ?? null,
          growth_stage_code: args.step.growth_stage_code ?? null,
          saved_chemical_id: p.line.savedChemicalId,
          product_name: p.line.productName,
          rate: p.line.rate,
          rate_basis: p.line.rateBasis,
          rate_unit: p.line.rateUnit,
          serviced_area_ha: args.totals.areaHa,
          serviced_vines: args.totals.vines,
        },
        sort_order: i,
      };
    }),
  };
}

export function draftProductsFromStep(
  step: SprayJob | null,
  existing?: FertigationApplication | null,
): FertigationDraftProduct[] {
  if (existing && existing.program_step_id === step?.id) {
    // Editing: keep the frozen lines and their ids.
    return [...existing.products]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({
        id: p.id,
        actual: p.actual_quantity == null ? "" : String(p.actual_quantity),
        line: {
          savedChemicalId: p.saved_chemical_id,
          productName: p.product_name,
          rate: p.planned_rate,
          rateBasis: p.rate_basis,
          rateUnit: p.rate_unit,
          productCategory: p.product_category,
          productForm: p.product_form,
          costPerUnit: p.cost_per_unit,
        },
      }));
  }
  return fertigationLinesFromJob(step).map((line) => ({ id: generateUuid(), line, actual: "" }));
}

/* ------------------------------------------------------------ hooks */

export function useFertigationProgramSteps(vineyardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["fertigation", "program-steps", vineyardId],
    enabled: !!vineyardId && enabled,
    queryFn: () => listFertigationProgramSteps(vineyardId!),
  });
}

export function useSessionFertigation(vineyardId: string | null, sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["fertigation", "session", vineyardId, sessionId],
    enabled: !!vineyardId && !!sessionId && enabled,
    queryFn: () => getSessionFertigation(vineyardId!, sessionId!),
  });
}

export function useFertigationApplications(
  vineyardId: string | null,
  opts: { programStepId?: string | null; vintageYear?: number | null; includeReversed?: boolean },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["fertigation", "applications", vineyardId, opts],
    enabled: !!vineyardId && enabled,
    queryFn: () =>
      listFertigationApplications({
        vineyardId: vineyardId!,
        programStepId: opts.programStepId ?? null,
        vintageYear: opts.vintageYear ?? null,
        includeReversed: opts.includeReversed ?? false,
      }),
  });
}

export function useUpsertFertigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertFertigationApplication,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fertigation"] }),
  });
}

/** Map of irrigation_session_id → active fertigation application. */
export function activeBySession(apps: FertigationApplication[] | null | undefined): Map<string, FertigationApplication> {
  const m = new Map<string, FertigationApplication>();
  for (const a of apps ?? []) if (a.status === "active") m.set(a.irrigation_session_id, a);
  return m;
}
