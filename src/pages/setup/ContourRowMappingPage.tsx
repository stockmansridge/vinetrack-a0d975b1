// Contour Row Mapping (Beta) — System Admin pilot. Draft mapping only:
// never writes paddocks.rows or any operational block input.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RowMapWorkspace from "@/components/paddocks/RowMapWorkspace";
import PanelTabs from "@/components/paddocks/PanelTabs";
import ContourAppleMap, { type CShape, type CMarker } from "@/components/paddocks/ContourAppleMap";
import { ArrowLeft, Plus, Trash2, Undo2, Save, Download, Upload, AlertTriangle, Info } from "lucide-react";

import { fetchOne } from "@/lib/queries";
import { parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
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
  type ContourDraft, type RowGroup, type DraftRow, type GenIssue, type DraftScope,
  newDraft, newGroup, totalRowsFor, generateGroupRows, hasManualEdits, validateDraftShape,
  rowMetrics, exportDraft, importDraftFile, readBackupFile, nextFreeRowNumber, LIMITS,
} from "@/lib/contourRows/draft";
import { checkDraftGeometry, hasErrors } from "@/lib/contourRows/checks";
import { moveVertex, deleteVertex, insertVertexAfter, splitAfterVertex, trimRow } from "@/lib/contourRows/rowEdits";
import { loadDraft, saveDraft, discardDraft, DraftApiError, type DraftLoad, type StoredDraft } from "@/lib/contourRows/draftApi";
import { workingCopyKey, getWorkingCopy, putWorkingCopy, clearWorkingCopy, reconcileSaved, clearWorkingCopiesExcept } from "@/lib/contourRows/workingCopy";
import { shiftGroup, shiftDirection, shiftProjection, canUndoShift, makeShiftUndo, SHIFT_LIMITS, type ShiftSide, type ShiftUndo } from "@/lib/contourRows/sideShift";
import NumberStepper from "@/components/paddocks/NumberStepper";
import { deleteDraftRow, planRenumber, applyRenumber, groupStatus } from "@/lib/contourRows/rowNumbering";
import { parseLineFile, looksSwapped, duplicateNumbers, linesFarOutside, IMPORT_LIMITS, type LineImportResult } from "@/lib/contourRows/importLines";

type Tool = "none" | "trace" | "area" | "exclusion";
const DRAFT_COLOUR = "#22D3EE";
const SELECTED_COLOUR = "#FACC15";
const EXISTING_COLOUR = "#E5E7EB";

export default function ContourRowMappingPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <NotFound />;
  return <ContourRowMappingInner />;
}

function ContourRowMappingInner() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { selectedVineyardId } = useVineyard();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const scopeReady = !!id && !!userId && !!selectedVineyardId;
  const paddockQ = useQuery({
    queryKey: ["contour-paddock", userId, selectedVineyardId, id], enabled: scopeReady, retry: false,
    queryFn: () => fetchOne("paddocks", id!),
  });
  const paddock: any = paddockQ.data;
  const inScope = !!paddock && paddock.vineyard_id === selectedVineyardId && paddock.id === id && !paddock.deleted_at;
  const canonicalRowIds = useMemo(() => new Set(parseRows(paddock?.rows).map((r) => r.id).filter((x): x is string => !!x)), [paddock]);
  const draftKey = ["contour-draft", userId, selectedVineyardId, id];
  const draftQ = useQuery({
    queryKey: draftKey, enabled: inScope, retry: false, refetchOnWindowFocus: false, staleTime: Infinity,
    queryFn: () => loadDraft({ vineyardId: selectedVineyardId!, paddockId: id! }),
  });
  const [nonce, setNonce] = useState(0);
  // Account change: drop other users' unsaved working copies.
  useEffect(() => { clearWorkingCopiesExcept(userId); }, [userId]);

  if (!scopeReady || paddockQ.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (paddockQ.error || !paddock || !inScope) {
    return (
      <div className="p-6 space-y-4">
        <BackTo id={id} />
        <Alert variant="destructive"><AlertTitle>Block not available</AlertTitle>
          <AlertDescription>This block isn't in the selected vineyard, has been archived, or you don't have access to it.</AlertDescription></Alert>
      </div>
    );
  }
  if (draftQ.isLoading || draftQ.isFetching) return <div className="p-6 text-muted-foreground">Loading draft…</div>;
  if (draftQ.error || !draftQ.data) {
    return (
      <div className="p-6 space-y-4">
        <BackTo id={id} />
        <Alert variant="destructive"><AlertTitle>Couldn't load the draft</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{(draftQ.error as Error | null)?.message ?? "No response."} Nothing has been changed and saving is off.</p>
            <Button size="sm" variant="outline" onClick={() => draftQ.refetch()}>Try again</Button>
          </AlertDescription></Alert>
      </div>
    );
  }
  const load = draftQ.data;
  return (
    <Editor
      key={`${userId}:${selectedVineyardId}:${id}:${nonce}`}
      paddock={paddock}
      copyKey={workingCopyKey(userId!, selectedVineyardId!, id!)}
      scope={{ vineyardId: selectedVineyardId!, paddockId: id!, canonicalRowIds }}
      load={load}
      onSaved={(s) => qc.setQueryData(draftKey, { status: "loaded", draft: s } satisfies DraftLoad)}
      onReload={async () => { await draftQ.refetch(); setNonce((n) => n + 1); }}
      onDiscarded={(revision) => { qc.setQueryData(draftKey, { status: "empty", revision } satisfies DraftLoad); setNonce((n) => n + 1); }}
    />
  );
}

function BackTo({ id, onClick }: { id?: string; onClick?: (e: React.MouseEvent) => void }) {
  return <Button variant="ghost" size="sm" asChild><Link to={`/setup/paddocks/${id}`} onClick={onClick}><ArrowLeft className="h-4 w-4 mr-1" /> Back to block</Link></Button>;
}

interface EditorProps {
  paddock: any; scope: DraftScope; load: DraftLoad; copyKey?: string;
  onSaved: (s: StoredDraft) => void; onReload: () => void; onDiscarded: (revision: number) => void;
}

type Busy = null | "saving" | "discarding";

