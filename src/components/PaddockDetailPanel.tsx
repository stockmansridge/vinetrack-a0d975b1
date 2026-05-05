import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { DerivedMetrics } from "@/lib/paddockGeometry";

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

  const varieties = Array.isArray(paddock.variety_allocations)
    ? paddock.variety_allocations
    : [];

  return (
    <div className="space-y-4 text-sm">
      <Section title="Summary">
        <Row label="Name" value={paddock.name ?? "Unnamed"} />
        <Row label="Area" value={`${fmt(metrics.areaHa, 3)} ha`} />
        <Row label="Rows" value={String(metrics.rowCount)} />
        <Row label="Total row length" value={`${fmt(metrics.totalRowLengthM, 0)} m`} />
        <Row
          label="Vines"
          value={
            metrics.vineCount == null
              ? "—"
              : `${metrics.vineCount.toLocaleString()} (${metrics.vineCountSource})`
          }
        />
        {varieties.length > 0 && (
          <Row
            label="Varieties"
            value={
              <span className="text-xs">
                {varieties.length} alloc.
              </span>
            }
          />
        )}
      </Section>

      <Section title="Row setup">
        <Row label="Row direction" value={paddock.row_direction != null ? `${fmt(paddock.row_direction, 1)}°` : "—"} />
        <Row label="Row width" value={paddock.row_width ? `${paddock.row_width} m` : "—"} />
        <Row label="Row offset" value={paddock.row_offset != null ? `${paddock.row_offset} m` : "—"} />
        <Row label="Vine spacing" value={paddock.vine_spacing ? `${paddock.vine_spacing} m` : "—"} />
        <Row label="Row length override" value={paddock.row_length_override ? `${paddock.row_length_override} m` : "—"} />
        <Row label="Vine count override" value={fmtInt(paddock.vine_count_override)} />
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

      <Section title="Data quality / debug">
        <Row label="Polygon points" value={polygonPointCount} />
        <Row label="Rows raw / parsed" value={`${rawRowsCount} / ${parsedRowsCount}`} />
        <Row label="Updated" value={fmtDate(paddock.updated_at)} />
      </Section>

      <div className="space-y-1">
        <JsonBlock label="polygon_points" value={paddock.polygon_points} />
        <JsonBlock label="rows" value={paddock.rows} />
        <JsonBlock label="variety_allocations" value={paddock.variety_allocations} />
      </div>

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={`/setup/paddocks/${paddock.id}`}>
          Open full detail <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
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
