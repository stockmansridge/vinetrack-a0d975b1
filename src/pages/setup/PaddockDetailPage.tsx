// Full paddock detail / edit page.
//
// Owner/manager: edit boundary, rows, varieties, irrigation, trellis,
// soil and danger-zone hard-delete.
// Other roles: read-only view (same sections, edit buttons hidden).
//
// Uses the same canonical paddock payload shape as the New Paddock
// wizard so writes round-trip cleanly to iOS.
//
// iOS parity reference: stockmansridge/rork-vinetrackv263 — paddock
// fields: name, polygon_points, rows, row_direction, row_width,
// row_offset, vine_spacing, variety_allocations, vine_count_override,
// row_length_override, flow_per_emitter, emitter_spacing,
// intermediate_post_spacing, planting_year.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, AlertTriangle, Trash2, Pencil, Info } from "lucide-react";

import { fetchOne } from "@/lib/queries";
import {
  fetchLinkedRecordCounts,
  hardDeletePaddock,
  updatePaddock,
  type LinkedCounts,
} from "@/lib/paddockMutations";
import {
  deriveMetrics,
  parsePolygonPoints,
  parseRows,
  polygonAreaHectares,
  polygonCentroid,
} from "@/lib/paddockGeometry";
import {
  generateRows,
  toCanonicalPolygon,
  type GeneratedRow,
  type LatLng,
} from "@/lib/paddockRowGeneration";

import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import BoundaryDrawMap from "@/components/paddocks/BoundaryDrawMap";
import VarietyAllocationEditor, {
  deserialiseAllocations,
  isAllocationsValid,
  serialiseAllocations,
  type VarietyAllocationRow,
} from "@/components/varieties/VarietyAllocationEditor";
import SoilProfileSection from "@/components/soil/SoilProfileSection";

const fmt = (n: any, d = 2) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

export default function PaddockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const { data: paddock, isLoading, error, refetch } = useQuery({
    queryKey: ["detail", "paddocks", id],
    enabled: !!id,
    queryFn: () => fetchOne("paddocks", id!),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <BackLink />
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (error || !paddock) {
    return (
      <div className="p-6 space-y-4">
        <BackLink />
        <Alert variant="destructive">
          <AlertTitle>Not found</AlertTitle>
          <AlertDescription>{(error as Error)?.message ?? "Paddock not found."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PaddockEditor
      paddock={paddock}
      canEdit={canEdit}
      vineyardId={selectedVineyardId}
      userId={user?.id ?? null}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ["detail", "paddocks", id] });
        qc.invalidateQueries({ queryKey: ["list", "paddocks"] });
        qc.invalidateQueries({ queryKey: ["paddocks"] });
        refetch();
      }}
      onDeleted={() => navigate("/setup/paddocks")}
    />
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/setup/paddocks">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to paddocks
      </Link>
    </Button>
  );
}

interface EditorProps {
  paddock: any;
  canEdit: boolean;
  vineyardId: string | null;
  userId: string | null;
  onSaved: () => void;
  onDeleted: () => void;
}

