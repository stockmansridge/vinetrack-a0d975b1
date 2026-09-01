import { useEffect, useState } from "react";
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
import type { GrapePurchaser, SavePurchaserInput } from "@/lib/grapePurchasersQuery";

export interface PurchaserDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vineyardId: string;
  existing?: GrapePurchaser | null;
  saving?: boolean;
  onSave: (input: SavePurchaserInput) => void;
}

export default function PurchaserDialog({
  open,
  onOpenChange,
  vineyardId,
  existing,
  saving,
  onSave,
}: PurchaserDialogProps) {
  const [wineryName, setWineryName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (!open) return;
    setWineryName(existing?.winery_name ?? "");
    setContactName(existing?.contact_name ?? "");
    setEmail(existing?.contact_email ?? "");
    setPhone(existing?.contact_phone ?? "");
    setAddress(existing?.contact_address ?? "");
  }, [open, existing]);

  const valid = wineryName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit purchaser" : "New purchaser"}</DialogTitle>
          <DialogDescription>
            Saved purchasers can be reused across allocations and vintages.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pur-name">Winery / purchaser name</Label>
            <Input
              id="pur-name"
              value={wineryName}
              onChange={(e) => setWineryName(e.target.value)}
              placeholder="ABC Wines"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pur-contact">Contact name</Label>
            <Input id="pur-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pur-email">Email</Label>
              <Input id="pur-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pur-phone">Phone</Label>
              <Input id="pur-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pur-address">Address</Label>
            <Input id="pur-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() =>
              onSave({
                id: existing?.id ?? null,
                vineyardId,
                wineryName,
                contactName,
                contactEmail: email,
                contactPhone: phone,
                contactAddress: address,
              })
            }
          >
            {saving ? "Saving…" : "Save purchaser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
