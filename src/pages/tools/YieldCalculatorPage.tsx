import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fetchYieldBlocks } from "@/lib/yieldReportsQuery";
import {
  calculatePruningYield,
  PRUNING_YIELD_FORMULA_TEXT,
  type PruneMethod,
} from "@/lib/pruningYieldFormula";
import {
  defaultSettingsForBlock,
  fetchPruningYieldSettings,
  savePruningYieldSettings,
  type PruningYieldSettings,
  type PruningYieldSettings,
} from "@/lib/pruningYieldSettingsQuery";
import { buildBlockPrunedYieldTiles } from "@/lib/pruningYieldSummary";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const HA_PER_AC = 0.40468564224;
/** Retired portal-only global saved state (replaced by shared per-block settings). */
const LEGACY_STORAGE_KEY = "vinetrack.pruningYieldCalculator.v1";

interface FormState {
  method: PruneMethod;
  bunchesPerBud: string;
  budsPerSpur: string;
  spursPerVine: string;
  budsPerCane: string;
  canesPerVine: string;
  vinesPerHa: string;
  bunchWeight: string;
}

const parse = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

const fmt = (v: number, dp = 2) =>
  v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });

function toForm(s: PruningYieldSettings): FormState {
  return {
    method: s.pruneMethod,
    bunchesPerBud: String(s.bunchesPerBud),
    budsPerSpur: String(s.budsPerSpur),
    spursPerVine: String(s.spursPerVine),
    budsPerCane: String(s.budsPerCane),
    canesPerVine: String(s.canesPerVine),
    vinesPerHa: s.vinesPerHa ? String(s.vinesPerHa) : "",
    bunchWeight: String(s.bunchWeightGrams),
  };
}

export default function YieldCalculatorPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const rf = useRegionFormatters();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [blockId, setBlockId] = useState<string>("");
  const [s, setS] = useState<FormState>(() =>
    toForm(defaultSettingsForBlock(selectedVineyardId ?? "", null)),
  );

  // Legacy portal-only global saved state is no longer authoritative.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldBlocks(selectedVineyardId!),
  });
  const blocks = blocksQ.data ?? [];
  const block = useMemo(() => blocks.find((b) => b.id === blockId) ?? null, [blocks, blockId]);

  const settingsQ = useQuery({
    queryKey: ["pruning-yield-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPruningYieldSettings(selectedVineyardId!),
  });
  const settingsByBlock = settingsQ.data ?? {};

  // Block switching: always reload every input from the shared saved record or
  // the canonical defaults — never leak the previous block's values.
  useEffect(() => {
    if (!selectedVineyardId) return;
    if (settingsQ.isLoading) return;
    const fallback = defaultSettingsForBlock(
      selectedVineyardId,
      block ? { id: block.id, areaHa: block.areaHa, vineCount: block.vineCount } : null,
    );
    const saved = blockId ? settingsByBlock[blockId] : undefined;
    // vines_per_ha is nullable in the contract: null means "derive from the
    // block's vine count ÷ area".
    setS(
      toForm(
        saved
          ? { ...saved, vinesPerHa: saved.vinesPerHa > 0 ? saved.vinesPerHa : fallback.vinesPerHa }
          : fallback,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, selectedVineyardId, settingsQ.isLoading, settingsQ.dataUpdatedAt, block?.id]);

  const set = (k: keyof FormState, v: string) => setS((prev) => ({ ...prev, [k]: v }));

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

  // Contract RLS: insert/update allowed for owner / manager / supervisor / operator.
  const canEdit = ["owner", "manager", "supervisor", "operator"].includes(currentRole ?? "");

  const saveM = useMutation({
    mutationFn: () =>
      savePruningYieldSettings({
        // SQL 198: send the exact revision we loaded — never a clock value.
        id: blockId ? settingsByBlock[blockId]?.id : undefined,
        serverRevision: blockId ? settingsByBlock[blockId]?.serverRevision ?? null : null,
        vineyardId: selectedVineyardId!,
        paddockId: blockId,
        pruneMethod: s.method,
        bunchesPerBud: parse(s.bunchesPerBud),
        budsPerSpur: parse(s.budsPerSpur),
        spursPerVine: parse(s.spursPerVine),
        budsPerCane: parse(s.budsPerCane),
        canesPerVine: parse(s.canesPerVine),
        vinesPerHa: parse(s.vinesPerHa),
        bunchWeightGrams: parse(s.bunchWeight),
      }),
    onSuccess: () => {
      setConflict(null);
      qc.invalidateQueries({ queryKey: ["pruning-yield-settings", selectedVineyardId] });
      toast({ title: "Block values saved", description: `Shared with the mobile apps for ${block?.name ?? "this block"}.` });
    },
    onError: (e: any) => {
      // A genuine SQL 198 revision conflict never discards the form, never
      // retries and never counts as a successful save. Any other error
      // (401/403, 5xx, 23505 unique_violation) keeps its own identity.
      if (e instanceof RevisionConflictError) {
        setConflict((e.latest as PruningYieldSettings | null) ?? null);
        return;
      }
      toast({ title: "Could not save", description: e?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const applyLatestFromServer = () => {
    if (conflict) setS(toForm(conflict));
    setConflict(null);
    qc.invalidateQueries({ queryKey: ["pruning-yield-settings", selectedVineyardId] });
  };

  const resetToDefaults = () =>
    setS(
      toForm(
        defaultSettingsForBlock(
          selectedVineyardId ?? "",
          block ? { id: block.id, areaHa: block.areaHa, vineCount: block.vineCount } : null,
        ),
      ),
    );

  const tiles = useMemo(
    () => buildBlockPrunedYieldTiles(blocks, settingsByBlock),
    [blocks, settingsByBlock],
  );

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Block Pruned Yield</CardTitle>
          <CardDescription>
            Calculated from each block&apos;s shared saved pruning assumptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocks available.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((t) => (
                <button
                  key={t.blockId}
                  type="button"
                  data-testid={`pruned-yield-tile-${t.blockId}`}
                  onClick={() => setBlockId(t.blockId)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                    t.blockId === blockId ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <div className="truncate text-sm font-medium">{t.blockName}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Pruned Yield
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {t.hasSettings && t.totalTonnes != null
                      ? `${fmt(t.totalTonnes)} t`
                      : t.hasSettings
                        ? `${fmt(t.tonnesPerHa ?? 0)} t/ha`
                        : "Not set"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>{PRUNING_YIELD_FORMULA_TEXT[s.method]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
              {block && (
                <p className="text-xs text-muted-foreground">
                  Area: {block.areaHa ? rf.area(block.areaHa, 2) : "—"} · Vines:{" "}
                  {block.vineCount != null ? fmt(block.vineCount, 0) : "—"}
                  {settingsByBlock[block.id] ? " · Shared values saved" : " · No saved values"}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Pruning method</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["spur", "cane"] as PruneMethod[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={s.method === m ? "default" : "outline"}
                    aria-pressed={s.method === m}
                    onClick={() => set("method", m)}
                    className={cn(
                      "w-full capitalize",
                      s.method === m && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                  >
                    {m}
                  </Button>
                ))}
              </div>
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

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => saveM.mutate()}
                disabled={!blockId || !canEdit || saveM.isPending}
              >
                Save Block Values
              </Button>
              <Button variant="ghost" size="sm" onClick={resetToDefaults}>
                Reset
              </Button>
              <span className="text-xs text-muted-foreground">
                Saves these pruning assumptions for this block.
              </span>
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
              value={result.totalTonnes != null ? fmt(result.totalTonnes, 3) : "—"}
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
  const id = `pyc-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
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
