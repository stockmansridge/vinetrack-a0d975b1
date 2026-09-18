import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Pause, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import AppleHeatMap from "@/components/growth/AppleHeatMap";
import LeafletHeatMap from "@/components/growth/LeafletHeatMap";

import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useVintage } from "@/lib/useVintage";
import { seasonRangeForVintage, vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import { usePinPlacements } from "@/lib/pinPlacementQuery";
import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";
import {
  RECENCY_HALF_LIFE_DAYS,
  RECENCY_MAX_AGE_DAYS,
  ageLabel,
  buildHeatModel,
  filterToVintage,
  formatEl,
  observationDays,
  observationDate,
  toObservations,
  type HeatObservation,
} from "@/lib/growthHeatmap";
import {
  EL_PHASES,
  elInPhase,
  makePhaseColour,
  makePhaseColourCss,
  phaseById,
  phaseColourCss,
  phaseForEl,
  phaseOptionLabel,
} from "@/lib/growthPhases";
import {
  advancePlayback,
  dayIndex as timelineIndex,
  dayAtIndex,
  dayOffsetPct,
  playbackStartDay,
  resolveSelectedDay,
  stepDay,
} from "@/lib/heatTimeline";
import { blockHeatDataUrl } from "@/components/growth/heatCanvas";

interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
  variety_allocations?: any;
  deleted_at?: string | null;
}

const ALL = "all";
const dayKey = (iso: string) => String(iso).slice(0, 10);

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  return reduced;
}

