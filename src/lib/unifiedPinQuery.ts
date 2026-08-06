// Unified Add Pin / Action data layer (SQL 170) — shared VineTrack backend.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { manualIssueErrorMessage, type RowSegment } from "@/lib/manualIssues";
import {
  buildCustomPinArgs,
  buildPinInsertRow,
  normaliseCustomPinType,
  parseButtonCatalogue,
  pinSegments,
  type ButtonConfigRow,
  type CustomPinType,
  type PinButtonDef,
  type UnifiedPinForm,
} from "@/lib/unifiedPin";
import type { LatLng } from "@/lib/paddockGeometry";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function rpc<T>(fn: string, args: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as any, args);
  if (error) throw new Error(manualIssueErrorMessage(error));
  return data as T;
}

/** Repair / Growth button catalogues configured for this vineyard. */
export function usePinButtonCatalogue(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pin-button-catalogue", vineyardId],
    enabled: !!vineyardId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ repair: PinButtonDef[]; growth: PinButtonDef[] }> => {
      const { data, error } = await supabase
        .from("vineyard_button_configs")
        .select("config_type, config_data")
        .eq("vineyard_id", vineyardId!);
      if (error) throw new Error(manualIssueErrorMessage(error));
      return parseButtonCatalogue((data ?? []) as ButtonConfigRow[]);
    },
  });
}

/** Vineyard custom pin types (SQL 170 catalogue). */
export function useCustomPinTypes(vineyardId: string | null) {
  return useQuery({
    queryKey: ["custom-pin-types", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<CustomPinType[]> => {
      const rows = await rpc<any[]>("list_vineyard_custom_pin_types", {
        p_vineyard_id: vineyardId,
        p_include_inactive: false,
      });
      return (rows ?? []).map(normaliseCustomPinType).filter((t) => t.id && t.name);
    },
  });
}

export function useCreateCustomPinType(vineyardId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, colour }: { name: string; colour?: string | null }) => {
      if (!vineyardId) throw new Error("Select a vineyard first.");
      const id = newId();
      await rpc("create_vineyard_custom_pin_type", {
        p_id: id,
        p_vineyard_id: vineyardId,
        p_name: name.trim(),
        p_color: colour ?? null,
        p_icon: null,
      });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-pin-types"] });
    },
  });
}

export interface CreateUnifiedPinInput {
  form: UnifiedPinForm;
  /** Selected Repair / Growth button (ignored for custom pins). */
  button?: PinButtonDef | null;
  /** Display name for custom pins. */
  customTypeName?: string | null;
  /** Block centroid used for block-scoped and row-scoped pins. */
  centre?: LatLng | null;
  /** Stage chosen in the Growth Stage picker (Growth pins only). */
  growthStageCode?: string | null;
}

export function useCreateUnifiedPin(vineyardId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ form, button, customTypeName, centre, growthStageCode }: CreateUnifiedPinInput) => {
      if (!vineyardId) throw new Error("Select a vineyard first.");
      const id = newId();

      if (form.pinType === "custom") {
        await rpc("create_custom_pin", {
          ...buildCustomPinArgs(form, {
            id,
            vineyardId,
            title: (customTypeName ?? "Custom").trim() || "Custom",
            centre,
          }),
        });
        return id;
      }

      if (!button) throw new Error("Choose a button.");
      const row = buildPinInsertRow(form, { id, vineyardId, button, centre, growthStageCode });
      const { error } = await supabase.from("pins").insert(row as any);
      if (error) throw new Error(manualIssueErrorMessage(error));

      const segments: RowSegment[] | null = pinSegments(form);
      if (segments?.length) {
        // Row-scoped pins store their rows/sections through the shared RPC.
        await rpc("set_pin_row_segments", { p_pin_id: id, p_segments: segments });
      }
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pins"] });
      qc.invalidateQueries({ queryKey: ["pins-raw-counts"] });
      qc.invalidateQueries({ queryKey: ["manual-issues"] });
      qc.invalidateQueries({ queryKey: ["growth_stage_records"] });
    },
  });
}
