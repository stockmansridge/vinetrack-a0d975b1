// Costing Setup Wizard — owner/manager only.
// Renders a checklist of prerequisites required for accurate
// block × variety × ha × tonne costing. Reads small head-only counts
// from the iOS Supabase project; non-owner/manager users never reach
// this component (CostReportsPage gates on useCanSeeCosts()).
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, ChevronRight, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/ios-supabase/client";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

interface Props {
  vineyardId: string;
}

interface SetupCounts {
  operatorCategories: number;
  operatorCategoriesWithRate: number;
  membersTotal: number;
  membersWithCategory: number;
  tractors: number;
  tractorsWithLph: number;
  tripsWithTractor: number;
  tripsTotal: number;
  fuelPurchases: number;
  savedChemicals: number;
  savedChemicalsWithPurchase: number;
  savedInputs: number;
  savedInputsWithCost: number;
  paddocks: number;
  paddocksWithPolygon: number;
  yieldRecords: number;
}

async function fetchSetupCounts(vineyardId: string): Promise<SetupCounts> {
  const eq = (t: string) =>
    supabase.from(t).select("*", { count: "exact", head: true }).eq("vineyard_id", vineyardId).is("deleted_at", null);

  const [
    opCat, opCatWithRate, memberRows,
    tractors, tractorsLph, trips, tripsTractor,
    fuel, chems, inputs, inputsCost, paddocks, yieldR,
  ] = await Promise.all([
    eq("worker_types"),
    eq("worker_types").not("cost_per_hour", "is", null),
    // Full rows so inactive / archived / duplicate memberships can be excluded
    // client-side — a head-only count would include them.
    supabase.from("vineyard_members").select("*").eq("vineyard_id", vineyardId),
    eq("tractors"),
    eq("tractors").not("fuel_usage_l_per_hour", "is", null),
    eq("trips"),
    eq("trips").not("tractor_id", "is", null),
    eq("fuel_purchases"),
    eq("saved_chemicals"),
    // Best-effort: rows whose purchase jsonb is not null. Resolved client-side
    // because jsonb null filters can be surprising; we just take total count
    // and resolve "has purchase" via a small select.
    supabase.from("saved_chemicals").select("id, purchase", { count: "exact" })
      .eq("vineyard_id", vineyardId).is("deleted_at", null).limit(1000),
    eq("saved_inputs"),
    eq("saved_inputs").not("cost_per_unit", "is", null),
    supabase.from("paddocks").select("id, polygon_points", { count: "exact" })
      .eq("vineyard_id", vineyardId).is("deleted_at", null).limit(2000),
    supabase.from("historical_yield_records").select("*", { count: "exact", head: true })
      .eq("vineyard_id", vineyardId),
  ]);

  // ---- Active operational workers only ----
  // Excludes soft-deleted / archived / removed / pending-invite memberships and
  // deduplicates by user_id so an owner with two membership rows counts once.
  const WORKER_ROLES = new Set(["owner", "manager", "supervisor", "operator"]);
  const rawMembers = (memberRows.data ?? []) as any[];
  const activeByUser = new Map<string, any>();
  rawMembers.forEach((m) => {
    if (!m?.user_id) return;                       // pending invite / no account
    if (m.deleted_at || m.removed_at || m.archived_at) return;
    const status = String(m.status ?? m.membership_status ?? "active").toLowerCase();
    if (status && status !== "active") return;     // pending, invited, suspended…
    if (m.is_service_account === true) return;
    const role = String(m.role ?? "").toLowerCase();
    if (role && !WORKER_ROLES.has(role)) return;   // non-operational account
    const existing = activeByUser.get(m.user_id);
    // Keep whichever membership actually carries an assignment.
    if (!existing || (!existing.worker_type_id && m.worker_type_id)) {
      activeByUser.set(m.user_id, m);
    }
  });
  const activeWorkers = Array.from(activeByUser.values());

  const chemsRows = (chems.data ?? []) as { purchase: any }[];
  const chemsWithPurchase = chemsRows.filter((r) => {
    const p = r.purchase;
    if (!p) return false;
    if (Array.isArray(p)) return p.length > 0;
    if (typeof p === "object") return Object.keys(p).length > 0;
    return false;
  }).length;
  const paddockRows = (paddocks.data ?? []) as { polygon_points: any }[];
  const paddocksWithPolygon = paddockRows.filter((r) => {
    const pp = r.polygon_points;
    if (!pp) return false;
    if (Array.isArray(pp)) return pp.length >= 3;
    return true;
  }).length;

  return {
    operatorCategories: opCat.count ?? 0,
    operatorCategoriesWithRate: opCatWithRate.count ?? 0,
    membersTotal: activeWorkers.length,
    membersWithCategory: activeWorkers.filter((m) => !!m.worker_type_id).length,
    tractors: tractors.count ?? 0,
    tractorsWithLph: tractorsLph.count ?? 0,
    tripsTotal: trips.count ?? 0,
    tripsWithTractor: tripsTractor.count ?? 0,
    fuelPurchases: fuel.count ?? 0,
    savedChemicals: chems.count ?? chemsRows.length,
    savedChemicalsWithPurchase: chemsWithPurchase,
    savedInputs: inputs.count ?? 0,
    savedInputsWithCost: inputsCost.count ?? 0,
    paddocks: paddocks.count ?? paddockRows.length,
    paddocksWithPolygon,
    yieldRecords: yieldR.count ?? 0,
  };
}


