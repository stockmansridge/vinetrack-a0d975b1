// Inventory panel for one vineyard chemical. Actions split by selected-vineyard
// role: Owner/Manager everything; Supervisor purchase + history; Operator read-only.
// Costs only for canViewChemicalInventoryCosts. Every action goes through the inventory RPCs and the
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
import { formatDate } from "@/lib/dateFormat";
import { useToast } from "@/hooks/use-toast";
import { useVineyard } from "@/context/VineyardContext";
import { formFromInventoryUnit, parsePhysicalForm } from "@/lib/chemicalPhysicalForm";
import {
  DEFAULT_LOW_STOCK_PERCENT, MARK_FINISHED_CONFIRM, OPENING_STOCK_NOT_SET, STOCK_STATE_LABEL, STOCK_STATE_TONE, STOCK_UNITS,
  fetchInventorySummary, fetchPurchaseHistory, formatMoney, markFinished, recordPurchaseV2, recordStocktakeV2, saveInventorySettings,
  canManageChemicalInventory, canRecordChemicalPurchase, canViewChemicalInventoryCosts,
  type InventorySummary, type PurchaseDraft, type SettingsDraft, type StockReason, type StockUnit, type StocktakeDraft,
} from "@/lib/chemicalInventory";
import { containerTotal, defaultContainer, previewUnitCost, type ContainerDraft } from "@/lib/chemicalContainers";

export const STOCK_TONE_CLASS = {
  green: "bg-success/15 text-success",
  amber: "bg-warning/20 text-warning-foreground",
  red: "bg-destructive/15 text-destructive",
  grey: "bg-muted text-muted-foreground",
} as const;

const LIQUID_UNITS: StockUnit[] = ["L", "mL"];
const SOLID_UNITS: StockUnit[] = ["kg", "g"];
const asStockUnit = (u?: string | null): StockUnit | undefined =>
  STOCK_UNITS.find((x) => x.toLowerCase() === String(u ?? "").trim().toLowerCase());

/** Units allowed once inventory exists: the backend's unit family only. */
export function allowedStockUnits(existingUnit?: string | null): readonly StockUnit[] {
  const f = formFromInventoryUnit(existingUnit);
  if (f === "solid") return SOLID_UNITS;
  if (f === "liquid") return LIQUID_UNITS;
  return STOCK_UNITS;
}

/**
 * Initial unit for inventory dialogs. Priority: existing inventory unit,
 * Saved Chemical product_form, Saved Chemical inventory_unit, then "L".
 * Never guessed from the chemical name.
 */
export function defaultStockUnit(existingUnit?: string | null, productForm?: string | null, inventoryUnit?: string | null): StockUnit {
  const existing = asStockUnit(existingUnit);
  if (existing) return existing;
  const form = parsePhysicalForm(productForm);
  if (form === "solid") return "kg";
  if (form === "liquid") return "L";
  const inv = asStockUnit(String(inventoryUnit ?? "").replace(/\s*\/.*$/, ""));
  if (inv) return inv;
  return "L";
}

export const INVENTORY_SUCCESS = {
  opening: "Opening stock saved",
  purchase: "Purchase recorded",
  stock: "Stock adjusted",
  finish: "Chemical marked finished",
  settings: "Low-stock settings saved",
} as const;