function PaddockEditor({ paddock, canEdit, vineyardId, userId, onSaved, onDeleted }: EditorProps) {
  const metrics = useMemo(() => deriveMetrics(paddock), [paddock]);
  const initialPolygon = useMemo(() => parsePolygonPoints(paddock.polygon_points), [paddock]);
  const initialRows = useMemo(() => parseRows(paddock.rows), [paddock]);

  // Overview
  const [name, setName] = useState<string>(paddock.name ?? "");
  const [plantingYear, setPlantingYear] = useState<string>(
    paddock.planting_year != null ? String(paddock.planting_year) : "",
  );

  // Boundary
  const [polygon, setPolygon] = useState<LatLng[]>(initialPolygon);

  // Rows / geometry
  const [rowDirection, setRowDirection] = useState<string>(String(paddock.row_direction ?? 0));
  const [rowWidth, setRowWidth] = useState<string>(String(paddock.row_width ?? 2.5));
  const [rowOffset, setRowOffset] = useState<string>(String(paddock.row_offset ?? 0));
  const [rowsCount, setRowsCount] = useState<string>(String(initialRows.length || 10));
  const [rowStartNumber, setRowStartNumber] = useState<string>(String((initialRows[0] as any)?.number ?? 1));
  const [rowNumberAscending, setRowNumberAscending] = useState<boolean>(() => {
    if (initialRows.length < 2) return true;
    const a = Number((initialRows[0] as any)?.number ?? 0);
    const b = Number((initialRows[1] as any)?.number ?? 0);
    return b >= a;
  });
  const [vineSpacing, setVineSpacing] = useState<string>(String(paddock.vine_spacing ?? 1.0));
  const [vineCountOverride, setVineCountOverride] = useState<string>(
    paddock.vine_count_override != null ? String(paddock.vine_count_override) : "",
  );
  const [rowLengthOverride, setRowLengthOverride] = useState<string>(
    paddock.row_length_override != null ? String(paddock.row_length_override) : "",
  );

  // Varieties
  const [varietyAllocations, setVarietyAllocations] = useState<VarietyAllocationRow[]>(
    deserialiseAllocations(paddock.variety_allocations),
  );

  // Trellis
  const [intermediatePostSpacing, setIntermediatePostSpacing] = useState<string>(
    paddock.intermediate_post_spacing != null ? String(paddock.intermediate_post_spacing) : "",
  );

  // Irrigation
  const [flowPerEmitter, setFlowPerEmitter] = useState<string>(
    paddock.flow_per_emitter != null ? String(paddock.flow_per_emitter) : "",
  );
  const [emitterSpacing, setEmitterSpacing] = useState<string>(
    paddock.emitter_spacing != null ? String(paddock.emitter_spacing) : "",
  );

  const [saving, setSaving] = useState(false);

  // Live derived rows (used by Rows tab preview).
  const generatedRows: GeneratedRow[] = useMemo(() => {
    const dir = Number(rowDirection);
    const w = Number(rowWidth);
    const off = Number(rowOffset) || 0;
    const c = Number(rowsCount);
    const start = Number(rowStartNumber) || 1;
    if (polygon.length < 3 || !Number.isFinite(dir) || !(w > 0) || !(c > 0)) return [];
    return generateRows({
      polygonPoints: polygon,
      rowDirectionDeg: dir,
      rowWidthM: w,
      rowOffsetM: off,
      count: c,
      rowStartNumber: start,
      rowNumberAscending,
    });
  }, [polygon, rowDirection, rowWidth, rowOffset, rowsCount, rowStartNumber, rowNumberAscending]);

  const liveAreaHa = useMemo(() => polygonAreaHectares(polygon), [polygon]);

  // Irrigation derived
  const rwNum = Number(rowWidth);
  const esNum = Number(emitterSpacing);
  const feNum = Number(flowPerEmitter);
  const emittersPerHa = rwNum > 0 && esNum > 0 ? 10000 / (rwNum * esNum) : null;
  const litresPerHaHr = emittersPerHa != null && feNum > 0 ? emittersPerHa * feNum : null;
  const mmPerHr = litresPerHaHr != null ? (litresPerHaHr / 1_000_000) * 100 : null;




  const onSaveOverview = async () => {
    if (!name.trim()) return toast({ title: "Name required", variant: "destructive" });
    await save({
      name: name.trim(),
      planting_year: plantingYear.trim() && Number(plantingYear) > 0 ? Number(plantingYear) : null,
    });
  };

  const onSaveBoundary = async () => {
    if (polygon.length < 3) return toast({ title: "Boundary needs ≥ 3 points", variant: "destructive" });
    // Regenerate rows against the new boundary using current row params.
    await save({
      polygon_points: toCanonicalPolygon(polygon),
      rows: generatedRows,
    });
  };

  const onSaveRows = async () => {
    if (generatedRows.length === 0) {
      return toast({ title: "No rows generated", description: "Check direction/width/count.", variant: "destructive" });
    }
    await save({
      rows: generatedRows,
      row_direction: Number(rowDirection),
      row_width: Number(rowWidth),
      row_offset: Number(rowOffset) || 0,
      vine_spacing: Number(vineSpacing),
      vine_count_override: vineCountOverride && Number(vineCountOverride) > 0 ? Number(vineCountOverride) : null,
      row_length_override: rowLengthOverride && Number(rowLengthOverride) > 0 ? Number(rowLengthOverride) : null,
    });
  };

  const onSaveVarieties = async () => {
    if (varietyAllocations.length > 0 && !isAllocationsValid(varietyAllocations)) {
      return toast({ title: "Allocations must total 100%", variant: "destructive" });
    }
    await save({ variety_allocations: serialiseAllocations(varietyAllocations) });
  };

  const onSaveTrellis = async () => {
    await save({
      intermediate_post_spacing:
        intermediatePostSpacing && Number(intermediatePostSpacing) > 0
          ? Number(intermediatePostSpacing)
          : null,
    });
  };

  const onSaveIrrigation = async () => {
    await save({
      flow_per_emitter: flowPerEmitter && Number(flowPerEmitter) > 0 ? Number(flowPerEmitter) : null,
      emitter_spacing: emitterSpacing && Number(emitterSpacing) > 0 ? Number(emitterSpacing) : null,
    });
  };

  const save = async (patch: Record<string, any>) => {
    setSaving(true);
    try {
      await updatePaddock(paddock.id, { ...patch, updated_by: userId });
      toast({ title: "Saved", description: paddock.name ?? "Paddock updated" });
      onSaved();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <BackLink />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{paddock.name ?? "Paddock"}</h1>
          <p className="text-sm text-muted-foreground">
            {fmt(metrics.areaHa, 2)} ha · {metrics.rowCount} rows
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only</Badge>}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="boundary">Boundary</TabsTrigger>
          <TabsTrigger value="rows">Rows</TabsTrigger>
          <TabsTrigger value="varieties">Varieties</TabsTrigger>
          <TabsTrigger value="trellis">Trellis</TabsTrigger>
          <TabsTrigger value="irrigation">Irrigation</TabsTrigger>
          <TabsTrigger value="soil">Soil</TabsTrigger>
          {canEdit && <TabsTrigger value="danger" className="text-destructive">Danger Zone</TabsTrigger>}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>Basic paddock details.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={120} />
              </Field>
              <Field label="Planting year">
                <Input
                  type="number"
                  min={1900}
                  max={2100}
                  value={plantingYear}
                  onChange={(e) => setPlantingYear(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <ReadOnly label="Area" value={`${fmt(metrics.areaHa, 3)} ha`} />
              <ReadOnly label="Total row length" value={`${fmt(metrics.totalRowLengthM, 0)} m`} />
              {canEdit && (
                <div className="sm:col-span-2 flex justify-end">
                  <Button onClick={onSaveOverview} disabled={saving} className="gap-1">
                    <Save className="h-4 w-4" /> Save overview
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Boundary */}
        <TabsContent value="boundary">
          <Card>
            <CardHeader>
              <CardTitle>Boundary</CardTitle>
              <CardDescription>
                Drag a vertex to move it, tap a midpoint handle to insert, tap a vertex (with ≥ 4 pts) to remove.
                {canEdit ? " Saving regenerates rows against the new boundary." : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-[520px] rounded-md overflow-hidden border">
                <BoundaryDrawMap
                  polygon={polygon}
                  setPolygon={canEdit ? setPolygon : undefined}
                  readonly={!canEdit}
                  excludePaddockId={paddock.id}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="text-muted-foreground">
                  Points: <span className="font-medium text-foreground">{polygon.length}</span>
                  {" · "}Area: <span className="font-medium text-foreground">{fmt(liveAreaHa, 3)} ha</span>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPolygon(initialPolygon)} disabled={saving}>
                      Reset
                    </Button>
                    <Button onClick={onSaveBoundary} disabled={saving || polygon.length < 3} className="gap-1">
                      <Save className="h-4 w-4" /> Save boundary
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rows */}
        <TabsContent value="rows">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Card className="overflow-hidden">
              <div className="h-[520px]">
                <BoundaryDrawMap
                  polygon={polygon}
                  readonly
                  rows={generatedRows}
                  excludePaddockId={paddock.id}
                />
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Row setup</CardTitle>
                <CardDescription>Same generator as iOS &amp; New Paddock.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <NumField label="Row direction (°)" value={rowDirection} onChange={setRowDirection} step="0.5" disabled={!canEdit} />
                <NumField label="Row width (m)" value={rowWidth} onChange={setRowWidth} step="0.1" disabled={!canEdit} />
                <NumField label="Row offset (m)" value={rowOffset} onChange={setRowOffset} step="0.1" disabled={!canEdit} />
                <NumField label="Rows count" value={rowsCount} onChange={setRowsCount} step="1" disabled={!canEdit} />
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Start row #" value={rowStartNumber} onChange={setRowStartNumber} step="1" disabled={!canEdit} />
                  <div className="space-y-2">
                    <Label className="text-xs">Ascending</Label>
                    <div className="flex h-10 items-center">
                      <Switch checked={rowNumberAscending} onCheckedChange={setRowNumberAscending} disabled={!canEdit} />
                    </div>
                  </div>
                </div>
                <NumField label="Vine spacing (m)" value={vineSpacing} onChange={setVineSpacing} step="0.1" disabled={!canEdit} />
                <NumField label="Vine count override" value={vineCountOverride} onChange={setVineCountOverride} step="1" disabled={!canEdit} />
                <NumField label="Row length override (m)" value={rowLengthOverride} onChange={setRowLengthOverride} step="1" disabled={!canEdit} />
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                  <Metric label="Rows generated" value={String(generatedRows.length)} />
                  <Metric label="Total row length" value={`${fmt(metrics.totalRowLengthM, 0)} m`} />
                </div>
                {canEdit && (
                  <div className="flex justify-end pt-2">
                    <Button onClick={onSaveRows} disabled={saving || generatedRows.length === 0} className="gap-1">
                      <Save className="h-4 w-4" /> Save rows
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Varieties */}
        <TabsContent value="varieties">
          <Card>
            <CardHeader>
              <CardTitle>Variety allocations</CardTitle>
              <CardDescription>Percentages must total 100%. Custom varieties save to this vineyard.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit ? (
                <>
                  <VarietyAllocationEditor
                    vineyardId={vineyardId}
                    value={varietyAllocations}
                    onChange={setVarietyAllocations}
                  />
                  <div className="flex justify-end">
                    <Button onClick={onSaveVarieties} disabled={saving} className="gap-1">
                      <Save className="h-4 w-4" /> Save varieties
                    </Button>
                  </div>
                </>
              ) : varietyAllocations.length === 0 ? (
                <div className="text-sm text-muted-foreground">No varieties assigned.</div>
              ) : (
                <ul className="text-sm space-y-1">
                  {varietyAllocations.map((a) => (
                    <li key={a.id} className="flex justify-between border-b py-1">
                      <span>{a.name || a.varietyKey || "—"}</span>
                      <span className="text-muted-foreground">{a.percent}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trellis */}
        <TabsContent value="trellis">
          <Card>
            <CardHeader>
              <CardTitle>Trellis</CardTitle>
              <CardDescription>Intermediate post spacing is the trellis field currently shared with iOS.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Intermediate post spacing (m)">
                <Input
                  type="number"
                  step="0.1"
                  value={intermediatePostSpacing}
                  onChange={(e) => setIntermediatePostSpacing(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <ReadOnly label="Intermediate posts (est.)" value={fmt(metrics.intermediatePostCount, 0)} />
              <div className="sm:col-span-2">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Additional trellis fields</AlertTitle>
                  <AlertDescription className="text-xs">
                    Trellis type, end-post and wire configuration are not yet in the shared paddock schema.
                    Backend changes are required before they can be edited here.
                  </AlertDescription>
                </Alert>
              </div>
              {canEdit && (
                <div className="sm:col-span-2 flex justify-end">
                  <Button onClick={onSaveTrellis} disabled={saving} className="gap-1">
                    <Save className="h-4 w-4" /> Save trellis
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Irrigation */}
        <TabsContent value="irrigation">
          <Card>
            <CardHeader>
              <CardTitle>Irrigation</CardTitle>
              <CardDescription>
                Application rate is derived from row width, emitter spacing and flow per emitter.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Flow per emitter (L/hr)">
                <Input type="number" step="0.1" value={flowPerEmitter} onChange={(e) => setFlowPerEmitter(e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Emitter spacing (m)">
                <Input type="number" step="0.1" value={emitterSpacing} onChange={(e) => setEmitterSpacing(e.target.value)} disabled={!canEdit} />
              </Field>
              <ReadOnly label="Row width" value={paddock.row_width ? `${paddock.row_width} m` : "—"} />
              <ReadOnly label="Emitters (est.)" value={fmt(metrics.emitterCount, 0)} />
              <ReadOnly label="L / ha / hr" value={litresPerHaHr != null ? fmt(litresPerHaHr, 0) : "—"} />
              <ReadOnly label="mm / hr" value={mmPerHr != null ? fmt(mmPerHr, 3) : "—"} />
              {canEdit && (
                <div className="sm:col-span-2 flex justify-end">
                  <Button onClick={onSaveIrrigation} disabled={saving} className="gap-1">
                    <Save className="h-4 w-4" /> Save irrigation
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Soil */}
        <TabsContent value="soil">
          <Card>
            <CardHeader>
              <CardTitle>Soil profile</CardTitle>
              <CardDescription>Linked to the shared soil profile / NSW SEED lookup.</CardDescription>
            </CardHeader>
            <CardContent>
              <SoilProfileSection
                paddockId={paddock.id}
                paddockName={paddock.name}
                vineyardId={vineyardId ?? paddock.vineyard_id ?? null}
                latitude={polygonCentroid(parsePolygonPoints(paddock.polygon_points))?.lat}
                longitude={polygonCentroid(parsePolygonPoints(paddock.polygon_points))?.lng}
              />

            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger zone */}
        {canEdit && (
          <TabsContent value="danger">
            <DangerZone paddock={paddock} onDeleted={onDeleted} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="h-10 px-3 flex items-center rounded-md border bg-muted/30 text-sm">{value}</div>
    </div>
  );
}

function NumField({
  label, value, onChange, step, disabled,
}: { label: string; value: string; onChange: (v: string) => void; step?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9" />
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

// ────────────────────────────────────────────────────────────────────────────
// Danger zone — hard delete with linked-record safety check.
// ────────────────────────────────────────────────────────────────────────────

function DangerZone({ paddock, onDeleted }: { paddock: any; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [counts, setCounts] = useState<LinkedCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingCounts(true);
    setConfirmName("");
    fetchLinkedRecordCounts(paddock.id)
      .then(setCounts)
      .finally(() => setLoadingCounts(false));
  }, [open, paddock.id]);

  const hasLinked = !!counts && counts.total > 0;
  const nameMatches = confirmName.trim() === (paddock.name ?? "").trim() && confirmName.length > 0;
  const canDelete = !loadingCounts && nameMatches && !deleting;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await hardDeletePaddock(paddock.id);
      toast({ title: "Paddock deleted", description: paddock.name });
      setOpen(false);
      onDeleted();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" /> Danger zone
        </CardTitle>
        <CardDescription>
          Permanently deletes this paddock. Use only for test paddocks or paddocks created in error.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This action cannot be undone</AlertTitle>
          <AlertDescription className="text-xs">
            Deleted paddocks are removed from both Lovable and iOS. For active blocks with historical
            data, prefer archiving (coming soon) instead of hard delete.
          </AlertDescription>
        </Alert>
        <Button variant="destructive" className="gap-1" onClick={() => setOpen(true)}>
          <Trash2 className="h-4 w-4" /> Delete paddock permanently
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete paddock permanently?</DialogTitle>
            <DialogDescription>
              This will permanently delete the paddock/block. This action cannot be undone. Only delete
              paddocks created in error or test paddocks that are not needed.
            </DialogDescription>
          </DialogHeader>

          {loadingCounts && <div className="text-sm text-muted-foreground">Checking linked records…</div>}

          {counts && (
            <div className="space-y-2">
              {hasLinked ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Linked records found ({counts.total})</AlertTitle>
                  <AlertDescription>
                    <ul className="text-xs list-disc pl-5 mt-1 space-y-0.5">
                      <CountLine label="Trips" n={counts.trips} />
                      <CountLine label="Pins" n={counts.pins} />
                      <CountLine label="Spray records" n={counts.sprayRecords} />
                      <CountLine label="Spray jobs" n={counts.sprayJobs} />
                      <CountLine label="Work tasks" n={counts.workTasks} />
                      <CountLine label="Damage records" n={counts.damageRecords} />
                      <CountLine label="Yield records" n={counts.yieldRecords} />
                      <CountLine label="Yield sessions" n={counts.yieldSessions} />
                    </ul>
                    <p className="text-xs mt-2">
                      Deleting will remove this paddock's reference from these records. Strongly
                      recommended for newly-created or test paddocks only.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="text-xs text-muted-foreground">
                  No linked trips, pins, spray, irrigation, yield or task records found.
                </div>
              )}

              <Label className="text-xs">
                Type the paddock name <span className="font-mono">{paddock.name}</span> to confirm:
              </Label>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={paddock.name ?? ""} />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" disabled={!canDelete} onClick={handleDelete} className="gap-1">
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CountLine({ label, n }: { label: string; n: number }) {
  if (!n) return null;
  return <li>{label}: <span className="font-medium">{n}</span></li>;
}