type RowState = "ok" | "warn" | "empty";

interface CheckRow {
  key: string;
  title: string;
  state: RowState;
  detail: string;
  href?: string;
  linkLabel?: string;
  /** Informational secondary line — never affects readiness. */
  note?: string;
  noteHref?: string;
  noteLabel?: string;
}

function buildRows(c: SetupCounts, rf: RegionFormatters): CheckRow[] {
  // Labour readiness depends ONLY on whether labour cost can be resolved:
  // at least one worker type exists and every worker type carries an hourly
  // rate. An unused worker type is a perfectly valid setup record, and a team
  // member without a default worker type never blocks costing — Work Task
  // labour lines carry their own worker type and rate.
  const missingRates = c.operatorCategories - c.operatorCategoriesWithRate;
  const categoriesReady = c.operatorCategories > 0 && missingRates === 0;
  const unassignedWorkers = Math.max(0, c.membersTotal - c.membersWithCategory);
  return [
    {
      key: "labour",
      title: "Operator labour",
      state: c.operatorCategories === 0 ? "empty" : categoriesReady ? "ok" : "warn",
      detail: c.operatorCategories === 0
        ? "No worker types yet. Add worker types with an hourly rate."
        : !categoriesReady
          ? `${missingRates} of ${c.operatorCategories} worker type${c.operatorCategories === 1 ? "" : "s"} ${missingRates === 1 ? "is" : "are"} missing an hourly rate.`
          : `${c.operatorCategories} worker type${c.operatorCategories === 1 ? "" : "s"} with an hourly rate — labour cost can be resolved.`,
      href: "/setup/operator-categories",
      linkLabel: "Worker types",
      note: unassignedWorkers > 0
        ? `Worker assignments: ${unassignedWorkers} active worker${unassignedWorkers === 1 ? " has" : "s have"} no default worker type. Optional — it only pre-fills new labour lines.`
        : undefined,
      noteHref: unassignedWorkers > 0 ? "/team" : undefined,
      noteLabel: unassignedWorkers > 0 ? "Assign worker types" : undefined,
    },

    {
      key: "fuel",
      title: "Fuel costing",
      state: (c.tractors === 0 || c.fuelPurchases === 0) ? "empty"
        : (c.tractorsWithLph === c.tractors && c.tripsWithTractor > 0) ? "ok" : "warn",
      detail: c.tractors === 0
        ? "No tractors yet. Add tractors with a fuel L/hr value."
        : c.tractorsWithLph < c.tractors
          ? `${c.tractors - c.tractorsWithLph} of ${c.tractors} tractors are missing fuel L/hr.`
          : c.fuelPurchases === 0
            ? "No fuel purchases recorded yet. Add purchases to derive cost per litre."
            : c.tripsWithTractor === 0
              ? "No trips have a linked tractor yet."
              : `${c.tripsWithTractor} of ${c.tripsTotal} trips have a linked tractor. ${c.fuelPurchases} fuel purchase(s) on file.`,
      href: "/setup/tractors",
      linkLabel: "Tractors & fuel",
    },
    {
      key: "chemical",
      title: "Chemical costing",
      state: c.savedChemicals === 0 ? "empty"
        : c.savedChemicalsWithPurchase === c.savedChemicals ? "ok" : "warn",
      detail: c.savedChemicals === 0
        ? "No saved chemicals yet."
        : `${c.savedChemicalsWithPurchase} of ${c.savedChemicals} saved chemicals have purchase / cost info.`,
      href: "/setup/chemicals",
      linkLabel: "Saved chemicals",
    },
    {
      key: "inputs",
      title: "Seed / input costing",
      state: c.savedInputs === 0 ? "empty"
        : c.savedInputsWithCost === c.savedInputs ? "ok" : "warn",
      detail: c.savedInputs === 0
        ? "No saved inputs yet. Add seed/fertiliser items with a cost per unit."
        : `${c.savedInputsWithCost} of ${c.savedInputs} saved inputs have a cost per unit. Make sure trip seeding lines reference a saved input.`,
      href: "/setup/saved-inputs",
      linkLabel: "Saved inputs",
    },
    {
      key: "area",
      title: "Treated area",
      state: c.paddocks === 0 ? "empty"
        : c.paddocksWithPolygon === c.paddocks ? "ok" : "warn",
      detail: c.paddocks === 0
        ? `No ${rf.blocksLabel.toLowerCase()} set up yet.`
        : `${c.paddocksWithPolygon} of ${c.paddocks} ${rf.blocksLabel.toLowerCase()} have a mapped polygon. Trips must be linked to mapped ${rf.blocksLabel.toLowerCase()} for cost per ${rf.areaUnitLabel} to calculate.`,
      href: "/setup/paddocks",
      linkLabel: rf.blocksLabel,
    },
    {
      key: "yield",
      title: "Yield tonnes",
      state: c.yieldRecords === 0 ? "empty" : "ok",
      detail: c.yieldRecords === 0
        ? `No actual yield records yet. Cost per tonne needs at least one yield record per ${rf.blockLabel.toLowerCase()} & season.`
        : `${c.yieldRecords} yield record(s) on file.`,
      href: "/yield",
      linkLabel: "Yield reports",
    },
  ];
}

