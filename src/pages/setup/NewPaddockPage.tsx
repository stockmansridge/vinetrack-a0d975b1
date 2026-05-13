// New Paddock wizard — Phase 2C scaffold.
//
// SAFETY: Final "Save paddock" button is gated by a TEST FLAG and is
// disabled until explicitly enabled. No write is performed yet — the Save
// button currently only logs the prepared payload to the console.
//
// Spec: docs/paddock-geometry-writer-spec.md

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, RotateCcw, Undo2, Copy, AlertTriangle, Info } from "lucide-react";

import {
  generateRows,
  toCanonicalPolygon,
  type GeneratedRow,
  type LatLng,
} from "@/lib/paddockRowGeneration";
import {
  polygonAreaHectares,
  polygonCentroid,
  haversineMeters,
} from "@/lib/paddockGeometry";

// ────────────────────────────────────────────────────────────────────────────
// TEST FLAG — keep `false` until production save is approved.
// When false, "Save paddock" is disabled and clicking the (disabled) button
// will only log the prepared payload. Flip to true ONLY after the iOS team
// has verified a test paddock round-trips correctly.
const ENABLE_PRODUCTION_SAVE = false;
// ────────────────────────────────────────────────────────────────────────────

type Step = "details" | "boundary" | "rows" | "review";

const fmt = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

// Simple O(n²) self-intersection check for closed polygon edges. Adjacent
// edges (sharing a vertex) are skipped. Returns true if any non-adjacent
// edges cross.
function polygonHasSelfIntersection(pts: LatLng[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  const seg = (i: number) => [pts[i], pts[(i + 1) % n]] as const;
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const intersects = (p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng) => {
    const d1 = cross(p4.lng - p3.lng, p4.lat - p3.lat, p1.lng - p3.lng, p1.lat - p3.lat);
    const d2 = cross(p4.lng - p3.lng, p4.lat - p3.lat, p2.lng - p3.lng, p2.lat - p3.lat);
    const d3 = cross(p2.lng - p1.lng, p2.lat - p1.lat, p3.lng - p1.lng, p3.lat - p1.lat);
    const d4 = cross(p2.lng - p1.lng, p2.lat - p1.lat, p4.lng - p1.lng, p4.lat - p1.lat);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === j) continue;
      if (j === (i + 1) % n || i === (j + 1) % n) continue;
      const [a, b] = seg(i);
      const [c, d] = seg(j);
      if (intersects(a, b, c, d)) return true;
    }
  }
  return false;
}

