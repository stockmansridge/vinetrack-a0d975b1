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
 *
 * Backend-only — the portal shows the grower "Vintage 2026".
 */
export function seasonLabelForVintage(vintage: number, seasonStartMonth: number): string {
  if (seasonStartMonth <= 1) return String(vintage);
  return `${vintage - 1}/${String(vintage).slice(-2)}`;
}

interface VarietyOption {
  id: string | null;
  name: string;
  percent: number | null;
}

/** Split the block area across varieties by allocation percent (equal when unset). */
export function apportionArea(
  areaHa: number | null | undefined,
  percents: (number | null)[],
): (number | null)[] {
  if (areaHa == null || !(areaHa > 0) || !percents.length) return percents.map(() => null);
  const p = percents.map((v) => (typeof v === "number" && v > 0 ? v : 0));
  const sum = p.reduce((a, b) => a + b, 0);
  if (sum <= 0) return p.map(() => areaHa / p.length);
  return p.map((v) => (areaHa * v) / sum);
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
  const [tonnesByVariety, setTonnesByVariety] = useState<Record<string, string>>({});
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

  const varieties = useMemo<VarietyOption[]>(() => {
    if (!selected) return [];
    const resolved = resolvePaddockAllocations(selected.varietyAllocations, varietyMap);
    const seen = new Set<string>();
    const out: VarietyOption[] = [];
    for (const a of resolved) {
      const name = (a.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const rawId = (a.raw?.varietyId ?? a.raw?.variety_id ?? null) as string | null;
      out.push({ id: rawId, name, percent: a.percent });
    }
    return out;
  }, [selected, varietyMap]);

  // Clear the entered tonnes whenever the block changes.
  useEffect(() => {
    setTonnesByVariety({});
  }, [blockId]);

  const areaShares = useMemo(
    () => apportionArea(selected?.areaHa ?? null, varieties.map((v) => v.percent)),
    [selected, varieties],
  );

  const entries = useMemo(() => {
    return varieties
      .map((v, i) => {
        const raw = (tonnesByVariety[v.name] ?? "").trim();
        if (raw === "") return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return null;
        return {
          variety: v.name,
          varietyId: v.id,
          actualYieldTonnes: n,
          areaHectares: areaShares[i] ?? null,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e != null);
  }, [varieties, tonnesByVariety, areaShares]);

  const hasInvalid = useMemo(
    () =>
      varieties.some((v) => {
        const raw = (tonnesByVariety[v.name] ?? "").trim();
        if (raw === "") return false;
        const n = Number(raw);
        return !Number.isFinite(n) || n < 0;
      }),
    [varieties, tonnesByVariety],
  );

  const valid = !!selected && !!vineyardId && varieties.length > 0 && entries.length > 0 && !hasInvalid;

  const totalTonnes = entries.reduce((a, e) => a + e.actualYieldTonnes, 0);
  const perArea = useMemo(() => {
    if (!valid || !selected?.areaHa) return null;
    const perHa = totalTonnes / selected.areaHa;
    const v = rf.areaUnitLabel === "ac" ? perHa * HA_PER_AC : perHa;
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} t/${rf.areaUnitLabel}`;
  }, [valid, totalTonnes, selected, rf]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !vineyardId) return;
      await recordActualYield({
        vineyardId,
        year: vintage,
        season,
        blockId: selected.id,
        blockName: selected.name ?? "Unnamed block",
        areaHectares: selected.areaHa,
        vineCount: selected.vineCount,
        notes,
        varieties: entries,
      });
    },
    onSuccess: () => {
      toast({ title: "Actual yield recorded" });
      qc.invalidateQueries({ queryKey: ["yield_reports"] });
      onOpenChange(false);
      setTonnesByVariety({});
      setNotes("");
    },
    onError: (e: any) =>
      toast({ title: "Could not save", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record actual yield</DialogTitle>
          <DialogDescription>
            Harvested tonnes for each variety in a block. Used by Cost Reports to calculate cost per
            tonne.
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
              The harvest vintage these tonnes belong to.
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

          {varieties.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This block has no configured varieties. Add variety allocations in Setup → Blocks to
              record yield by variety.
            </p>
          ) : (
            <div className="space-y-3">
              {varieties.map((v) => (
                <div key={v.name} className="rounded-md border p-3 space-y-1.5">
                  <div className="text-sm font-medium">{v.name}</div>
                  <Label htmlFor={`ay-${v.name}`} className="text-xs text-muted-foreground">
                    Actual yield (tonnes)
                  </Label>
                  <Input
                    id={`ay-${v.name}`}
                    aria-label={`Actual yield (tonnes) — ${v.name}`}
                    inputMode="decimal"
                    value={tonnesByVariety[v.name] ?? ""}
                    onChange={(e) =>
                      setTonnesByVariety((prev) => ({ ...prev, [v.name]: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {perArea
                  ? `Total ${totalTonnes.toLocaleString(undefined, { maximumFractionDigits: 2 })} t · ${perArea}`
                  : "Leave a variety blank if it was not harvested."}
              </p>
            </div>
          )}

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