export interface CostingSetupSummary {
  hasIssues: boolean;
  okCount: number;
  totalCount: number;
}

export function useCostingSetupSummary(vineyardId: string | null): CostingSetupSummary {
  const rf = useRegionFormatters();
  const { data } = useQuery({
    queryKey: ["costing-setup-counts", vineyardId],
    queryFn: () => fetchSetupCounts(vineyardId!),
    enabled: !!vineyardId,
  });
  if (!data) return { hasIssues: false, okCount: 0, totalCount: 0 };
  const rows = buildRows(data, rf);
  const ok = rows.filter((r) => r.state === "ok").length;
  return { hasIssues: rows.some((r) => r.state !== "ok"), okCount: ok, totalCount: rows.length };
}

export default function CostingSetupWizard({ vineyardId }: Props) {
  const rf = useRegionFormatters();
  const { data, isLoading, error } = useQuery({
    queryKey: ["costing-setup-counts", vineyardId],
    queryFn: () => fetchSetupCounts(vineyardId),
    enabled: !!vineyardId,
  });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold">Costing setup</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete these setup items so VineTrack can calculate cost by {rf.blockLabel.toLowerCase()},
            variety, {rf.areaUnitLabel === "ac" ? "acre" : "hectare"} and tonne.
          </p>
        </div>
        {data && (
          <Badge variant="outline" className="shrink-0">
            {buildRows(data, rf).filter((r) => r.state === "ok").length} / {buildRows(data, rf).length} ready
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="h-4 w-4 animate-spin" />Checking your setup…
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive py-2">
          Could not load setup status. Please try again.
        </div>
      )}

      {data && (
        <ul className="divide-y">
          {buildRows(data, rf).map((row) => (
            <li key={row.key} className="py-2.5 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {row.state === "ok"
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  : <AlertTriangle className={`h-5 w-5 ${row.state === "empty" ? "text-muted-foreground" : "text-amber-600"}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{row.title}</span>
                  {row.state !== "ok" && (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {row.state === "empty" ? "Not started" : "Needs attention"}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{row.detail}</p>
                {row.note && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.note}{" "}
                    {row.noteHref && (
                      <Link to={row.noteHref} className="text-primary hover:underline">
                        {row.noteLabel ?? "Open"}
                      </Link>
                    )}
                  </p>
                )}
              </div>
              {row.href && (
                <Link
                  to={row.href}
                  className="shrink-0 inline-flex items-center text-xs text-primary hover:underline"
                >
                  {row.linkLabel ?? "Open"}
                  <ChevronRight className="h-3 w-3 ml-0.5" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
