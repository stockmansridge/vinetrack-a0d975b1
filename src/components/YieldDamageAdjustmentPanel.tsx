// Phase 3 — Yield Estimation × Damage Records.
//
// Reads active paddocks + active damage records for the vineyard, calculates
// per-paddock effective loss using `aggregateDamageByPaddock`, and surfaces:
//   - total mapped damage area (ha)
//   - total effective loss area (ha)
//   - vineyard yield impact %
//   - per-paddock breakdown
//   - optional adjusted yield (base tonnes × (1 - lossPct/100))
//
// Pure presentation: never writes to the database.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchList } from "@/lib/queries";
import {
  parsePolygonPoints,
  polygonAreaHectares,
} from "@/lib/paddockGeometry";
import {
  fetchDamageRecordsForVineyard,
  type DamageRecord,
} from "@/lib/damageRecordsQuery";
import { aggregateDamageByPaddock } from "@/lib/damageImpact";

interface PaddockLite {
  id: string;
  name: string | null;
  polygon_points?: any;
}

interface Props {
  vineyardId: string | null;
  /** Optional base yield (tonnes) — when provided, an adjusted figure is shown. */
  baseTonnes?: number | null;
  /** Optional label for the base figure (e.g. "Historical 2024"). */
  baseLabel?: string;
  /** Compact rendering inside a sheet/drawer — hides the per-paddock table. */
  compact?: boolean;
  /** Initial state of the "apply damage" toggle. Default false (optional, off). */
  defaultEnabled?: boolean;
}

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

export default function YieldDamageAdjustmentPanel({
  vineyardId,
  baseTonnes,
  baseLabel,
  compact = false,
  defaultEnabled = false,
}: Props) {
  const [enabled, setEnabled] = useState(defaultEnabled);

  const paddocksQ = useQuery({
    queryKey: ["paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", vineyardId!),
  });
  const damageQ = useQuery({
    queryKey: ["damage_records_for_yield", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchDamageRecordsForVineyard(vineyardId!),
  });

  const paddocks = paddocksQ.data ?? [];
  const records: DamageRecord[] = damageQ.data?.records ?? [];

  const summary = useMemo(() => {
    const blockAreaByPaddock = new Map<string, number>();
    for (const p of paddocks) {
      blockAreaByPaddock.set(p.id, polygonAreaHectares(parsePolygonPoints(p.polygon_points)));
    }
    const agg = aggregateDamageByPaddock(records, blockAreaByPaddock);

    let totalMappedHa = 0;          // sum of damage polygon areas (or block area when no polygon)
    let totalEffectiveHa = 0;       // sum of effective loss areas
    let totalBlockHa = 0;           // sum of block areas across vineyard

    const rows: Array<{
      paddockId: string;
      name: string;
      blockHa: number;
      effectiveHa: number;
      lossPct: number;
      recordCount: number;
    }> = [];

    for (const p of paddocks) {
      const blockHa = blockAreaByPaddock.get(p.id) ?? 0;
      totalBlockHa += blockHa;
      const a = agg.get(p.id);
      if (a && a.recordCount > 0) {
        totalEffectiveHa += a.totalEffectiveHa;
        rows.push({
          paddockId: p.id,
          name: p.name ?? p.id,
          blockHa,
          effectiveHa: a.totalEffectiveHa,
          lossPct: a.lossPct,
          recordCount: a.recordCount,
        });
      }
    }

    // Total mapped (raw, pre-intensity) damage area — for context only.
    for (const r of records) {
      const poly = parsePolygonPoints(r.polygon_points);
      const blockHa = r.paddock_id ? blockAreaByPaddock.get(r.paddock_id) ?? 0 : 0;
      totalMappedHa += poly.length >= 3 ? polygonAreaHectares(poly) : blockHa;
    }

    const vineyardLossPct = totalBlockHa > 0
      ? Math.min(100, (totalEffectiveHa / totalBlockHa) * 100)
      : 0;

    rows.sort((a, b) => b.effectiveHa - a.effectiveHa);

    return {
      totalMappedHa,
      totalEffectiveHa,
      totalBlockHa,
      vineyardLossPct,
      rows,
      recordCount: records.length,
    };
  }, [paddocks, records]);

  const adjustedTonnes =
    baseTonnes != null && Number.isFinite(baseTonnes)
      ? baseTonnes * (1 - summary.vineyardLossPct / 100)
      : null;

  const loading = paddocksQ.isLoading || damageQ.isLoading;
  const error = paddocksQ.error || damageQ.error;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Damage adjustment</div>
          <p className="text-xs text-muted-foreground">
            Reduces yield using mapped damage records (polygon area × intensity).
            Toggle off to see the base estimate only.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Apply</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading damage data…</p>}
      {error && <p className="text-xs text-destructive">{(error as Error).message}</p>}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Stat label="Mapped damage area" value={`${fmt(summary.totalMappedHa)} ha`} />
            <Stat label="Effective loss" value={`${fmt(summary.totalEffectiveHa)} ha`} />
            <Stat
              label="Vineyard area"
              value={summary.totalBlockHa > 0 ? `${fmt(summary.totalBlockHa)} ha` : "—"}
            />
            <Stat
              label="Yield impact"
              value={summary.totalBlockHa > 0 ? `${summary.vineyardLossPct.toFixed(1)}%` : "—"}
              accent
            />
          </div>

          {baseTonnes != null && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Base estimate {baseLabel ? `(${baseLabel})` : ""}
                </span>
                <span className="font-medium">{fmt(baseTonnes)} t</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Adjusted{enabled ? "" : " (preview — toggle to apply)"}
                </span>
                <span className={enabled ? "font-semibold text-primary" : "font-medium opacity-70"}>
                  {adjustedTonnes != null ? `${fmt(adjustedTonnes)} t` : "—"}
                </span>
              </div>
              {summary.recordCount > 0 && (
                <div className="text-[11px] text-muted-foreground pt-1 border-t">
                  Example: {fmt(baseTonnes)} t × (1 − {summary.vineyardLossPct.toFixed(1)}%) ={" "}
                  {adjustedTonnes != null ? `${fmt(adjustedTonnes)} t` : "—"}
                </div>
              )}
            </div>
          )}

          {summary.recordCount === 0 && (
            <p className="text-xs text-muted-foreground">
              No active damage records for this vineyard — adjustment has no effect.
            </p>
          )}

          {!compact && summary.rows.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paddock</TableHead>
                    <TableHead className="text-right">Block (ha)</TableHead>
                    <TableHead className="text-right">Effective loss (ha)</TableHead>
                    <TableHead className="text-right">Loss %</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((r) => (
                    <TableRow key={r.paddockId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{fmt(r.blockHa)}</TableCell>
                      <TableCell className="text-right">{fmt(r.effectiveHa)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.lossPct >= 50 ? "destructive" : r.lossPct >= 20 ? "default" : "secondary"}>
                          {r.lossPct.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.recordCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Per-paddock loss is capped at 100%. Overlapping damage polygons in the same paddock are
            summed and may overstate loss — polygon overlap detection is not implemented yet.
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={accent ? "text-base font-semibold text-primary" : "text-sm font-medium"}>
        {value}
      </div>
    </div>
  );
}
