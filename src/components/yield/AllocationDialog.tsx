import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, Pencil, Plus, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  ALLOCATION_TYPE_LABEL,
  type AllocationType,
  type GrapeAllocation,
  type SaveAllocationInput,
} from "@/lib/grapeAllocationsQuery";
import {
  fetchGrapePurchasers,
  saveGrapePurchaser,
  type GrapePurchaser,
  type SavePurchaserInput,
} from "@/lib/grapePurchasersQuery";
import PurchaserDialog from "@/components/yield/PurchaserDialog";

export interface AllocationBlockOption {
  id: string;
  name: string;
  /** Variety names planted in the block, used to filter compatible blocks. */
  varieties?: string[];
}

export interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vineyardId: string;
  vintage: number;
  /** Owner / Manager only — controls whether price fields exist at all. */
  canSeeFinancials: boolean;
  currencySymbol: string;
  /** Canonical varieties configured for the active vineyard. */
  varieties: string[];
  blocks: AllocationBlockOption[];
  existing?: (GrapeAllocation & { pricePerTonne?: number | null }) | null;
  saving?: boolean;
  onSave: (input: SaveAllocationInput) => void;
}

interface BlockRow {
  key: string;
  paddockId: string;
  tonnes: string;
}

const Help = ({ text }: { text: string }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label="More information"
        className="text-muted-foreground hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-72 text-sm">{text}</PopoverContent>
  </Popover>
);

