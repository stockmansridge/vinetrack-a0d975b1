// Inventory pilot panel for one vineyard chemical. System Admin only (gate
// applied by the caller). Every action goes through the inventory RPCs and the
// panel reloads the database summary afterwards — nothing is calculated here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LOW_STOCK_PERCENT, MARK_FINISHED_CONFIRM, OPENING_STOCK_NOT_SET, STOCK_STATE_LABEL, STOCK_STATE_TONE, STOCK_UNITS,
  fetchInventorySummary, fetchPurchaseHistory, formatMoney, markFinished, recordPurchase, recordStocktake, saveInventorySettings,
  type InventorySummary, type PurchaseDraft, type SettingsDraft, type StockReason, type StockUnit, type StocktakeDraft,
} from "@/lib/chemicalInventory";

export const STOCK_TONE_CLASS = {
  green: "bg-success/15 text-success",
  amber: "bg-warning/20 text-warning-foreground",
  red: "bg-destructive/15 text-destructive",
  grey: "bg-muted text-muted-foreground",
} as const;

function UnitSelect({ value, onChange, label }: { value: StockUnit; onChange: (u: StockUnit) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StockUnit)}>
      <SelectTrigger className="w-24" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{STOCK_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export function InventorySummaryView({ s }: { s: InventorySummary }) {
  const tone = s.state ? STOCK_STATE_TONE[s.state] : "grey";
  if (s.state === "needs_opening_stock" || s.state === null) {
    return <p className="text-sm text-muted-foreground" data-testid="inventory-unknown">{OPENING_STOCK_NOT_SET}</p>;
  }
  return (
    <div className="space-y-2" data-testid="inventory-summary">
      <div className="text-2xl font-semibold">{s.quantity ?? "—"} {s.unit ?? ""} <span className="text-sm font-normal text-muted-foreground">available</span></div>
      {s.percent !== null && (
        <div className="flex items-center gap-2" data-testid="inventory-gauge">
          <Progress value={Math.max(0, Math.min(100, s.percent))} className="h-3" />
          <span className="text-sm">{Math.round(s.percent)}%</span>
        </div>
      )}
      <div className="text-sm">Status: <Badge className={cn("border-transparent", STOCK_TONE_CLASS[tone])}>{STOCK_STATE_LABEL[s.state]}</Badge></div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyPurchase = (): PurchaseDraft => ({ date: today(), quantity: "", unit: "L", total: "", currency: "AUD", batch: "", supplier: "", reference: "", expiry: "", notes: "" });

export function ChemicalInventoryPanel({ savedChemicalId }: { savedChemicalId: string }) {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["chem-inventory", savedChemicalId], queryFn: () => fetchInventorySummary(savedChemicalId) });
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ["chem-inventory-history", savedChemicalId], enabled: showHistory, queryFn: () => fetchPurchaseHistory(savedChemicalId) });
  const [dialog, setDialog] = useState<null | "purchase" | "stock" | "finish" | "settings">(null);
  const [purchase, setPurchase] = useState<PurchaseDraft>(emptyPurchase);
  const [stock, setStock] = useState<StocktakeDraft>({ quantity: "", unit: "L", reason: "stocktake", notes: "" });
  const [finishNote, setFinishNote] = useState("");
  const [settings, setSettings] = useState<SettingsDraft>({ warningsEnabled: true, lowQuantity: "", lowUnit: "L", lowPercent: String(DEFAULT_LOW_STOCK_PERCENT) });
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["chem-inventory", savedChemicalId] }),
      qc.invalidateQueries({ queryKey: ["chem-inventory-history", savedChemicalId] }),
      qc.invalidateQueries({ queryKey: ["saved_chemicals"] }),
    ]);
  };
  const mut = useMutation({
    mutationFn: async (kind: "purchase" | "stock" | "finish" | "settings") => {
      if (kind === "purchase") return recordPurchase(savedChemicalId, purchase);
      if (kind === "stock") return recordStocktake(savedChemicalId, stock);
      if (kind === "finish") return markFinished(savedChemicalId, finishNote);
      return saveInventorySettings(savedChemicalId, settings);
    },
    onSuccess: async () => { setDialog(null); setErr(null); await reload(); },
    onError: (e: any) => setErr(e?.message ?? "The backend refused this change."),
  });
  const open = (d: typeof dialog) => {
    setErr(null);
    if (d === "purchase") setPurchase(emptyPurchase());
    if (d === "stock") setStock({ quantity: "", unit: (s?.unit as StockUnit) && STOCK_UNITS.includes(s!.unit as StockUnit) ? (s!.unit as StockUnit) : "L", reason: needsOpening ? "opening_stock" : "stocktake", notes: "" });
    if (d === "settings" && s) setSettings({ warningsEnabled: s.warningsEnabled ?? true, lowQuantity: s.lowStockQuantity === null ? "" : String(s.lowStockQuantity), lowUnit: "L", lowPercent: String(s.lowStockPercent ?? DEFAULT_LOW_STOCK_PERCENT) });
    if (d === "finish") setFinishNote("");
    setDialog(d);
  };

  const s = summary.data;
  const needsOpening = !s || s.state === "needs_opening_stock" || s.state === null;
  return (
    <section className="space-y-3 rounded border p-3" data-testid="inventory-panel">
      <h3 className="font-semibold">Inventory</h3>
      {summary.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {summary.error && <p className="text-sm text-destructive">{(summary.error as Error).message}</p>}
      {s && <InventorySummaryView s={s} />}
      {s && !needsOpening && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Latest price</dt><dd data-testid="inventory-latest-price">{s.latestUnitCost === null ? "—" : `${formatMoney(s.latestUnitCost, s.currency)}${s.latestCostUnit ? ` / ${s.latestCostUnit}` : ""}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Latest purchase</dt><dd>{s.latestPurchaseDate ? new Date(s.latestPurchaseDate).toLocaleDateString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Batch</dt><dd>{s.latestBatch ?? "—"}</dd></div>
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {needsOpening ? <Button size="sm" onClick={() => open("stock")}>Set Opening Stock</Button> : null}
        <Button size="sm" variant={needsOpening ? "outline" : "default"} onClick={() => open("purchase")}>Record Purchase</Button>
        {!needsOpening && <Button size="sm" variant="outline" onClick={() => open("stock")}>Stocktake / Adjust</Button>}
        {!needsOpening && <Button size="sm" variant="outline" onClick={() => open("finish")}>Mark Finished</Button>}
        <Button size="sm" variant="ghost" onClick={() => open("settings")}>Low stock settings</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>Purchase History</Button>
      </div>

      {showHistory && (
        <div className="overflow-x-auto" data-testid="purchase-history">
          {history.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {history.error && <p className="text-sm text-destructive">{(history.error as Error).message}</p>}
          {history.data && (history.data.length === 0 ? <p className="text-sm text-muted-foreground">No purchases recorded.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr>
                {["Date", "Quantity", "Total amount", "Unit cost", "Batch", "Supplier", "Expiry", "Invoice/reference"].map((h) => <th key={h} className="p-1">{h}</th>)}
              </tr></thead>
              <tbody>{history.data.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-1">{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                  <td className="p-1">{p.quantity ?? "—"} {p.unit ?? ""}</td>
                  <td className="p-1">{formatMoney(p.total, p.currency)}</td>
                  <td className="p-1">{p.unitCost === null ? "—" : `${formatMoney(p.unitCost, p.currency)}${p.unit ? ` / ${p.unit}` : ""}`}</td>
                  <td className="p-1">{p.batch ?? "—"}</td>
                  <td className="p-1">{p.supplier ?? "—"}</td>
                  <td className="p-1">{p.expiry ? new Date(p.expiry).toLocaleDateString() : "—"}</td>
                  <td className="p-1">{p.reference ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          ))}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !mut.isPending && setDialog(null)}>
        <DialogContent>
          {dialog === "purchase" && (<>
            <DialogHeader><DialogTitle>Record Purchase</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label htmlFor="p-date">Purchase date</Label><Input id="p-date" type="date" value={purchase.date} onChange={(e) => setPurchase({ ...purchase, date: e.target.value })} /></div>
              <div><Label htmlFor="p-qty">Quantity</Label><Input id="p-qty" inputMode="decimal" value={purchase.quantity} onChange={(e) => setPurchase({ ...purchase, quantity: e.target.value })} /></div>
              <div><Label>Unit</Label><UnitSelect label="Unit" value={purchase.unit} onChange={(u) => setPurchase({ ...purchase, unit: u })} /></div>
              <div><Label htmlFor="p-total">Total purchase amount</Label><Input id="p-total" inputMode="decimal" value={purchase.total} onChange={(e) => setPurchase({ ...purchase, total: e.target.value })} /></div>
              <div><Label htmlFor="p-cur">Currency</Label><Input id="p-cur" value={purchase.currency} onChange={(e) => setPurchase({ ...purchase, currency: e.target.value.toUpperCase() })} /></div>
              <div><Label htmlFor="p-batch">Batch number</Label><Input id="p-batch" value={purchase.batch} onChange={(e) => setPurchase({ ...purchase, batch: e.target.value })} /></div>
              <div><Label htmlFor="p-sup">Supplier — optional</Label><Input id="p-sup" value={purchase.supplier} onChange={(e) => setPurchase({ ...purchase, supplier: e.target.value })} /></div>
              <div><Label htmlFor="p-ref">Invoice/reference — optional</Label><Input id="p-ref" value={purchase.reference} onChange={(e) => setPurchase({ ...purchase, reference: e.target.value })} /></div>
              <div><Label htmlFor="p-exp">Expiry date — optional</Label><Input id="p-exp" type="date" value={purchase.expiry} onChange={(e) => setPurchase({ ...purchase, expiry: e.target.value })} /></div>
              <div className="col-span-2"><Label htmlFor="p-notes">Notes — optional</Label><Textarea id="p-notes" value={purchase.notes} onChange={(e) => setPurchase({ ...purchase, notes: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">The unit cost is worked out by VineTrack from the quantity and total amount.</p>
          </>)}
          {dialog === "stock" && (<>
            <DialogHeader><DialogTitle>{needsOpening ? "Set Opening Stock" : "Adjust Stock"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="s-qty">Current physical quantity</Label><Input id="s-qty" inputMode="decimal" value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></div>
              <div><Label>Unit</Label><UnitSelect label="Stock unit" value={stock.unit} onChange={(u) => setStock({ ...stock, unit: u })} /></div>
              <div className="col-span-2"><Label>Reason</Label>
                <Select value={stock.reason} onValueChange={(v) => setStock({ ...stock, reason: v as StockReason })}>
                  <SelectTrigger aria-label="Reason"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="opening_stock">Opening stock</SelectItem>
                    <SelectItem value="stocktake">Stocktake</SelectItem>
                    <SelectItem value="correction">Correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label htmlFor="s-notes">Note</Label><Textarea id="s-notes" value={stock.notes} onChange={(e) => setStock({ ...stock, notes: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">This sets a new starting point. Past purchases are kept.</p>
          </>)}
          {dialog === "finish" && (<>
            <DialogHeader><DialogTitle>Mark Finished</DialogTitle></DialogHeader>
            <p className="whitespace-pre-line text-sm" data-testid="finish-confirm">{MARK_FINISHED_CONFIRM}</p>
            <Textarea value={finishNote} onChange={(e) => setFinishNote(e.target.value)} placeholder="Note — optional" aria-label="Finished note" />
          </>)}
          {dialog === "settings" && (<>
            <DialogHeader><DialogTitle>Low stock settings</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Switch id="w-en" checked={settings.warningsEnabled} onCheckedChange={(v) => setSettings({ ...settings, warningsEnabled: v })} /><Label htmlFor="w-en">Warnings enabled</Label></div>
              <div className="flex items-end gap-2">
                <div><Label htmlFor="w-q">Low stock quantity — optional</Label><Input id="w-q" inputMode="decimal" value={settings.lowQuantity} onChange={(e) => setSettings({ ...settings, lowQuantity: e.target.value })} /></div>
                <UnitSelect label="Low stock unit" value={settings.lowUnit} onChange={(u) => setSettings({ ...settings, lowUnit: u })} />
              </div>
              <div><Label htmlFor="w-p">Low stock percentage</Label><Input id="w-p" inputMode="decimal" value={settings.lowPercent} onChange={(e) => setSettings({ ...settings, lowPercent: e.target.value })} /></div>
            </div>
          </>)}
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mut.isPending} onClick={() => setDialog(null)}>Cancel</Button>
            <Button disabled={mut.isPending} variant={dialog === "finish" ? "destructive" : "default"} onClick={() => dialog && mut.mutate(dialog)}>
              {dialog === "finish" ? "Mark Finished" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
