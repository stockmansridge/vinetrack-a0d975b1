// Picking Log financial privacy — shared VineTrack contract (sql/187).
//
// sql/187 moved the commercially sensitive picking fields off
// `public.picking_records` and into `public.picking_record_financials`:
//
//   sold_to, price_per_tonne  → companion table (RLS: owner/manager SELECT only)
//   grape_value               → derived, never stored on the base row
//
// Every reader now sees NULL for `picking_records.sold_to`,
// `price_per_tonne` and `grape_value`. The ONLY supported read path for money
// is `get_picking_record_financials(p_vineyard_id)` (or a direct SELECT on the
// companion table, which is the same RLS). Lower roles receive errcode 42501 —
// that is "no financial access", NOT an error to retry and NOT $0.
//
// Writes are unchanged: the portal keeps sending `sold`, `sold_to` and
// `price_per_tonne` on `picking_records`; a BEFORE trigger routes them. No
// portal-only financial storage exists and the companion table is never
// written directly.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import type { PickingRecord } from "@/lib/pickingRecordsQuery";

/** Roles allowed to read Picking Log commercial values (sql/187 RLS mirror). */
const FINANCIAL_ROLES = new Set(["owner", "manager"]);

export function canSeePickingFinancials(role: string | null | undefined): boolean {
  return !!role && FINANCIAL_ROLES.has(role);
}

/** Hook: true when the signed-in user is owner or manager of the vineyard. */
export function useCanSeePickingFinancials(): boolean {
  const { currentRole } = useVineyard();
  return canSeePickingFinancials(currentRole);
}

export interface PickingRecordFinancial {
  picking_record_id: string;
  sold_to: string | null;
  price_per_tonne: number | null;
  /** weight_kg / 1000 × price_per_tonne for sold picks (server-derived). */
  grape_value: number | null;
}

export interface PickingFinancialsResult {
  /** False when the backend denied access (42501) — never treated as $0. */
  authorised: boolean;
  byId: Map<string, PickingRecordFinancial>;
}

const DENIED: PickingFinancialsResult = { authorised: false, byId: new Map() };

/** Postgres "insufficient privilege" — the documented no-access signal. */
export function isFinancialAccessDenied(error: any): boolean {
  return error?.code === "42501" || /permission denied|insufficient/i.test(error?.message ?? "");
}

export async function fetchPickingRecordFinancials(
  vineyardId: string,
): Promise<PickingFinancialsResult> {
  const { data, error } = await (supabase as any).rpc("get_picking_record_financials", {
    p_vineyard_id: vineyardId,
  });
  // Never retry-loop a permission error: the caller simply has no money access.
  if (error) {
    if (isFinancialAccessDenied(error)) return DENIED;
    throw error;
  }
  const byId = new Map<string, PickingRecordFinancial>();
  for (const row of (data ?? []) as any[]) {
    const id = row?.picking_record_id ?? row?.id;
    if (!id) continue;
    byId.set(String(id), {
      picking_record_id: String(id),
      sold_to: row?.sold_to ?? null,
      price_per_tonne: row?.price_per_tonne != null ? Number(row.price_per_tonne) : null,
      grape_value: row?.grape_value != null ? Number(row.grape_value) : null,
    });
  }
  return { authorised: true, byId };
}

/**
 * Financial values for a vineyard's picks. The query is only issued for
 * owner/manager: lower roles must not even probe the protected contract.
 */
export function usePickingFinancials(vineyardId: string | null) {
  const canSee = useCanSeePickingFinancials();
  const q = useQuery({
    queryKey: ["picking_record_financials", vineyardId],
    enabled: !!vineyardId && canSee,
    queryFn: () => fetchPickingRecordFinancials(vineyardId!),
    staleTime: 60_000,
  });
  return {
    canSee,
    /** True only when the role allows money AND the backend returned rows. */
    authorised: canSee && (q.data?.authorised ?? false),
    byId: q.data?.byId ?? new Map<string, PickingRecordFinancial>(),
    isLoading: q.isLoading,
  };
}

export type PickingRecordWithFinancials = PickingRecord & {
  /** Present only for authorised readers; absent means "not authorised". */
  financial?: PickingRecordFinancial | null;
};

/**
 * Merge protected values into base rows for an authorised reader.
 *
 * For unauthorised readers the rows are returned untouched — the masked NULLs
 * stay NULL and no `financial` key is attached, so the UI can distinguish
 * "no permission" from "authorised but nothing recorded".
 */
export function mergePickingFinancials(
  records: PickingRecord[],
  result: { authorised: boolean; byId: Map<string, PickingRecordFinancial> },
): PickingRecordWithFinancials[] {
  if (!result.authorised) return records;
  return records.map((r) => ({ ...r, financial: result.byId.get(r.id) ?? null }));
}

/** The three distinct money states a pick can be in (never collapsed to $0). */
export type PickingMoneyState = "no-permission" | "no-sale" | "no-data" | "recorded";

export function pickingMoneyState(
  record: Pick<PickingRecord, "sold">,
  opts: { authorised: boolean; financial?: PickingRecordFinancial | null },
): PickingMoneyState {
  if (!opts.authorised) return "no-permission";
  if (!record.sold) return "no-sale";
  const f = opts.financial;
  if (!f || (f.sold_to == null && f.price_per_tonne == null)) return "no-data";
  return "recorded";
}