const newKey = () => Math.random().toString(36).slice(2);
const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export default function AllocationDialog({
  open,
  onOpenChange,
  vineyardId,
  vintage,
  canSeeFinancials,
  currencySymbol,
  varieties,
  blocks,
  existing,
  saving,
  onSave,
}: AllocationDialogProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<AllocationType>("external");
  const [variety, setVariety] = useState("");
  const [tonnes, setTonnes] = useState("");
  const [destination, setDestination] = useState("");
  const [purchaserId, setPurchaserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contactAddress: "",
  });
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [blockRows, setBlockRows] = useState<BlockRow[]>([]);
  const [purchaserDialog, setPurchaserDialog] = useState<null | { editing: GrapePurchaser | null }>(
    null,
  );

  const purchasersQ = useQuery({
    queryKey: ["grape_purchasers", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchGrapePurchasers(vineyardId),
  });
  const purchasers = purchasersQ.data ?? [];
  const selectedPurchaser = purchasers.find((p) => p.id === purchaserId) ?? null;

  const savePurchaser = useMutation({
    mutationFn: (input: SavePurchaserInput) => saveGrapePurchaser(input),
    onSuccess: (p) => {
      toast({ title: "Purchaser saved" });
      qc.invalidateQueries({ queryKey: ["grape_purchasers", vineyardId] });
      setPurchaserDialog(null);
      setPurchaserId(p.id);
      // A newly created / edited purchaser refreshes the snapshot for THIS
      // allocation only — saved allocations are never rewritten.
      setSnapshot({
        name: p.winery_name ?? "",
        contactName: p.contact_name ?? "",
        contactEmail: p.contact_email ?? "",
        contactPhone: p.contact_phone ?? "",
        contactAddress: p.contact_address ?? "",
      });
    },
    onError: (e: any) =>
      toast({
        title: "Could not save purchaser",
        description: e?.message ?? String(e),
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (!open) return;
    setType(existing?.allocation_type ?? "external");
    setVariety(existing?.variety_name ?? "");
    setTonnes(existing?.quantity_tonnes != null ? String(existing.quantity_tonnes) : "");
    setDestination(existing?.destination_name ?? "");
    setPurchaserId(existing?.purchaser_id ?? null);
    setSnapshot({
      name: existing?.purchaser_name ?? "",
      contactName: existing?.contact_name ?? "",
      contactEmail: existing?.contact_email ?? "",
      contactPhone: existing?.contact_phone ?? "",
      contactAddress: existing?.contact_address ?? "",
    });
    setPrice(existing?.pricePerTonne != null ? String(existing.pricePerTonne) : "");
    setNotes(existing?.notes ?? "");
    setBlockRows(
      (existing?.blocks ?? []).map((b) => ({
        key: newKey(),
        paddockId: b.paddock_id,
        tonnes: b.quantity_tonnes != null ? String(b.quantity_tonnes) : "",
      })),
    );
  }, [open, existing]);

  const qty = Number(tonnes);
  const isOwn = type === "own_use";

  const varietyOptions = useMemo(() => {
    const set = new Set(varieties.filter((v) => v && v.trim().length));
    // A legacy allocation may hold a variety that is no longer configured.
    if (existing?.variety_name) set.add(existing.variety_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [varieties, existing]);

  /** Prefer blocks planted with the selected variety; fall back to all blocks. */
  const compatibleBlocks = useMemo(() => {
    if (!variety) return blocks;
    const match = blocks.filter((b) => (b.varieties ?? []).some((v) => lower(v) === lower(variety)));
    return match.length ? match : blocks;
  }, [blocks, variety]);

  const assigned = useMemo(
    () =>
      blockRows.reduce((a, r) => {
        const n = Number(r.tonnes);
        return a + (Number.isFinite(n) ? n : 0);
      }, 0),
    [blockRows],
  );

  const overAssigned = Number.isFinite(qty) && qty > 0 && assigned - qty > 0.005;
  const duplicateBlocks = useMemo(() => {
    const ids = blockRows.map((r) => r.paddockId).filter(Boolean);
    return new Set(ids).size !== ids.length;
  }, [blockRows]);

  const contractValue =
    !isOwn && canSeeFinancials && Number.isFinite(qty) && Number.isFinite(Number(price))
      ? qty * Number(price)
      : null;

  const valid =
    Number.isFinite(qty) &&
    qty > 0 &&
    variety.trim().length > 0 &&
    (isOwn ? destination.trim().length > 0 : snapshot.name.trim().length > 0) &&
    !overAssigned &&
    !duplicateBlocks;

  const submit = () => {
    const priceNum = Number(price);
    onSave({
      id: existing?.id ?? null,
      vineyardId,
      vintage,
      allocationType: type,
      varietyName: variety,
      varietyKey: variety.trim().toLowerCase(),
      quantityTonnes: qty,
      destinationName: isOwn ? destination : null,
      purchaserId: isOwn ? null : purchaserId,
      purchaserName: isOwn ? null : snapshot.name,
      contactName: isOwn ? null : snapshot.contactName,
      contactEmail: isOwn ? null : snapshot.contactEmail,
      contactPhone: isOwn ? null : snapshot.contactPhone,
      contactAddress: isOwn ? null : snapshot.contactAddress,
      // Price only exists for external allocations recorded by Owner/Manager.
      pricePerTonne:
        !isOwn && canSeeFinancials && price.trim() !== "" && Number.isFinite(priceNum)
          ? priceNum
          : null,
      notes,
      blocks: blockRows
        .filter((r) => r.paddockId && r.tonnes.trim() !== "")
        .map((r) => ({ paddockId: r.paddockId, tonnes: Number(r.tonnes) })),
    });
  };

  const sectionTitle = (s: string) => (
    <h3 className="text-sm font-semibold text-foreground">{s}</h3>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[90vw] max-w-[980px] sm:max-w-[980px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit allocation" : "Grape allocation"}</DialogTitle>
            <DialogDescription>
              One allocation is a single commitment for one vintage, one variety, one quantity
              and one agreed price. Add another allocation for a different variety or price.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Allocation ------------------------------------------------ */}
            <section className="space-y-3">
              {sectionTitle("Allocation")}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Allocation type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as AllocationType)}>
                    <SelectTrigger aria-label="Allocation type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="own_use">{ALLOCATION_TYPE_LABEL.own_use}</SelectItem>
                      <SelectItem value="external">{ALLOCATION_TYPE_LABEL.external}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Vintage</Label>
                  <Input value={vintage} readOnly disabled />
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Variety
                    <Help text="Each allocation covers one variety. Create another allocation if the purchaser has committed to a different variety." />
                  </Label>
                  <Select value={variety || undefined} onValueChange={setVariety}>
                    <SelectTrigger aria-label="Variety">
                      <SelectValue placeholder="Select variety" />
                    </SelectTrigger>
                    <SelectContent>
                      {varietyOptions.length === 0 && (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No varieties configured
                        </div>
                      )}
                      {varietyOptions.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="alloc-tonnes" className="flex items-center gap-1.5">
                    Quantity (tonnes)
                    <Help text="Total tonnes required or committed under this allocation." />
                  </Label>
                  <Input
                    id="alloc-tonnes"
                    type="number"
                    min="0"
                    step="0.01"
                    value={tonnes}
                    onChange={(e) => setTonnes(e.target.value)}
                  />
                </div>

                {isOwn && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="alloc-destination">Destination / use</Label>
                    <Input
                      id="alloc-destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Estate wine"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Purchaser ------------------------------------------------- */}
            {!isOwn && (
              <section className="space-y-3">
                {sectionTitle("Purchaser")}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5 min-w-[240px] flex-1">
                    <Label>Purchaser</Label>
                    <Select
                      value={purchaserId ?? undefined}
                      onValueChange={(id) => {
                        const p = purchasers.find((x) => x.id === id);
                        setPurchaserId(id);
                        if (p) {
                          setSnapshot({
                            name: p.winery_name ?? "",
                            contactName: p.contact_name ?? "",
                            contactEmail: p.contact_email ?? "",
                            contactPhone: p.contact_phone ?? "",
                            contactAddress: p.contact_address ?? "",
                          });
                        }
                      }}
                    >
                      <SelectTrigger aria-label="Purchaser">
                        <SelectValue placeholder={snapshot.name || "Select purchaser"} />
                      </SelectTrigger>
                      <SelectContent>
                        {purchasers.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No saved purchasers yet
                          </div>
                        )}
                        {purchasers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.winery_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPurchaserDialog({ editing: null })}
                  >
                    <Plus className="h-4 w-4 mr-1.5" /> New purchaser
                  </Button>
                  {selectedPurchaser && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPurchaserDialog({ editing: selectedPurchaser })}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit purchaser
                    </Button>
                  )}
                </div>

                {(snapshot.name ||
                  snapshot.contactName ||
                  snapshot.contactEmail ||
                  snapshot.contactPhone ||
                  snapshot.contactAddress) && (
                  <div className="rounded-md border p-3 text-sm text-muted-foreground space-y-0.5">
                    <div className="font-medium text-foreground">{snapshot.name || "—"}</div>
                    <div>{snapshot.contactName || "No contact name"}</div>
                    <div>
                      {[snapshot.contactEmail, snapshot.contactPhone].filter(Boolean).join(" · ") ||
                        "No email or phone"}
                    </div>
                    <div>{snapshot.contactAddress || "No address"}</div>
                    <p className="text-xs pt-1">
                      These details are stored with the allocation as a historical record.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Commercial ------------------------------------------------ */}
            {!isOwn && canSeeFinancials && (
              <section className="space-y-3">
                {sectionTitle("Commercial")}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="alloc-price" className="flex items-center gap-1.5">
                      Price per tonne ({currencySymbol})
                      <Help text="Agreed price for this individual commitment. Contract value is calculated from quantity × price per tonne." />
                    </Label>
                    <Input
                      id="alloc-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Visible to owners and managers only.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract value</Label>
                    <div className="h-10 flex items-center text-lg font-semibold">
                      {contractValue == null || !Number.isFinite(contractValue)
                        ? "—"
                        : `${currencySymbol}${contractValue.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}`}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Calculated from quantity × price per tonne.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* Fruit source ---------------------------------------------- */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {sectionTitle("Block allocations (optional)")}
                  <Help text="Optionally nominate which blocks will supply this commitment. Enter the tonnes expected from each block. Assigned tonnes cannot exceed the committed quantity." />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBlockRows((rows) => [...rows, { key: newKey(), paddockId: "", tonnes: "" }])
                  }
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Add block
                </Button>
              </div>

              {blockRows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No blocks nominated for this allocation.
                </p>
              )}

              <div className="space-y-2">
                {blockRows.map((row) => {
                  const taken = new Set(
                    blockRows.filter((r) => r.key !== row.key).map((r) => r.paddockId),
                  );
                  const options = compatibleBlocks.filter(
                    (b) => !taken.has(b.id) || b.id === row.paddockId,
                  );
                  return (
                    <div key={row.key} className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1.5 min-w-[220px] flex-1">
                        <Label className="text-xs text-muted-foreground">Block</Label>
                        <Select
                          value={row.paddockId || undefined}
                          onValueChange={(v) =>
                            setBlockRows((rows) =>
                              rows.map((r) => (r.key === row.key ? { ...r, paddockId: v } : r)),
                            )
                          }
                        >
                          <SelectTrigger aria-label="Block">
                            <SelectValue placeholder="Select block" />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                                {b.varieties?.length ? ` — ${b.varieties.join(", ")}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 w-32">
                        <Label className="text-xs text-muted-foreground">Tonnes</Label>
                        <Input
                          aria-label="Block tonnes"
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.tonnes}
                          onChange={(e) =>
                            setBlockRows((rows) =>
                              rows.map((r) =>
                                r.key === row.key ? { ...r, tonnes: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove block allocation"
                        onClick={() =>
                          setBlockRows((rows) => rows.filter((r) => r.key !== row.key))
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              {blockRows.length > 0 && (
                <p className={`text-xs ${overAssigned ? "text-destructive" : "text-muted-foreground"}`}>
                  Assigned: {assigned.toFixed(2)} t of{" "}
                  {Number.isFinite(qty) ? qty.toFixed(2) : "0.00"} t · Unassigned:{" "}
                  {Number.isFinite(qty) ? Math.max(qty - assigned, 0).toFixed(2) : "0.00"} t
                </p>
              )}
              {overAssigned && (
                <p className="text-sm text-destructive">
                  Assigned tonnes exceed the committed quantity. Reduce the block quantities before
                  saving.
                </p>
              )}
              {duplicateBlocks && (
                <p className="text-sm text-destructive">
                  Each block can only be listed once per allocation.
                </p>
              )}
            </section>

            {/* Notes ------------------------------------------------------ */}
            <section className="space-y-1.5">
              {sectionTitle("Notes")}
              <Textarea
                id="alloc-notes"
                aria-label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!valid || saving}>
              {saving ? "Saving…" : existing ? "Save changes" : "Add allocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PurchaserDialog
        open={!!purchaserDialog}
        onOpenChange={(v) => !v && setPurchaserDialog(null)}
        vineyardId={vineyardId}
        existing={purchaserDialog?.editing ?? null}
        saving={savePurchaser.isPending}
        onSave={(input) => savePurchaser.mutate(input)}
      />
    </>
  );
}
