// Vineyard Costings — "Estimated Yield" tab.
//
// Cost per tonne by block and variety, where the tonnes default to the
// canonical seasonal base estimate (SQL 221) and can be edited inline to run
// a scenario. Overrides are in-memory only — nothing is written back — and
// "Reset to estimates" restores every block to the estimate.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { SeasonYieldBlockEstimate } from "@/lib/seasonYieldContract";
import {
  buildBlockScenarioRows,
  buildVarietyScenarioRows,
  scenarioTotals,
} from "@/lib/costPerTonneScenario";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtT = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v.toLocaleString(undefined, { maximumFractionDigits: 3 })} t`;

const fmt3 = (v: number | null) =>
  v == null ? "" : String(Math.round(v * 1000) / 1000);

/** Editable tonnes cell. Commits valid numbers (≥ 0) as the user types;
 *  empty clears the override (back to the estimate); invalid text reverts on blur. */
function TonnesInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(fmt3(value));
  useEffect(() => {
    setText(fmt3(value));
  }, [value]);
  const parsed = text.trim() === "" ? null : Number(text);
  const valid = text.trim() === "" || (Number.isFinite(parsed) && (parsed as number) >= 0);
  return (
    <Input
      value={text}
      inputMode="decimal"
      aria-label={ariaLabel}
      aria-invalid={!valid}
      placeholder="—"
      className={`h-8 w-24 text-right ml-auto ${valid ? "" : "border-destructive"}`}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = t.trim() === "" ? null : Number(t);
        if (t.trim() === "" || (Number.isFinite(n) && (n as number) >= 0)) onCommit(n);
      }}
      onBlur={() => {
        if (!valid) setText(fmt3(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export default function EstimatedYieldTab({
  blocks,
  costByBlockId,
  costByVariety,
  vintage,
  loading,
}: {
  /** Canonical seasonal estimate blocks for the selected vintage. */
  blocks: SeasonYieldBlockEstimate[];
  /** Filtered Cost Reports total per block id. */
  costByBlockId: Map<string, number>;
  /** Filtered Cost Reports total per variety name (lowercased). */
  costByVariety: Map<string, number>;
  vintage: number | null;
  loading: boolean;
}) {
  const rf = useRegionFormatters();
  const money = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : rf.currency(v, 0);

  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const setBlockTonnes = (paddockId: string, tonnes: number | null) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      if (tonnes == null) next.delete(paddockId);
      else next.set(paddockId, tonnes);
      return next;
    });
  const resetAll = () => setOverrides(new Map());

  const blockRows = useMemo(
    () => buildBlockScenarioRows(blocks, costByBlockId, overrides),
    [blocks, costByBlockId, overrides],
  );
  const varietyRows = useMemo(
    () => buildVarietyScenarioRows(blocks, costByBlockId, overrides),
    [blocks, costByBlockId, overrides],
  );
  const totals = useMemo(() => scenarioTotals(blockRows), [blockRows]);

  if (vintage == null) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Select a Vintage in the filters above to run an estimated-yield scenario.
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
    );
  }

  if (blocks.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No seasonal yield estimate exists for Vintage {vintage} yet. Set up the
        Pruning Yield Calculator on the Yields page, or type your own tonnes
        against each block once an estimate exists.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground max-w-2xl">
          Cost per tonne for Vintage {vintage}, using the seasonal yield
          estimate as the default tonnes per {rf.blockLabel.toLowerCase()}. Type
          your own tonnes to run a scenario — nothing is saved, and Reset
          restores the estimates. Costs follow the page filters.
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetAll}
          disabled={overrides.size === 0}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to estimates
        </Button>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total cost</div>
          <div className="text-lg font-semibold mt-1">{money(totals.totalCost)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Scenario yield
            {totals.blocksWithTonnes < totals.blocksTotal &&
              ` (${totals.blocksWithTonnes}/${totals.blocksTotal} ${rf.blockLabel.toLowerCase()}s)`}
          </div>
          <div className="text-lg font-semibold mt-1">{fmtT(totals.totalTonnes)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Overall cost / tonne</div>
          <div className="text-lg font-semibold mt-1">{money(totals.costPerTonne)}</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{rf.blockLabel}</TableHead>
              <TableHead className="text-right">Area ({rf.areaUnitLabel})</TableHead>
              <TableHead className="text-right">Estimate (t)</TableHead>
              <TableHead className="text-right">Scenario tonnes</TableHead>
              <TableHead className="text-right">Total cost</TableHead>
              <TableHead className="text-right">Cost/t</TableHead>
              <TableHead className="text-right">Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blockRows.map((b) => (
              <TableRow key={b.paddockId}>
                <TableCell className="font-medium">
                  {b.blockName}
                  {b.isOverridden && (
                    <Badge variant="outline" className="ml-2 text-[10px]">edited</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {b.areaHa == null ? "—" : rf.area(b.areaHa, 2)}
                </TableCell>
                <TableCell className="text-right">{fmtT(b.estimateTonnes)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <TonnesInput
                      value={b.tonnes}
                      ariaLabel={`Scenario tonnes for ${b.blockName}`}
                      onCommit={(v) => setBlockTonnes(b.paddockId, v)}
                    />
                    {b.isOverridden && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label={`Reset ${b.blockName} to the estimate`}
                        title="Reset to the estimate"
                        onClick={() => setBlockTonnes(b.paddockId, null)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">{money(b.totalCost)}</TableCell>
                <TableCell className="text-right font-medium">{money(b.costPerTonne)}</TableCell>
                <TableCell className="text-right">
                  {b.warnings.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" />{b.warnings.length}
                    </span>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variety</TableHead>
              <TableHead className="text-right">Scenario tonnes</TableHead>
              <TableHead className="text-right">Total cost</TableHead>
              <TableHead className="text-right">Cost/t</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {varietyRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No variety allocations on the estimated blocks.
                </TableCell>
              </TableRow>
            )}
            {varietyRows.map((v) => (
              <TableRow key={v.varietyKey}>
                <TableCell className="font-medium">{v.varietyName}</TableCell>
                <TableCell className="text-right">
                  {v.tonnes == null ? `${fmtT(v.knownTonnes)} (partial)` : fmtT(v.tonnes)}
                </TableCell>
                <TableCell className="text-right">{money(v.totalCost)}</TableCell>
                <TableCell className="text-right font-medium">{money(v.costPerTonne)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
