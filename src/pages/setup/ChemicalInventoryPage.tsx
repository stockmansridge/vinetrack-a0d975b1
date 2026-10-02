// Chemical Inventory — vineyard-level stock overview.
//
// All stock figures come from the existing chemical_inventory_summary RPC (one
// call per saved chemical, shared cache key with ChemicalInventoryPanel so the
// panel's actions refresh this page). Nothing is calculated in the browser.
//
// Pilot gate: canUseInventoryPilot (System Admin only) — applied here and on the
// Chemicals page button. Removing the gate in chemicalInventory.ts releases both.
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import {
  canUseInventoryPilot, fetchInventorySummary, formatMoney, OPENING_STOCK_NOT_SET,
  STOCK_STATE_LABEL, STOCK_STATE_TONE, type InventorySummary, type StockState,
} from "@/lib/chemicalInventory";
import { useV3RevisionDisplay, v3RevisionIdOf } from "@/lib/chemicalV3Display";
import { shortManufacturerName } from "@/lib/manufacturerNormalise";
import { ChemicalInventoryPanel, STOCK_TONE_CLASS } from "@/components/chemicals/ChemicalInventoryPanel";
import { ChemicalLabelThumb } from "@/components/chemicals/ChemicalListCells";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dateFormat";

type FilterKey = "all" | "ok" | "low_stock" | "out_of_stock" | "needs_opening_stock";
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "ok", label: "In stock" },
  { key: "low_stock", label: "Low stock" },
  { key: "out_of_stock", label: "Out of stock" },
  { key: "needs_opening_stock", label: OPENING_STOCK_NOT_SET },
];

/** Backend-supplied stock value only — never quantity × cost in the browser. */
const backendValue = (s?: InventorySummary): number | null => {
  return s?.estimatedStockValue ?? null;
};

export default function ChemicalInventoryPage() {
  const { selectedVineyardId } = useVineyard();
  const { isAdmin, loading: adminLoading } = useIsSystemAdmin();
  const allowed = canUseInventoryPilot(isAdmin);
  const canSeeCosts = useCanSeeCosts();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");
  const [openRow, setOpenRow] = useState<any | null>(null);

  const chemQ = useQuery({
    queryKey: ["saved_chemicals", selectedVineyardId, "active"],
    enabled: !!selectedVineyardId && allowed,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });
  const chemicals: any[] = chemQ.data?.chemicals ?? [];
  const { data: revDisplay } = useV3RevisionDisplay(chemicals);

  const summaries = useQueries({
    queries: chemicals.map((c) => ({
      queryKey: ["chem-inventory", c.id],
      enabled: allowed,
      queryFn: () => fetchInventorySummary(c.id),
    })),
  });
  // Derived directly every render — no memo, so cache writes show immediately.
  const items = chemicals.map((c, i) => ({
    c,
    s: summaries[i]?.data as InventorySummary | undefined,
    loading: summaries[i]?.isLoading,
    err: summaries[i]?.error as Error | null,
  }));

  // Unknown state only means "opening stock not set" when the backend doesn't say tracked.
  const stateOf = (s?: InventorySummary): StockState | null =>
    s?.state ?? (s && s.tracked !== true ? "needs_opening_stock" : null);
  const count = (k: StockState) => items.filter((x) => stateOf(x.s) === k).length;
  const tracked = items.filter((x) => { const st = stateOf(x.s); return st && st !== "needs_opening_stock"; }).length;
  const values = items.map((x) => backendValue(x.s)).filter((v): v is number => v !== null);
  const currency = items.find((x) => x.s?.currency)?.s?.currency ?? "AUD";

  const visible = items.filter(({ c, s }) => {
    if (filter !== "all" && stateOf(s) !== filter) return false;
    const f = q.trim().toLowerCase();
    if (!f) return true;
    return [c.name, c.manufacturer].some((v) => String(v ?? "").toLowerCase().includes(f));
  });

  if (adminLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!allowed) return <Navigate to="/setup/chemicals" replace />;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/setup/chemicals"><ArrowLeft className="h-4 w-4 mr-1" />Chemicals</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Package className="h-6 w-6 text-primary" />Chemical Inventory</h1>
        <p className="text-sm text-muted-foreground">Track chemical stock, purchases and low-stock levels for this vineyard.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Tracked chemicals" value={tracked} />
        <SummaryCard label="Low stock" value={count("low_stock")} tone="amber" />
        <SummaryCard label="Out of stock" value={count("out_of_stock")} tone="red" />
        {canSeeCosts && (
          <SummaryCard label="Estimated stock value"
            value={values.length ? formatMoney(values.reduce((a, b) => a + b, 0), currency) : "—"}
            hint={values.length ? undefined : "Available once stock and purchase cost are recorded"} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={cn("rounded px-3 py-1 text-sm transition", filter === f.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>
        <Input placeholder="Chemical name or manufacturer…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
      </div>

      <Card className="divide-y">
        {chemQ.isLoading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {chemQ.error && <p className="p-6 text-center text-sm text-destructive">{(chemQ.error as Error).message}</p>}
        {!chemQ.isLoading && visible.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No chemicals match.</p>}
        {visible.map(({ c, s, loading, err }) => {
          const rid = v3RevisionIdOf(c);
          const st = stateOf(s);
          const unknown = st === "needs_opening_stock";
          return (
            <div key={c.id} role="button" tabIndex={0} onClick={() => setOpenRow(c)}
              onKeyDown={(e) => e.key === "Enter" && setOpenRow(c)}
              className="flex cursor-pointer flex-wrap items-center gap-4 p-3 transition hover:bg-muted/40 md:flex-nowrap">
              <div onClick={(e) => e.stopPropagation()}>
                <ChemicalLabelThumb row={c} rev={rid ? revDisplay?.get(rid) : null} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground" title={c.manufacturer ?? undefined}>{shortManufacturerName(c.manufacturer) || "—"}</div>
              </div>
              <div className="w-full md:w-64">
                {loading ? <span className="text-xs text-muted-foreground">Loading stock…</span>
                  : err ? <span className="text-xs text-destructive">{err.message}</span>
                  : unknown ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{OPENING_STOCK_NOT_SET}</span>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpenRow(c); }}>Set opening stock</Button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{s?.quantity ?? "—"} {s?.unit ?? ""}</div>
                      {s?.percent != null && (
                        <div className="flex items-center gap-2">
                          <Progress value={Math.max(0, Math.min(100, s.percent))} className="h-2" />
                          <span className="w-10 text-right text-xs text-muted-foreground">{Math.round(s.percent)}%</span>
                        </div>
                      )}
                    </div>
                  )}
              </div>
              <div className="w-32">
                {st && !unknown && (
                  <Badge className={cn("border-transparent px-2 py-0 text-[11px]", STOCK_TONE_CLASS[STOCK_STATE_TONE[st]])}>{STOCK_STATE_LABEL[st]}</Badge>
                )}
              </div>
              <div className="w-40 text-xs text-muted-foreground">
                <div>{s?.latestPurchaseDate ? `Purchased ${formatDate(new Date(s.latestPurchaseDate))}` : "No purchases"}</div>
                {s?.latestBatch && <div>Batch {s.latestBatch}</div>}
              </div>
            </div>
          );
        })}
      </Card>

      <Sheet open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>{openRow?.name}</SheetTitle></SheetHeader>
          {openRow && <div className="mt-4"><ChemicalInventoryPanel savedChemicalId={openRow.id} savedChemical={openRow} /></div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SummaryCard({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "amber" | "red"; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold", tone === "amber" && "text-warning-foreground", tone === "red" && "text-destructive")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
