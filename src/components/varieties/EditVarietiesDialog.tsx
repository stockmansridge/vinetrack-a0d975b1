// Edit-varieties dialog for an existing paddock. Owner/manager only.
// Persists serialised allocations to paddocks.variety_allocations.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import VarietyAllocationEditor, {
  deserialiseAllocations,
  isAllocationsValid,
  serialiseAllocations,
  type VarietyAllocationRow,
} from "./VarietyAllocationEditor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paddockId: string;
  paddockName?: string;
  vineyardId: string | null | undefined;
  initialAllocations: any;
}

export default function EditVarietiesDialog({
  open,
  onOpenChange,
  paddockId,
  paddockName,
  vineyardId,
  initialAllocations,
}: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<VarietyAllocationRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setRows(deserialiseAllocations(initialAllocations));
  }, [open, initialAllocations]);

  const canSave = rows.length === 0 || isAllocationsValid(rows);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = serialiseAllocations(rows);
      const { error } = await supabase
        .from("paddocks")
        .update({
          variety_allocations: payload as any,
          client_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", paddockId);
      if (error) throw error;
      toast({ title: "Varieties updated", description: paddockName ?? paddockId });
      qc.invalidateQueries({ queryKey: ["detail", "paddocks", paddockId] });
      qc.invalidateQueries({ queryKey: ["paddocks"] });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit grape varieties</DialogTitle>
          <DialogDescription>
            {paddockName ?? "Block"} — assign varieties totalling 100%.
          </DialogDescription>
        </DialogHeader>
        <VarietyAllocationEditor
          vineyardId={vineyardId}
          value={rows}
          onChange={setRows}
          disabled={saving}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