export function Editor({ paddock, scope, load, copyKey, onSaved, onReload, onDiscarded }: EditorProps) {
  // Tab-only working copy (Back/Forward, vineyard switch). Restored only after the normal load passed.
  const [restored] = useState(() => (copyKey ? getWorkingCopy(copyKey) : null));
  const navigate = useNavigate();
  const setupRequired = load.status === "setup_required";
  const boundary = useMemo(() => parsePolygonPoints(paddock.polygon_points), [paddock]);
  const legacyRows = useMemo(() => parseRows(paddock.rows), [paddock]);
  const initial = useMemo(() => restored ? (JSON.parse(restored.savedJson) as ContourDraft) : (load.status === "loaded" ? load.draft.payload : newDraft(scope.vineyardId, scope.paddockId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const [draft, setDraftRaw] = useState<ContourDraft>(() => structuredClone(restored?.draft ?? initial));
  const [base, setBase] = useState<{ draftId: string | null; revision: number }>(() => restored?.base ?? (
    load.status === "loaded" ? { draftId: load.draft.draftId, revision: load.draft.revision } : { draftId: null, revision: load.status === "empty" ? load.revision : 0 }));
  const [showRestored, setShowRestored] = useState(!!restored);
  const serverMoved = !!restored && (load.status === "loaded" ? load.draft.draftId !== restored.base.draftId || load.draft.revision !== restored.base.revision
    : load.status === "empty" ? restored.base.draftId !== null || restored.base.revision !== load.revision : false);
  const savedJson = useRef(restored?.savedJson ?? JSON.stringify(initial));
  useEffect(() => { if (copyKey) putWorkingCopy(copyKey, { draft, base, savedJson: savedJson.current }); }, [copyKey, draft, base]);
  const dirty = JSON.stringify(draft) !== savedJson.current;
  const attempt = useRef<{ json: string; id: string; revision: number; draftId: string | null } | null>(null);

  // While a save/discard is in flight every mutation is frozen (handler guard + disabled controls).
  const [busy, setBusyState] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const setBusy = (b: Busy) => { busyRef.current = b; setBusyState(b); };
  const setDraft = useCallback((u: SetStateAction<ContourDraft>) => { if (busyRef.current) return; setDraftRaw(u); }, []);
  const guard = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (!busyRef.current) f(...a); };

  const [groupId, setGroupId] = useState<string | null>(initial.groups[0]?.id ?? null);
  const [tool, setToolRaw] = useState<Tool>("none");
  const [exclusionId, setExclusionId] = useState<string | null>(null);
  const [selVertex, setSelVertex] = useState<number | null>(null);
  const setTool = (t: Tool) => { setToolRaw(t); setSelVertex(null); };
  const [panelTab, setPanelTab] = useState<string>(initial.groups.length ? "setup" : "groups");
  const [rowSel, setRowSel] = useState<{ rowId: string; part: number; idx: number | null } | null>(null);
  const [issues, setIssues] = useState<GenIssue[]>([]);
  const [fitNonce, setFitNonce] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => void }>(null);
  const [trimM, setTrimM] = useState(1);
  const [shiftM, setShiftM] = useState(SHIFT_LIMITS.defaultM);
  const [shiftUndo, setShiftUndo] = useState<ShiftUndo | null>(null);
  const [lineImport, setLineImport] = useState<null | { res: LineImportResult; fileName: string; numbers: number[]; error: string | null }>(null);
  const [backup, setBackup] = useState<null | { text: string; canRestoreInPlace: boolean; fileName: string }>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const lineInput = useRef<HTMLInputElement>(null);

  const group = draft.groups.find((g) => g.id === groupId) ?? null;
  const updateGroup = (gid: string, f: (g: RowGroup) => RowGroup) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g) => (g.id === gid ? f(g) : g)) }));
  const allRows = draft.groups.flatMap((g) => g.rows);
  const selRow = rowSel ? allRows.find((r) => r.id === rowSel.rowId) ?? null : null;
  const updateRow = (rowId: string, f: (r: DraftRow) => DraftRow) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.id === rowId ? f(r) : r)) })) }));

  // Live final-geometry + structure check (deferred so typing stays responsive).
  const deferred = useDeferredValue(draft);
  const geoIssues = useMemo(() => checkDraftGeometry(deferred, boundary), [deferred, boundary]);
  const shapeErrors = useMemo(() => validateDraftShape(deferred, scope), [deferred, scope]);
  const missingLinks = useMemo(() => allRows.filter((r) => r.canonicalRowId && !scope.canonicalRowIds?.has(r.canonicalRowId)).length, [allRows, scope]);

  // Leaving with unsaved edits: browser unload + any in-app link click.
  const leaveRisk = dirty || !!busy;
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (leaveRisk) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [leaveRisk]);
  useEffect(() => {
    if (!leaveRisk) return;
    const h = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault(); e.stopPropagation();
      if (busyRef.current) { toast({ title: "Please wait", description: "The draft is still saving." }); return; }
      setConfirm({ title: "Leave without saving?", body: "Your unsaved draft changes will be lost.", action: () => { savedJson.current = JSON.stringify(draft); if (copyKey) clearWorkingCopy(copyKey); navigate(url.pathname + url.search + url.hash); } });
    };
    document.addEventListener("click", h, true);
    return () => document.removeEventListener("click", h, true);
  }, [leaveRisk, draft, navigate, copyKey]);

  // Points of whichever outline is being edited.
  const editPts: LatLng[] = !group ? [] : tool === "trace" ? group.referenceTrace : tool === "area" ? group.workingArea ?? []
    : tool === "exclusion" ? group.exclusions.find((m) => m.id === exclusionId)?.points ?? [] : [];
  const closedOutline = tool === "area" || tool === "exclusion";
  const setEditPts = (f: (pts: LatLng[]) => LatLng[]) => {
    if (!group) return;
    updateGroup(group.id, (g) => tool === "trace" ? { ...g, referenceTrace: f(g.referenceTrace) }
      : tool === "area" ? { ...g, workingArea: f(g.workingArea ?? []) }
      : tool === "exclusion" ? { ...g, exclusions: g.exclusions.map((m) => (m.id === exclusionId ? { ...m, points: f(m.points) } : m)) } : g);
  };

  const onMapClick = guard((p: LatLng) => {
    if (!group || tool === "none") return;
    const max = tool === "trace" ? LIMITS.maxTracePoints : LIMITS.maxMaskPoints;
    if (editPts.length >= max) return;
    if (tool === "exclusion" && !exclusionId) return;
    setEditPts((pts) => [...pts, p]);
  });

  const addGroup = guard(() => {
    const g = newGroup(`Row group ${draft.groups.length + 1}`, nextFreeRowNumber(draft));
    setDraft((d) => ({ ...d, groups: [...d.groups, g] }));
    setGroupId(g.id); setTool("none"); setIssues([]); setRowSel(null); setPanelTab("setup");
  });

  const shiftProj = useMemo(() => shiftProjection(boundary, group?.referenceTrace[0] ?? { lat: -34.5, lng: 138.7 }), [boundary, group]);
  const shiftDir = group ? shiftDirection(group, shiftProj) : null;
  const doShift = guard((side: ShiftSide) => {
    if (!group) return;
    let next: RowGroup;
    try { next = shiftGroup(group, shiftProj, shiftM, side); }
    catch (e) { toast({ title: "Can't shift", description: (e as Error).message }); return; }
    setShiftUndo(makeShiftUndo(group, next)); // only the last shift is kept
    updateGroup(group.id, () => next);
  });
  const undoShift = guard(() => {
    const entry = shiftUndo; setShiftUndo(null);
    if (!group || !entry || !canUndoShift(entry, group)) return;
    updateGroup(group.id, () => entry.before);
  });

  const runGenerate = () => {
    if (!group || busyRef.current) return;
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
  const generate = guard(() => {
    if (group && group.rows.length) {
      setConfirm({ title: `Replace the ${group.rows.length} drafted rows in ${group.name}?`,
        body: `Regenerating recreates ${totalRowsFor(group)} rows from the trace and the left/right counts${hasManualEdits(group) ? ", replacing rows you've edited by hand" : ""}. Rows you deleted will come back unless you lower the counts. Other groups aren't affected.`,
        action: () => { if (!busyRef.current) runGenerate(); } });
    } else runGenerate();
  });

  // Delete one logical draft row (all parts), targeted by stable group + row ids.
  const askDeleteRow = guard((gid: string, rowId: string) => {
    const g = draft.groups.find((x) => x.id === gid); const r = g?.rows.find((x) => x.id === rowId);
    if (!g || !r) return;
    setConfirm({ title: `Delete row ${r.number} from ${g.name}?`,
      body: `Only this draft row (${r.parts.length} part${r.parts.length === 1 ? "" : "s"}) is removed. Other rows keep their numbers and shapes. Regenerating this group would bring it back unless you lower the left/right counts. Not saved until you press Save Draft.`,
      action: () => {
        if (busyRef.current) return;
        setDraft((d) => deleteDraftRow(d, gid, rowId));
        setRowSel((cur) => (cur?.rowId === rowId ? null : cur)); setIssues([]);
        toast({ title: `Row ${r.number} removed from the draft`, description: "Press Save Draft to keep this." });
      } });
  });

  // Numbering only: never regenerates or moves rows.
  const renumber = guard(() => {
    if (!group) return;
    const plan = planRenumber(draft, group.id);
    if (plan.ok === false) { setIssues([{ level: "error", message: plan.error }]); return; }
    if (!plan.changed) { toast({ title: "Row numbers already up to date" }); return; }
    setDraft((d) => applyRenumber(d, group.id, plan)); setIssues([]);
    toast({ title: `Updated ${plan.changed} row number${plan.changed === 1 ? "" : "s"}`, description: "Shapes and edits unchanged. Press Save Draft to keep this." });
  });
  const status = group ? groupStatus(draft, group) : null;
  const step = !group ? 1 : group.mode !== "imported" && (group.referenceTrace.length < 2 || tool === "trace") ? 2
    : !group.rows.length || status?.countDiffers ? 3 : dirty ? 4 : 0;

  const doSave = async () => {
    if (busyRef.current || setupRequired) return;
    const errs = [...validateDraftShape(draft, scope), ...checkDraftGeometry(draft, boundary).filter((i) => i.level === "error").map((i) => i.message)];
    if (errs.length) { setSaveError(`Fix these first: ${errs.slice(0, 5).join(" ")}`); return; }
    const json = JSON.stringify(draft);
    const a = attempt.current;
    if (!a || a.json !== json || a.revision !== base.revision || a.draftId !== base.draftId)
      attempt.current = { json, id: generateUuid(), revision: base.revision, draftId: base.draftId };
    const snap = attempt.current!;
    setBusy("saving"); setSaveError(null);
    try {
      const s = await saveDraft(scope, { draftId: snap.draftId, revision: snap.revision }, snap.id, JSON.parse(snap.json));
      if (copyKey) reconcileSaved(copyKey, snap.json, { draftId: s.draftId, revision: s.revision });
      savedJson.current = snap.json;
      attempt.current = null;
      setBase({ draftId: s.draftId, revision: s.revision });
      onSaved(s);
      toast({ title: "Draft saved", description: `Revision ${s.revision} confirmed by VineTrack.` });
    } catch (e) {
      setSaveError(e instanceof DraftApiError ? e.message : (e as Error).message);
    } finally { setBusy(null); }
  };

  const resetToEmpty = () => {
    const fresh = newDraft(scope.vineyardId, scope.paddockId);
    setDraftRaw(fresh); savedJson.current = JSON.stringify(fresh); attempt.current = null;
    setGroupId(null); setRowSel(null); setIssues([]); setToolRaw("none"); setSaveError(null);
  };
  const doDiscard = guard(() => setConfirm({
    title: base.draftId ? "Discard this draft?" : "Clear this unsaved draft?",
    body: base.draftId ? "This deletes the saved draft mapping for this block. Block setup and real rows are not affected." : "Everything in this unsaved draft will be cleared.",
    action: async () => {
      if (busyRef.current) return;
      if (!base.draftId) { resetToEmpty(); toast({ title: "Unsaved draft cleared" }); return; }
      setBusy("discarding");
      try {
        const r = await discardDraft(scope.paddockId, base.draftId, base.revision);
        busyRef.current = null;
        if (copyKey) clearWorkingCopy(copyKey);
        savedJson.current = JSON.stringify(draft); // suppress leave guard during remount
        onDiscarded(r.revision);
        toast({ title: r.alreadyDiscarded ? "Draft was already discarded" : "Draft discarded" });
      } catch (e) { setSaveError((e as Error).message); setBusy(null); }
    },
  }));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportDraft(draft), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(paddock.name ?? "block").replace(/[^\w-]+/g, "_")}-contour-draft.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const onBackupFile = async (f: File) => {
    if (busyRef.current) return;
    try {
      if (f.size > LIMITS.maxBackupFileBytes) throw new Error("This backup is larger than 5 MB.");
      const text = await f.text();
      const info = readBackupFile(text, scope, draft.draftId);
      setBackup({ text, canRestoreInPlace: info.canRestoreInPlace, fileName: f.name });
    } catch (e) { toast({ title: "Couldn't read backup", description: (e as Error).message, variant: "destructive" }); }
  };
  const applyBackup = (mode: "restore" | "copy") => {
    if (!backup || busyRef.current) return;
    try {
      const next = importDraftFile(backup.text, scope, draft.draftId, mode);
      const geo = checkDraftGeometry(next, boundary).filter((i) => i.level === "error");
      if (geo.length) throw new Error(`The backup's rows don't fit this block: ${geo[0].message}`);
      setDraft(next); setGroupId(next.groups[0]?.id ?? null); setRowSel(null); setIssues([]); setBackup(null);
      toast({ title: mode === "restore" ? "Backup restored" : "Backup imported as a copy",
        description: mode === "restore" ? "All identities kept. Save to keep these changes."
          : "Group, row and part identities were regenerated and row links cleared; this block's draft id is kept. Save to keep these changes." });
    } catch (e) { toast({ title: "Couldn't import backup", description: (e as Error).message, variant: "destructive" }); }
  };

  const onLineFile = async (f: File) => {
    if (busyRef.current) return;
    try {
      if (f.size > IMPORT_LIMITS.maxBytes) throw new Error("File is larger than 5 MB.");
      const res = parseLineFile(f.name, await f.text());
      if (looksSwapped(res.lines, boundary)) throw new Error("The coordinates look like latitude and longitude are swapped. Re-export with longitude first (GeoJSON) or check the source.");
      const far = linesFarOutside(res.lines, boundary);
      if (far.length) throw new Error(`${far.length} line(s) are more than 100 m outside this block. Check the file is for this block.`);
      let next = nextFreeRowNumber(draft);
      const numbers = res.lines.map((l) => l.suggestedNumber ?? next++);
      setLineImport({ res, fileName: f.name, numbers, error: null });
    } catch (e) { toast({ title: "Couldn't read file", description: (e as Error).message, variant: "destructive" }); }
  };
  const used = new Set(allRows.map((r) => r.number));
  const importDups = lineImport ? duplicateNumbers(lineImport.numbers, used) : [];
  const commitLineImport = () => {
    if (!lineImport || busyRef.current || importDups.length || lineImport.numbers.some((n) => !Number.isInteger(n) || n < 1 || n > LIMITS.maxRowNumber)) return;
    const g: RowGroup = {
      ...newGroup(`Imported: ${lineImport.fileName}`.slice(0, LIMITS.maxNameLength), lineImport.numbers[0] ?? 1), mode: "imported", leftCount: 0, rightCount: 0,
      rows: lineImport.res.lines.map((l, i) => ({
        id: generateUuid(), number: lineImport.numbers[i], offsetIndex: null, provenance: "imported", canonicalRowId: null,
        source: { format: lineImport.res.format, fileName: lineImport.fileName.slice(0, 200), featureIndex: l.featureIndex, name: l.name?.slice(0, 200) ?? undefined },
        parts: l.parts.map((p) => ({ id: generateUuid(), points: p })),
      })),
    };
    const candidate = { ...draft, groups: [...draft.groups, g] };
    const errs = [...validateDraftShape(candidate, scope), ...checkDraftGeometry(candidate, boundary).filter((i) => i.level === "error").map((i) => i.message)];
    if (errs.length) { setLineImport({ ...lineImport, error: errs.slice(0, 5).join(" ") }); return; }
    setDraft(candidate);
    setGroupId(g.id); setLineImport(null);
  };

  const groupMetrics = useMemo(() => (group ? rowMetrics(group.rows, boundary) : []), [group, boundary]);
  const allMetrics = useMemo(() => rowMetrics(allRows, boundary), [allRows, boundary]);
  const sum = (m: typeof allMetrics, k: "lengthM" | "chordM") => m.reduce((s, r) => s + r[k], 0);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const locked = !!busy;
  const centre = boundary[0] ?? { lat: -34.5, lng: 138.7 };
  const mapShapes: CShape[] = [];
  if (boundary.length >= 3) mapShapes.push({ id: "boundary", kind: "polygon", points: boundary, color: "#34C759", width: 2, fillOpacity: 0.05 });
  legacyRows.forEach((r, i) => { if (r.start && r.end) mapShapes.push({ id: `legacy-${i}`, kind: "polyline", points: [r.start, r.end], color: EXISTING_COLOUR, width: 1, opacity: 0.35, dash: [3, 4] }); });
  const mapMarkers: CMarker[] = [];
  for (const g of draft.groups) {
    const active = g.id === groupId; const selRowId = rowSel?.rowId ?? null;
    if (g.workingArea && g.workingArea.length >= 2) mapShapes.push({ id: `wa-${g.id}`, kind: "polygon", points: g.workingArea, color: "#60A5FA", width: active ? 2 : 1, dash: [6, 4], fillOpacity: 0.04 });
    g.exclusions.forEach((m) => { if (m.points.length >= 2) mapShapes.push({ id: `ex-${m.id}`, kind: "polygon", points: m.points, color: "#F87171", width: 1.5, fillOpacity: 0.25 }); });
    g.rows.forEach((r) => r.parts.forEach((p) => mapShapes.push({
      id: `row-${p.id}`, kind: "polyline", points: p.points,
      color: r.id === selRowId ? SELECTED_COLOUR : DRAFT_COLOUR, width: r.id === selRowId ? 4 : active ? 2.5 : 1.5, opacity: active ? 1 : 0.6,
      onClick: guard(() => { setGroupId(g.id); setTool("none"); setRowSel({ rowId: r.id, part: 0, idx: null }); }),
    })));
    if (g.referenceTrace.length >= 2) {
      mapShapes.push({ id: `trace-${g.id}`, kind: "polyline", points: g.referenceTrace, color: "#F97316", width: active ? 3 : 1.5, dash: [8, 6] });
      if (active) mapMarkers.push({ id: `end-${g.id}`, point: g.referenceTrace[g.referenceTrace.length - 1], size: 16, labelOffsetX: 30,
        html: `<div style="color:#F97316;font-weight:700;font-size:14px;text-shadow:0 0 2px #000;white-space:nowrap">▶ end</div>` });
    }
  }
  if (shiftDir?.source === "row" && shiftDir.start && shiftDir.end && group) {
    const cue = (t: string) => `<div style="color:#F97316;font-weight:700;font-size:12px;text-shadow:0 0 2px #000;white-space:nowrap">${t}</div>`;
    mapMarkers.push({ id: `shift-start-${group.id}`, point: shiftDir.start, size: 14, labelOffsetX: 8, html: cue(`● start row ${shiftDir.rowNumber}`) });
    mapMarkers.push({ id: `shift-end-${group.id}`, point: shiftDir.end, size: 14, labelOffsetX: 8, html: cue("▶ end") });
  }
  const dot = (active: boolean) => `<div style="width:12px;height:12px;border-radius:9999px;border:2px solid #fff;background:${active ? "#EF4444" : "#0EA5E9"};box-shadow:0 0 2px #000"></div>`;
  if (group && tool !== "none") {
    editPts.forEach((p, i) => mapMarkers.push({ id: `v-${tool}-${exclusionId}-${i}`, point: p, size: 12, html: dot(selVertex === i), draggable: !locked,
      onClick: () => setSelVertex(i),
      onDragEnd: (q) => setEditPts((pts) => pts.map((x, j) => (j === i ? q : x))) }));
    if (!locked) editPts.forEach((a, i) => {
      const b = editPts[i + 1] ?? (closedOutline && editPts.length >= 3 ? editPts[0] : null);
      if (!b) return;
      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      mapMarkers.push({ id: `m-${tool}-${i}`, point: mid, size: 8, html: `<div style="width:8px;height:8px;border-radius:9999px;background:#fff;opacity:.8"></div>`,
        onClick: () => setEditPts((pts) => { const t = pts.slice(); t.splice(i + 1, 0, mid); return t; }) });
    });
  }
  if (selRow) selRow.parts.forEach((p, pi) => p.points.forEach((q, qi) => mapMarkers.push({
    id: `r-${pi}-${qi}`, point: q, size: 12, html: dot(rowSel?.part === pi && rowSel?.idx === qi), draggable: !locked,
    onClick: () => setRowSel({ rowId: selRow.id, part: pi, idx: qi }),
    onDragEnd: (x) => updateRow(selRow.id, (r) => moveVertex(r, pi, qi, x)),
  })));
  const blocking = hasErrors(geoIssues) || shapeErrors.length > 0;
  // Selecting a different row opens Row edit (not repeated for point clicks on the same row).
  const selRowId = rowSel?.rowId ?? null;
  useEffect(() => { if (selRowId) setPanelTab("row"); }, [selRowId]);
  const canSave = !setupRequired && dirty && !busy && !blocking;

  return (
    <div className="space-y-4">
      <BackTo id={paddock.id} />
      <RowMapWorkspace title="Contour mapping" revealKey={rowSel?.rowId ?? null} onFit={() => setFitNonce((n) => n + 1)} settings={<>
      <PanelTabs label="Contour mapping" value={panelTab} onValueChange={setPanelTab}
        header={<div className="space-y-2">
                <h1 className="text-lg font-semibold tracking-tight text-orange-600 dark:text-orange-400">Contour Row Mapping (Beta)</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{paddock.name}</span>
          <Badge variant="outline">Draft mapping — for review</Badge>
          {busy === "saving" ? <Badge variant="secondary">Saving… editing paused</Badge>
            : dirty ? <Badge variant="secondary">Unsaved changes</Badge>
            : base.draftId ? <Badge variant="secondary">Saved · revision {base.revision}</Badge> : <Badge variant="secondary">Not yet saved</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={doSave} disabled={!canSave} className={`gap-1 ${step === 4 ? "ring-2 ring-orange-500" : ""}`}><Save className="h-4 w-4" /> {busy === "saving" ? "Saving…" : "Save Draft"}</Button>
          <Button size="sm" variant="outline" disabled={!dirty || locked} onClick={guard(() => setConfirm({ title: "Cancel unsaved edits?", body: "Your changes since the last save will be lost.", action: () => { if (busyRef.current) return; setDraftRaw(JSON.parse(savedJson.current)); setRowSel(null); setIssues([]); setToolRaw("none"); } }))}>Cancel edits</Button>
          {blocking && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPanelTab("review")}>Fix problems</Button>}
        </div>
      {showRestored && (
        <Alert><Info className="h-4 w-4" /><AlertTitle>Unsaved draft restored</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>Your unsaved changes from earlier in this browser tab were kept. They are not saved to VineTrack until you press Save.
              {serverMoved && " The saved draft has changed since — saving will report a conflict; export a backup first."}</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setShowRestored(false)}>OK</Button>
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => setConfirm({ title: "Throw away restored changes?", body: "The editor goes back to the last saved draft.", action: () => { if (copyKey) clearWorkingCopy(copyKey); onReload(); } })}>Throw away and reload</Button></div>
          </AlertDescription></Alert>
      )}
      {setupRequired && (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Database setup required — saving is off</AlertTitle>
          <AlertDescription>The VineTrack database doesn't have Contour Row Mapping storage yet. You can try the tools and export a backup, but nothing can be saved until it's set up.</AlertDescription></Alert>
      )}
      {saveError && (
        <Alert variant="destructive"><AlertTitle>Draft not saved</AlertTitle>
          <AlertDescription className="space-y-2"><p>{saveError}</p><p>Your edits are still here.</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={locked || !canSave} onClick={doSave}>Try again</Button>
              <Button size="sm" variant="outline" onClick={exportJson}>Export backup</Button>
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => setConfirm({ title: "Reload latest?", body: "Your unsaved edits here will be lost. Export a backup first if you need them.", action: () => { savedJson.current = JSON.stringify(draft); if (copyKey) clearWorkingCopy(copyKey); onReload(); } })}>Reload latest (loses edits)</Button></div>
          </AlertDescription></Alert>
      )}
      {boundary.length < 3 && <Alert variant="destructive"><AlertTitle>No block boundary</AlertTitle><AlertDescription>Draw the block boundary in Block Setup first.</AlertDescription></Alert>}

        </div>}
        tabs={[
          { id: "groups", label: "Groups", content: <>
        <div className="rounded border bg-muted/40 p-2 text-[11px] text-muted-foreground space-y-1">
          <p><b>Rows tab</b> keeps the block's active rows, used for totals and the mobile apps.</p>
          <p><b>This page</b> is a separate review draft. Save Draft keeps it but doesn't replace the active rows, row count, boundary or vine counts.</p>
        </div>
        <ol className="w-full space-y-0.5 text-xs" aria-label="Steps">
          {["Add or select a row group", "Start trace, click along one vine row, then Finish trace", "Set spacing, left/right counts and first number, then Generate rows", "Review the rows, then Save Draft"].map((t, i) => (
            <li key={i} className={`rounded px-2 py-0.5 ${step === i + 1 ? "bg-orange-500/15 font-semibold text-orange-700 dark:text-orange-300" : "text-muted-foreground"}`} aria-current={step === i + 1 ? "step" : undefined}>{i + 1}. {t}{step === i + 1 ? " ← next" : ""}</li>
          ))}
        </ol>
<fieldset disabled={locked} className="min-w-0">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Row groups</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {draft.groups.map((g) => (
                <button key={g.id} type="button" onClick={guard(() => { setGroupId(g.id); setRowSel(null); setIssues([]); setTool("none"); setPanelTab("setup"); })}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${g.id === groupId ? "border-primary bg-primary/10" : "bg-card"}`}>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.mode === "imported" ? "Imported" : g.mode === "contour" ? "Contour" : "Straight"} · {g.rows.length} rows drafted</div>
                </button>
              ))}
              <Button size="sm" variant={step === 1 ? "default" : "outline"} className="w-full gap-1" onClick={addGroup}><Plus className="h-4 w-4" /> Add row group</Button>
            </CardContent></Card>

</fieldset>
          </> },
          { id: "setup", label: "Setup", content: <fieldset disabled={locked} className="min-w-0">
            {group ? null : <p className="text-xs text-muted-foreground">Add or select a row group first.</p>}
          {group && <GroupPanel g={group} tool={tool} setTool={setTool} exclusionId={exclusionId} setExclusionId={setExclusionId}
            update={(f) => updateGroup(group.id, f)} selVertex={selVertex} setSelVertex={setSelVertex}
            onDeleteVertex={() => { if (selVertex == null) return; setEditPts((pts) => pts.filter((_, i) => i !== selVertex)); setSelVertex(null); }}
            onUndoVertex={() => setEditPts((pts) => pts.slice(0, -1))} editCount={editPts.length}
            onGenerate={generate} issues={issues} locked={locked} status={status!} step={step} onRenumber={renumber}
            shift={{ amount: shiftM, setAmount: setShiftM, onShift: doShift, canUndo: canUndoShift(shiftUndo, group), onUndo: undoShift, dir: shiftDir }}
            onDelete={() => setConfirm({ title: `Delete ${group.name}?`, body: "Only this group's draft rows are removed. Other groups keep their numbers.", action: () => { setDraft((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== group.id) })); setGroupId(null); setRowSel(null); } })} />}

</fieldset> },
          { id: "row", label: "Row edit", content: <fieldset disabled={locked} className="min-w-0">
            {!(selRow && rowSel) && <p className="text-xs text-muted-foreground">Click a drafted row on the map, or in the Review table, to edit it.</p>}
{selRow && rowSel && (
            <Card className="border-yellow-500"><CardHeader className="pb-2"><CardTitle className="text-base">Row {selRow.number} <span className="text-xs font-normal text-muted-foreground">({selRow.provenance}, {selRow.parts.length} part{selRow.parts.length === 1 ? "" : "s"})</span></CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">Drag points on the map. Click a point to select it.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => { updateRow(selRow.id, (r) => deleteVertex(r, rowSel.part, rowSel.idx!)); setRowSel({ ...rowSel, idx: null }); }}>Delete point</Button>
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => updateRow(selRow.id, (r) => insertVertexAfter(r, rowSel.part, rowSel.idx!))}>Add point after</Button>
                  <Button size="sm" variant="outline" disabled={rowSel.idx == null} onClick={() => { try { updateRow(selRow.id, (r) => splitAfterVertex(r, rowSel.part, rowSel.idx!)); setRowSel({ ...rowSel, idx: null }); } catch (e) { toast({ title: "Can't split here", description: (e as Error).message }); } }}>Split after point</Button>
                </div>
                <div className="flex items-end gap-2">
                  <NumberStepper className="w-36" label="Trim (m)" value={trimM} onChange={setTrimM} min={0.1} max={1000} step={0.1} disabled={locked} />
                  <Button size="sm" variant="outline" onClick={() => updateRow(selRow.id, (r) => trimRow(r, "start", trimM))}>Trim start</Button>
                  <Button size="sm" variant="outline" onClick={() => updateRow(selRow.id, (r) => trimRow(r, "end", trimM))}>Trim end</Button>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-2">
                  <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => { const g = draft.groups.find((g) => g.rows.some((r) => r.id === selRow.id)); if (g) askDeleteRow(g.id, selRow.id); }}><Trash2 className="h-3.5 w-3.5" /> Delete row</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRowSel(null)}>Done</Button>
                </div>
              </CardContent></Card>
          )}

</fieldset> },
          { id: "review", label: "Review", badge: blocking ? <span className="ml-0.5 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">!</span> : null, content: <>
<fieldset disabled={locked} className="space-y-3 min-w-0">
          {(geoIssues.length > 0 || shapeErrors.length > 0 || missingLinks > 0) && (
            <Card className="border-destructive/50"><CardHeader className="pb-2"><CardTitle className="text-base">Draft check</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {shapeErrors.map((m, k) => <p key={`s${k}`} className="text-xs text-destructive">Problem: {m}</p>)}
                {geoIssues.slice(0, 20).map((i, k) => <p key={`g${k}`} className={`text-xs ${i.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.level === "error" ? "Problem: " : "Check: "}{i.message}</p>)}
                {geoIssues.length > 20 && <p className="text-xs text-muted-foreground">…and {geoIssues.length - 20} more.</p>}
                {missingLinks > 0 && <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.canonicalRowId && !scope.canonicalRowIds?.has(r.canonicalRowId) ? { ...r, canonicalRowId: null } : r)) })) }))}>Clear {missingLinks} link(s) to rows no longer in this block</Button>}
                {blocking && <p className="text-xs text-muted-foreground">Saving is off until problems are fixed.</p>}
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
                      <tr key={m.rowId} className={`cursor-pointer border-t ${rowSel?.rowId === m.rowId ? "bg-primary/10" : ""}`} onClick={guard(() => { setTool("none"); setRowSel({ rowId: m.rowId, part: 0, idx: null }); })}>
                        <td className="p-1">{m.number}</td><td className="p-1 text-right">{fmt(m.lengthM)}</td><td className="p-1 text-right">{fmt(m.chordM)}</td><td className="p-1 text-right">{m.parts}</td></tr>
                    ))}</tbody></table>
                </div>
              )}
            </CardContent></Card>
