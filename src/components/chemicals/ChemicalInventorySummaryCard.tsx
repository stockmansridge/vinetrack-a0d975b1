// Read-only "Inventory & purchase" summary inside Edit Chemical.
// Chemical Inventory / Chemical Purchase are the authority; nothing here is
// editable, computed locally, or copied back into the Saved Chemical.
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dateFormat";
import {
  canRecordChemicalPurchase, canViewChemicalInventoryCosts, fetchInventorySummary, fetchPurchaseHistory,
  formatMoney, STOCK_STATE_LABEL,
} from "@/lib/chemicalInventory";

type Role = Parameters<typeof canRecordChemicalPurchase>[0];

export function ChemicalInventorySummaryCard({ savedChemicalId, role }: { savedChemicalId: string | null; role: Role }) {
  if (!savedChemicalId) {
    return (
      <div className="rounded-md border border-border/60 p-3" data-testid="inventory-summary-new">
        <div className="text-sm font-semibold">Inventory &amp; purchase</div>
        <p className="mt-1 text-xs text-muted-foreground">Save the chemical first, then record purchases through Chemical Purchase.</p>
      </div>
    );
  }
  return <Loaded id={savedChemicalId} role={role} />;
}

function Loaded({ id, role }: { id: string; role: Role }) {
  const showCost = canViewChemicalInventoryCosts(role);
  const canBuy = canRecordChemicalPurchase(role);
  const summary = useQuery({ queryKey: ["chem-inventory", id], queryFn: () => fetchInventorySummary(id) });
  const history = useQuery({ queryKey: ["chem-inventory-history", id], queryFn: () => fetchPurchaseHistory(id) });
  const s = summary.data;
  const p = history.data?.[0] ?? null;
  const qty = s?.quantity != null ? `${s.quantity} ${s.unit ?? ""}`.trim() : "—";
  const rows: Array<[string, string | null | undefined]> = [
    ["Latest purchase", s?.latestPurchaseDate ? formatDate(s.latestPurchaseDate) : null],
    ...(showCost ? [["Latest unit cost", s?.latestUnitCost != null ? `${formatMoney(s.latestUnitCost, s.currency)}${s.latestCostUnit ? ` / ${s.latestCostUnit}` : ""}` : null] as [string, string | null]] : []),
    ["Containers", p?.containerCount != null && p.containerSize != null ? `${p.containerCount} × ${p.containerSize} ${p.containerUnit ?? ""}`.trim() : null],
    ["Batch / Lot", s?.latestBatch],
    ["Production / Batch date", s?.latestBatchDate ? formatDate(s.latestBatchDate) : null],
    ["Serial number", s?.latestSerial],
    ["Supplier", p?.supplier],
    ["Invoice / reference", p?.reference],
    ["Expiry", p?.expiry ? formatDate(p.expiry) : null],
  ];
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3" data-testid="inventory-summary">
      <div className="text-sm font-semibold">Inventory &amp; purchase</div>
      {summary.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : summary.isError ? (
        <p className="text-xs text-muted-foreground">Inventory details are unavailable right now.</p>
      ) : (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Current quantity</dt><dd>{qty}</dd>
          <dt className="text-muted-foreground">Stock status</dt><dd>{s?.state ? STOCK_STATE_LABEL[s.state] : "—"}</dd>
          {rows.filter(([, v]) => v).map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></Fragment>))}
        </dl>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild size="sm" variant="outline"><Link to="/setup/chemicals/inventory">View Inventory</Link></Button>
        {canBuy && <Button asChild size="sm"><Link to={`/setup/chemicals/purchases?chemical=${encodeURIComponent(id)}`}>Record Purchase</Link></Button>}
      </div>
    </div>
  );
}
