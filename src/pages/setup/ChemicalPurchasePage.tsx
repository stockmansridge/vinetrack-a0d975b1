// Chemical Purchase — record a purchase against an existing Saved Chemical.
// System Admin inventory pilot gate (canUseInventoryPilot). Writes go through
// the existing recordPurchase RPC with aggregate quantity + unit only; the
// container entry is a UI model until the backend stores container fields.
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { canUseInventoryPilot, fetchInventorySummary, fetchPurchaseHistory, recordPurchase, type PurchaseDraft } from "@/lib/chemicalInventory";
import { defaultContainer, type ContainerDraft } from "@/lib/chemicalContainers";
import { useV3RevisionDisplay, v3RevisionIdOf } from "@/lib/chemicalV3Display";
import { shortManufacturerName } from "@/lib/manufacturerNormalise";
import { ChemicalSectionNav } from "@/components/chemicals/ChemicalSectionNav";
import { ChemicalLabelThumb } from "@/components/chemicals/ChemicalListCells";
import { PurchaseFields, allowedStockUnits, defaultStockUnit, emptyPurchase, purchaseFromContainers } from "@/components/chemicals/ChemicalInventoryPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function ChemicalPurchasePage() {
  const { selectedVineyardId } = useVineyard();
  const { isAdmin, loading } = useIsSystemAdmin();
  const allowed = canUseInventoryPilot(isAdmin);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [chemId, setChemId] = useState<string>("");
  const [purchase, setPurchase] = useState<PurchaseDraft>(() => emptyPurchase());
  const [box, setBox] = useState<ContainerDraft>({ count: "1", size: "", unit: "L" });
  const [err, setErr] = useState<string | null>(null);

  const chemQ = useQuery({
    queryKey: ["saved_chemicals", selectedVineyardId, "active"],
    enabled: !!selectedVineyardId && allowed,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });
  const chemicals: any[] = chemQ.data?.chemicals ?? [];
  const { data: revDisplay } = useV3RevisionDisplay(chemicals);
  const chem = chemicals.find((c) => c.id === chemId) ?? null;
  const summary = useQuery({ queryKey: ["chem-inventory", chemId], enabled: !!chemId && allowed, queryFn: () => fetchInventorySummary(chemId) });
  const units = allowedStockUnits(summary.data?.unit ?? null);

  const pick = (id: string) => {
    setChemId(id); setErr(null);
    const c = chemicals.find((x) => x.id === id);
    const unit = defaultStockUnit(null, c?.product_form, c?.inventory_unit);
    setPurchase(emptyPurchase(unit));
    setBox(defaultContainer(c?.pack_size, c?.pack_unit, unit));
  };
  // Once the summary arrives, keep the container unit inside the stored unit family.
  const effectiveBox = units.includes(box.unit) ? box : { ...box, unit: defaultStockUnit(summary.data?.unit ?? null) };

  const mut = useMutation({
    mutationFn: async () => {
      await recordPurchase(chemId, purchaseFromContainers(purchase, effectiveBox));
      qc.setQueryData(["chem-inventory", chemId], await fetchInventorySummary(chemId));
      const h = await fetchPurchaseHistory(chemId).catch(() => undefined);
      if (h) qc.setQueryData(["chem-inventory-history", chemId], h);
    },
    onSuccess: () => { toast({ title: "Purchase recorded" }); setErr(null); pick(chemId); },
    onError: (e: any) => setErr(e?.message ?? "The backend refused this change."),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!allowed) return <Navigate to="/setup/chemicals" replace />;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><ShoppingCart className="h-6 w-6 text-primary" />Chemical Purchase</h1>
        <p className="text-sm text-muted-foreground">Record chemical purchases and add them to vineyard inventory.</p>
      </div>
      <ChemicalSectionNav active="purchases" />

      <Card className="max-w-2xl space-y-4 p-4">
        <div className="space-y-1">
          <Label>Chemical</Label>
          <Select value={chemId} onValueChange={pick}>
            <SelectTrigger aria-label="Chemical"><SelectValue placeholder={chemQ.isLoading ? "Loading…" : "Choose a vineyard chemical"} /></SelectTrigger>
            <SelectContent>
              {chemicals.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.manufacturer ? ` — ${shortManufacturerName(c.manufacturer)}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Not listed? Use Add Chemical above first.</p>
        </div>

        {chem && (
          <div className="flex items-center gap-3 rounded border p-2" data-testid="purchase-selected">
            <ChemicalLabelThumb row={chem} rev={v3RevisionIdOf(chem) ? revDisplay?.get(v3RevisionIdOf(chem)!) : null} />
            <div className="min-w-0">
              <div className="truncate font-medium">{chem.name}</div>
              <div className="truncate text-xs text-muted-foreground">{shortManufacturerName(chem.manufacturer) || "—"}</div>
            </div>
          </div>
        )}

        {chem && (<>
          <PurchaseFields purchase={purchase} setPurchase={setPurchase} box={effectiveBox} setBox={setBox} units={units} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end">
            <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Record Purchase"}</Button>
          </div>
        </>)}
      </Card>
    </div>
  );
}
