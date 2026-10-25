import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { archiveVineyard, describeVineyardError } from "@/lib/vineyardSettingsQuery";
import { archivableVineyards, bulkArchiveVineyards } from "@/lib/bulkArchiveVineyards";

/** Lets an owner tick several of their other vineyards and archive them at once. */
export function BulkArchiveVineyardsCard() {
  const { user } = useAuth();
  const { memberships, selectedVineyardId } = useVineyard();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const options = useMemo(
    () => archivableVineyards(memberships, selectedVineyardId),
    [memberships, selectedVineyardId],
  );
  if (options.length === 0) return null;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirming(false);
    setPicked(new Set());
  };

  const run = async () => {
    setBusy(true);
    const res = await bulkArchiveVineyards([...picked], archiveVineyard);
    await qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
    await qc.invalidateQueries({ queryKey: ["archived-vineyards"] });
    setBusy(false);
    if (res.failed.length) {
      toast({
        title: `${res.archived.length} archived, ${res.failed.length} couldn't be archived`,
        description: describeVineyardError(new Error(res.failed[0].message)),
        variant: "destructive",
      });
      setPicked(new Set(res.failed.map((f) => f.id)));
      setConfirming(false);
      return;
    }
    toast({
      title: `${res.archived.length} vineyard${res.archived.length === 1 ? "" : "s"} archived`,
      description: "Hidden from your list. Records are kept and can be restored.",
    });
    close();
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Archive className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <div className="text-sm font-medium">Clean up my vineyards</div>
            <p className="text-xs text-muted-foreground max-w-md">
              Archive several vineyards you own at once, such as old demo or test
              vineyards. They disappear from your list but can be restored later
              from the Select vineyard page.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Choose vineyards
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {confirming ? `Archive ${picked.size} vineyard${picked.size === 1 ? "" : "s"}?` : "Clean up my vineyards"}
            </DialogTitle>
            <DialogDescription>
              {confirming
                ? "They will be hidden for every member. Historical records are kept."
                : "Tick the vineyards to archive. The vineyard you are in now isn't listed."}
            </DialogDescription>
          </DialogHeader>
          {!confirming && (
            <div className="max-h-80 overflow-y-auto rounded-md border bg-card divide-y">
              {options.map((m) => (
                <label
                  key={m.vineyard_id}
                  className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={picked.has(m.vineyard_id)}
                    onCheckedChange={() => toggle(m.vineyard_id)}
                    aria-label={`Archive ${m.vineyard_name ?? m.vineyard_id}`}
                  />
                  <span className="flex-1">{m.vineyard_name ?? m.vineyard_id}</span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={confirming ? () => setConfirming(false) : close} disabled={busy}>
              {confirming ? "Back" : "Cancel"}
            </Button>
            {confirming ? (
              <Button variant="destructive" onClick={run} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Archive vineyards
              </Button>
            ) : (
              <Button onClick={() => setConfirming(true)} disabled={picked.size === 0}>
                Archive selected ({picked.size})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