export default function GrowthStageHeatmap({
  records,
  isLoading,
  error,
}: {
  records: GrowthStageRecord[];
  isLoading?: boolean;
  error?: unknown;
}) {
  const { selectedVineyardId } = useVineyard();
  const { resolve } = useTeamLookup(selectedVineyardId);
  const { vintage: currentVintage, seasonStartMonth, seasonStartDay, hemisphere } = useVintage();
  const reducedMotion = usePrefersReducedMotion();

  const [vintage, setVintage] = useState<number | null>(null);
  const [blockFilter, setBlockFilter] = useState<string>(ALL);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedObs, setSelectedObs] = useState<HeatObservation | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [mapProvider, setMapProvider] = useState<"apple" | "fallback">("apple");
  const [mapReason, setMapReason] = useState<string | null>(null);

  /** Data-driven: only Vintages that actually contain observations. */
  const vintageOptions = useMemo(() => {
    const s = new Set<number>();
    for (const r of records) {
      const iso = observationDate(r);
      if (!iso) continue;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      s.add(vintageForDate(d, seasonStartMonth, seasonStartDay));
    }
    const list = Array.from(s).sort((a, b) => b - a);
    return list.length ? list : [currentVintage];
  }, [records, currentVintage, seasonStartMonth, seasonStartDay]);

  /** Default to the current Vintage only when it has observations. */
  const activeVintage =
    vintage != null && vintageOptions.includes(vintage)
      ? vintage
      : vintageOptions.includes(currentVintage)
        ? currentVintage
        : vintageOptions[0];

  const season = useMemo(
    () => seasonRangeForVintage(seasonStartMonth, seasonStartDay, activeVintage),
    [seasonStartMonth, seasonStartDay, activeVintage],
  );

  const { data: paddocks = [], error: paddockError } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const recordIds = useMemo(() => records.map((r) => r.id), [records]);
  const { placements } = usePinPlacements(recordIds);

  const assignedById = useMemo(() => {
    const m = new Map<string, boolean>();
    placements.forEach((row, id) => {
      if (row.is_location_assigned != null || row.location_warning_code) {
        m.set(id, row.is_location_assigned === true && row.location_warning_code !== "unassigned_location");
      }
    });
    return m;
  }, [placements]);

  const allObs = useMemo(() => toObservations(records, { assignedById }), [records, assignedById]);

  const seasonObs = useMemo(
    () => filterToVintage(allObs, season.startISO, season.endISO),
    [allObs, season.startISO, season.endISO],
  );

  // ---- development phase --------------------------------------------------
  /** Phase containing the most recent observation in the season. */
  const latestPhaseId = useMemo(() => {
    let latest: HeatObservation | null = null;
    for (const o of seasonObs) {
      if (!latest || dayKey(o.dateISO) > dayKey(latest.dateISO)) latest = o;
    }
    return latest ? phaseForEl(latest.el).id : EL_PHASES[0].id;
  }, [seasonObs]);

  const phase = phaseById(phaseId) ?? phaseById(latestPhaseId) ?? EL_PHASES[0];

  const phaseObs = useMemo(
    () => seasonObs.filter((o) => elInPhase(o.el, phase)),
    [seasonObs, phase],
  );

  const colourFor = useMemo(() => makePhaseColour(phase), [phase]);
  const colourCss = useMemo(() => makePhaseColourCss(phase), [phase]);

  // ---- timeline -----------------------------------------------------------
  /** Distinct observation dates for the selected phase and block. */
  const obsDays = useMemo(() => {
    const scoped = blockFilter === ALL ? phaseObs : phaseObs.filter((o) => o.paddockId === blockFilter);
    return observationDays(scoped);
  }, [phaseObs, blockFilter]);

  // Phase / Vintage / block change → latest available date in that scope.
  useEffect(() => {
    setSelectedDate(null);
    setPlaying(false);
  }, [phase.id, activeVintage, blockFilter]);

  const activeDay = resolveSelectedDay(obsDays, selectedDate);
  const selectedDay = activeDay ?? dayKey(season.endISO);
  const dayPos = timelineIndex(obsDays, activeDay);

  const blocks = useMemo(
    () =>
      paddocks
        .filter((p) => !p.deleted_at)
        .map((p) => ({
          id: p.id,
          name: p.name ?? "Unnamed block",
          polygon: parsePolygonPoints(p.polygon_points),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [paddocks],
  );

  const model = useMemo(
    () =>
      buildHeatModel({
        observations: phaseObs,
        blocks,
        atDateISO: selectedDay,
        blockFilter: blockFilter === ALL ? null : blockFilter,
      }),
    [phaseObs, blocks, selectedDay, blockFilter],
  );

  const overlays = useMemo(
    () =>
      model.blocks.flatMap((b) => {
        if (b.mode === "none" || b.mode === "no_polygon" || !b.gridBounds) return [];
        const url = blockHeatDataUrl(b, b.mode === "halo" ? 0.55 : 0.72, colourFor);
        if (!url) return [];
        return [{
          id: b.paddockId,
          url,
          bounds: [
            [b.gridBounds.minLat, b.gridBounds.minLng],
            [b.gridBounds.maxLat, b.gridBounds.maxLng],
          ] as [[number, number], [number, number]],
        }];
      }),
    [model, colourFor],
  );

  const fitPoints = useMemo(() => {
    const pts: LatLng[] = [];
    model.blocks.forEach((b) => pts.push(...b.polygon));
    if (!pts.length) model.qualifying.forEach((o) => pts.push({ lat: o.lat, lng: o.lng }));
    return pts;
  }, [model]);

  const staleIds = useMemo(() => new Set(model.stale.map((o) => o.id)), [model.stale]);

  const mapProps = {
    blocks: model.blocks,
    overlays,
    observations: model.qualifying,
    staleIds,
    fitPoints,
    fitKey,
    showBoundaries,
    colourCss,
    onSelect: setSelectedObs,
  };


  // ---- playback -----------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    if (reducedMotion || obsDays.length < 2) { setPlaying(false); return; }
    const id = window.setInterval(() => {
      setSelectedDate((cur) => {
        const next = advancePlayback(obsDays, cur);
        if (!next.playing) setPlaying(false);
        return next.day;
      });
    }, 800);
    return () => window.clearInterval(id);
  }, [playing, obsDays, reducedMotion]);

  useEffect(() => {
    const stop = () => setPlaying(false);
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      setPlaying(false);
    };
  }, []);

  const stepObs = (dir: 1 | -1) => {
    setPlaying(false);
    const target = stepDay(obsDays, selectedDate ?? activeDay, dir);
    if (target) setSelectedDate(target);
  };

  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (obsDays.length < 2) return;
    setSelectedDate(playbackStartDay(obsDays, selectedDate));
    setPlaying(true);
  };

  const dateLabel = new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const noPolygonBlocks = model.blocks.filter((b) => b.mode === "no_polygon" && b.observations.length);
  const emptyBlocks = model.blocks.filter((b) => b.mode === "none");
  const staleBlocks = model.blocks.filter((b) => b.mode === "stale");

  if (error) {
    return <Card className="p-6 text-sm text-destructive">Growth Stage data could not be loaded.</Card>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Visualise how recorded EL growth stages progress across your vineyard throughout the Vintage.
        </p>
        <p className="text-xs text-muted-foreground">
          This shows recorded phenological development (E-L growth stages) only. It is not a measurement of
          Brix, Baumé, pH or TA.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Vintage</div>
            <Select value={String(activeVintage)} onValueChange={(v) => setVintage(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {vintageOptions.map((v) => (
                  <SelectItem key={v} value={String(v)}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Block</div>
            <Select value={blockFilter} onValueChange={(v) => { setBlockFilter(v); setFitKey((k) => k + 1); }}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All blocks</SelectItem>
                {blocks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Development phase</div>
            <Select value={phase.id} onValueChange={(v) => setPhaseId(v)}>
              <SelectTrigger className="w-[320px]" aria-label="Development phase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EL_PHASES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{phaseOptionLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFitKey((k) => k + 1)}>
            <Maximize2 className="mr-2 h-4 w-4" /> Fit to {blockFilter === ALL ? "vineyard" : "block"}
          </Button>
          <div className="flex items-center gap-2 pb-1">
            <Switch
              id="heatmap-boundaries"
              checked={showBoundaries}
              onCheckedChange={setShowBoundaries}
            />
            <Label htmlFor="heatmap-boundaries" className="text-xs">
              Block boundaries &amp; names
            </Label>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {mapProvider === "fallback" && (
              <Badge variant="outline" className="text-xs" title={mapReason ?? undefined}>
                Apple Maps unavailable — using fallback
              </Badge>
            )}
            <span>
              Season {season.startISO} → {season.endISO} · {hemisphere === "southern" ? "Southern" : "Northern"} hemisphere
            </span>
          </div>
        </div>


        {/* Phase legend — first stage red, final stage green. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">E-L {phase.min}</span>
          <div
            className="h-3 w-56 rounded-full"
            style={{
              background: `linear-gradient(to right, ${phaseColourCss(phase.min, phase)}, ${phaseColourCss(
                (phase.min + phase.max) / 2,
                phase,
              )}, ${phaseColourCss(phase.max, phase)})`,
            }}
            aria-hidden
          />
          <span className="text-xs text-muted-foreground">E-L {phase.max}</span>
          <span className="text-xs text-muted-foreground">{phase.label}</span>
        </div>

        <div className="space-y-0.5 text-sm">
          <div>
            <strong>{dateLabel}</strong> · {model.qualifying.length} recorded observation
            {model.qualifying.length === 1 ? "" : "s"} available ·{" "}
            <span className="font-medium">{model.influencing.length}</span> influencing the heat surface
          </div>
          <div className="text-muted-foreground">
            {model.medianEl == null
              ? "No current recorded stage influencing the surface"
              : `Typical current stage ${formatEl(model.medianEl)}`}
            {model.stale.length > 0 &&
              ` · ${model.stale.length} stale observation${model.stale.length === 1 ? "" : "s"} (older than ${RECENCY_MAX_AGE_DAYS} days) shown as faded, dashed pins`}
          </div>
        </div>

        {isLoading ? (
          <div className="h-[540px] animate-pulse rounded-md bg-muted" />
        ) : paddockError ? (
          <div className="rounded-md border p-6 text-sm text-destructive">
            Block geometry could not be loaded.
          </div>
        ) : seasonObs.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            No Growth Stage observations recorded in the {activeVintage} Vintage.
          </div>
        ) : phaseObs.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            No observations in this development phase
          </div>
        ) : (
          <div className="h-[540px] overflow-hidden rounded-md border">
            {mapProvider === "apple" ? (
              <AppleHeatMap {...mapProps} onUnavailable={(r) => { setMapReason(r); setMapProvider("fallback"); }} />
            ) : (
              <LeafletHeatMap {...mapProps} />
            )}
          </div>
        )}


        {/* Timeline */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={togglePlay}
              disabled={reducedMotion || obsDays.length < 2}
              aria-label={playing ? "Pause timeline" : "Play timeline"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepObs(-1)}
              disabled={!obsDays.length}
              aria-label="Previous observation date"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepObs(1)}
              disabled={!obsDays.length}
              aria-label="Next observation date"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="relative flex-1">
              <Slider
                value={[dayPos]}
                min={0}
                max={Math.max(0, obsDays.length - 1)}
                step={1}
                disabled={obsDays.length < 2}
                onValueChange={([v]) => {
                  setPlaying(false);
                  const d = dayAtIndex(obsDays, v);
                  if (d) setSelectedDate(d);
                }}
                aria-label="Observation date timeline"
              />
              <div className="absolute inset-x-0 top-5 h-3">
                {obsDays.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`absolute top-0 h-3 w-1.5 -translate-x-1/2 rounded-sm ${
                      d === activeDay ? "bg-primary" : "bg-primary/60 hover:bg-primary"
                    }`}
                    style={{ left: `${dayOffsetPct(obsDays, d)}%` }}
                    aria-label={`Select observation date ${d}`}
                    onClick={() => { setPlaying(false); setSelectedDate(d); }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {obsDays.length
              ? `${obsDays.length} observation date${obsDays.length === 1 ? "" : "s"} in this development phase`
              : "No observations in this development phase"}
          </div>
          {reducedMotion && (
            <div className="text-xs text-muted-foreground">
              Animation disabled — your browser requests reduced motion.
            </div>
          )}
        </div>

        {(noPolygonBlocks.length > 0 ||
          model.unassigned.length > 0 ||
          emptyBlocks.length > 0 ||
          staleBlocks.length > 0) && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {noPolygonBlocks.map((b) => (
              <div key={b.paddockId}>
                {b.paddockName}: heat surface unavailable — no usable block boundary. Pins are still shown.
              </div>
            ))}
            {emptyBlocks.length > 0 && (
              <div>{emptyBlocks.length} block(s) have no observations on or before this date.</div>
            )}
            {staleBlocks.length > 0 && (
              <div>
                {staleBlocks.length} block(s) have only stale observations (older than {RECENCY_MAX_AGE_DAYS} days)
                — no heat surface is drawn, the recorded pins remain for historical context.
              </div>
            )}
            {model.unassigned.length > 0 && (
              <div>
                {model.unassigned.length} observation(s) have coordinates but no canonical block — shown as
                outlined pins and excluded from interpolation.
              </div>
            )}
            <div>
              Older observations fade with a {RECENCY_HALF_LIFE_DAYS}-day half-life and reach zero influence at
              {" "}{RECENCY_MAX_AGE_DAYS} days, so stale areas stop implying current coverage.
            </div>
          </div>
        )}
      </Card>

      {selectedObs && (
        <Card className="p-4 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">Recorded observation</div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedObs(null)}>Close</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge style={{ background: colourCss(selectedObs.el), color: "#fff" }}>
              {formatEl(selectedObs.el)}
            </Badge>
            {selectedObs.record.growth_stage_label && <span>{selectedObs.record.growth_stage_label}</span>}
          </div>
          <div>Date: {dayKey(selectedObs.dateISO)}</div>
          <div>Block: {selectedObs.record.paddock_name ?? "Unassigned"}</div>
          {selectedObs.record.row_number != null && <div>Row: {selectedObs.record.row_number}</div>}
          {selectedObs.record.variety && <div>Variety: {selectedObs.record.variety}</div>}
          {selectedObs.record.created_by && <div>Recorded by: {resolve(selectedObs.record.created_by) ?? "Unknown member"}</div>}
          <div className="text-muted-foreground">{ageLabel(selectedObs.dateISO, selectedDay)}</div>
        </Card>
      )}
    </div>
  );
}
