// Coordinated deletion of a manual spray application.
//
// Deletion goes through the shared `delete_manual_spray_v1` adapter with every
// identity, never a direct table write. The operation id is allocated ONCE per
// deletion, so a retry after an uncertain response is the same request rather
// than a second deletion. A repeat of an already-deleted application resolves
// as deleted, which is the intended end state.
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  deleteManualSpray, newOperationId, type ManualSprayDeleteRequest,
} from "@/lib/manualSpray/contract";

export interface ManualSprayDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name typed to confirm; falls back to the record id when unnamed. */
  applicationName: string;
  identities: Omit<ManualSprayDeleteRequest, "operationId">;
  /** Called after the server confirmed the deletion (or it was already gone). */
  onDeleted: () => void;
}

export function ManualSprayDeleteDialog({
  open, onOpenChange, applicationName, identities, onDeleted,
}: ManualSprayDeleteDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  /** Frozen for the whole deletion, including retries. */
  const operationId = useRef<string>(newOperationId());

  const confirmed = typed.trim() === applicationName.trim() && !!applicationName.trim();

  async function run() {
    setBusy(true);
    setError(null);
    const out = await deleteManualSpray({ operationId: operationId.current, ...identities });
    setBusy(false);
    if (out.kind === "saved" || out.kind === "deleted") {
      onDeleted();
      onOpenChange(false);
      return;
    }
    setUncertain(out.kind === "uncertain");
    setError(out.message);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this manual spray?</DialogTitle>
          <DialogDescription>
            This removes the manual application, its spray record and its linked trip together.
            Type the application name to confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Application name</Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={applicationName}
            aria-label="Type the application name to confirm deletion"
          />
        </div>

        {error && (
          <PortalNotice
            variant="warning"
            compact
            description={uncertain ? `${error} Retry sends the same request.` : error}
          />
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!confirmed || busy} onClick={run} className="gap-1.5">
            <Trash2 className="h-4 w-4" />
            {busy ? "Deleting…" : error ? "Retry delete" : "Delete manual spray"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
