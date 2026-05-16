import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink, AlertTriangle } from "lucide-react";
import type { DerivedMetrics } from "@/lib/paddockGeometry";
import { parsePolygonPoints, polygonCentroid } from "@/lib/paddockGeometry";
import { useVineyard } from "@/context/VineyardContext";
import SoilProfileSection from "@/components/soil/SoilProfileSection";
import {
  useGrapeVarieties,
  buildVarietyMap,
  resolvePaddockAllocations,
} from "@/lib/varietyResolver";

const fmt = (n: any, d = 2) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "—";
const fmtInt = (n: any) =>
  Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString() : "—";
const fmtDate = (v: any) => {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: any }) {
  const [open, setOpen] = useState(false);
  const summary =
    Array.isArray(value)
      ? `${value.length} item${value.length === 1 ? "" : "s"}`
      : value == null
      ? "—"
      : typeof value === "object"
      ? `${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}`
      : String(value).slice(0, 40);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
        >
          <span className="font-medium">{label}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="truncate">{summary}</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-64 overflow-auto rounded border bg-background p-2 text-[10px] leading-tight font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(value, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface Props {
  paddock: any;
  metrics: DerivedMetrics;
  parsedRowsCount: number;
  rawRowsCount: number;
  polygonPointCount: number;
  asSheet?: boolean;
  onClose?: () => void;
}

export function PaddockDetailContent({
  paddock,
  metrics,
  parsedRowsCount,
  rawRowsCount,
  polygonPointCount,
}: Props) {
  // Irrigation derived
  const rowWidth = Number(paddock.row_width);
  const emitterSpacing = Number(paddock.emitter_spacing);
  const flowPerEmitter = Number(paddock.flow_per_emitter);
  const emittersPerHa =
    rowWidth > 0 && emitterSpacing > 0 ? 10000 / (rowWidth * emitterSpacing) : null;
  const litresPerHaHr =
    emittersPerHa != null && flowPerEmitter > 0 ? emittersPerHa * flowPerEmitter : null;
  const mlPerHaHr = litresPerHaHr != null ? litresPerHaHr / 1_000_000 : null;
  const mmPerHr = mlPerHaHr != null ? mlPerHaHr * 100 : null;

  const { selectedVineyardId } = useVineyard();
  const { data: grapeVarieties } = useGrapeVarieties(selectedVineyardId);
  const varietyMap = buildVarietyMap(grapeVarieties);
  const allocations = resolvePaddockAllocations(paddock.variety_allocations, varietyMap);
  const polygonRaw = Array.isArray(paddock.polygon_points) ? paddock.polygon_points : [];

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-4 text-sm">
      <Section title="Boundary / Area">
        <Row label="Area" value={`${fmt(metrics.areaHa, 3)} ha`} />
        <Row label="Boundary points" value={String(polygonPointCount || polygonRaw.length || 0)} />
      </Section>

      <Section title="Rows">
        <Row label="Row count" value={String(metrics.rowCount)} />
        <Row label="Row direction" value={paddock.row_direction != null ? `${fmt(paddock.row_direction, 1)}°` : "—"} />
        <Row label="Row width" value={paddock.row_width ? `${paddock.row_width} m` : "—"} />
        <Row label="Row offset" value={paddock.row_offset != null ? `${paddock.row_offset} m` : "—"} />
        <Row label="Vine spacing" value={paddock.vine_spacing ? `${paddock.vine_spacing} m` : "—"} />
        <Row label="Total row length" value={`${fmt(metrics.totalRowLengthM, 0)} m`} />
        <Row
          label="Average row length"
          value={metrics.rowCount > 0 ? `${fmt(metrics.totalRowLengthM / metrics.rowCount, 1)} m` : "—"}
        />
        <Row label="Row length override" value={paddock.row_length_override ? `${paddock.row_length_override} m` : "—"} />
        <Row label="Vine count override" value={fmtInt(paddock.vine_count_override)} />
        <Row
          label="Vines"
          value={
            metrics.vineCount == null
              ? "—"
              : `${metrics.vineCount.toLocaleString()} (${metrics.vineCountSource})`
          }
        />
      </Section>

      <Section title="Varieties">
        {allocations.length === 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-xs">
                <Badge variant="outline" className="text-amber-700 border-amber-400">
                  Unassigned variety
                </Badge>
                <AlertTriangle className="h-3 w-3 text-amber-600" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              This block has no variety allocation, or the allocation could not
              be matched. Add or fix the variety allocation in Block Settings.
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="space-y-1">
            {allocations.map((a, i) => (
              <div
                key={a.id ?? i}
                className="flex items-baseline justify-between gap-3 py-1"
              >
                <span className="font-medium">
                  {a.resolved ? (
                    a.name
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1">
                          <Badge variant="outline" className="text-amber-700 border-amber-400">
                            Unassigned variety
                          </Badge>
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        This allocation could not be matched to a grape variety.
                        Add or fix the variety allocation in Block Settings.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
                <span className="text-xs text-muted-foreground text-right">
                  {a.percent != null ? `${fmt(a.percent, 1)}%` : "—"}
                  {a.clone ? ` · clone ${a.clone}` : ""}
                  {a.rootstock ? ` · ${a.rootstock}` : ""}
                  {a.plantingYear ? ` · ${a.plantingYear}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {paddock.planting_year && (
          <Row label="Planting year (block)" value={paddock.planting_year} />
        )}
      </Section>

      <Section title="Irrigation">
        <Row label="Flow / emitter" value={paddock.flow_per_emitter ? `${paddock.flow_per_emitter} L/h` : "—"} />
        <Row label="Emitter spacing" value={paddock.emitter_spacing ? `${paddock.emitter_spacing} m` : "—"} />
        <Row label="Emitters" value={fmtInt(metrics.emitterCount)} />
        <Row label="L/ha/hr" value={litresPerHaHr != null ? fmt(litresPerHaHr, 0) : "—"} />
        <Row label="ML/ha/hr" value={mlPerHaHr != null ? fmt(mlPerHaHr, 6) : "—"} />
        <Row label="mm/hr" value={mmPerHr != null ? fmt(mmPerHr, 3) : "—"} />
      </Section>

      <Section title="Trellis">
        <Row label="Intermediate post spacing" value={paddock.intermediate_post_spacing ? `${paddock.intermediate_post_spacing} m` : "—"} />
        <Row label="Intermediate posts" value={fmtInt(metrics.intermediatePostCount)} />
      </Section>

      <Section title="Phenology">
        <Row label="Budburst" value={fmtDate(paddock.budburst_date)} />
        <Row label="Flowering" value={fmtDate(paddock.flowering_date)} />
        <Row label="Veraison" value={fmtDate(paddock.veraison_date)} />
        <Row label="Harvest" value={fmtDate(paddock.harvest_date)} />
        <Row label="Planting year" value={paddock.planting_year ?? "—"} />
      </Section>

      <Section title="Updated">
        <Row label="Updated" value={fmtDate(paddock.updated_at)} />
      </Section>

      <AdvancedRawData
        paddock={paddock}
        parsedRowsCount={parsedRowsCount}
        rawRowsCount={rawRowsCount}
        polygonPointCount={polygonPointCount}
      />

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={`/setup/paddocks/${paddock.id}`}>
          Open full detail <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
    </TooltipProvider>
  );
}

function AdvancedRawData({
  paddock,
  parsedRowsCount,
  rawRowsCount,
  polygonPointCount,
}: {
  paddock: any;
  parsedRowsCount: number;
  rawRowsCount: number;
  polygonPointCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <span>Advanced / raw data (debug)</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1">
        <Row label="Polygon points" value={polygonPointCount} />
        <Row label="Rows raw / parsed" value={`${rawRowsCount} / ${parsedRowsCount}`} />
        <JsonBlock label="polygon_points" value={paddock.polygon_points} />
        <JsonBlock label="rows" value={paddock.rows} />
        <JsonBlock label="variety_allocations" value={paddock.variety_allocations} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function PaddockDetailPanel(props: Props & { onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent side="right" className="w-[420px] sm:w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{props.paddock.name ?? "Unnamed paddock"}</SheetTitle>
          <SheetDescription>Read-only paddock details</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <PaddockDetailContent {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
