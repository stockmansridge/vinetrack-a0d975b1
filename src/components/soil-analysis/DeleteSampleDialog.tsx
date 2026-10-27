// Permanent delete confirmation for UNAPPROVED soil samples. Confirmed
// samples never reach this dialog (callers gate on isSoilSampleDeletable and
// the backend rejects confirmed deletes regardless). The dialog spells out
// that the sample, extracted results and the original uploaded source
// document are all removed and cannot be recovered.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/ios-supabase/client";
import { deleteSoilSample, type SoilSample } from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;

export function DeleteSampleDialog({
  sample,
  open,
  onOpenChange,
  onDeleted,
}: {
  sample: SoilSample | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docsQuery = useQuery({
    queryKey: ["soil-analysis", "sample-documents", sample?.id],
    enabled: open && !!sample?.id,
    queryFn: async (): Promise<Array<{ original_filename: string }>> => {
      const { data, error } = await db
        .from("soil_sample_documents")
        .select("original_filename")
        .eq("sample_id", sample!.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const confirm = async () => {
    if (!sample) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSoilSample(sample.id);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filenames = (docsQuery.data ?? []).map((d) => d.original_filename).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete sample permanently?</DialogTitle>
          <DialogDescription>
            This permanently removes the sample, its extracted results and the original uploaded
            source document. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {sample && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-0.5">
            <div>
              <span className="text-muted-foreground">Sample date: </span>
              {formatDate(sample.sampled_at)}
            </div>
            <div>
              <span className="text-muted-foreground">Lab paddock name: </span>
              {sample.lab_paddock_name ?? "—"}
            </div>
            {filenames.length > 0 && (
              <div>
                <span className="text-muted-foreground">Source document: </span>
                {filenames.join(", ")}
              </div>
            )}
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}
        <div className="flex justify-start gap-2 pt-1">
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
