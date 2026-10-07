// Contour Row Mapping (Beta) — System Admin pilot. Draft mapping only:
// never writes paddocks.rows or any operational block input.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Plus, Trash2, Undo2, Save, Download, Upload, Maximize, AlertTriangle, Info } from "lucide-react";

import { fetchOne } from "@/lib/queries";
import { parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { generateUuid } from "@/lib/uuid";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import NotFound from "@/pages/NotFound";

import type { LatLng } from "@/lib/contourRows/geometry";
import {
  type ContourDraft, type RowGroup, type DraftRow, type GenIssue,
  newDraft, newGroup, totalRowsFor, generateGroupRows, hasManualEdits, validateDraft,
  rowMetrics, exportDraft, importDraftFile, nextFreeRowNumber, LIMITS,
} from "@/lib/contourRows/draft";
import { moveVertex, deleteVertex, insertVertexAfter, splitAfterVertex, trimRow } from "@/lib/contourRows/rowEdits";
import { loadDraft, saveDraft, discardDraft, DraftApiError } from "@/lib/contourRows/draftApi";
import { parseLineFile, looksSwapped, duplicateNumbers, type LineImportResult } from "@/lib/contourRows/importLines";

type Tool = "none" | "trace" | "area" | "exclusion";
const DRAFT_COLOUR = "#22D3EE";
const SELECTED_COLOUR = "#FACC15";
const EXISTING_COLOUR = "#E5E7EB";

const vIcon = (active: boolean) => L.divIcon({
  className: "",
  html: `<div style="width:12px;height:12px;border-radius:9999px;border:2px solid #fff;background:${active ? "#EF4444" : "#0EA5E9"};box-shadow:0 0 2px #000"></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
});
const midIcon = L.divIcon({ className: "", html: `<div style="width:8px;height:8px;border-radius:9999px;background:#fff;opacity:.8"></div>`, iconSize: [8, 8], iconAnchor: [4, 4] });

const ll = (p: LatLng) => [p.lat, p.lng] as [number, number];

function FitTo({ points, nonce }: { points: LatLng[]; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points.map(ll)), { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return null;
}
function Clicks({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function ContourRowMappingPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <NotFound />;
  return <ContourRowMappingInner />;
}

function ContourRowMappingInner() {
  const { id } = useParams<{ id: string }>();
  const { selectedVineyardId } = useVineyard();
  const qc = useQueryClient();
  const paddockQ = useQuery({ queryKey: ["detail", "paddocks", id], enabled: !!id, queryFn: () => fetchOne("paddocks", id!) });
  const paddock: any = paddockQ.data;
  const inScope = !!paddock && !!selectedVineyardId && paddock.vineyard_id === selectedVineyardId;
  const draftQ = useQuery({
    queryKey: ["contour-draft", id], enabled: inScope, retry: false, refetchOnWindowFocus: false,
    queryFn: () => loadDraft(id!),
  });

  if (paddockQ.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (paddockQ.error || !paddock || !inScope) {
    return (
      <div className="p-6 space-y-4">
        <BackTo id={id} />
        <Alert variant="destructive"><AlertTitle>Block not available</AlertTitle>
          <AlertDescription>This block isn't in the selected vineyard, or you don't have access to it.</AlertDescription></Alert>
      </div>
    );
  }
  if (draftQ.isLoading) return <div className="p-6 text-muted-foreground">Loading draft…</div>;
  if (draftQ.error) {
    return (
      <div className="p-6 space-y-4">
        <BackTo id={id} />
        <Alert variant="destructive"><AlertTitle>Couldn't load the draft</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{(draftQ.error as Error).message} Nothing has been changed.</p>
            <Button size="sm" variant="outline" onClick={() => draftQ.refetch()}>Try again</Button>
          </AlertDescription></Alert>
      </div>
    );
  }
  const load = draftQ.data!;
  return (
    <Editor
      key={load.status === "loaded" ? `${load.draft.payload.draftId}:${load.draft.revision}` : load.status}
      paddock={paddock}
      vineyardId={selectedVineyardId!}
      setupRequired={load.status === "setup_required"}
      stored={load.status === "loaded" ? load.draft : null}
      onSaved={(s) => qc.setQueryData(["contour-draft", id], { status: "loaded", draft: s })}
      onReload={() => draftQ.refetch()}
      onDiscarded={() => qc.setQueryData(["contour-draft", id], { status: "empty" })}
    />
  );
}

function BackTo({ id }: { id?: string }) {
  return <Button variant="ghost" size="sm" asChild><Link to={`/setup/paddocks/${id}`}><ArrowLeft className="h-4 w-4 mr-1" /> Back to block</Link></Button>;
}

interface EditorProps {
  paddock: any; vineyardId: string; setupRequired: boolean;
  stored: { revision: number; payload: ContourDraft } | null;
  onSaved: (s: any) => void; onReload: () => void; onDiscarded: () => void;
}

function Editor({ paddock, vineyardId, setupRequired, stored, onSaved, onReload, onDiscarded }: EditorProps) {
  const boundary = useMemo(() => parsePolygonPoints(paddock.polygon_points), [paddock]);
  const legacyRows = useMemo(() => parseRows(paddock.rows), [paddock]);
  const initial = useMemo(() => stored?.payload ?? newDraft(vineyardId, paddock.id), [stored, vineyardId, paddock.id]);
  const [draft, setDraft] = useState<ContourDraft>(() => structuredClone(initial));
  const savedJson = useRef(JSON.stringify(initial));
  const revision = stored?.revision ?? 0;
  const dirty = JSON.stringify(draft) !== savedJson.current;
  const saveId = useRef<{ json: string; id: string } | null>(null);

  const [groupId, setGroupId] = useState<string | null>(initial.groups[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("none");
  const [exclusionId, setExclusionId] = useState<string | null>(null);
  const [selVertex, setSelVertex] = useState<number | null>(null);
  const [rowSel, setRowSel] = useState<{ rowId: string; part: number; idx: number | null } | null>(null);
  const [issues, setIssues] = useState<GenIssue[]>([]);
  const [fitNonce, setFitNonce] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => void }>(null);
  const [trimM, setTrimM] = useState("1");
  const [lineImport, setLineImport] = useState<null | { res: LineImportResult; fileName: string; numbers: number[] }>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const lineInput = useRef<HTMLInputElement>(null);

  const group = draft.groups.find((g) => g.id === groupId) ?? null;
  const updateGroup = (gid: string, f: (g: RowGroup) => RowGroup) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g) => (g.id === gid ? f(g) : g)) }));
  const allRows = draft.groups.flatMap((g) => g.rows);
  const selRow = rowSel ? allRows.find((r) => r.id === rowSel.rowId) ?? null : null;
  const updateRow = (rowId: string, f: (r: DraftRow) => DraftRow) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.id === rowId ? f(r) : r)) })) }));

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const onMapClick = (p: LatLng) => {
    if (!group) return;
    if (tool === "trace") {
      if (group.referenceTrace.length >= LIMITS.maxTracePoints) return;
      updateGroup(group.id, (g) => ({ ...g, referenceTrace: [...g.referenceTrace, p] }));
    } else if (tool === "area") {
      updateGroup(group.id, (g) => ({ ...g, workingArea: [...(g.workingArea ?? []), p] }));
    } else if (tool === "exclusion" && exclusionId) {
      updateGroup(group.id, (g) => ({ ...g, exclusions: g.exclusions.map((m) => (m.id === exclusionId ? { ...m, points: [...m.points, p] } : m)) }));
    }
  };

  const addGroup = () => {
    const g = newGroup(`Row group ${draft.groups.length + 1}`, nextFreeRowNumber(draft));
    setDraft((d) => ({ ...d, groups: [...d.groups, g] }));
    setGroupId(g.id); setTool("trace"); setIssues([]); setRowSel(null);
  };

  const runGenerate = () => {
    if (!group) return;
    const res = generateGroupRows(group, boundary);
    setIssues(res.issues);
    if (!res.rows.length) return;
    const others = new Set(draft.groups.filter((g) => g.id !== group.id).flatMap((g) => g.rows.map((r) => r.number)));
    const clash = res.rows.map((r) => r.number).filter((n) => others.has(n));
    if (clash.length) {
      setIssues([...res.issues, { level: "error", message: `Row numbers ${clash.slice(0, 5).join(", ")} are already used by another group. Change the starting row number.` }]);
      return;
    }
    updateGroup(group.id, (g) => ({ ...g, rows: res.rows }));
    setRowSel(null);
  };
  const generate = () => {
    if (group && hasManualEdits(group)) {
      setConfirm({ title: "Replace manual edits?", body: "Regenerating replaces rows you've edited by hand in this group. Other groups aren't affected.", action: runGenerate });
    } else runGenerate();
  };

  const doSave = async () => {
    const errs = validateDraft(draft);
    if (errs.length) { setSaveError(errs.join(" ")); return; }
    const json = JSON.stringify(draft);
    if (!saveId.current || saveId.current.json !== json) saveId.current = { json, id: generateUuid() };
    setSaving(true); setSaveError(null);
    try {
      const s = await saveDraft(paddock.id, revision, saveId.current.id, draft);
      savedJson.current = JSON.stringify(s.payload);
      toast({ title: "Draft saved", description: `Revision ${s.revision} confirmed by VineTrack.` });
      onSaved(s);
    } catch (e) {
      setSaveError(e instanceof DraftApiError ? e.message : (e as Error).message);
    } finally { setSaving(false); }
  };

  const doDiscard = () => setConfirm({
    title: "Discard this draft?", body: "This deletes the saved draft mapping for this block. Block setup and real rows are not affected.",
    action: async () => {
      try {
        if (revision > 0) await discardDraft(paddock.id, revision);
        onDiscarded();
        toast({ title: "Draft discarded" });
      } catch (e) { setSaveError((e as Error).message); }
    },
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportDraft(draft), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(paddock.name ?? "block").replace(/[^\w-]+/g, "_")}-contour-draft.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File, asNew: boolean) => {
    try {
      const { draft: d, sameDraft } = importDraftFile(await f.text(), vineyardId, paddock.id, draft.draftId, asNew);
      // Keep this block's draft id so the save still targets the same draft.
      const next = sameDraft ? d : { ...d, draftId: draft.draftId };
      setDraft(next); setGroupId(next.groups[0]?.id ?? null); setRowSel(null);
      toast({ title: sameDraft ? "Backup restored" : "Backup imported as new", description: sameDraft ? "Identities kept. Save to keep these changes." : "All identities were regenerated. Save to keep these changes." });
    } catch (e) { toast({ title: "Couldn't import backup", description: (e as Error).message, variant: "destructive" }); }
  };

  const onLineFile = async (f: File) => {
    try {
      const res = parseLineFile(f.name, await f.text());
      if (looksSwapped(res.lines, boundary)) throw new Error("The coordinates look like latitude and longitude are swapped. Re-export with longitude first (GeoJSON) or check the source.");
      let next = nextFreeRowNumber(draft);
      const numbers = res.lines.map((l) => l.suggestedNumber ?? next++);
      setLineImport({ res, fileName: f.name, numbers });
    } catch (e) { toast({ title: "Couldn't read file", description: (e as Error).message, variant: "destructive" }); }
  };
  const used = new Set(allRows.map((r) => r.number));
  const importDups = lineImport ? duplicateNumbers(lineImport.numbers, used) : [];
  const commitLineImport = () => {
    if (!lineImport || importDups.length || lineImport.numbers.some((n) => !Number.isInteger(n) || n < 1)) return;
    const g: RowGroup = {
      ...newGroup(`Imported: ${lineImport.fileName}`, lineImport.numbers[0] ?? 1), mode: "imported", leftCount: 0, rightCount: 0,
      rows: lineImport.res.lines.map((l, i) => ({
        id: generateUuid(), number: lineImport.numbers[i], offsetIndex: null, provenance: "imported", canonicalRowId: null,
        source: { format: lineImport.res.format, fileName: lineImport.fileName, featureIndex: l.featureIndex, name: l.name ?? undefined },
        parts: l.parts.map((p) => ({ id: generateUuid(), points: p })),
      })),
    };
    setDraft((d) => ({ ...d, groups: [...d.groups, g] }));
    setGroupId(g.id); setLineImport(null);
  };

  const groupMetrics = useMemo(() => (group ? rowMetrics(group.rows, boundary) : []), [group, boundary]);
  const allMetrics = useMemo(() => rowMetrics(allRows, boundary), [allRows, boundary]);
  const sum = (m: typeof allMetrics, k: "lengthM" | "chordM") => m.reduce((s, r) => s + r[k], 0);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const centre = boundary[0] ?? { lat: -34.5, lng: 138.7 };
  const canSave = !setupRequired && dirty && !saving;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <BackTo id={paddock.id} />
      <div className="flex flex-col items-start gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-orange-600 dark:text-orange-400">Contour Row Mapping (Beta)</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{paddock.name}</span>
          <Badge variant="outline">Draft mapping — for review</Badge>
          {dirty ? <Badge variant="secondary">Unsaved changes</Badge> : revision > 0 ? <Badge variant="secondary">Saved · revision {revision}</Badge> : <Badge variant="secondary">Not yet saved</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">This draft never changes the block's real rows, row count, boundary or vine counts.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={doSave} disabled={!canSave} className="gap-1"><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Draft"}</Button>
          <Button size="sm" variant="outline" disabled={!dirty} onClick={() => setConfirm({ title: "Cancel unsaved edits?", body: "Your changes since the last save will be lost.", action: () => { setDraft(JSON.parse(savedJson.current)); setRowSel(null); setIssues([]); } })}>Cancel edits</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={exportJson}><Download className="h-4 w-4" /> Export backup</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => jsonInput.current?.click()}><Upload className="h-4 w-4" /> Restore backup</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => lineInput.current?.click()}><Upload className="h-4 w-4" /> Import rows (GeoJSON/KML)</Button>
          <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={setupRequired || revision === 0} onClick={doDiscard}><Trash2 className="h-4 w-4" /> Discard draft</Button>
          <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setConfirm({ title: "Restore backup", body: "If this backup is from this same draft its identities are kept. Otherwise it is imported as new with fresh identities. It replaces the current unsaved draft.", action: () => importJson(f, false) }); }} />
          <input ref={lineInput} type="file" accept=".geojson,.json,.kml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onLineFile(f); }} />
        </div>
      </div>

      {setupRequired && (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Database setup required — saving is off</AlertTitle>
          <AlertDescription>The VineTrack database doesn't have Contour Row Mapping storage yet. You can try the tools and export a backup, but nothing can be saved until it's set up.</AlertDescription></Alert>
      )}
      {saveError && (
        <Alert variant="destructive"><AlertTitle>Draft not saved</AlertTitle>
          <AlertDescription className="space-y-2"><p>{saveError}</p><p>Your edits are still here.</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={doSave}>Try again</Button>
              <Button size="sm" variant="outline" onClick={exportJson}>Export backup</Button>
              <Button size="sm" variant="ghost" onClick={onReload}>Reload latest (loses edits)</Button></div>
          </AlertDescription></Alert>
      )}
      {boundary.length < 3 && <Alert variant="destructive"><AlertTitle>No block boundary</AlertTitle><AlertDescription>Draw the block boundary in Block Setup first.</AlertDescription></Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="relative h-[640px] rounded-lg border overflow-hidden">
          <MapContainer center={ll(centre)} zoom={18} maxZoom={21} scrollWheelZoom className="h-full w-full">
            <FitTo points={boundary} nonce={fitNonce} />
            <TileLayer attribution="Tiles &copy; Esri" maxNativeZoom={19} maxZoom={21}
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            <Clicks onClick={onMapClick} />
            {boundary.length >= 3 && <Polygon positions={boundary.map(ll)} interactive={false} pathOptions={{ color: "#34C759", weight: 2, fillOpacity: 0.05 }} />}
            {legacyRows.map((r, i) => r.start && r.end && (
              <Polyline key={`legacy-${i}`} positions={[ll(r.start), ll(r.end)]} interactive={false} pathOptions={{ color: EXISTING_COLOUR, weight: 1, opacity: 0.35, dashArray: "3 4" }} />
            ))}
            {draft.groups.map((g) => (
              <GroupLayer key={g.id} g={g} active={g.id === groupId} selRowId={rowSel?.rowId ?? null}
                onSelectRow={(rowId) => { setGroupId(g.id); setTool("none"); setRowSel({ rowId, part: 0, idx: null }); }} />
            ))}
            {group && tool !== "none" && tool !== "exclusion" && (tool === "trace" ? group.referenceTrace : group.workingArea ?? []).map((p, i, arr) => (
              <Marker key={`v-${tool}-${i}`} position={ll(p)} draggable icon={vIcon(selVertex === i)}
                eventHandlers={{
                  click: () => setSelVertex(i),
                  dragend: (e) => { const q = (e.target as L.Marker).getLatLng(); const pt = { lat: q.lat, lng: q.lng };
                    updateGroup(group.id, (g) => tool === "trace" ? { ...g, referenceTrace: g.referenceTrace.map((x, j) => j === i ? pt : x) } : { ...g, workingArea: (g.workingArea ?? []).map((x, j) => j === i ? pt : x) }); },
                }}>
              </Marker>
            ))}
            {group && tool === "trace" && group.referenceTrace.slice(1).map((b, i) => {
              const a = group.referenceTrace[i];
              return <Marker key={`m-${i}`} position={[(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]} icon={midIcon}
                eventHandlers={{ click: () => updateGroup(group.id, (g) => { const t = g.referenceTrace.slice(); t.splice(i + 1, 0, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }); return { ...g, referenceTrace: t }; }) }} />;
            })}
            {selRow && selRow.parts.map((p, pi) => p.points.map((q, qi) => (
              <Marker key={`r-${pi}-${qi}`} position={ll(q)} draggable icon={vIcon(rowSel?.part === pi && rowSel?.idx === qi)}
                eventHandlers={{
                  click: () => setRowSel({ rowId: selRow.id, part: pi, idx: qi }),
                  dragend: (e) => { const x = (e.target as L.Marker).getLatLng(); updateRow(selRow.id, (r) => moveVertex(r, pi, qi, { lat: x.lat, lng: x.lng })); },
                }} />
            )))}
          </MapContainer>
          <Button size="sm" variant="secondary" className="absolute right-3 top-3 z-[400] gap-1" onClick={() => setFitNonce((n) => n + 1)}><Maximize className="h-4 w-4" /> Fit to block</Button>
          {tool !== "none" && <div className="absolute left-3 bottom-3 z-[400] rounded bg-background/90 px-3 py-1.5 text-xs shadow">
            {tool === "trace" ? "Click along one existing vine row, from one end to the other." : tool === "area" ? "Click to outline the working area for this group." : "Click to outline a track or obstacle to cut out."}
          </div>}
        </div>

        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Row groups</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {draft.groups.map((g) => (
                <button key={g.id} type="button" onClick={() => { setGroupId(g.id); setRowSel(null); setIssues([]); setTool("none"); }}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${g.id === groupId ? "border-primary bg-primary/10" : "bg-card"}`}>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.mode === "imported" ? "Imported" : g.mode === "contour" ? "Contour" : "Straight"} · {g.rows.length} rows drafted</div>
                </button>
              ))}
              <Button size="sm" variant="outline" className="w-full gap-1" onClick={addGroup}><Plus className="h-4 w-4" /> Add row group</Button>
            </CardContent></Card>

          {group && <GroupPanel g={group} tool={tool} setTool={setTool} exclusionId={exclusionId} setExclusionId={setExclusionId}
            update={(f) => updateGroup(group.id, f)} selVertex={selVertex} setSelVertex={setSelVertex}
            onGenerate={generate} issues={issues}
            onDelete={() => setConfirm({ title: `Delete ${group.name}?`, body: "Only this group's draft rows are removed. Other groups keep their numbers.", action: () => { setDraft((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== group.id) })); setGroupId(null); setRowSel(null); } })} />}

          {selRow && rowSel && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Row {selRow.number} <span className="text-xs font-normal text-muted-foreground">({selRow.provenance}, {selRow.parts.length} part{selRow.parts.length === 1 ? "" : "s"})</span></CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">Drag points on the map. Click a point to select it.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => { updateRow(selRow.id, (r) => deleteVertex(r, rowSel.part, rowSel.idx!)); setRowSel({ ...rowSel, idx: null }); }}>Delete point</Button>
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => updateRow(selRow.id, (r) => insertVertexAfter(r, rowSel.part, rowSel.idx!))}>Add point after</Button>
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => { try { updateRow(selRow.id, (r) => splitAfterVertex(r, rowSel.part, rowSel.idx!)); setRowSel({ ...rowSel, idx: null }); } catch (e) { toast({ title: "Can't split here", description: (e as Error).message }); } }}>Split after point</Button>
                </div>
                <div className="flex items-end gap-2">
                  <div><Label className="text-xs">Trim (m)</Label><Input className="h-8 w-20" value={trimM} onChange={(e) => setTrimM(e.target.value)} inputMode="decimal" /></div>
                  <Button size="sm" variant="outline" onClick={() => updateRow(selRow.id, (r) => trimRow(r, "start", Number(trimM)))}>Trim start</Button>
                  <Button size="sm" variant="outline" onClick={() => updateRow(selRow.id, (r) => trimRow(r, "end", Number(trimM)))}>Trim end</Button>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRowSel(null)}>Done</Button>
              </CardContent></Card>
          )}

          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Draft measurements</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground flex gap-1"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Draft preview only. Vine, post and irrigation figures still come from Block Setup.</p>
              <div>Whole draft: <b>{allMetrics.length}</b> rows · <b>{fmt(sum(allMetrics, "lengthM"))} m</b> actual length (straight end-to-end: {fmt(sum(allMetrics, "chordM"))} m)</div>
              {group && <div>This group: <b>{groupMetrics.length}</b> rows · <b>{fmt(sum(groupMetrics, "lengthM"))} m</b> (end-to-end {fmt(sum(groupMetrics, "chordM"))} m)</div>}
              {paddock.row_length_override != null && <div className="text-xs text-muted-foreground">Block Setup total row length override: {fmt(Number(paddock.row_length_override))} m (unchanged)</div>}
              {groupMetrics.length > 0 && (
                <div className="max-h-56 overflow-auto rounded border">
                  <table className="w-full text-xs"><thead className="bg-muted/50"><tr><th className="p-1 text-left">Row</th><th className="p-1 text-right">Length m</th><th className="p-1 text-right">End-to-end m</th><th className="p-1 text-right">Parts</th></tr></thead>
                    <tbody>{groupMetrics.map((m) => (
                      <tr key={m.rowId} className={`cursor-pointer border-t ${rowSel?.rowId === m.rowId ? "bg-primary/10" : ""}`} onClick={() => { setTool("none"); setRowSel({ rowId: m.rowId, part: 0, idx: null }); }}>
                        <td className="p-1">{m.number}</td><td className="p-1 text-right">{fmt(m.lengthM)}</td><td className="p-1 text-right">{fmt(m.chordM)}</td><td className="p-1 text-right">{m.parts}</td></tr>
                    ))}</tbody></table>
                </div>
              )}
            </CardContent></Card>
        </div>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.body}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const a = confirm?.action; setConfirm(null); a?.(); }}>Continue</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>

      <AlertDialog open={!!lineImport} onOpenChange={(o) => !o && setLineImport(null)}>
        <AlertDialogContent className="max-w-lg"><AlertDialogHeader><AlertDialogTitle>Import rows into the draft</AlertDialogTitle>
          <AlertDialogDescription>Rows are added to a new group in this draft only. Check the row numbers.</AlertDialogDescription></AlertDialogHeader>
          {lineImport && <div className="space-y-2 text-sm">
            {lineImport.res.warnings.map((w, i) => <p key={i} className="text-xs text-muted-foreground">{w}</p>)}
            <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-xs"><thead className="bg-muted/50"><tr><th className="p-1 text-left">Feature</th><th className="p-1 text-left">Parts</th><th className="p-1 text-left">Row number</th></tr></thead>
              <tbody>{lineImport.res.lines.map((l, i) => (
                <tr key={i} className="border-t"><td className="p-1">{l.name ?? `#${l.featureIndex + 1}`}</td><td className="p-1">{l.parts.length}</td>
                  <td className="p-1"><Input className="h-7 w-20" inputMode="numeric" value={String(lineImport.numbers[i])}
                    onChange={(e) => setLineImport({ ...lineImport, numbers: lineImport.numbers.map((n, j) => (j === i ? Number(e.target.value) : n)) })} /></td></tr>
              ))}</tbody></table></div>
            {importDups.length > 0 && <p className="text-xs text-destructive">Row numbers used more than once or already in the draft: {importDups.join(", ")}</p>}
          </div>}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={importDups.length > 0} onClick={commitLineImport}>Add to draft</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>
    </div>
  );
}

