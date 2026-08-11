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
import { useVintage } from "@/lib/useVintage";
import {
  buildVarietyMap,
  resolvePaddockAllocations,
  useGrapeVarieties,
} from "@/lib/varietyResolver";

const HA_PER_AC = 0.40468564224;
const VINTAGE_HISTORY_YEARS = 15;

/**
 * Season label derived from the vintage under the shared VineTrack season
 * contract: a season starting in January is a single calendar year, otherwise
 * it straddles two years and ends in the vintage year (e.g. 2026 → "2025/26").
 */
export function seasonLabelForVintage(vintage: number, seasonStartMonth: number): string {
  if (seasonStartMonth <= 1) return String(vintage);
  return `${vintage - 1}/${String(vintage).slice(-2)}`;
}

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
  const { vintage: currentVintage, seasonStartMonth } = useVintage();
  const [year, setYear] = useState<number | null>(null);
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
  const { data: grapeVarieties } = useGrapeVarieties(vineyardId);
  const varietyMap = useMemo(() => buildVarietyMap(grapeVarieties ?? []), [grapeVarieties]);

  const vintage = year ?? currentVintage;
  const season = useMemo(
    () => seasonLabelForVintage(vintage, seasonStartMonth),
    [vintage, seasonStartMonth],
  );
  const vintageOptions = useMemo(() => {
    const base = currentVintage + 1;
    return Array.from({ length: VINTAGE_HISTORY_YEARS + 2 }, (_, i) => base - i);
  }, [currentVintage]);

  useEffect(() => {
    if (open && !blockId && blocks.length) setBlockId(blocks[0].id);
  }, [open, blocks, blockId]);

  const selected = useMemo(() => blocks.find((b) => b.id === blockId) ?? null, [blocks, blockId]);

  const varieties = useMemo(() => {
    if (!selected) return [] as { id: string | null; name: string }[];
    const resolved = resolvePaddockAllocations(selected.varietyAllocations, varietyMap);
    const seen = new Set<string>();
    const out: { id: string | null; name: string }[] = [];
    for (const a of resolved) {
      const name = (a.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const rawId = (a.raw?.varietyId ?? a.raw?.variety_id ?? null) as string | null;
      out.push({ id: rawId, name });
    }
    return out;
  }, [selected, varietyMap]);

  // Reset / auto-select the variety whenever the block (or its varieties) change.
  useEffect(() => {
    if (varieties.length === 1) setVariety(varieties[0].name);
    else setVariety((v) => (varieties.some((x) => x.name === v) ? v : ""));
  }, [varieties]);

  const varietyId = useMemo(
    () => varieties.find((v) => v.name === variety)?.id ?? null,
    [varieties, variety],
  );

  const parsed = Number(tonnes.trim());
  const valid =
    tonnes.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    !!selected &&
    !!vineyardId &&
    (varieties.length === 0 || !!variety);

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
        year: vintage,
        season,
        blockId: selected.id,
        blockName: selected.name ?? "Unnamed block",
        variety,
        varietyId,
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
            Harvested tonnes for a block and variety. Used by Cost Reports to calculate cost per tonne.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Vintage</Label>
            <Select value={String(vintage)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger aria-label="Vintage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vintageOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Harvest year. Season {season} is derived from your vineyard's season start.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Block</Label>
            <Select value={blockId} onValueChange={setBlockId}>
              <SelectTrigger aria-label="Block">
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
            <Label>Variety</Label>
            {varieties.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This block has no configured varieties. Add variety allocations in Setup → Blocks to
                record yield by variety.
              </p>
            ) : varieties.length === 1 ? (
              <p className="text-sm">{varieties[0].name}</p>
            ) : (
              <Select value={variety} onValueChange={setVariety}>
                <SelectTrigger aria-label="Variety">
                  <SelectValue placeholder="Select a variety" />
                </SelectTrigger>
                <SelectContent>
                  {varieties.map((v) => (
                    <SelectItem key={v.name} value={v.name}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
