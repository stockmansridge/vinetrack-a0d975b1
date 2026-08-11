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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { fetchYieldBlocks, recordActualYield, type YieldBlockInfo } from "@/lib/yieldReportsQuery";
import { createPickingRecord } from "@/lib/pickingRecordsQuery";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { resolveSugarUnit, sugarUnitLabel } from "@/lib/vineyardRegionSettingsQuery";
import { useVintage } from "@/lib/useVintage";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import {
  buildVarietyMap,
  resolvePaddockAllocations,
  useGrapeVarieties,
} from "@/lib/varietyResolver";

const HA_PER_AC = 0.40468564224;
const VINTAGE_HISTORY_YEARS = 15;
const NO_CLONE = "__none__";

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
  key: string | null;
  name: string;
  percent: number | null;
  clones: string[];
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

/** Block → variety (+ clone) options from the synced vineyard block config. */
function useBlockVarieties(selected: YieldBlockInfo | null, vineyardId: string | null) {
  const { data: grapeVarieties } = useGrapeVarieties(vineyardId);
  const varietyMap = useMemo(() => buildVarietyMap(grapeVarieties ?? []), [grapeVarieties]);
  return useMemo<VarietyOption[]>(() => {
    if (!selected) return [];
    const resolved = resolvePaddockAllocations(selected.varietyAllocations, varietyMap);
    const out: VarietyOption[] = [];
    const byName = new Map<string, VarietyOption>();
    for (const a of resolved) {
      const name = (a.name ?? "").trim();
      if (!name) continue;
      const clone = (a.clone ?? "").trim();
      const existing = byName.get(name.toLowerCase());
      if (existing) {
        if (clone && !existing.clones.includes(clone)) existing.clones.push(clone);
        continue;
      }
      const opt: VarietyOption = {
        id: (a.raw?.varietyId ?? a.raw?.variety_id ?? null) as string | null,
        key: (a.raw?.varietyKey ?? a.raw?.variety_key ?? null) as string | null,
        name,
        percent: a.percent,
        clones: clone ? [clone] : [],
      };
      byName.set(name.toLowerCase(), opt);
      out.push(opt);
    }
    return out;
  }, [selected, varietyMap]);
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
  const [mode, setMode] = useState<"basic" | "detailed">("basic");

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", vineyardId],
    enabled: !!vineyardId && open,
    queryFn: () => fetchYieldBlocks(vineyardId!),
  });
  const blocks = blocksQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record actual yield</DialogTitle>
          <DialogDescription>
            Basic records one harvested total per block and variety. Detailed adds an individual
            pick to the Picking Log — a block can have many picks in a vintage.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="border border-border bg-muted/70 shadow-sm">
            <TabsTrigger
              value="basic"
              className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
            >
              Basic
            </TabsTrigger>
            <TabsTrigger
              value="detailed"
              className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
            >
              Detailed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-4">
            <BasicForm
              vineyardId={vineyardId}
              blocks={blocks}
              open={open}
              onOpenChange={onOpenChange}
            />
          </TabsContent>
          <TabsContent value="detailed" className="mt-4">
            <DetailedForm vineyardId={vineyardId} blocks={blocks} onOpenChange={onOpenChange} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Basic — unchanged historical_yield_records behaviour.
// ---------------------------------------------------------------------------