function GroupLayer({ g, active, selRowId, onSelectRow }: { g: RowGroup; active: boolean; selRowId: string | null; onSelectRow: (id: string) => void }) {
  return (
    <>
      {g.workingArea && g.workingArea.length >= 2 && <Polygon positions={g.workingArea.map(ll)} interactive={false} pathOptions={{ color: "#60A5FA", weight: active ? 2 : 1, dashArray: "6 4", fillOpacity: 0.04 }} />}
      {g.exclusions.map((m) => m.points.length >= 2 && <Polygon key={m.id} positions={m.points.map(ll)} interactive={false} pathOptions={{ color: "#F87171", weight: 1.5, fillOpacity: 0.25 }} />)}
      {g.rows.map((r) => r.parts.map((p) => (
        <Polyline key={p.id} positions={p.points.map(ll)} eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onSelectRow(r.id); } }}
          pathOptions={{ color: r.id === selRowId ? SELECTED_COLOUR : DRAFT_COLOUR, weight: r.id === selRowId ? 4 : active ? 2.5 : 1.5, opacity: active ? 1 : 0.6 }} />
      )))}
      {g.referenceTrace.length >= 2 && <Polyline positions={g.referenceTrace.map(ll)} interactive={false} pathOptions={{ color: "#F97316", weight: active ? 3 : 1.5, dashArray: "8 6" }} />}
      {active && g.referenceTrace.length >= 2 && <Marker position={ll(g.referenceTrace[g.referenceTrace.length - 1])} interactive={false}
        icon={L.divIcon({ className: "", html: `<div style="color:#F97316;font-weight:700;font-size:14px;text-shadow:0 0 2px #000">▶ end</div>`, iconSize: [50, 16], iconAnchor: [-6, 8] })} />}
    </>
  );
}