export default function NewPaddockPage() {
  const navigate = useNavigate();
  // qc reserved for future use after production save is enabled.
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const [step, setStep] = useState<Step>("details");

  // Step 1 — basics
  const [name, setName] = useState("");
  const [plantingYear, setPlantingYear] = useState<string>("");

  // Step 2 — boundary
  const [polygon, setPolygon] = useState<LatLng[]>([]);

  // Step 3 — row inputs
  const [rowDirection, setRowDirection] = useState("0");
  const [rowWidth, setRowWidth] = useState("2.5");
  const [rowOffset, setRowOffset] = useState("0");
  const [rowsCount, setRowsCount] = useState("10");
  const [rowStartNumber, setRowStartNumber] = useState("1");
  const [rowNumberAscending, setRowNumberAscending] = useState(true);
  const [vineSpacing, setVineSpacing] = useState("1.0");
  const [vineCountOverride, setVineCountOverride] = useState("");
  const [rowLengthOverride, setRowLengthOverride] = useState("");
  const [intermediatePostSpacing, setIntermediatePostSpacing] = useState("");
  const [flowPerEmitter, setFlowPerEmitter] = useState("");
  const [emitterSpacing, setEmitterSpacing] = useState("");

  // Step 4
  const [showRawPayload, setShowRawPayload] = useState(false);

  // Generated rows
  const generated: GeneratedRow[] = useMemo(() => {
    const dir = Number(rowDirection);
    const w = Number(rowWidth);
    const off = Number(rowOffset);
    const c = Number(rowsCount);
    const start = Number(rowStartNumber) || 1;
    if (polygon.length < 3 || !Number.isFinite(dir) || !Number.isFinite(w) || w <= 0 || !Number.isFinite(c) || c <= 0) {
      return [];
    }
    return generateRows({
      polygonPoints: polygon,
      rowDirectionDeg: dir,
      rowWidthM: w,
      rowOffsetM: Number.isFinite(off) ? off : 0,
      count: c,
      rowStartNumber: start,
      rowNumberAscending,
    });
  }, [polygon, rowDirection, rowWidth, rowOffset, rowsCount, rowStartNumber, rowNumberAscending]);

  // Derived metrics
  const areaHa = useMemo(() => polygonAreaHectares(polygon), [polygon]);
  const totalRowLengthM = useMemo(
    () =>
      generated.reduce(
        (s, r) =>
          s +
          haversineMeters(
            { lat: r.startPoint.latitude, lng: r.startPoint.longitude },
            { lat: r.endPoint.latitude, lng: r.endPoint.longitude },
          ),
        0,
      ),
    [generated],
  );
  const effectiveTotalRowLength =
    Number(rowLengthOverride) > 0 ? Number(rowLengthOverride) : totalRowLengthM;

  const estimatedVineCount =
    Number(vineSpacing) > 0 && effectiveTotalRowLength > 0
      ? Math.floor(effectiveTotalRowLength / Number(vineSpacing))
      : null;
  const effectiveVineCount =
    Number(vineCountOverride) > 0 ? Math.round(Number(vineCountOverride)) : estimatedVineCount;

  const intermediatePostCount =
    Number(intermediatePostSpacing) > 0 && effectiveTotalRowLength > 0
      ? Math.max(
          0,
          Math.floor(effectiveTotalRowLength / Number(intermediatePostSpacing)) - 2 * generated.length,
        )
      : null;

  const totalEmitters =
    Number(emitterSpacing) > 0 && effectiveTotalRowLength > 0
      ? Math.floor(effectiveTotalRowLength / Number(emitterSpacing))
      : null;

  const mmPerHr =
    Number(emitterSpacing) > 0 && Number(flowPerEmitter) > 0 && Number(rowWidth) > 0
      ? ((10000 / (Number(rowWidth) * Number(emitterSpacing))) * Number(flowPerEmitter)) / 1_000_000 * 100
      : null;

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!selectedVineyardId) errors.push("No vineyard selected.");
    if (!name.trim()) errors.push("Paddock name is required.");
    if (polygon.length < 3) errors.push("Boundary needs at least 3 points.");
    const dir = Number(rowDirection);
    if (!Number.isFinite(dir) || dir < 0 || dir > 360) errors.push("Row direction must be 0–360°.");
    if (!(Number(rowWidth) > 0)) errors.push("Row width must be > 0.");
    if (!(Number(vineSpacing) > 0)) errors.push("Vine spacing must be > 0.");
    if (!(Number(rowsCount) > 0)) errors.push("Row count must be > 0.");
    if (generated.length === 0 && polygon.length >= 3) errors.push("No rows generated — check direction/width/offset.");
    return errors;
  }, [selectedVineyardId, name, polygon, rowDirection, rowWidth, vineSpacing, rowsCount, generated.length]);

  const isValid = validation.length === 0;

  // Build payload (per spec §8 / docs §7)
  const payload = useMemo(() => {
    const base: Record<string, any> = {
      id: crypto.randomUUID(),
      vineyard_id: selectedVineyardId,
      name: name.trim(),
      polygon_points: toCanonicalPolygon(polygon),
      rows: generated,
      row_direction: Number(rowDirection),
      row_width: Number(rowWidth),
      row_offset: Number(rowOffset) || 0,
      vine_spacing: Number(vineSpacing),
      variety_allocations: [],
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
      client_updated_at: new Date().toISOString(),
    };
    const optional: Record<string, any> = {};
    if (Number(vineCountOverride) > 0) optional.vine_count_override = Number(vineCountOverride);
    if (Number(rowLengthOverride) > 0) optional.row_length_override = Number(rowLengthOverride);
    if (Number(flowPerEmitter) > 0) optional.flow_per_emitter = Number(flowPerEmitter);
    if (Number(emitterSpacing) > 0) optional.emitter_spacing = Number(emitterSpacing);
    if (Number(intermediatePostSpacing) > 0) optional.intermediate_post_spacing = Number(intermediatePostSpacing);
    if (plantingYear.trim() && Number(plantingYear) > 0) optional.planting_year = Number(plantingYear);
    return { ...base, ...optional };
  }, [
    selectedVineyardId, name, polygon, generated, rowDirection, rowWidth, rowOffset,
    vineSpacing, user?.id, vineCountOverride, rowLengthOverride, flowPerEmitter,
    emitterSpacing, intermediatePostSpacing, plantingYear,
  ]);

  // Strip server-managed fields before exposing payload (defensive — these
  // are not added by the builder, but we filter to make the contract explicit).
  const exportablePayload = useMemo(() => {
    const omit = new Set(["created_at", "updated_at", "deleted_at", "sync_version"]);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload)) if (!omit.has(k)) out[k] = v;
    return out;
  }, [payload]);

  // Soft warnings (non-blocking)
  const warnings = useMemo(() => {
    const w: string[] = [];
    const requestedRows = Number(rowsCount);
    if (areaHa > 0 && areaHa < 0.05) w.push(`Area is very small (${areaHa.toFixed(3)} ha) — verify the boundary.`);
    if (areaHa > 50) w.push(`Area is very large (${areaHa.toFixed(1)} ha) — verify the boundary.`);
    if (Number.isFinite(requestedRows) && requestedRows > 0 && generated.length > 0 && generated.length < requestedRows) {
      w.push(`Generated ${generated.length} rows but ${requestedRows} were requested — some rows fall outside the polygon.`);
    }
    if (generated.length > 0 && totalRowLengthM < 1) {
      w.push("Total row length is near zero — check row direction and boundary.");
    }
    if (polygon.length >= 4 && polygonHasSelfIntersection(polygon)) {
      w.push("Polygon appears to self-intersect — boundary edges cross.");
    }
    if (!intermediatePostSpacing) w.push("Intermediate post spacing not provided — post count won't be derived.");
    if (!flowPerEmitter || !emitterSpacing) w.push("Irrigation inputs missing (flow per emitter / emitter spacing) — irrigation rate won't be derived.");
    return w;
  }, [areaHa, rowsCount, generated.length, totalRowLengthM, polygon, intermediatePostSpacing, flowPerEmitter, emitterSpacing]);

  const copyPayloadToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportablePayload, null, 2));
      toast({ title: "Payload copied", description: "Insert payload JSON copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard not available in this context.", variant: "destructive" });
    }
  };

  // Permission gate
  if (!canEdit) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/setup/paddocks")}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Not authorised</AlertTitle>
          <AlertDescription>
            Only owners and managers can create paddocks.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const onSavePressed = () => {
    if (!isValid) {
      toast({ title: "Cannot save", description: validation[0], variant: "destructive" });
      return;
    }
    if (!ENABLE_PRODUCTION_SAVE) {
      if (import.meta.env.DEV) {
        console.warn("[NewPaddock] Production save is DISABLED (ENABLE_PRODUCTION_SAVE = false).");
        console.log("[NewPaddock] Prepared insert payload:", payload);
      }
      toast({
        title: "Test mode — save disabled",
        description: "Payload logged to console. Production save is gated by a test flag pending iOS round-trip approval.",
      });
      return;
    }
    // Production save path is not enabled in this scaffold.
    toast({ title: "Save not implemented", variant: "destructive" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/setup/paddocks")} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Paddocks
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">New paddock</h1>
        </div>
        <Badge variant="outline" className="border-warning/50 text-warning-foreground/90 bg-warning/10">
          Test mode — save disabled
        </Badge>
      </div>

      <StepNav step={step} setStep={setStep} hasPolygon={polygon.length >= 3} hasRows={generated.length > 0} />

      {step === "details" && (
        <Card>
          <CardHeader>
            <CardTitle>Basic details</CardTitle>
            <CardDescription>Give the paddock a name. Planting year is optional.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="planting_year">Planting year</Label>
              <Input id="planting_year" type="number" min={1900} max={2100}
                value={plantingYear} onChange={(e) => setPlantingYear(e.target.value)} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button onClick={() => setStep("boundary")} disabled={!name.trim()}>Next: draw boundary</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "boundary" && (
        <BoundaryStep
          polygon={polygon}
          setPolygon={setPolygon}
          onBack={() => setStep("details")}
          onNext={() => setStep("rows")}
        />
      )}

      {step === "rows" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="overflow-hidden">
            <div className="h-[520px]">
              <PreviewMap polygon={polygon} rows={generated} />
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Row setup</CardTitle>
              <CardDescription>
                Geometry is generated using the same algorithm as the iOS app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <NumberField label="Row direction (°)" value={rowDirection} onChange={setRowDirection} step="1" />
              <NumberField label="Row width (m)" value={rowWidth} onChange={setRowWidth} step="0.1" />
              <NumberField label="Row offset (m)" value={rowOffset} onChange={setRowOffset} step="0.1" />
              <NumberField label="Rows count" value={rowsCount} onChange={setRowsCount} step="1" />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Start row #" value={rowStartNumber} onChange={setRowStartNumber} step="1" />
                <div className="space-y-2">
                  <Label>Ascending</Label>
                  <div className="flex h-10 items-center">
                    <Switch checked={rowNumberAscending} onCheckedChange={setRowNumberAscending} />
                  </div>
                </div>
              </div>
              <NumberField label="Vine spacing (m)" value={vineSpacing} onChange={setVineSpacing} step="0.1" />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Optional fields</summary>
                <div className="mt-3 space-y-3">
                  <NumberField label="Vine count override" value={vineCountOverride} onChange={setVineCountOverride} step="1" />
                  <NumberField label="Row length override (m)" value={rowLengthOverride} onChange={setRowLengthOverride} step="1" />
                  <NumberField label="Intermediate post spacing (m)" value={intermediatePostSpacing} onChange={setIntermediatePostSpacing} step="0.1" />
                  <NumberField label="Flow per emitter (L/hr)" value={flowPerEmitter} onChange={setFlowPerEmitter} step="0.1" />
                  <NumberField label="Emitter spacing (m)" value={emitterSpacing} onChange={setEmitterSpacing} step="0.1" />
                </div>
              </details>

              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                <Metric label="Area" value={`${fmt(areaHa, 2)} ha`} />
                <Metric label="Rows generated" value={fmt(generated.length, 0)} />
                <Metric label="Total row length" value={`${fmt(totalRowLengthM, 0)} m`} />
                {effectiveVineCount != null && <Metric label="Estimated vines" value={fmt(effectiveVineCount, 0)} />}
                {intermediatePostCount != null && <Metric label="Intermediate posts" value={fmt(intermediatePostCount, 0)} />}
                {totalEmitters != null && <Metric label="Emitters" value={fmt(totalEmitters, 0)} />}
                {mmPerHr != null && <Metric label="Irrigation" value={`${fmt(mmPerHr, 2)} mm/hr`} />}
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button variant="ghost" onClick={() => setStep("boundary")}>Back</Button>
                <Button onClick={() => setStep("review")} disabled={generated.length === 0}>Review</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "review" && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>
              Confirm the paddock details. This will write to the production database when enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {validation.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Cannot save yet</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {validation.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <SummaryRow label="Name" value={name} />
              <SummaryRow label="Vineyard" value={selectedVineyardId ?? "—"} />
              <SummaryRow label="Boundary points" value={String(polygon.length)} />
              <SummaryRow label="Rows" value={String(generated.length)} />
              <SummaryRow label="Area" value={`${fmt(areaHa, 2)} ha`} />
              <SummaryRow label="Total row length" value={`${fmt(totalRowLengthM, 0)} m`} />
              <SummaryRow label="Row direction" value={`${rowDirection}°`} />
              <SummaryRow label="Row width" value={`${rowWidth} m`} />
              <SummaryRow label="Vine spacing" value={`${vineSpacing} m`} />
              {plantingYear && <SummaryRow label="Planting year" value={plantingYear} />}
              {effectiveVineCount != null && <SummaryRow label="Estimated vines" value={fmt(effectiveVineCount, 0)} />}
            </div>

            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Production write — handle with care</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <div>Paddock creation affects maps, rows, irrigation, yield and field records. Test carefully before saving to production.</div>
                <div className="opacity-90">Recommended: verify this payload in a test vineyard before enabling production save.</div>
              </AlertDescription>
            </Alert>

            {(!intermediatePostSpacing || !flowPerEmitter || !emitterSpacing) && (
              <Alert>
                <AlertTitle>Optional fields missing</AlertTitle>
                <AlertDescription className="text-xs">
                  {!intermediatePostSpacing && <div>• Intermediate post spacing not set — post count won't be derived.</div>}
                  {(!flowPerEmitter || !emitterSpacing) && <div>• Emitter spacing / flow not set — irrigation rate won't be derived.</div>}
                </AlertDescription>
              </Alert>
            )}

            {warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warnings ({warnings.length})</AlertTitle>
                <AlertDescription className="text-xs">
                  <ul className="list-disc pl-5 space-y-0.5">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setShowRawPayload((v) => !v)}
                >
                  {showRawPayload ? "Hide" : "Show"} raw payload
                </button>
                <Button type="button" variant="outline" size="sm" onClick={copyPayloadToClipboard} className="gap-1">
                  <Copy className="h-3.5 w-3.5" /> Copy payload
                </Button>
              </div>
              {showRawPayload && (
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-tight">
                  {JSON.stringify(exportablePayload, null, 2)}
                </pre>
              )}
            </div>

            <Alert variant="destructive">
              <AlertTitle>Production save is gated</AlertTitle>
              <AlertDescription className="text-xs">
                The Save button is disabled by a test flag (<code>ENABLE_PRODUCTION_SAVE</code>) until the
                payload and row-generation logic are confirmed to round-trip cleanly with iOS. Pressing
                Save in test mode logs the payload to the console only.
              </AlertDescription>
            </Alert>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("rows")}>Back</Button>
              <Button
                onClick={onSavePressed}
                disabled={!ENABLE_PRODUCTION_SAVE || !isValid}
                title={!ENABLE_PRODUCTION_SAVE ? "Save disabled — test flag off" : ""}
              >
                {ENABLE_PRODUCTION_SAVE ? "Save paddock" : "Save paddock (test mode — disabled)"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function StepNav({
  step, setStep, hasPolygon, hasRows,
}: { step: Step; setStep: (s: Step) => void; hasPolygon: boolean; hasRows: boolean }) {
  const items: { id: Step; label: string; enabled: boolean }[] = [
    { id: "details", label: "1. Details", enabled: true },
    { id: "boundary", label: "2. Boundary", enabled: true },
    { id: "rows", label: "3. Rows", enabled: hasPolygon },
    { id: "review", label: "4. Review", enabled: hasPolygon && hasRows },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          disabled={!it.enabled}
          onClick={() => setStep(it.id)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            step === it.id
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-50"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label, value, onChange, step,
}: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border bg-card p-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Boundary draw step (Leaflet)
// ────────────────────────────────────────────────────────────────────────────

function BoundaryStep({
  polygon, setPolygon, onBack, onNext,
}: {
  polygon: LatLng[];
  setPolygon: (p: LatLng[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="h-[520px]">
          <DrawMap polygon={polygon} setPolygon={setPolygon} />
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Draw boundary
          </CardTitle>
          <CardDescription>
            Click the map to drop boundary points. Add at least 3 points to form
            a polygon. The polygon is stored open (first point is not repeated).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Metric label="Points" value={String(polygon.length)} />
          <Metric label="Area" value={`${fmt(polygonAreaHectares(polygon), 2)} ha`} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setPolygon(polygon.slice(0, -1))} disabled={!polygon.length}>
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setPolygon([])} disabled={!polygon.length}>
              <RotateCcw className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={onBack}>Back</Button>
            <Button onClick={onNext} disabled={polygon.length < 3}>Next: rows</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DrawMap({ polygon, setPolygon }: { polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  return (
    <MapContainer center={[-34.5, 138.7]} zoom={16} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ClickHandler polygon={polygon} setPolygon={setPolygon} />
      {polygon.length >= 3 && (
        <Polygon
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: "hsl(145 42% 28%)", weight: 2.5, fillOpacity: 0.25 }}
        />
      )}
      {polygon.length === 2 && (
        <Polyline
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: "hsl(145 42% 28%)", weight: 2 }}
        />
      )}
      {polygon.map((p, i) => (
        <Marker
          key={i}
          position={[p.lat, p.lng]}
          icon={vertexIcon(i + 1)}
        />
      ))}
    </MapContainer>
  );
}

function ClickHandler({ polygon, setPolygon }: { polygon: LatLng[]; setPolygon: (p: LatLng[]) => void }) {
  useMapEvents({
    click(e) {
      setPolygon([...polygon, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    },
  });
  return null;
}

function vertexIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:hsl(145 42% 28%);color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 2px rgba(0,0,0,.3);transform:translate(-50%,-50%)">${n}</div>`,
    iconSize: [0, 0],
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Preview map (rows + polygon, fits bounds)
// ────────────────────────────────────────────────────────────────────────────

function PreviewMap({ polygon, rows }: { polygon: LatLng[]; rows: GeneratedRow[] }) {
  const center = polygonCentroid(polygon) ?? { lat: -34.5, lng: 138.7 };
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={17} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FitToPolygon polygon={polygon} />
      {polygon.length >= 3 && (
        <Polygon
          positions={polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: "hsl(145 42% 28%)", weight: 2.5, fillOpacity: 0.2 }}
        />
      )}
      {rows.map((r, i) => (
        <Polyline
          key={r.id}
          positions={[
            [r.startPoint.latitude, r.startPoint.longitude],
            [r.endPoint.latitude, r.endPoint.longitude],
          ]}
          pathOptions={{ color: "#34C759", weight: 1.5, opacity: 0.9 }}
        />
      ))}
      {rows.length > 0 && (
        <Marker
          position={[rows[0].startPoint.latitude, rows[0].startPoint.longitude]}
          icon={rowChip(rows[0].number)}
          interactive={false}
        />
      )}
      {rows.length > 1 && (
        <Marker
          position={[rows[rows.length - 1].startPoint.latitude, rows[rows.length - 1].startPoint.longitude]}
          icon={rowChip(rows[rows.length - 1].number)}
          interactive={false}
        />
      )}
    </MapContainer>
  );
}

function FitToPolygon({ polygon }: { polygon: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (polygon.length < 2) return;
    const b = L.latLngBounds(polygon.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(b.pad(0.2), { padding: [16, 16] });
  }, [polygon, map]);
  return null;
}

function rowChip(n: number) {
  return L.divIcon({
    className: "",
    html: `<div class="vt-row-chip">${n}</div>`,
    iconSize: [0, 0],
  });
}
