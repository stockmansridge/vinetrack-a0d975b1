import { useEffect, useMemo, useState } from "react";
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
import {
  ALLOCATION_TYPE_LABEL,
  type AllocationType,
  type GrapeAllocation,
  type SaveAllocationInput,
} from "@/lib/grapeAllocationsQuery";

export interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vineyardId: string;
  vintage: number;
  /** Owner / Manager only — controls whether price fields exist at all. */
  canSeeFinancials: boolean;
  currencySymbol: string;
  varieties: string[];
  blocks: { id: string; name: string }[];
  existing?: (GrapeAllocation & { pricePerTonne?: number | null }) | null;
  saving?: boolean;
  onSave: (input: SaveAllocationInput) => void;
}

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
  const [type, setType] = useState<AllocationType>("external");
  const [variety, setVariety] = useState("");
  const [tonnes, setTonnes] = useState("");
  const [destination, setDestination] = useState("");
  const [purchaser, setPurchaser] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [blockTonnes, setBlockTonnes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setType(existing?.allocation_type ?? "external");
    setVariety(existing?.variety_name ?? "");
    setTonnes(existing?.quantity_tonnes != null ? String(existing.quantity_tonnes) : "");
    setDestination(existing?.destination_name ?? "");
    setPurchaser(existing?.purchaser_name ?? "");
    setContactName(existing?.contact_name ?? "");
    setContactEmail(existing?.contact_email ?? "");
    setContactPhone(existing?.contact_phone ?? "");
    setContactAddress(existing?.contact_address ?? "");
    setPrice(existing?.pricePerTonne != null ? String(existing.pricePerTonne) : "");
    setNotes(existing?.notes ?? "");
    const bt: Record<string, string> = {};
    for (const b of existing?.blocks ?? []) {
      bt[b.paddock_id] = b.quantity_tonnes != null ? String(b.quantity_tonnes) : "";
    }
    setBlockTonnes(bt);
  }, [open, existing]);

  const qty = Number(tonnes);
  const isOwn = type === "own_use";
  const valid =
    Number.isFinite(qty) &&
    qty > 0 &&
    variety.trim().length > 0 &&
    (isOwn ? destination.trim().length > 0 : purchaser.trim().length > 0);

  const blockSum = useMemo(
    () =>
      Object.values(blockTonnes).reduce((a, v) => {
        const n = Number(v);
        return a + (Number.isFinite(n) ? n : 0);
      }, 0),
    [blockTonnes],
  );

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
      purchaserName: isOwn ? null : purchaser,
      contactName: isOwn ? null : contactName,
      contactEmail: isOwn ? null : contactEmail,
      contactPhone: isOwn ? null : contactPhone,
      contactAddress: isOwn ? null : contactAddress,
      // Price only exists for external allocations recorded by Owner/Manager.
      pricePerTonne:
        !isOwn && canSeeFinancials && price.trim() !== "" && Number.isFinite(priceNum)
          ? priceNum
          : null,
      notes,
      blocks: Object.entries(blockTonnes)
        .filter(([, v]) => v.trim() !== "")
        .map(([paddockId, v]) => ({ paddockId, tonnes: Number(v) })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit allocation" : "Add allocation"}</DialogTitle>
          <DialogDescription>
            Record where the {vintage} vintage crop is going — own use or an external
            commitment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
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
            <Label htmlFor="alloc-variety">Variety</Label>
            <Input
              id="alloc-variety"
              list="alloc-variety-options"
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              placeholder="Pinot Noir"
            />
            <datalist id="alloc-variety-options">
              {varieties.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-tonnes">Quantity (tonnes)</Label>
            <Input
              id="alloc-tonnes"
              type="number"
              min="0"
              step="0.01"
              value={tonnes}
              onChange={(e) => setTonnes(e.target.value)}
            />
          </div>

          {isOwn ? (
            <div className="space-y-1.5">
              <Label htmlFor="alloc-destination">Destination</Label>
              <Input
                id="alloc-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Estate wine"
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="alloc-purchaser">Purchaser</Label>
                <Input
                  id="alloc-purchaser"
                  value={purchaser}
                  onChange={(e) => setPurchaser(e.target.value)}
                  placeholder="Winery name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alloc-contact-name">Contact name</Label>
                <Input
                  id="alloc-contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alloc-contact-email">Contact email</Label>
                <Input
                  id="alloc-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alloc-contact-phone">Contact phone</Label>
                <Input
                  id="alloc-contact-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="alloc-contact-address">Contact address</Label>
                <Input
                  id="alloc-contact-address"
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                />
              </div>
              {canSeeFinancials && (
                <div className="space-y-1.5">
                  <Label htmlFor="alloc-price">Price per tonne ({currencySymbol})</Label>
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
              )}
            </>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Blocks (optional)</Label>
            <div className="rounded-md border divide-y max-h-52 overflow-y-auto">
              {blocks.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No blocks configured.</p>
              )}
              {blocks.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-2">
                  <span className="flex-1 text-sm">{b.name}</span>
                  <Input
                    aria-label={`${b.name} tonnes`}
                    className="w-28"
                    type="number"
                    min="0"
                    step="0.01"
                    value={blockTonnes[b.id] ?? ""}
                    onChange={(e) =>
                      setBlockTonnes((s) => ({ ...s, [b.id]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            {blockSum > 0 && (
              <p className="text-xs text-muted-foreground">
                Block split total: {blockSum.toFixed(2)} t
                {Number.isFinite(qty) && qty > 0 && Math.abs(blockSum - qty) > 0.005
                  ? ` — does not match the allocation quantity (${qty.toFixed(2)} t)`
                  : ""}
              </p>
            )}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alloc-notes">Notes</Label>
            <Textarea
              id="alloc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
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
  );
}