function UnitSelect({ value, onChange, label, units = STOCK_UNITS }: { value: StockUnit; onChange: (u: StockUnit) => void; label: string; units?: readonly StockUnit[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StockUnit)}>
      <SelectTrigger className="w-24" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
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
export const emptyPurchase = (unit: StockUnit = "L"): PurchaseDraft => ({ date: today(), quantity: "", unit, total: "", currency: "AUD", batch: "", batchDate: "", serialNumber: "", supplier: "", reference: "", expiry: "", notes: "" });

/** Containers × size → aggregate quantity (legacy helper; V2 sends container fields instead). */
export const purchaseFromContainers = (p: PurchaseDraft, box: ContainerDraft): PurchaseDraft => {
  const t = containerTotal(box);
  return { ...p, quantity: t === null ? "" : String(t), unit: box.unit };
};

export function ContainerFields({ box, setBox, units, unitLocked, idPrefix = "c" }: { box: ContainerDraft; setBox: (b: ContainerDraft) => void; units: readonly StockUnit[]; unitLocked?: boolean; idPrefix?: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div><Label htmlFor={`${idPrefix}-count`}>Number of containers</Label><Input id={`${idPrefix}-count`} inputMode="numeric" value={box.count} onChange={(e) => setBox({ ...box, count: e.target.value })} /></div>
      <div><Label htmlFor={`${idPrefix}-size`}>Container size</Label><Input id={`${idPrefix}-size`} inputMode="decimal" value={box.size} onChange={(e) => setBox({ ...box, size: e.target.value })} /></div>
      <div><Label>Unit</Label>{unitLocked ? <div className="flex h-10 items-center text-sm">{box.unit}</div> : <UnitSelect label="Container unit" units={units} value={box.unit} onChange={(u) => setBox({ ...box, unit: u })} />}</div>
    </div>
  );
}

export function PurchaseFields({ purchase, setPurchase, box, setBox, units }: { purchase: PurchaseDraft; setPurchase: (p: PurchaseDraft) => void; box: ContainerDraft; setBox: (b: ContainerDraft) => void; units: readonly StockUnit[] }) {
  const total = containerTotal(box);
  const unitCost = previewUnitCost(purchase.total, total);
  return (
    <div className="space-y-3">
      <ContainerFields box={box} setBox={setBox} units={units} idPrefix="p" />
      <div className="rounded bg-muted/40 px-3 py-2 text-sm" data-testid="purchase-total-preview">
        {total === null ? <span className="text-muted-foreground">Enter containers and size to see the total.</span>
          : <span>{box.count} × {box.size} {box.unit} = <strong>{total} {box.unit}</strong> total</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="p-total">Total purchase amount</Label><Input id="p-total" inputMode="decimal" value={purchase.total} onChange={(e) => setPurchase({ ...purchase, total: e.target.value })} /></div>
        <div><Label htmlFor="p-cur">Currency</Label><Input id="p-cur" value={purchase.currency} onChange={(e) => setPurchase({ ...purchase, currency: e.target.value.toUpperCase() })} /></div>
        {unitCost !== null && <p className="col-span-2 text-xs text-muted-foreground" data-testid="purchase-unit-cost-preview">{formatMoney(Number(purchase.total), purchase.currency)} purchase ≈ {formatMoney(unitCost, purchase.currency)}/{box.unit} (preview — VineTrack calculates the saved unit cost)</p>}
      </div>
      <fieldset className="grid grid-cols-2 gap-2 rounded border p-2" data-testid="purchase-traceability">
        <legend className="px-1 text-xs font-medium">Traceability</legend>
        <div><Label htmlFor="p-date">Purchase date</Label><Input id="p-date" type="date" value={purchase.date} onChange={(e) => setPurchase({ ...purchase, date: e.target.value })} /></div>
        <div><Label htmlFor="p-batch">Batch / Lot number</Label><Input id="p-batch" value={purchase.batch} onChange={(e) => setPurchase({ ...purchase, batch: e.target.value })} /></div>
        <div><Label htmlFor="p-bdate">Production / Batch date</Label><Input id="p-bdate" type="date" value={purchase.batchDate} onChange={(e) => setPurchase({ ...purchase, batchDate: e.target.value })} /></div>
        <div><Label htmlFor="p-serial">Serial number (if applicable)</Label><Input id="p-serial" value={purchase.serialNumber} onChange={(e) => setPurchase({ ...purchase, serialNumber: e.target.value })} /></div>
        <div><Label htmlFor="p-sup">Supplier — optional</Label><Input id="p-sup" value={purchase.supplier} onChange={(e) => setPurchase({ ...purchase, supplier: e.target.value })} /></div>
        <div><Label htmlFor="p-ref">Invoice/reference — optional</Label><Input id="p-ref" value={purchase.reference} onChange={(e) => setPurchase({ ...purchase, reference: e.target.value })} /></div>
        <div><Label htmlFor="p-exp">Expiry date — optional</Label><Input id="p-exp" type="date" value={purchase.expiry} onChange={(e) => setPurchase({ ...purchase, expiry: e.target.value })} /></div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><Label htmlFor="p-notes">Notes — optional</Label><Textarea id="p-notes" value={purchase.notes} onChange={(e) => setPurchase({ ...purchase, notes: e.target.value })} /></div>
      </div>
    </div>
  );
}

export type InventoryChemicalContext = { product_form?: string | null; inventory_unit?: string | null; pack_size?: unknown; pack_unit?: string | null } | null | undefined;

export function ChemicalInventoryPanel({ savedChemicalId, savedChemical }: { savedChemicalId: string; savedChemical?: InventoryChemicalContext }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentRole } = useVineyard();
  const canManage = canManageChemicalInventory(currentRole);
  const canBuy = canRecordChemicalPurchase(currentRole);
  const canCost = canViewChemicalInventoryCosts(currentRole);
  const summary = useQuery({ queryKey: ["chem-inventory", savedChemicalId], queryFn: () => fetchInventorySummary(savedChemicalId) });
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ["chem-inventory-history", savedChemicalId], enabled: showHistory, queryFn: () => fetchPurchaseHistory(savedChemicalId) });
  const [dialog, setDialog] = useState<null | "purchase" | "stock" | "finish" | "settings">(null);
  const [purchase, setPurchase] = useState<PurchaseDraft>(() => emptyPurchase());
  const [box, setBox] = useState<ContainerDraft>({ count: "1", size: "", unit: "L" });
  const [capBox, setCapBox] = useState<ContainerDraft>({ count: "1", size: "", unit: "L" });
  const [stock, setStock] = useState<StocktakeDraft>({ quantity: "", unit: "L", reason: "stocktake", notes: "" });
  const [finishNote, setFinishNote] = useState("");
  const [settings, setSettings] = useState<SettingsDraft>({ warningsEnabled: true, lowQuantity: "", lowUnit: "L", lowPercent: String(DEFAULT_LOW_STOCK_PERCENT) });
  const [err, setErr] = useState<string | null>(null);

  const s = summary.data;
  const needsOpening = !s || s.state === "needs_opening_stock" || (s.state === null && s.tracked !== true);
  // Existing inventory keeps its unit family, even before opening stock is set.
  const existingUnit = s?.unit ?? null;
  const units = allowedStockUnits(existingUnit);
  const initialUnit = defaultStockUnit(existingUnit, savedChemical?.product_form, savedChemical?.inventory_unit);
  const capacity = containerTotal(capBox);

  // Deterministic post-save update: fetch the fresh summary, write it into the
  // shared cache (panel + Inventory page), then refetch in the background.
  const refreshAfterSave = async (kind: "purchase" | "stock" | "finish" | "settings") => {
    const fresh = await fetchInventorySummary(savedChemicalId);
    qc.setQueryData(["chem-inventory", savedChemicalId], fresh);
    if (kind === "purchase") {
      const h = await fetchPurchaseHistory(savedChemicalId).catch(() => undefined);
      if (h) qc.setQueryData(["chem-inventory-history", savedChemicalId], h);
    }
    void qc.invalidateQueries({ queryKey: ["chem-inventory-history", savedChemicalId] });
    void qc.invalidateQueries({ queryKey: ["saved_chemicals"] });
  };
  const mut = useMutation({
    mutationFn: async (kind: "purchase" | "stock" | "finish" | "settings") => {
      if (kind === "purchase" ? !canBuy : !canManage) throw new Error("Your role on this vineyard can't make this change.");
      const wasOpening = kind === "stock" && needsOpening;
      // Same V2 contract as the Chemical Purchase page; the backend computes quantity.
      if (kind === "purchase") await recordPurchaseV2(savedChemicalId, purchase, box);
      else if (kind === "stock") await recordStocktakeV2(savedChemicalId, stock, needsOpening ? { ...capBox, unit: stock.unit } : null);
      else if (kind === "finish") await markFinished(savedChemicalId, finishNote);
      else await saveInventorySettings(savedChemicalId, settings);
      await refreshAfterSave(kind);
      return wasOpening ? "opening" : kind;
    },
    onSuccess: (key) => {
      setDialog(null); setErr(null);
      toast({ title: INVENTORY_SUCCESS[key as keyof typeof INVENTORY_SUCCESS] });
    },
    onError: (e: any) => setErr(e?.message ?? "The backend refused this change."),
  });
  const open = (d: typeof dialog) => {
    setErr(null);
    if (d === "purchase") { setPurchase(emptyPurchase(initialUnit)); setBox(defaultContainer(savedChemical?.pack_size, savedChemical?.pack_unit, initialUnit, units)); }
    if (d === "stock") {
      const cap = defaultContainer(savedChemical?.pack_size, savedChemical?.pack_unit, initialUnit, units);
      const full = needsOpening ? containerTotal(cap) : null;
      // Opening stock defaults to full containers; the operator lowers it if partly used.
      setStock({ quantity: full === null ? "" : String(full), unit: needsOpening ? cap.unit : initialUnit, reason: needsOpening ? "opening_stock" : "stocktake", notes: "" });
      setCapBox(cap);
    }
    if (d === "settings" && s) setSettings({ warningsEnabled: s.warningsEnabled ?? true, lowQuantity: s.lowStockQuantity === null ? "" : String(s.lowStockQuantity), lowUnit: initialUnit, lowPercent: String(s.lowStockPercent ?? DEFAULT_LOW_STOCK_PERCENT) });
    if (d === "finish") setFinishNote("");
    setDialog(d);
  };

  return (
    <section className="space-y-3 rounded border p-3" data-testid="inventory-panel">
      <h3 className="font-semibold">Inventory</h3>
      {summary.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {summary.error && <p className="text-sm text-destructive">{(summary.error as Error).message}</p>}
      {s && <InventorySummaryView s={s} />}
      {s && !needsOpening && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {canCost && <div><dt className="text-xs text-muted-foreground">Latest price</dt><dd data-testid="inventory-latest-price">{s.latestUnitCost === null ? "—" : `${formatMoney(s.latestUnitCost, s.currency)}${s.latestCostUnit ? ` / ${s.latestCostUnit}` : ""}`}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">Latest purchase</dt><dd>{s.latestPurchaseDate ? new Date(s.latestPurchaseDate).toLocaleDateString() : "—"}</dd></div>
          {s.latestBatch && <div><dt className="text-xs text-muted-foreground">Batch / Lot</dt><dd data-testid="inventory-latest-batch">{s.latestBatch}</dd></div>}
          {s.latestBatchDate && <div><dt className="text-xs text-muted-foreground">Production / Batch date</dt><dd data-testid="inventory-latest-batch-date">{formatDate(s.latestBatchDate)}</dd></div>}
          {s.latestSerial && <div><dt className="text-xs text-muted-foreground">Serial</dt><dd data-testid="inventory-latest-serial">{s.latestSerial}</dd></div>}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {canManage && needsOpening ? <Button size="sm" onClick={() => open("stock")}>Set Opening Stock</Button> : null}
        {canBuy && <Button size="sm" variant={needsOpening && canManage ? "outline" : "default"} onClick={() => open("purchase")}>Record Purchase</Button>}
        {canManage && !needsOpening && <Button size="sm" variant="outline" onClick={() => open("stock")}>Stocktake / Adjust</Button>}
        {canManage && !needsOpening && <Button size="sm" variant="outline" onClick={() => open("finish")}>Mark Finished</Button>}
        {canManage && <Button size="sm" variant="ghost" onClick={() => open("settings")}>Low stock settings</Button>}
        <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>Purchase History</Button>
      </div>

      {showHistory && (
        <div className="overflow-x-auto" data-testid="purchase-history">
          {history.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {history.error && <p className="text-sm text-destructive">{(history.error as Error).message}</p>}
          {history.data && (history.data.length === 0 ? <p className="text-sm text-muted-foreground">No purchases recorded.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr>
                {["Purchase date", "Quantity", ...(canCost ? ["Total amount", "Unit cost"] : []), "Batch / Lot", "Production / Batch date", "Serial", "Supplier", "Expiry", "Invoice/reference"].map((h) => <th key={h} className="p-1">{h}</th>)}
              </tr></thead>
              <tbody>{history.data.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-1">{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                  <td className="p-1" data-testid="history-quantity">
                    {p.containerCount !== null && p.containerSize !== null && <div>{p.containerCount} × {p.containerSize} {p.containerUnit ?? p.unit ?? ""}</div>}
                    <div className={p.containerCount !== null ? "text-xs text-muted-foreground" : undefined}>{p.quantity ?? "—"} {p.unit ?? ""}{p.containerCount !== null ? " total" : ""}</div>
                  </td>
                  {canCost && <td className="p-1">{formatMoney(p.total, p.currency)}</td>}
                  {canCost && <td className="p-1">{p.unitCost === null ? "—" : `${formatMoney(p.unitCost, p.currency)}${p.unit ? ` / ${p.unit}` : ""}`}</td>}
                  <td className="p-1" data-testid="history-batch">{p.batch ?? "—"}</td>
                  <td className="p-1" data-testid="history-batch-date">{p.batchDate ? formatDate(p.batchDate) : "—"}</td>
                  <td className="p-1" data-testid="history-serial">{p.serialNumber ?? "—"}</td>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {dialog === "purchase" && (<>
            <DialogHeader><DialogTitle>Record Purchase</DialogTitle></DialogHeader>
            <PurchaseFields purchase={purchase} setPurchase={setPurchase} box={box} setBox={setBox} units={units} />
          </>)}
          {dialog === "stock" && (<>
            <DialogHeader><DialogTitle>{needsOpening ? "Set Opening Stock" : "Adjust Stock"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {needsOpening && (
                <div className="col-span-2 space-y-2 rounded border bg-muted/30 p-2" data-testid="opening-capacity">
                  <div className="text-xs font-medium">Container capacity</div>
                  <ContainerFields box={{ ...capBox, unit: stock.unit }} setBox={(b) => {
                    // Keep "full" in step with capacity until the operator types their own amount.
                    const prev = containerTotal(capBox), next = containerTotal(b);
                    if (stock.quantity === "" || (prev !== null && Number(stock.quantity) === prev)) setStock({ ...stock, quantity: next === null ? "" : String(next) });
                    setCapBox({ ...b, unit: stock.unit });
                  }} units={units} unitLocked idPrefix="o" />
                  {capacity !== null && <p className="text-xs text-muted-foreground" data-testid="opening-capacity-total">Capacity {capBox.count} × {capBox.size} {stock.unit} = {capacity} {stock.unit}</p>}
                </div>
              )}
              <div><Label htmlFor="s-qty">Current physical quantity</Label><Input id="s-qty" inputMode="decimal" value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></div>
              <div><Label>Unit</Label><UnitSelect label="Stock unit" units={units} value={stock.unit} onChange={(u) => setStock({ ...stock, unit: u })} /></div>
              {needsOpening && capacity !== null && Number(stock.quantity) > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground" data-testid="opening-remaining-preview">
                  {stock.quantity} {stock.unit} remaining of {capacity} {stock.unit} ({Math.round((Number(stock.quantity) / capacity) * 100)}% — preview; VineTrack calculates the saved figure)
                </p>
              )}
              {existingUnit && units.length < 4 && (
                <p className="col-span-2 text-xs text-muted-foreground" data-testid="unit-family-note">
                  This inventory is tracked by {units.includes("L") ? "volume (L / mL)" : "weight (kg / g)"}. The unit type can't be changed here.
                </p>
              )}
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
                <UnitSelect label="Low stock unit" units={units} value={settings.lowUnit} onChange={(u) => setSettings({ ...settings, lowUnit: u })} />
              </div>
              <div><Label htmlFor="w-p">Low stock percentage</Label><Input id="w-p" inputMode="decimal" value={settings.lowPercent} onChange={(e) => setSettings({ ...settings, lowPercent: e.target.value })} /></div>
            </div>
          </>)}
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mut.isPending} onClick={() => setDialog(null)}>Cancel</Button>
            <Button disabled={mut.isPending} variant={dialog === "finish" ? "destructive" : "default"} onClick={() => dialog && mut.mutate(dialog)}>
              {mut.isPending ? "Saving…" : dialog === "finish" ? "Mark Finished" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