</fieldset>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={exportJson}><Download className="h-4 w-4" /> Export backup</Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={locked} onClick={() => jsonInput.current?.click()}><Upload className="h-4 w-4" /> Restore backup</Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={locked} onClick={() => lineInput.current?.click()}><Upload className="h-4 w-4" /> Import rows (GeoJSON/KML)</Button>
          <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={setupRequired || locked || (!base.draftId && !dirty)} onClick={doDiscard}><Trash2 className="h-4 w-4" /> {base.draftId ? "Discard draft" : "Clear draft"}</Button>
          <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onBackupFile(f); }} />
          <input ref={lineInput} type="file" accept=".geojson,.json,.kml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onLineFile(f); }} />
        </div>
          </> },
        ]} />
      </>}>
        <ContourAppleMap centre={centre} fitPoints={boundary} fitNonce={fitNonce} onMapClick={onMapClick}
          shapes={mapShapes} markers={mapMarkers} controlsPosition="left" />
        {tool !== "none" && <div className="pointer-events-none absolute left-3 right-3 bottom-10 z-[400] rounded bg-background/90 px-3 py-1.5 text-xs shadow md:right-[410px]">
          {tool === "trace" ? "Click along one existing vine row, from one end to the other." : tool === "area" ? "Click to outline the working area. Drag points to move them; click a white dot to add one." : "Click to outline a track or obstacle. Drag points to move them; click a white dot to add one."}
        </div>}
      </RowMapWorkspace>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.body}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const a = confirm?.action; setConfirm(null); a?.(); }}>Continue</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>

      <AlertDialog open={!!backup} onOpenChange={(o) => !o && setBackup(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restore backup</AlertDialogTitle>
          <AlertDialogDescription>
            {backup?.canRestoreInPlace
              ? "This backup is from this same draft. Restore it with all identities kept, or import it as a copy with fresh group/row/part identities."
              : "This backup is from a different draft or block, so it can only be imported as a copy: group, row and part identities are regenerated and links to block rows are cleared. This block keeps its own draft id."}
            {" "}It replaces what's currently in the editor (not saved until you press Save).
          </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => applyBackup("copy")}>Import as new copy</Button>
            {backup?.canRestoreInPlace && <Button onClick={() => applyBackup("restore")}>Restore into this draft</Button>}
          </AlertDialogFooter>
        </AlertDialogContent></AlertDialog>

      <AlertDialog open={!!lineImport} onOpenChange={(o) => !o && setLineImport(null)}>
        <AlertDialogContent className="max-w-lg"><AlertDialogHeader><AlertDialogTitle>Import rows into the draft</AlertDialogTitle>
          <AlertDialogDescription>Rows are added to a new group in this draft only. Check the row numbers.</AlertDialogDescription></AlertDialogHeader>
          {lineImport && <div className="space-y-2 text-sm">
            {lineImport.res.warnings.map((w, i) => <p key={i} className="text-xs text-muted-foreground">{w}</p>)}
            <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-xs"><thead className="bg-muted/50"><tr><th className="p-1 text-left">Feature</th><th className="p-1 text-left">Parts</th><th className="p-1 text-left">Row number</th></tr></thead>
              <tbody>{lineImport.res.lines.map((l, i) => (
                <tr key={i} className="border-t"><td className="p-1">{l.name ?? `#${l.featureIndex + 1}`}</td><td className="p-1">{l.parts.length}</td>
                  <td className="p-1"><NumberStepper className="w-36" hideLabel label={`Row number for ${l.name ?? `feature ${l.featureIndex + 1}`}`} integer min={1} max={LIMITS.maxRowNumber} step={1} disabled={locked}
                    value={Number.isFinite(lineImport.numbers[i]) ? lineImport.numbers[i] : 1}
                    onChange={(n) => setLineImport((cur) => cur && ({ ...cur, error: null, numbers: cur.numbers.map((x, j) => (j === i ? n : x)) }))} /></td></tr>
              ))}</tbody></table></div>
            {importDups.length > 0 && <p className="text-xs text-destructive">Row numbers used more than once or already in the draft: {importDups.join(", ")}</p>}
            {lineImport.error && <p className="text-xs text-destructive">Can't add these rows: {lineImport.error}</p>}
          </div>}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={importDups.length > 0 || locked} onClick={commitLineImport}>Add to draft</Button></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>
    </div>
  );
}

