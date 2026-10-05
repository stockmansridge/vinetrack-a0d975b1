import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import type { SprayJobChemicalLine } from "@/lib/sprayJobsQuery";

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

export interface FertigationCapabilities {
  vineyard_id: string | null;
  development_gate: "system_admin" | string;
  can_view_fertigation: boolean;
  can_manage_fertigation_program: boolean;
  can_record_fertigation: boolean;
  can_edit_fertigation: boolean;
  can_reverse_fertigation: boolean;
}

export interface FertigationProgramStep {
  id: string;
  vineyard_id: string;
  name: string;
  is_template: boolean;
  operation_type: string | null;
  growth_stage_code: string | null;
  notes: string | null;
  chemical_lines: SprayJobChemicalLine[] | null;
}

export type FertigationRateBasis =
  | "per_hectare"
  | "per_vine"
  | "per_irrigation_cycle";

export interface FertigationProductInput {
  id?: string | null;
  saved_chemical_id?: string | null;
  product_name: string;
  planned_rate?: number | null;
  rate_basis?: FertigationRateBasis | null;
  rate_unit?: string | null;
  planned_quantity?: number | null;
  actual_quantity?: number | null;
  quantity_unit?: string | null;
  cost_per_unit?: number | null;
}

export interface FertigationApplication {
  id: string;
  vineyard_id: string;
  irrigation_session_id: string;
  program_step_id: string | null;
  program_step_name: string | null;
  growth_stage_code: string | null;
  notes: string | null;
  status: string;
  products: Array<Record<string, any>>;
}

export function useFertigationCapabilities(vineyardId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["fertigation", "capabilities", vineyardId],
    enabled: enabled && !!vineyardId,
    staleTime: 60_000,
    queryFn: () =>
      rpc<FertigationCapabilities>("get_fertigation_capabilities", {
        p_vineyard_id: vineyardId,
      }),
  });
}

export function useFertigationProgramSteps(
  vineyardId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["fertigation", "program-steps", vineyardId],
    enabled: enabled && !!vineyardId,
    queryFn: () =>
      rpc<FertigationProgramStep[]>("list_fertigation_program_steps", {
        p_vineyard_id: vineyardId,
      }),
  });
}

export function useUpsertIrrigationFertigation(vineyardId: string | null) {
  return useMutation({
    mutationFn: (input: {
      id: string;
      irrigation_session_id: string;
      program_step_id?: string | null;
      notes?: string | null;
      products: FertigationProductInput[];
    }) =>
      rpc<FertigationApplication>("upsert_irrigation_fertigation", {
        p_id: input.id,
        p_vineyard_id: vineyardId,
        p_irrigation_session_id: input.irrigation_session_id,
        p_program_step_id: input.program_step_id ?? null,
        p_notes: input.notes ?? null,
        p_products: input.products,
      }),
  });
}

/**
 * Current Spray Program rates are richer than the first fertigation contract.
 * Only an unambiguous area rate is translated automatically. Other bases remain
 * unset so VineTrack never invents a fertigation dose.
 */
export function fertigationBasisFromProgramLine(
  line: SprayJobChemicalLine,
): FertigationRateBasis | null {
  const basis = String(
    (line as any).product_rate_basis ?? line.rate_basis ?? "",
  ).toLowerCase();
  if (
    basis === "whole_block_area" ||
    basis === "treated_area" ||
    basis === "per_hectare"
  ) {
    return "per_hectare";
  }
  return null;
}

export function programStepProducts(
  step: FertigationProgramStep,
  actualByIndex: Record<number, string>,
): FertigationProductInput[] {
  return (step.chemical_lines ?? [])
    .filter((line) => String(line.name ?? "").trim())
    .map((line, index) => {
      const actualText = actualByIndex[index]?.trim() ?? "";
      const actual = actualText === "" ? null : Number(actualText);
      const savedChemicalId =
        ((line as any).savedChemicalId ?? line.chemical_id ?? null) as string | null;
      return {
        saved_chemical_id: savedChemicalId,
        product_name: String(line.name ?? "").trim(),
        planned_rate: line.rate ?? null,
        rate_basis: fertigationBasisFromProgramLine(line),
        rate_unit: line.unit ?? null,
        actual_quantity: Number.isFinite(actual as number) ? actual : null,
        quantity_unit: line.unit ?? null,
        cost_per_unit: (line as any).costPerUnit ?? null,
      };
    });
}
