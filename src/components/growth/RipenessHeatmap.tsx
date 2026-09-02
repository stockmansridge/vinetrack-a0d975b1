import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, ImageOverlay, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Pause, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useVintage } from "@/lib/useVintage";
import { seasonRangeForVintage, vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import { usePinPlacements } from "@/lib/pinPlacementQuery";
import type { GrowthStageRecord } from "@/lib/growthStageRecordsQuery";
import {
  EL_COLOUR_STOPS,
  EL_MAX,
  EL_MIN,
  RECENCY_HALF_LIFE_DAYS,
  ageLabel,
  buildHeatModel,
  daysBetween,
  elColourCss,
  filterToVintage,
  formatEl,
  observationDays,
  observationDate,
  toObservations,
  type HeatObservation,
} from "@/lib/growthHeatmap";
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

function addDays(iso: string, n: number): string {
  const t = Date.parse(`${dayKey(iso)}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function FitTo({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try {
      map.fitBounds(L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.15), { padding: [16, 16] });
    } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

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

export default function RipenessHeatmap({
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
  const [dayIndex, setDayIndex] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [selectedObs, setSelectedObs] = useState<HeatObservation | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const touchedDay = useRef(false);

  const activeVintage = vintage ?? currentVintage;
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

  /** Vintages present in the data, plus the current one. */
  const vintageOptions = useMemo(() => {
    const s = new Set<number>([currentVintage]);
    for (const r of records) {
      const iso = observationDate(r);
      if (!iso) continue;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      s.add(vintageForDate(d, seasonStartMonth, seasonStartDay));
    }
    return Array.from(s).sort((a, b) => b - a);
  }, [records, currentVintage, seasonStartMonth, seasonStartDay]);

  const seasonObs = useMemo(
    () => filterToVintage(allObs, season.startISO, season.endISO),
    [allObs, season.startISO, season.endISO],
  );

  const days = useMemo(() => {
    const out: string[] = [];
    const total = Math.max(1, daysBetween(season.startISO, season.endISO));
    for (let i = 0; i <= total; i++) out.push(addDays(season.startISO, i));
    return out;
  }, [season.startISO, season.endISO]);

  const obsDays = useMemo(() => observationDays(seasonObs), [seasonObs]);

  // Default the slider to the latest recorded observation in the season.
  useEffect(() => {
    touchedDay.current = false;
    const last = obsDays[obsDays.length - 1];
    const idx = last ? days.indexOf(last) : days.length - 1;
    setDayIndex(idx >= 0 ? idx : days.length - 1);
  }, [activeVintage, days, obsDays]);

  const selectedDay = days[Math.min(dayIndex, days.length - 1)] ?? season.startISO;

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
        observations: seasonObs,
        blocks,
        atDateISO: selectedDay,
        blockFilter: blockFilter === ALL ? null : blockFilter,
      }),
    [seasonObs, blocks, selectedDay, blockFilter],
  );

  const overlays = useMemo(
    () =>
      model.blocks.flatMap((b) => {
        if (b.mode === "none" || b.mode === "no_polygon" || !b.gridBounds) return [];
        const url = blockHeatDataUrl(b, b.mode === "halo" ? 0.55 : 0.72);
        if (!url) return [];
        return [{
          id: b.paddockId,
          url,
          bounds: [
            [b.gridBounds.minLat, b.gridBounds.minLng],
            [b.gridBounds.maxLat, b.gridBounds.maxLng],
          ] as L.LatLngBoundsLiteral,
        }];
      }),
    [model],
  );

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const pts: LatLng[] = [];
    model.blocks.forEach((b) => pts.push(...b.polygon));
    if (!pts.length) model.qualifying.forEach((o) => pts.push({ lat: o.lat, lng: o.lng }));
    if (!pts.length) return null;
    return pts.map((p) => [p.lat, p.lng]) as L.LatLngBoundsLiteral;
  }, [model, fitKey]);

  // ---- playback -----------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) { setPlaying(false); return; }
    const id = window.setInterval(() => {
      setDayIndex((i) => {
        if (i >= days.length - 1) return 0;
        return i + 1;
      });
    }, 90);
    return () => window.clearInterval(id);
  }, [playing, days.length, reducedMotion]);

  useEffect(() => {
    const stop = () => setPlaying(false);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
    });
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      setPlaying(false);
    };
  }, []);

  const stepObs = (dir: 1 | -1) => {
    setPlaying(false);
    const cur = selectedDay;
    const next = dir === 1 ? obsDays.find((d) => d > cur) : [...obsDays].reverse().find((d) => d < cur);
    if (!next) return;
    const idx = days.indexOf(next);
    if (idx >= 0) setDayIndex(idx);
  };

  const dateLabel = new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const noPolygonBlocks = model.blocks.filter((b) => b.mode === "no_polygon" && b.observations.length);
  const emptyBlocks = model.blocks.filter((b) => b.mode === "none");

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
          <Button variant="outline" size="sm" onClick={() => setFitKey((k) => k + 1)}>
            <Maximize2 className="mr-2 h-4 w-4" /> Fit to {blockFilter === ALL ? "vineyard" : "block"}
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">
            Season {season.startISO} → {season.endISO} · {hemisphere === "southern" ? "Southern" : "Northern"} hemisphere
          </div>
        </div>

        {/* Fixed EL legend — never rescaled to the current result set. */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="h-3 w-56 rounded-full"
            style={{
              background: `linear-gradient(to right, ${EL_COLOUR_STOPS.map(
                (s) => `${elColourCss(s.el)} ${((s.el - EL_MIN) / (EL_MAX - EL_MIN)) * 100}%`,
              ).join(", ")})`,
            }}
            aria-hidden
          />
          <div className="flex flex-wrap gap-2 text-xs">
            {EL_COLOUR_STOPS.map((s) => (
              <span key={s.el} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: elColourCss(s.el) }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="text-sm">
          <strong>{dateLabel}</strong> · {model.qualifying.length} observation
          {model.qualifying.length === 1 ? "" : "s"} ·{" "}
          {model.medianEl == null ? "No recorded stage" : `Typical recorded stage ${formatEl(model.medianEl)}`}
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
        ) : (
          <div className="h-[540px] overflow-hidden rounded-md border">
            <MapContainer center={[-34.3, 138.6]} zoom={14} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="Tiles &copy; Esri"
              />
              <FitTo bounds={bounds} />
              {model.blocks.map((b) =>
                b.polygon.length >= 3 ? (
                  <Polygon
                    key={`poly-${b.paddockId}`}
                    positions={b.polygon.map((p) => [p.lat, p.lng]) as any}
                    pathOptions={{ color: "#ffffff", weight: 2, fillOpacity: b.mode === "none" ? 0.05 : 0 }}
                  >
                    <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white">
                      {b.paddockName}
                      {b.mode === "none" ? " · No observations" : ""}
                    </Tooltip>
                  </Polygon>
                ) : null,
              )}
              {overlays.map((o) => (
                <ImageOverlay key={`heat-${o.id}-${selectedDay}`} url={o.url} bounds={o.bounds} opacity={1} />
              ))}
              {model.qualifying.map((o) => (
                <CircleMarker
                  key={o.id}
                  center={[o.lat, o.lng]}
                  radius={6}
                  pathOptions={{
                    color: "#ffffff",
                    weight: 2,
                    fillColor: elColourCss(o.el),
                    fillOpacity: o.assigned && o.paddockId ? 1 : 0,
                  }}
                  eventHandlers={{ click: () => setSelectedObs(o) }}
                />
              ))}
            </MapContainer>
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setPlaying((p) => !p)}
              disabled={reducedMotion}
              aria-label={playing ? "Pause timeline" : "Play timeline"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => stepObs(-1)} aria-label="Previous observation date">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => stepObs(1)} aria-label="Next observation date">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="relative flex-1">
              <Slider
                value={[Math.min(dayIndex, days.length - 1)]}
                min={0}
                max={Math.max(0, days.length - 1)}
                step={1}
                onValueChange={([v]) => { touchedDay.current = true; setPlaying(false); setDayIndex(v); }}
                aria-label="Season timeline"
              />
              <div className="pointer-events-none absolute inset-x-0 top-5 h-2">
                {obsDays.map((d) => {
                  const i = days.indexOf(d);
                  if (i < 0) return null;
                  return (
                    <span
                      key={d}
                      className="absolute top-0 h-2 w-px bg-primary/70"
                      style={{ left: `${(i / Math.max(1, days.length - 1)) * 100}%` }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          {reducedMotion && (
            <div className="text-xs text-muted-foreground">
              Animation disabled — your browser requests reduced motion.
            </div>
          )}
        </div>

        {(noPolygonBlocks.length > 0 || model.unassigned.length > 0 || emptyBlocks.length > 0) && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {noPolygonBlocks.map((b) => (
              <div key={b.paddockId}>
                {b.paddockName}: heat surface unavailable — no usable block boundary. Pins are still shown.
              </div>
            ))}
            {emptyBlocks.length > 0 && (
              <div>{emptyBlocks.length} block(s) have no observations on or before this date.</div>
            )}
            {model.unassigned.length > 0 && (
              <div>
                {model.unassigned.length} observation(s) have coordinates but no canonical block — shown as
                outlined pins and excluded from interpolation.
              </div>
            )}
            <div>
              Older observations fade with a {RECENCY_HALF_LIFE_DAYS}-day half-life so stale areas become more
              transparent rather than misleadingly solid.
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
            <Badge style={{ background: elColourCss(selectedObs.el), color: "#fff" }}>
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