function GroupPanel({ g, tool, setTool, exclusionId, setExclusionId, update, selVertex, setSelVertex, onDeleteVertex, onUndoVertex, editCount, onGenerate, issues, onDelete, locked, shift, status, step, onRenumber }: {
  g: RowGroup; tool: Tool; setTool: (t: Tool) => void; exclusionId: string | null; setExclusionId: (s: string | null) => void;
  update: (f: (g: RowGroup) => RowGroup) => void; selVertex: number | null; setSelVertex: (n: number | null) => void;
  onDeleteVertex: () => void; onUndoVertex: () => void; editCount: number;
  onGenerate: () => void; issues: GenIssue[]; onDelete: () => void; locked: boolean;
  status: ReturnType<typeof groupStatus>; step: number; onRenumber: () => void;
  shift: { amount: number; setAmount: (n: number) => void; onShift: (s: ShiftSide) => void; canUndo: boolean; onUndo: () => void; dir: ReturnType<typeof shiftDirection> };
}) {
  const hasGeometry = g.referenceTrace.length > 0 || g.rows.length > 0;
  const imported = g.mode === "imported";
  const maskEditing = tool === "area" || tool === "exclusion";
  const maskTools = maskEditing && (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className="gap-1" disabled={!editCount} onClick={onUndoVertex}><Undo2 className="h-3.5 w-3.5" /> Undo point</Button>
      <Button size="sm" variant="outline" disabled={selVertex == null} onClick={onDeleteVertex}>Delete selected point</Button>
      <span className="text-[11px] text-muted-foreground self-center">{editCount} points{editCount < 3 ? " — needs at least 3" : ""}</span>
    </div>
  );
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Group settings</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div><Label className="text-xs">Name</Label><Input className="h-8" maxLength={LIMITS.maxNameLength} value={g.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></div>
        {!imported && <>
          <div className="flex gap-2">
            {(["contour", "straight"] as const).map((m) => <Button key={m} size="sm" variant={g.mode === m ? "default" : "outline"} onClick={() => update((x) => ({ ...x, mode: m }))}>{m === "contour" ? "Contour" : "Straight"}</Button>)}
          </div>
          <div className="rounded border p-2 space-y-2">
            <div className="font-medium text-xs">Trace one existing row</div>
            <p className="text-[11px] text-muted-foreground">{g.mode === "straight" ? "Click the two ends of one row." : "Click points along one vine row on the satellite image, end to end. Drag points to adjust; click a white dot to add a point."}</p>
            <div className="flex flex-wrap gap-2">
              <Button size={step === 2 ? "default" : "sm"} variant={tool === "trace" || step === 2 ? "default" : "outline"} className={step === 2 ? "bg-orange-600 text-white hover:bg-orange-700 font-semibold" : ""} onClick={() => setTool(tool === "trace" ? "none" : "trace")}>{tool === "trace" ? "Finish trace" : g.referenceTrace.length ? "Edit trace" : "Start trace"}</Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={!g.referenceTrace.length} onClick={() => update((x) => ({ ...x, referenceTrace: x.referenceTrace.slice(0, -1) }))}><Undo2 className="h-3.5 w-3.5" /> Undo point</Button>
              <Button size="sm" variant="outline" disabled={selVertex == null || tool !== "trace"} onClick={onDeleteVertex}>Delete point</Button>
            </div>
            <div className="text-[11px] text-muted-foreground">{g.referenceTrace.length} points</div>
            {g.mode === "contour" && <div className="flex items-center gap-2 text-xs"><Label className="text-xs">Smoothing</Label>
              {[0, 1, 2].map((s) => <Button key={s} size="sm" variant={g.smoothing === s ? "default" : "outline"} className="h-7 px-2" onClick={() => update((x) => ({ ...x, smoothing: s }))}>{s === 0 ? "Off" : s === 1 ? "Light" : "More"}</Button>)}</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberStepper label="Row spacing (m)" value={g.spacingM} min={LIMITS.minSpacingM} max={LIMITS.maxSpacingM} step={0.1} disabled={locked} onChange={(n) => update((x) => ({ ...x, spacingM: n }))} />
            <NumberStepper label="Rows on the left" integer value={g.leftCount} min={0} max={LIMITS.maxSideCount} step={1} disabled={locked} hint="Extra rows" onChange={(n) => update((x) => ({ ...x, leftCount: n }))} />
            <NumberStepper label="Rows on the right" integer value={g.rightCount} min={0} max={LIMITS.maxSideCount} step={1} disabled={locked} hint="Extra rows" onChange={(n) => update((x) => ({ ...x, rightCount: n }))} />
          </div>
          <p className="text-xs">Total: <b>{Number.isFinite(totalRowsFor(g)) ? totalRowsFor(g) : "—"}</b> rows (traced row + {g.leftCount} left + {g.rightCount} right). Left and right are as you face the ▶ end arrow.</p>
          <div className="flex items-center gap-2"><Switch checked={g.extendToArea} onCheckedChange={(v) => update((x) => ({ ...x, extendToArea: v }))} />
            <span className="text-xs">Extend rows to the edge of the area</span></div>
        </>}
        <div className="rounded border p-2 space-y-2">
          <div className="font-medium text-xs">Row numbers</div>
          <NumberStepper label="Starting row number" integer value={g.startNumber} min={1} max={LIMITS.maxRowNumber} step={1} disabled={locked} onChange={(n) => update((x) => ({ ...x, startNumber: n }))} />
          <div className="flex items-center gap-2"><Switch checked={g.ascending} onCheckedChange={(v) => update((x) => ({ ...x, ascending: v }))} />
            <span className="text-xs">{g.ascending ? "Numbers go up from left to right" : "Numbers go up from right to left"}</span></div>
          {g.rows.length > 0 && <>
            <p className="text-[11px] text-muted-foreground">Update row numbers renumbers the {g.rows.length} rows already drafted, {imported ? "in the order they were imported" : "left to right as you face ▶ end"}, without moving or recreating them. Gaps from deleted rows close up.</p>
            <Button size="sm" variant={status.numbersOutOfDate ? "default" : "outline"} disabled={locked} onClick={onRenumber}>Update row numbers</Button>
            {status.numbersOutOfDate && <p className="text-[11px] text-amber-700 dark:text-amber-400">Drafted row numbers don't match these settings yet.</p>}
          </>}
        </div>
        {hasGeometry && <div className="rounded border p-2 space-y-2">
          <div className="font-medium text-xs">Side shift</div>
          <p className="text-[11px] text-muted-foreground">Slides this group's trace and all its rows sideways together, keeping their shape, spacing and edits. Left/right are as you face the {shift.dir?.source === "row" ? `direction of row ${shift.dir.rowNumber} (from the orange "start" marker to "▶ end" on the map)` : "▶ end arrow"}. The map isn't rotated; working areas, cut-outs and other groups don't move.</p>
          <div className="flex flex-wrap items-end gap-2">
            <NumberStepper className="w-36" label="Side shift (m)" value={shift.amount} min={SHIFT_LIMITS.minM} max={SHIFT_LIMITS.maxM} step={0.1} disabled={locked} onChange={shift.setAmount} />
            <Button size="sm" variant="outline" disabled={locked || !shift.dir} onClick={() => shift.onShift("left")}>◀ Shift left</Button>
            <Button size="sm" variant="outline" disabled={locked || !shift.dir} onClick={() => shift.onShift("right")}>Shift right ▶</Button>
            <Button size="sm" variant="ghost" className="gap-1" disabled={locked || !shift.canUndo} onClick={shift.onUndo}><Undo2 className="h-3.5 w-3.5" /> Undo shift</Button>
          </div>
          {!shift.dir && <p className="text-[11px] text-amber-700 dark:text-amber-400">Shift needs a trace or row at least 0.5 m long to know which way is left and right.</p>}
        </div>}
        <div className="rounded border p-2 space-y-2">
          <div className="font-medium text-xs">Working area & cut-outs (optional)</div>
          <p className="text-[11px] text-muted-foreground">Limit this group to part of the block so differently aligned rows don't overlap. Cut out tracks or obstacles. Editing an outline never changes rows until you regenerate. The real block boundary isn't changed.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={tool === "area" ? "default" : "outline"} onClick={() => { if (tool !== "area" && !g.workingArea) update((x) => ({ ...x, workingArea: [] })); setTool(tool === "area" ? "none" : "area"); }}>{tool === "area" ? "Finish area" : g.workingArea?.length ? "Edit area" : "Draw area"}</Button>
            {g.workingArea && <Button size="sm" variant="outline" onClick={() => { update((x) => ({ ...x, workingArea: null })); if (tool === "area") setTool("none"); }}>Clear area</Button>}
            <Button size="sm" variant="outline" onClick={() => { const id = generateUuid(); update((x) => ({ ...x, exclusions: [...x.exclusions, { id, points: [] }] })); setExclusionId(id); setTool("exclusion"); }}>Add cut-out</Button>
            {tool === "exclusion" && <Button size="sm" onClick={() => setTool("none")}>Finish cut-out</Button>}
          </div>
          {maskTools}
          {g.exclusions.map((m, i) => (
            <div key={m.id} className="flex items-center justify-between text-xs"><span className={m.id === exclusionId && tool === "exclusion" ? "font-semibold" : ""}>Cut-out {i + 1} · {m.points.length} pts</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6" onClick={() => { setExclusionId(m.id); setTool("exclusion"); }}>Edit</Button>
                <Button size="sm" variant="ghost" className="h-6" onClick={() => { update((x) => ({ ...x, exclusions: x.exclusions.filter((e) => e.id !== m.id) })); if (exclusionId === m.id) { setExclusionId(null); setTool("none"); } }}>Remove</Button>
              </span></div>
          ))}
        </div>
        <p className="text-xs">Drafted now: <b>{status.drafted}</b> rows{!imported && <> · these settings would generate <b>{Number.isFinite(status.configured) ? status.configured : "—"}</b></>}</p>
        {status.countDiffers && <p className="text-[11px] text-amber-700 dark:text-amber-400">Settings differ from the drafted rows. Regenerate to apply spacing/count changes (this replaces hand edits and deleted rows).</p>}
        {!imported && <Button className={`w-full ${step === 3 ? "ring-2 ring-orange-500" : ""}`} onClick={onGenerate}>{g.rows.length ? "Regenerate rows" : "Generate rows"}</Button>}
        {issues.length > 0 && <div className="space-y-1">{issues.map((i, k) => (
          <p key={k} className={`text-xs ${i.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.level === "error" ? "Problem: " : "Check: "}{i.message}</p>
        ))}</div>}
        <Button size="sm" variant="ghost" className="text-destructive gap-1" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete group</Button>
      </CardContent></Card>
  );
}
