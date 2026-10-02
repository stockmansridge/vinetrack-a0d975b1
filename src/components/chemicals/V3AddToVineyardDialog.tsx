// Add a V3 revision to the selected vineyard. The database RPC does the
// projection into saved_chemicals; the Portal only sends the revision, the
// vineyard and an optional opening stock exactly as entered.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALREADY_IN_VINEYARD, PENDING_CATALOGUE_REVIEW, STOCK_UNITS, addV3ToVineyard, isPendingCatalogueReview, type StockUnit } from "@/lib/chemicalInventory";

export function V3AddToVineyardButton({ revisionId, productName, status, vineyardId, vineyardName }: {
  revisionId: string; productName: string; status: string | null; vineyardId: string | null; vineyardName: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<StockUnit>("L");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => addV3ToVineyard({ revisionId, vineyardId: vineyardId!, quantity: qty, unit }),
    onSuccess: (r) => {
      setOpen(false);
      setMsg({ tone: "ok", text: r.reused ? ALREADY_IN_VINEYARD : `Added to ${vineyardName ?? "vineyard"}.${qty.trim() ? "" : " Opening stock not set."}` });
      qc.invalidateQueries({ queryKey: ["saved_chemicals"] });
    },
    onError: (e: any) => setMsg({ tone: "err", text: e?.message ?? "The backend refused this action." }),
  });
  return (
    <div className="space-y-1">
      {isPendingCatalogueReview(status) && <p className="text-xs text-warning-foreground" data-testid="v3-pending-note">{PENDING_CATALOGUE_REVIEW}</p>}
      <Button size="sm" disabled={!vineyardId} title={vineyardId ? undefined : "Select a vineyard first"} onClick={() => { setMsg(null); setQty(""); setOpen(true); }}>Add to Vineyard</Button>
      {msg && <p className={msg.tone === "err" ? "text-xs text-destructive" : "text-xs text-success"}>{msg.text}</p>}
      <Dialog open={open} onOpenChange={(o) => !mut.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {productName} to {vineyardName ?? "this vineyard"}</DialogTitle></DialogHeader>
          <Label htmlFor="v3-open-qty">Opening stock — optional</Label>
          <div className="flex gap-2">
            <Input id="v3-open-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="w-40" />
            <Select value={unit} onValueChange={(v) => setUnit(v as StockUnit)}>
              <SelectTrigger className="w-24" aria-label="Opening stock unit"><SelectValue /></SelectTrigger>
              <SelectContent>{STOCK_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {msg?.tone === "err" && <p className="text-sm text-destructive">{msg.text}</p>}
          <DialogFooter>
            <Button disabled={mut.isPending || !vineyardId} onClick={() => mut.mutate()}>Add to Vineyard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
