// Bunch Count Trip history (sql/187).
//
// Every completed trip is a preserved dated observation. The CURRENT estimate
// is the latest completed trip per block (see `currentEstimatesByBlock`) — the
// exact same rule Yield Reports uses, so the badge and the report can never
// disagree. Drafts are history but never current.
import { Fragment, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BunchCountTrip, CurrentBlockEstimate } from "@/lib/bunchCountTrips";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const HA_PER_AC = 0.40468564224;

const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });

export function tripSampleCount(trip: BunchCountTrip): number {
  return trip.summary.blocks.reduce((n, b) => n + b.recordedCount, 0);
}

export default function BunchCountTripsPanel({
  trips,
  currentEstimates,
  liveTripIds,
  loading,
  error,
  onOpenTrip,
}: {
  trips: BunchCountTrip[];
  currentEstimates: Map<string, CurrentBlockEstimate>;
  liveTripIds: Set<string>;
  loading?: boolean;
  error?: string | null;
  onOpenTrip: (tripId: string) => void;
}) {
  const rf = useRegionFormatters();
  const [expanded, setExpanded] = useState<string | null>(null);

  const perArea = (tPerHa?: number | null) => {
    if (tPerHa == null) return "—";
    const v = rf.areaUnitLabel === "ac" ? tPerHa * HA_PER_AC : tPerHa;
    return `${fmtNum(v)} t/${rf.areaUnitLabel}`;
  };
  const fmtDate = (v?: string | null) => (v ? rf.date(v) || "—" : "—");

  const tripById = new Map(trips.map((t) => [t.id, t]));

  // The summary card follows the same selection as the badge: the newest trip
  // that currently supplies at least one block's estimate.
  const currentTrip = trips.find((t) => liveTripIds.has(t.id)) ?? null;
  const currentTonnes = Array.from(currentEstimates.values()).reduce(
    (sum, e) => (e.tonnes == null ? sum : sum + e.tonnes),
    0,
  );

  return (
    <div className="space-y-3">
      <Card className="p-4" data-testid="current-estimate-card">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Current estimate</div>
        {currentTrip ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[24px] font-bold leading-none tabular-nums">
              {fmtNum(currentTonnes)} t
            </span>
            <span className="text-sm text-muted-foreground">
              Trip completed {fmtDate(currentTrip.completedAt ?? currentTrip.sortDate)} ·{" "}
              {currentEstimates.size} block{currentEstimates.size === 1 ? "" : "s"}
            </span>
            <Badge variant="outline" className="border-primary text-primary">
              {currentTrip.applyDamage ? "Damage adjustment applied" : "Base estimate"}
            </Badge>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No completed Bunch Count Trip for this vintage yet.
          </p>
        )}
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Completed</TableHead>
              <TableHead>Vintage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Blocks</TableHead>
              <TableHead className="text-right">Estimated (t)</TableHead>
              <TableHead className="text-right">Per {rf.areaUnitLabel}</TableHead>
              <TableHead className="text-right">Samples</TableHead>
              <TableHead>Damage</TableHead>
              <TableHead>Route</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-destructive py-6">{error}</TableCell>
              </TableRow>
            )}
            {!loading && !error && trips.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No Bunch Count Trips recorded for this vintage.
                </TableCell>
              </TableRow>
            )}
            {trips.map((t) => {
              const isCurrent = liveTripIds.has(t.id);
              const open = expanded === t.id;
              const areaHa = t.summary.totalAreaHa;
              const source = t.routeSourceSessionId ? tripById.get(t.routeSourceSessionId) : null;
              return (
                <Fragment key={t.id}>
                  <TableRow
                    className="cursor-pointer"
                    data-testid={`trip-row-${t.id}`}
                    onClick={() => setExpanded(open ? null : t.id)}
                  >
                    <TableCell className="w-8">
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>{fmtDate(t.completedAt ?? t.createdAt)}</TableCell>
                    <TableCell>{t.vintage ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {t.isCompleted ? (
                          <Badge>Completed</Badge>
                        ) : (
                          <Badge variant="outline">Draft</Badge>
                        )}
                        {isCurrent && (
                          <Badge variant="outline" className="border-primary text-primary">
                            CURRENT ESTIMATE
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{t.sampledBlocks.length || t.summary.blocks.length}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(t.totalEstimatedTonnes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {perArea(
                        t.totalEstimatedTonnes != null && areaHa
                          ? t.totalEstimatedTonnes / areaHa
                          : null,
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tripSampleCount(t)}</TableCell>
                    <TableCell className="text-xs">
                      {t.applyDamage ? "Damage adjustment applied" : "Base estimate"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.routeReused ? "Route reused" : "New route"}
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={10}>
                        <div className="space-y-2 py-1 text-xs">
                          <div className="flex flex-wrap gap-x-6 gap-y-1">
                            <span>
                              <span className="text-muted-foreground">Sampling density: </span>
                              {t.samplesPerHectare != null
                                ? `${t.samplesPerHectare} / ha`
                                : "—"}
                            </span>
                            <span>
                              <span className="text-muted-foreground">Base estimate: </span>
                              {fmtNum(t.totalBaseTonnes)} t
                            </span>
                            <span>
                              <span className="text-muted-foreground">Adjusted estimate: </span>
                              {fmtNum(t.totalEstimatedTonnes)} t
                            </span>
                            {t.routeReused && (
                              <span>
                                <span className="text-muted-foreground">Route source: </span>
                                {source
                                  ? `From trip completed ${fmtDate(source.completedAt ?? source.sortDate)}`
                                  : "Earlier trip"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {t.summary.blocks.map((b, i) => (
                              <Badge key={i} variant="secondary" className="font-normal">
                                {b.blockName ?? "Unnamed block"}
                                {b.variety ? ` · ${b.variety}` : ""} · {b.recordedCount} samples ·{" "}
                                {fmtNum(b.estimatedYieldTonnes)} t
                              </Badge>
                            ))}
                            {t.summary.blocks.length === 0 && (
                              <span className="text-muted-foreground">No blocks sampled.</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenTrip(t.id);
                            }}
                          >
                            View full trip detail
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
