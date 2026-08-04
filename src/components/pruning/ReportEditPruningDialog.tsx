// Lazy loader around EditPruningDialog for use in reports.
//
// The Pruning Tracker already has row identities and segments in memory; the
// Pruning Activity Report does not. This wrapper fetches exactly what the
// editor needs (paddock geometry, the season's manual row count and all
// completed segments for that season) once the dialog is opened.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { buildRowIdentities } from "@/lib/pruningCalc";
import { parseRows } from "@/lib/paddockGeometry";
import type { PruningEntry, PruningRowSegment } from "@/lib/pruningQuery";
import EditPruningDialog from "@/components/pruning/EditPruningDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entry: PruningEntry;
  vineyardId: string;
  paddockName: string;
  onPrev?: () => void;
  onNext?: () => void;
  navLabel?: string;
}

export default function ReportEditPruningDialog({
  open, onOpenChange, entry, vineyardId, paddockName, onPrev, onNext, navLabel,
}: Props) {
  const ctx = useQuery({
    queryKey: ["pruning", "edit-context", entry.id, entry.paddock_id, entry.pruning_season_id],
    enabled: open,
    queryFn: async () => {
      const [paddockRes, seasonRes, segRes] = await Promise.all([
        supabase.from("paddocks").select("*").eq("id", entry.paddock_id).maybeSingle(),
        supabase.from("pruning_seasons").select("manual_row_count")
          .eq("id", entry.pruning_season_id).maybeSingle(),
        supabase.from("pruning_row_segments").select("*")
          .eq("pruning_season_id", entry.pruning_season_id),
      ]);
      if (paddockRes.error) throw paddockRes.error;
      if (seasonRes.error) throw seasonRes.error;
      if (segRes.error) throw segRes.error;

      const paddock = paddockRes.data as any;
      const identities = buildRowIdentities(
        parseRows(paddock?.rows),
        paddock,
        (seasonRes.data as any)?.manual_row_count ?? null,
      );
      return {
        identities,
        segments: (segRes.data ?? []) as unknown as PruningRowSegment[],
      };
    },
  });

  if (!open) return null;

  if (ctx.isLoading || ctx.error || !ctx.data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit pruning entry</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">
            {ctx.error
              ? `Couldn't load this entry: ${(ctx.error as any)?.message ?? String(ctx.error)}`
              : "Loading entry…"}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <EditPruningDialog
      open={open}
      onOpenChange={onOpenChange}
      entry={entry}
      identities={ctx.data.identities}
      allSegments={ctx.data.segments}
      vineyardId={vineyardId}
      paddockName={paddockName}
    />
  );
}
