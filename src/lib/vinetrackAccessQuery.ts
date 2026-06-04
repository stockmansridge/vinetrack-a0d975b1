// VineTrack access entitlement — reads from the iOS Supabase project's
// get_my_vinetrack_access() RPC (schema lives in Rork's draft billing
// migration). The portal renders billing/plan state from this single
// source of truth. Safe-by-default: returns null if the RPC is not
// deployed yet (draft schema) so the Billing page can show an empty
// state instead of erroring.
import { useQuery } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface VinetrackAccess {
  user_id: string | null;
  has_supabase_access: boolean;
  access_source: "team" | "enterprise" | "legacy" | "none" | string;
  is_owner: boolean;
  subscription_id: string | null;
  plan_code: string | null;
  plan_tier: string | null;
  plan_name: string | null;
  billing_provider: "apple" | "stripe" | "manual" | string | null;
  status: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  portal_access: boolean;
  portal_access_level: "none" | "basic" | "full" | "custom" | string | null;
  can_use_ios_app: boolean;
  can_use_portal: boolean;
  seats_included: number | null;
  seats_purchased: number | null;
  active_licences: number | null;
  vineyard_id: string | null;
  licence_id: string | null;
  solo_check_required: boolean;
  unlimited_licences?: boolean | null;
  manual_grant_reason?: string | null;
  manual_grant_expires_at?: string | null;
}

const QK = ["vinetrack", "access"] as const;

export function useVinetrackAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id ?? null],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<{
      access: VinetrackAccess | null;
      schemaMissing: boolean;
    }> => {
      const { data, error } = await (iosSupabase as any).rpc(
        "get_my_vinetrack_access"
      );
      if (error) {
        // RPC not deployed yet (draft billing schema). Treat as empty.
        const msg = (error.message || "").toLowerCase();
        if (
          msg.includes("does not exist") ||
          msg.includes("not found") ||
          msg.includes("could not find") ||
          (error as any).code === "42883" ||
          (error as any).code === "PGRST202"
        ) {
          return { access: null, schemaMissing: true };
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return { access: (row ?? null) as VinetrackAccess | null, schemaMissing: false };
    },
  });
}

export interface VinetrackInvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  currency: string | null;
  total_cents: number | null;
  amount_paid_cents: number | null;
  period_start: string | null;
  period_end: string | null;
  issued_at: string | null;
  paid_at: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
}

export function useVinetrackInvoices(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["vinetrack", "invoices", subscriptionId ?? null],
    enabled: !!subscriptionId,
    staleTime: 60_000,
    queryFn: async (): Promise<VinetrackInvoiceRow[]> => {
      const { data, error } = await (iosSupabase as any)
        .from("vinetrack_invoice_records")
        .select(
          "id,invoice_number,status,currency,total_cents,amount_paid_cents,period_start,period_end,issued_at,paid_at,hosted_invoice_url,invoice_pdf_url"
        )
        .eq("subscription_id", subscriptionId)
        .order("issued_at", { ascending: false });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("does not exist") || (error as any).code === "42P01") {
          return [];
        }
        throw error;
      }
      return (data ?? []) as VinetrackInvoiceRow[];
    },
  });
}

function fmtMoney(cents: number | null | undefined, currency: string | null | undefined) {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "AUD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}
export { fmtMoney as formatVinetrackMoney };