function BasicForm({
  vineyardId,
  blocks,
  open,
  onOpenChange,
}: {
  vineyardId: string | null;
  blocks: YieldBlockInfo[];
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
  const varieties = useBlockVarieties(selected, vineyardId);

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
    <>
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

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detailed — one picking_records row per pick (sql/180).
// ---------------------------------------------------------------------------

function DetailedForm({
  vineyardId,
  blocks,
  onOpenChange,
}: {
  vineyardId: string | null;
  blocks: YieldBlockInfo[];
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const rf = useRegionFormatters();
  const { seasonStartMonth, seasonStartDay } = useVintage();
  const sugarUnit = resolveSugarUnit(rf.settings);

  const today = new Date().toISOString().slice(0, 10);
  const [pickedAt, setPickedAt] = useState(today);
  const [blockId, setBlockId] = useState("");
  const [varietyName, setVarietyName] = useState("");
  const [clone, setClone] = useState(NO_CLONE);
  const [weightKg, setWeightKg] = useState("");
  const [sugar, setSugar] = useState("");
  const [ph, setPh] = useState("");
  const [ta, setTa] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sold, setSold] = useState(false);
  const [soldTo, setSoldTo] = useState("");
  const [pricePerTonne, setPricePerTonne] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!blockId && blocks.length) setBlockId(blocks[0].id);
  }, [blocks, blockId]);

  const selected = useMemo(() => blocks.find((b) => b.id === blockId) ?? null, [blocks, blockId]);
  const varieties = useBlockVarieties(selected, vineyardId);

  // Auto-select the sole variety; reset when the block changes.
  useEffect(() => {
    setVarietyName(varieties.length === 1 ? varieties[0].name : "");
    setClone(NO_CLONE);
  }, [blockId, varieties.length]);

  const variety = useMemo(
    () => varieties.find((v) => v.name === varietyName) ?? null,
    [varieties, varietyName],
  );
  useEffect(() => {
    if (variety && variety.clones.length === 1) setClone(variety.clones[0]);
  }, [variety]);

  /** Display-only mirror of the server trigger (season-end year). */
  const derivedVintage = useMemo(() => {
    const d = new Date(`${pickedAt}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return vintageForDate(d, seasonStartMonth, seasonStartDay);
  }, [pickedAt, seasonStartMonth, seasonStartDay]);

  const weight = Number(weightKg);
  const weightValid = weightKg.trim() !== "" && Number.isFinite(weight) && weight > 0;
  const valid = !!vineyardId && !!pickedAt && !!selected && weightValid;

  const price = Number(pricePerTonne);
  const previewValue =
    sold && Number.isFinite(price) && price > 0 && weightValid ? (weight / 1000) * price : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!vineyardId || !selected) return;
      const num = (s: string) => {
        const n = Number(s);
        return s.trim() !== "" && Number.isFinite(n) ? n : null;
      };
      await createPickingRecord({
        vineyardId,
        pickedAt,
        paddockId: selected.id,
        paddockName: selected.name ?? "Unnamed block",
        varietyId: variety?.id ?? null,
        varietyKey: variety?.key ?? null,
        varietyName: variety?.name ?? null,
        clone: clone === NO_CLONE ? null : clone,
        weightKg: weight,
        sugarValue: num(sugar),
        sugarUnit,
        ph: num(ph),
        taGL: num(ta),
        purpose,
        sold,
        soldTo: sold ? soldTo : null,
        pricePerTonne: sold ? num(pricePerTonne) : null,
        notes,
      });
    },
    onSuccess: () => {
      toast({ title: "Pick recorded" });
      qc.invalidateQueries({ queryKey: ["picking_records"] });
      qc.invalidateQueries({ queryKey: ["picking_yield_totals"] });
      qc.invalidateQueries({ queryKey: ["yield_reports"] });
      // Keep the sheet open for fast harvest entry (parity with iOS).
      setWeightKg("");
      setSugar("");
      setPh("");
      setTa("");
      setNotes("");
    },
    onError: (e: any) =>
      toast({ title: "Could not save", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pk-date">Date</Label>
            <Input
              id="pk-date"
              type="date"
              value={pickedAt}
              onChange={(e) => setPickedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vintage</Label>
            <div
              className="h-10 rounded-md border bg-muted/40 px-3 flex items-center text-sm"
              aria-label="Vintage"
            >
              {derivedVintage ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground">Set by the date — confirmed on save.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Block</Label>
          <Select value={blockId} onValueChange={setBlockId}>
            <SelectTrigger aria-label="Pick block">
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Variety</Label>
            {varieties.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This block has no configured varieties.
              </p>
            ) : (
              <Select value={varietyName} onValueChange={setVarietyName}>
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
            <Label>Clone</Label>
            {variety && variety.clones.length ? (
              <Select value={clone} onValueChange={setClone}>
                <SelectTrigger aria-label="Clone">
                  <SelectValue placeholder="Select a clone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLONE}>Not specified</SelectItem>
                  {variety.clones.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                No clone recorded for this variety in the block configuration.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pk-weight">Weight (kg)</Label>
            <Input
              id="pk-weight"
              inputMode="decimal"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pk-sugar">{sugarUnitLabel(sugarUnit)}</Label>
            <Input
              id="pk-sugar"
              inputMode="decimal"
              value={sugar}
              onChange={(e) => setSugar(e.target.value)}
              placeholder="0.0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pk-ph">pH</Label>
            <Input id="pk-ph" inputMode="decimal" value={ph} onChange={(e) => setPh(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pk-ta">TA (g/L)</Label>
            <Input id="pk-ta" inputMode="decimal" value={ta} onChange={(e) => setTa(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pk-purpose">Purpose</Label>
          <Input
            id="pk-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Estate wine"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <Label htmlFor="pk-sold">Sold</Label>
          <Switch id="pk-sold" checked={sold} onCheckedChange={setSold} aria-label="Sold" />
        </div>

        {sold && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pk-soldto">Sold to</Label>
              <Input id="pk-soldto" value={soldTo} onChange={(e) => setSoldTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pk-price">Price per tonne</Label>
              <Input
                id="pk-price"
                inputMode="decimal"
                value={pricePerTonne}
                onChange={(e) => setPricePerTonne(e.target.value)}
              />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Grape value{previewValue != null ? `: ${rf.currency(previewValue)}` : ""} is calculated
              and stored by the backend.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pk-notes">Notes (optional)</Label>
          <Textarea id="pk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save pick"}
        </Button>
      </DialogFooter>
    </>
  );
}
