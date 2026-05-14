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
    opCat, opCatWithRate, members, membersCat,
    tractors, tractorsLph, trips, tripsTractor,
    fuel, chems, inputs, inputsCost, paddocks, yieldR,
  ] = await Promise.all([
    eq("operator_categories"),
    eq("operator_categories").not("cost_per_hour", "is", null),
    supabase.from("vineyard_members").select("*", { count: "exact", head: true }).eq("vineyard_id", vineyardId),
    supabase.from("vineyard_members").select("*", { count: "exact", head: true })
      .eq("vineyard_id", vineyardId).not("operator_category_id", "is", null),
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
    membersTotal: members.count ?? 0,
    membersWithCategory: membersCat.count ?? 0,
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
}

function buildRows(c: SetupCounts): CheckRow[] {
  const rateOk = c.operatorCategories > 0 && c.operatorCategoriesWithRate === c.operatorCategories;
  const memberOk = c.membersTotal > 0 && c.membersWithCategory === c.membersTotal;
  return [
    {
      key: "labour",
      title: "Operator labour",
      state: c.operatorCategories === 0 || c.membersTotal === 0 ? "empty" :
        rateOk && memberOk ? "ok" : "warn",
      detail: c.operatorCategories === 0
        ? "No operator categories yet. Add categories with an hourly rate."
        : !rateOk
          ? `${c.operatorCategories - c.operatorCategoriesWithRate} of ${c.operatorCategories} categories are missing an hourly rate.`
          : !memberOk
            ? `${c.membersTotal - c.membersWithCategory} of ${c.membersTotal} team members are not yet assigned to an operator category.`
            : "All categories have a rate and all team members are assigned.",
      href: "/setup/operator-categories",
      linkLabel: "Operator categories",
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
        ? "No blocks/paddocks set up yet."
        : `${c.paddocksWithPolygon} of ${c.paddocks} blocks have a mapped polygon. Trips must be linked to mapped blocks for cost per ha to calculate.`,
      href: "/setup/paddocks",
      linkLabel: "Blocks / paddocks",
    },
    {
      key: "yield",
      title: "Yield tonnes",
      state: c.yieldRecords === 0 ? "empty" : "ok",
      detail: c.yieldRecords === 0
        ? "No actual yield records yet. Cost per tonne needs at least one yield record per block & season."
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
  const { data } = useQuery({
    queryKey: ["costing-setup-counts", vineyardId],
    queryFn: () => fetchSetupCounts(vineyardId!),
    enabled: !!vineyardId,
  });
  if (!data) return { hasIssues: false, okCount: 0, totalCount: 0 };
  const rows = buildRows(data);
  const ok = rows.filter((r) => r.state === "ok").length;
  return { hasIssues: rows.some((r) => r.state !== "ok"), okCount: ok, totalCount: rows.length };
}

export default function CostingSetupWizard({ vineyardId }: Props) {
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
            Complete these setup items so VineTrack can calculate cost by block,
            variety, hectare and tonne.
          </p>
        </div>
        {data && (
          <Badge variant="outline" className="shrink-0">
            {buildRows(data).filter((r) => r.state === "ok").length} / {buildRows(data).length} ready
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
          {buildRows(data).map((row) => (
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