function GroupPanel({ g, tool, setTool, exclusionId, setExclusionId, update, selVertex, setSelVertex, onGenerate, issues, onDelete }: {
  g: RowGroup; tool: Tool; setTool: (t: Tool) => void; exclusionId: string | null; setExclusionId: (s: string | null) => void;
  update: (f: (g: RowGroup) => RowGroup) => void; selVertex: number | null; setSelVertex: (n: number | null) => void;
  onGenerate: () => void; issues: GenIssue[]; onDelete: () => void;
}) {
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const field = (label: string, value: number, set: (n: number) => void, hint?: string) => (
    <div><Label className="text-xs">{label}</Label><Input className="h-8" inputMode="decimal" defaultValue={String(value)} key={`${g.id}-${label}-${value}`}
      onBlur={(e) => set(num(e.target.value))} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
  );
  const imported = g.mode === "imported";
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Group settings</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div><Label className="text-xs">Name</Label><Input className="h-8" value={g.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></div>
        {!imported && <>
          <div className="flex gap-2">
            {(["contour", "straight"] as const).map((m) => <Button key={m} size="sm" variant={g.mode === m ? "default" : "outline"} onClick={() => update((x) => ({ ...x, mode: m }))}>{m === "contour" ? "Contour" : "Straight"}</Button>)}
          </div>
          <div className="rounded border p-2 space-y-2">
            <div className="font-medium text-xs">Trace one existing row</div>
            <p className="text-[11px] text-muted-foreground">{g.mode === "straight" ? "Click the two ends of one row." : "Click points along one vine row on the satellite image, end to end. Drag points to adjust; click a white dot to add a point."}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={tool === "trace" ? "default" : "outline"} onClick={() => setTool(tool === "trace" ? "none" : "trace")}>{tool === "trace" ? "Finish trace" : g.referenceTrace.length ? "Edit trace" : "Start trace"}</Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={!g.referenceTrace.length} onClick={() => update((x) => ({ ...x, referenceTrace: x.referenceTrace.slice(0, -1) }))}><Undo2 className="h-3.5 w-3.5" /> Undo point</Button>
              <Button size="sm" variant="outline" disabled={selVertex == null || tool !== "trace"} onClick={() => { update((x) => ({ ...x, referenceTrace: x.referenceTrace.filter((_, i) => i !== selVertex) })); setSelVertex(null); }}>Delete point</Button>
            </div>
            <div className="text-[11px] text-muted-foreground">{g.referenceTrace.length} points</div>
            {g.mode === "contour" && <div className="flex items-center gap-2 text-xs"><Label className="text-xs">Smoothing</Label>
              {[0, 1, 2].map((s) => <Button key={s} size="sm" variant={g.smoothing === s ? "default" : "outline"} className="h-7 px-2" onClick={() => update((x) => ({ ...x, smoothing: s }))}>{s === 0 ? "Off" : s === 1 ? "Light" : "More"}</Button>)}</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field("Row spacing (m)", g.spacingM, (n) => update((x) => ({ ...x, spacingM: n })))}
            {field("Starting row number", g.startNumber, (n) => update((x) => ({ ...x, startNumber: n })))}
            {field("Rows on the left", g.leftCount, (n) => update((x) => ({ ...x, leftCount: n })), "Extra rows")}
            {field("Rows on the right", g.rightCount, (n) => update((x) => ({ ...x, rightCount: n })), "Extra rows")}
          </div>
          <p className="text-xs">Total: <b>{Number.isFinite(totalRowsFor(g)) ? totalRowsFor(g) : "—"}</b> rows (traced row + {g.leftCount} left + {g.rightCount} right). Left and right are as you face the ▶ end arrow.</p>
          <div className="flex items-center gap-2"><Switch checked={g.ascending} onCheckedChange={(v) => update((x) => ({ ...x, ascending: v }))} />
            <span className="text-xs">{g.ascending ? "Numbers go up from left to right" : "Numbers go up from right to left"}</span></div>
          <div className="flex items-center gap-2"><Switch checked={g.extendToArea} onCheckedChange={(v) => update((x) => ({ ...x, extendToArea: v }))} />
            <span className="text-xs">Extend rows to the edge of the area</span></div>
        </>}
        <div className="rounded border p-2 space-y-2">
          <div className="font-medium text-xs">Working area & cut-outs (optional)</div>
          <p className="text-[11px] text-muted-foreground">Limit this group to part of the block so differently aligned rows don't overlap. Cut out tracks or obstacles. The real block boundary isn't changed.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={tool === "area" ? "default" : "outline"} onClick={() => setTool(tool === "area" ? "none" : "area")}>{tool === "area" ? "Finish area" : g.workingArea?.length ? "Edit area" : "Draw area"}</Button>
            {g.workingArea && <Button size="sm" variant="outline" onClick={() => update((x) => ({ ...x, workingArea: null }))}>Clear area</Button>}
            <Button size="sm" variant="outline" onClick={() => { const id = generateUuid(); update((x) => ({ ...x, exclusions: [...x.exclusions, { id, points: [] }] })); setExclusionId(id); setTool("exclusion"); }}>Add cut-out</Button>
            {tool === "exclusion" && <Button size="sm" onClick={() => setTool("none")}>Finish cut-out</Button>}
          </div>
          {g.exclusions.map((m, i) => (
            <div key={m.id} className="flex items-center justify-between text-xs"><span className={m.id === exclusionId && tool === "exclusion" ? "font-semibold" : ""}>Cut-out {i + 1} · {m.points.length} pts</span>
              <Button size="sm" variant="ghost" className="h-6" onClick={() => update((x) => ({ ...x, exclusions: x.exclusions.filter((e) => e.id !== m.id) }))}>Remove</Button></div>
          ))}
        </div>
        {!imported && <Button className="w-full" onClick={onGenerate}>{g.rows.length ? "Regenerate rows" : "Generate rows"}</Button>}
        {issues.length > 0 && <div className="space-y-1">{issues.map((i, k) => (
          <p key={k} className={`text-xs ${i.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.level === "error" ? "Problem: " : "Check: "}{i.message}</p>
        ))}</div>}
        <Button size="sm" variant="ghost" className="text-destructive gap-1" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete group</Button>
      </CardContent></Card>
  );
}
