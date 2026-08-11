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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { fetchYieldBlocks, recordActualYield } from "@/lib/yieldReportsQuery";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const HA_PER_AC = 0.40468564224;

export default function RecordActualYieldDialog({
  vineyardId,
  open,
  onOpenChange,
}: {
  vineyardId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const rf = useRegionFormatters();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [season, setSeason] = useState("");
  const [blockId, setBlockId] = useState<string>("");
  const [variety, setVariety] = useState("");
  const [tonnes, setTonnes] = useState("");
  const [notes, setNotes] = useState("");

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", vineyardId],
    enabled: !!vineyardId && open,
    queryFn: () => fetchYieldBlocks(vineyardId!),
  });
  const blocks = blocksQ.data ?? [];

  useEffect(() => {
    if (open && !blockId && blocks.length) setBlockId(blocks[0].id);
  }, [open, blocks, blockId]);

  const selected = useMemo(() => blocks.find((b) => b.id === blockId) ?? null, [blocks, blockId]);
  const parsed = Number(tonnes.trim());
  const valid = tonnes.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && !!selected && !!vineyardId;

  const perArea = useMemo(() => {
    if (!valid || !selected?.areaHa) return null;
    const perHa = parsed / selected.areaHa;
    const v = rf.areaUnitLabel === "ac" ? perHa * HA_PER_AC : perHa;
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} t/${rf.areaUnitLabel}`;
  }, [valid, parsed, selected, rf]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !vineyardId) return;
      await recordActualYield({
        vineyardId,
        year,
        season,
        blockId: selected.id,
        blockName: selected.name ?? "Unnamed block",
        variety,
        areaHectares: selected.areaHa,
        vineCount: selected.vineCount,
        actualYieldTonnes: parsed,
        notes,
      });
    },
    onSuccess: () => {
      toast({ title: "Actual yield recorded" });
      qc.invalidateQueries({ queryKey: ["yield_reports"] });
      onOpenChange(false);
      setTonnes("");
      setNotes("");
      setVariety("");
    },
    onError: (e: any) =>
      toast({ title: "Could not save", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record actual yield</DialogTitle>
          <DialogDescription>
            Harvested tonnes for a block and season. Used by Cost Reports to calculate cost per tonne.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ay-year">Year</Label>
              <Input
                id="ay-year"
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ay-season">Season (optional)</Label>
              <Input id="ay-season" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="2025/26" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Block</Label>
            <Select value={blockId} onValueChange={setBlockId}>
              <SelectTrigger>
                <SelectValue placeholder={blocks.length ? "Select a block" : "No blocks available"} />
              </SelectTrigger>
              <SelectContent>
                {blocks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name ?? "Unnamed block"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.areaHa ? (
              <p className="text-xs text-muted-foreground">Area: {rf.area(selected.areaHa, 2)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ay-variety">Variety (optional)</Label>
            <Input id="ay-variety" value={variety} onChange={(e) => setVariety(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ay-tonnes">Actual yield (tonnes)</Label>
            <Input
              id="ay-tonnes"
              inputMode="decimal"
              value={tonnes}
              onChange={(e) => setTonnes(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              {perArea ?? "Used by Cost Reports to calculate cost per tonne."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ay-notes">Notes (optional)</Label>
            <Textarea id="ay-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
