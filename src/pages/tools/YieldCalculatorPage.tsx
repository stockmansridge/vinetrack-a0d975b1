import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { fetchYieldBlocks } from "@/lib/yieldReportsQuery";
import {
  calculatePruningYield,
  PRUNING_YIELD_FORMULA_TEXT,
  type PruneMethod,
} from "@/lib/pruningYieldFormula";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const HA_PER_AC = 0.40468564224;
const STORAGE_KEY = "vinetrack.pruningYieldCalculator.v1";

interface SavedSettings {
  method: PruneMethod;
  bunchesPerBud: string;
  budsPerSpur: string;
  spursPerVine: string;
  budsPerCane: string;
  canesPerVine: string;
  vinesPerHa: string;
  bunchWeight: string;
}

const DEFAULTS: SavedSettings = {
  method: "spur",
  bunchesPerBud: "1.5",
  budsPerSpur: "2",
  spursPerVine: "6",
  budsPerCane: "10",
  canesPerVine: "4",
  vinesPerHa: "",
  bunchWeight: "120",
};

function loadSaved(): SavedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SavedSettings>) };
  } catch {
    return DEFAULTS;
  }
}

const parse = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

const fmt = (v: number, dp = 2) =>
  v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });

export default function YieldCalculatorPage() {
  const { selectedVineyardId } = useVineyard();
  const rf = useRegionFormatters();
  const [s, setS] = useState<SavedSettings>(loadSaved);
  const [blockId, setBlockId] = useState<string>("");

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldBlocks(selectedVineyardId!),
  });
  const blocks = blocksQ.data ?? [];
  const block = useMemo(() => blocks.find((b) => b.id === blockId) ?? null, [blocks, blockId]);

  // Seed vines/ha from the selected block when the user has not typed one.
  useEffect(() => {
    if (!block || s.vinesPerHa.trim() !== "") return;
    if (block.vineCount && block.areaHa && block.areaHa > 0) {
      setS((prev) => ({ ...prev, vinesPerHa: String(Math.round(block.vineCount! / block.areaHa!)) }));
    }
  }, [block, s.vinesPerHa]);

  const set = (k: keyof SavedSettings, v: string) => setS((prev) => ({ ...prev, [k]: v }));

  const result = useMemo(
    () =>
      calculatePruningYield({
        method: s.method,
        bunchesPerBud: parse(s.bunchesPerBud),
        budsPerSpur: parse(s.budsPerSpur),
        spursPerVine: parse(s.spursPerVine),
        budsPerCane: parse(s.budsPerCane),
        canesPerVine: parse(s.canesPerVine),
        vinesPerHa: parse(s.vinesPerHa),
        bunchWeightGrams: parse(s.bunchWeight),
        areaHectares: block?.areaHa ?? null,
      }),
    [s, block],
  );

  const perArea = (tPerHa: number) =>
    `${fmt(rf.areaUnitLabel === "ac" ? tPerHa * HA_PER_AC : tPerHa)} t/${rf.areaUnitLabel}`;

  const saveDefaults = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

  return (
    <div className="space-y-4">
      <PageHead
        title="Pruning Yield Calculator"
        description="Estimate yield per hectare from bud counts, pruning method and bunch weight."
        path="/tools/yield-estimation"
      />

      <div>
        <h1 className="text-2xl font-semibold">Pruning Yield Calculator</h1>
        <p className="text-sm text-muted-foreground">
          Estimate potential yield at pruning from bud numbers, vine density and expected bunch weight —
          the same calculation used in the VineTrack mobile app.
        </p>
      </div>

      <PortalNotice
        variant="info"
        compact
        title="Planning estimate only"
        description="This calculator does not save records. Use Yields to record sampling sessions and actual harvested tonnes."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>{PRUNING_YIELD_FORMULA_TEXT[s.method]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Block (optional)</Label>
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
              {block && (
                <p className="text-xs text-muted-foreground">
                  Area: {block.areaHa ? rf.area(block.areaHa, 2) : "—"} · Vines:{" "}
                  {block.vineCount != null ? fmt(block.vineCount, 0) : "—"}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Pruning method</Label>
              <Tabs value={s.method} onValueChange={(v) => set("method", v as PruneMethod)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="spur">Spur</TabsTrigger>
                  <TabsTrigger value="cane">Cane</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground">
                {s.method === "spur"
                  ? "Spur pruning: short canes (spurs) left with a set number of buds each."
                  : "Cane pruning: longer canes retained on each vine with multiple buds per cane."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Bunches / bud" value={s.bunchesPerBud} onChange={(v) => set("bunchesPerBud", v)} />
              {s.method === "spur" ? (
                <>
                  <Field label="Buds / spur" value={s.budsPerSpur} onChange={(v) => set("budsPerSpur", v)} />
                  <Field label="Spurs / vine" value={s.spursPerVine} onChange={(v) => set("spursPerVine", v)} />
                </>
              ) : (
                <>
                  <Field label="Buds / cane" value={s.budsPerCane} onChange={(v) => set("budsPerCane", v)} />
                  <Field label="Canes / vine" value={s.canesPerVine} onChange={(v) => set("canesPerVine", v)} />
                </>
              )}
              <Field label="Vines / ha" value={s.vinesPerHa} onChange={(v) => set("vinesPerHa", v)} />
              <Field label="Bunch weight (g)" value={s.bunchWeight} onChange={(v) => set("bunchWeight", v)} />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={saveDefaults}>
                Save as my defaults
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setS(DEFAULTS)}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimate</CardTitle>
            <CardDescription>Recalculates as you type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Buds / vine" value={fmt(result.budsPerVine)} />
            <Row label="Bunches / ha" value={fmt(result.bunchesPerHa, 0)} />
            <Row label="Yield (kg/ha)" value={fmt(result.yieldKgPerHa)} />
            <Row label={`Yield per ${rf.areaUnitLabel}`} value={perArea(result.yieldTonnesPerHa)} strong />
            <Row
              label="Block total (t)"
              value={result.totalTonnes != null ? fmt(result.totalTonnes) : "—"}
              strong
            />
            {result.totalTonnes == null && (
              <p className="text-xs text-muted-foreground">
                Select a block with a mapped boundary to see the block total.
              </p>
            )}
            <div className="pt-2">
              <Badge variant="outline" className="text-[11px] font-normal">
                {PRUNING_YIELD_FORMULA_TEXT[s.method]}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}
