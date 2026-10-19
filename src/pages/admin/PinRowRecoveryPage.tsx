// Stage 1 Existing Pin Row Recovery — System Admin, Stockman's Ridge only.
// REVIEW ONLY: no writes, no queue, no confirmations. Notes stay in this tab.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import {
  GEOMETRY_SOURCE_LABEL, RECOVERY_VINEYARD_ID, STATUS_LABEL, assessPin, isMissingRowPin,
  latestEvidenceByPin, recoveryCsv, validateKnownPins, trackSummary, CATEGORY_LABEL,
  triadOf, triadGroup, triadCoverage, isPriorityPin, TRIAD_GROUP_LABEL, type InputStatus,
  type CaptureEvidence, type RecoveryStatus,
} from "@/lib/pinRowRecovery";
import { AdminGate } from "./_shared";
import { PinRowReviewDetail } from "@/components/admin/PinRowReviewDetail";
import {
  AUTHORITY, DECISION_LABEL, DRAFT_NOTICE, buildDecision, exportDraftCsv, exportDraftJson, importDraftJson,
  writebackPreflight, type CurrentPin, type DecisionKind, type ReviewDecision,
} from "@/lib/pinRowReviewDraft";

const DRAFT_KEY = "vinetrack.pinRowReviewDraft." + RECOVERY_VINEYARD_ID;
type MissingInput = "any" | "gps" | "direction" | "side" | "block";
function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

const SAMPLE_IDS = [
  "3c15741a-ae59-48f7-80c5-e53092d715ec",
  "b07937af-3365-477e-8b4e-b9bb8122604b",
  "6f1c2656-75bf-4041-934b-9f0df043e655",
  "fa0201e1-e22b-4cf5-98c0-8f4e858ab4a4",
  "331286a7-1e1a-4bd4-a0f0-22f17b9504cf",
  "f4d91c8f-a486-4697-9ca3-ae383abe01ce",
  "6ef803a9-0391-43fc-a4e9-0315411456d2",
  "aac13d4f-4258-4fd2-87dd-0b0f93923da5",
];
const PREVIEW_URL = "https://id-preview--9b5a08c7-4e98-403e-aabb-9adeb50cdc93.lovable.app/admin/pin-row-recovery";
const PAGE = 25;
const FETCH_PAGE = 1000;
const db = supabase as any;

/** Paginate past the default 1000-row response limit. */
async function fetchAll(build: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await build().range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < FETCH_PAGE) return out;
  }
}
async function batched(ids: string[], size: number, fn: (c: string[]) => Promise<any[]>): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

export default function PinRowRecoveryPage() {
  return <AdminGate><PinRowRecoveryInner /></AdminGate>;
}

function PinRowRecoveryInner() {
  const { user } = useAuth();
  const { memberships } = useVineyard();
  const isMember = memberships.some((m: any) => (m.vineyard_id ?? m.id ?? m.vineyard?.id) === RECOVERY_VINEYARD_ID);

  const base = useQuery({
    queryKey: ["pin-row-recovery", "base"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pins, paddocks] = await Promise.all([
        fetchAll(() => db.from("pins").select("*").eq("vineyard_id", RECOVERY_VINEYARD_ID).is("deleted_at", null).order("id")),
        fetchAll(() => db.from("paddocks").select("id,name,polygon_points,rows").eq("vineyard_id", RECOVERY_VINEYARD_ID).is("deleted_at", null).order("id")),
      ]);
      return { pins, paddocks };
    },
  });
  const missing = useMemo(() => (base.data?.pins ?? []).filter(isMissingRowPin), [base.data]);
  const missingIds = useMemo(() => missing.map((p) => String(p.id)), [missing]);

  const evidence = useQuery({
    queryKey: ["pin-row-recovery", "evidence", missingIds.length],
    enabled: missingIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ map: Map<string, CaptureEvidence> | null; error: string | null }> => {
      try {
        const rows = await batched(missingIds, 100, async (c) => {
          const r = await db.from("pin_capture_evidence")
            .select("pin_id,captured_at,horizontal_accuracy_m,heading_degrees,heading_observed_at,pressed_side,observations,geometry_hash")
            .in("pin_id", c);
          if (r.error) throw r.error;
          return r.data ?? [];
        });
        return { map: latestEvidenceByPin(rows), error: null };
      } catch (e: any) { return { map: null, error: e?.message ?? "unavailable" }; }
    },
  });

  const segments = useQuery({
    queryKey: ["pin-row-recovery", "segments", missingIds.length],
    enabled: missingIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const rows = await batched(missingIds, 100, async (c) => {
          const r = await db.from("pin_row_segments").select("pin_id,row_number,segment_number").in("pin_id", c);
          if (r.error) throw r.error;
          return r.data ?? [];
        });
        const m = new Map<string, { row_number: number; segment_number: number | null }[]>();
        rows.forEach((s: any) => {
          const k = String(s.pin_id);
          m.set(k, [...(m.get(k) ?? []), { row_number: s.row_number, segment_number: s.segment_number ?? null }]);
        });
        return { map: m, error: null as string | null };
      } catch (e: any) { return { map: null, error: e?.message ?? "unavailable" }; }
    },
  });

  const [loadTrips, setLoadTrips] = useState(false);
  const trips = useQuery({
    queryKey: ["pin-row-recovery", "trips", missingIds.length],
    enabled: loadTrips && missingIds.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const ids = [...new Set(missing.map((p) => p.trip_id).filter(Boolean).map(String))];
      try {
        const rows = await batched(ids, 5, async (c) => {
          const r = await db.from("trips").select("id,path_points").in("id", c);
          if (r.error) throw r.error;
          return r.data ?? [];
        });
        const m = new Map<string, LatLng[]>();
        rows.forEach((t: any) => m.set(String(t.id), parsePolygonPoints(t.path_points)));
        return { map: m, requested: ids.length, error: null as string | null };
      } catch (e: any) { return { map: null, requested: ids.length, error: e?.message ?? "unavailable" }; }
    },
  });

  const rows = useMemo(() => {
    if (!base.data) return [];
    const ev = {
      paddocks: base.data.paddocks,
      evidence: evidence.data?.map ?? null,
      segments: segments.data?.map ?? null,
      trips: !loadTrips || trips.isLoading ? ("not_loaded" as const) : trips.data?.map ?? null,
    };
    return missing.map((p) => assessPin(p, ev));
  }, [base.data, missing, evidence.data, segments.data, trips.data, trips.isLoading, loadTrips]);
  // Same evidence without tracks — baseline for status transitions.
  const rowsNoTracks = useMemo(() => {
    if (!base.data) return [];
    const ev = { paddocks: base.data.paddocks, evidence: evidence.data?.map ?? null,
      segments: segments.data?.map ?? null, trips: "not_loaded" as const };
    return missing.map((p) => assessPin(p, ev));
  }, [base.data, missing, evidence.data, segments.data]);
  const tracksLoaded = loadTrips && !trips.isLoading && !!trips.data;
  const cov = useMemo(() => triadCoverage(rows), [rows]);
  const tsum = useMemo(() => trackSummary(rowsNoTracks, rows), [rowsNoTracks, rows]);

  const counts = useMemo(() => {
    const c: Record<RecoveryStatus, number> = { supported_candidate: 0, requires_review: 0, not_resolvable: 0, preserve_existing: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const validation = useMemo(() => base.data ? validateKnownPins(base.data.pins, base.data.paddocks) : null, [base.data]);

  const [filter, setFilter] = useState<RecoveryStatus | "all" | "priority">("all");
  const [page, setPage] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [blockFilter, setBlockFilter] = useState<string>("all");
  const [missingFilter, setMissingFilter] = useState<MissingInput>("any");
  const [decisionFilter, setDecisionFilter] = useState<DecisionKind | "unreviewed" | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reviewer = user?.email ?? user?.id ?? "unknown reviewer";
  // Local-only drafts (this browser). Never sent to the database.
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>(() => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}"); } catch { return {}; }
  });
  const persist = (d: Record<string, ReviewDecision>) => { setDecisions(d); try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const shown = (filter === "priority"
    ? rows.filter(isPriorityPin)
    : [...rows.filter((r) => filter === "all" || r.status === filter)].sort((a, b) => Number(isPriorityPin(b)) - Number(isPriorityPin(a))))
    .filter((r) => blockFilter === "all" || (r.pin.paddock_id ?? "none") === blockFilter)
    .filter((r) => {
      if (missingFilter === "any") return true;
      const t = triadOf(r);
      return missingFilter === "block" ? !r.savedBlockName : t[missingFilter] !== "qualified";
    })
    .filter((r) => decisionFilter === "all" || (decisionFilter === "unreviewed" ? !decisions[r.id] : decisions[r.id]?.decision === decisionFilter));
  const segMap = segments.data?.map ?? null;
  const currentMap = useMemo(() => {
    const m = new Map<string, CurrentPin>();
    for (const r of rows) m.set(r.id, { pin: r.pin, segs: segMap ? segMap.get(r.id) ?? [] : null, row: r });
    return m;
  }, [rows, segMap]);
  const preflight = useMemo(() => base.data ? writebackPreflight(Object.values(decisions), currentMap, base.data.paddocks) : null, [decisions, currentMap, base.data]);
  const reviewSummary = useMemo(() => {
    const c: Record<string, number> = { unreviewed: 0, approve_for_writeback: 0, hold: 0, needs_field_verification: 0, preserve_existing: 0 };
    rows.forEach((r) => { c[decisions[r.id]?.decision ?? "unreviewed"]++; });
    const pri = rows.filter(isPriorityPin);
    return { ...c, priorityReviewed: pri.filter((r) => decisions[r.id]).length, priorityTotal: pri.length };
  }, [rows, decisions]);
  const selIdx = selectedId ? shown.findIndex((r) => r.id === selectedId) : -1;
  const selected = selIdx >= 0 ? shown[selIdx] : selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const go = (d: number) => { if (!shown.length) return; const i = ((selIdx < 0 ? 0 : selIdx + d) + shown.length) % shown.length; setSelectedId(shown[i].id); };
  const onImport = async (file: File) => {
    const res = importDraftJson(await file.text(), [...currentMap.values()], base.data?.paddocks ?? []);
    const next = { ...decisions };
    res.accepted.forEach((d) => { next[d.pin_id] = d; });
    persist(next);
    setImportMsg(`Imported ${res.accepted.length}. Refused as stale (pin or map changed — re-review): ${res.stale.length}${res.stale.length ? ` [${res.stale.map((s) => `${s.pin_id.slice(0, 8)}: ${s.fields.join("/")}`).join("; ")}]` : ""}. Rejected: ${res.rejected.length}${res.rejected.length ? ` [${res.rejected.map((x) => `${x.pin_id?.slice(0, 8) ?? "file"}: ${x.reason}`).join("; ")}]` : ""}.`);
  };
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));

  const exportCsv = () => {
    const blob = new Blob([recoveryCsv(rows, notes)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pin-row-recovery-candidates-NON-AUTHORITATIVE.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const stateText = (q: any, d: any) =>
    q.isLoading ? "loading" : d?.error ? `unavailable (${d.error})` : d ? "loaded" : "not loaded";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Pin Row Recovery (Stage 1 review)</h1>
        <p className="text-sm text-muted-foreground">
          Stockman's Ridge only. Review only — nothing here changes pins, rows, segments or evidence.
          Every suggestion is a non-authoritative candidate; none are confirmed.
        </p>
      </div>

      <Card className="p-4 text-sm space-y-1">
        <div><Badge variant="outline">Preview only — not published</Badge></div>
        <div>Preview link: <a className="underline" href={PREVIEW_URL}>{PREVIEW_URL}</a></div>
        <div>Signed in as: {user?.email ?? "not signed in to the VineTrack backend"}</div>
        <div>Stockman's Ridge membership: {isMember ? "yes" : "no — pins, segments and trips are member-readable, so data below may be empty or unavailable"}</div>
        <div>Geometry: {GEOMETRY_SOURCE_LABEL}.</div>
      </Card>

      {base.error && <Card className="p-4 text-sm text-destructive">Pins/blocks unavailable: {(base.error as any).message}</Card>}
      {base.isLoading && <Card className="p-4 text-sm text-muted-foreground">Loading pins and blocks…</Card>}

      {base.data && (
        <>
          <Card className="p-4 flex flex-wrap gap-3 items-center text-sm">
            <span>Active pins loaded: <b>{base.data.pins.length}</b></span>
            <span>Missing-row pins: <b>{rows.length}</b></span>
            {(Object.keys(counts) as RecoveryStatus[]).map((k) => (
              <Badge key={k} variant="outline">{STATUS_LABEL[k]}: {counts[k]}</Badge>
            ))}
            <span className="text-muted-foreground">Capture evidence: {stateText(evidence, evidence.data)}</span>
            <span className="text-muted-foreground">Row segments: {stateText(segments, segments.data)}</span>
            <span className="text-muted-foreground">
              Trip tracks: {!loadTrips ? "not loaded" : trips.isLoading ? "loading" : trips.data?.error ? `unavailable (${trips.data.error})` : `loaded ${trips.data?.map?.size ?? 0}/${trips.data?.requested ?? 0}`}
            </span>
            {!loadTrips && <Button size="sm" variant="outline" onClick={() => setLoadTrips(true)}>Load trip tracks</Button>}
            <Button size="sm" variant="outline" onClick={exportCsv}>Export CSV (non-authoritative)</Button>
          </Card>

          <Card className="p-4 text-sm space-y-1">
            <div className="font-medium">Three-input evidence coverage (GPS · travel direction · left/right)</div>
            {(["gps", "direction", "side"] as const).map((k) => (
              <div key={k}>{k === "gps" ? "A) GPS" : k === "direction" ? "B) Travel direction (movement, not phone facing)" : "C) Left/right"}:{" "}
                {(Object.entries(cov[k]) as [InputStatus, number][]).map(([s2, n]) => `${s2} ${n}`).join(" · ")}</div>
            ))}
            <div>Groups: {(Object.entries(cov.groups) as [keyof typeof TRIAD_GROUP_LABEL, number][]).map(([g, n]) => `${TRIAD_GROUP_LABEL[g]} ${n}`).join(" · ")}</div>
            <div>Side recorded {cov.withSide} (trip-linked {cov.tripLinkedWithSide}, standalone {cov.standaloneWithSide}) · no side {cov.noSide}</div>
            <div>Unique track anchor {cov.uniqueAnchor} (with side {cov.uniqueAnchorWithSide}, without {cov.uniqueAnchorNoSide}) · first-inspection set (anchor + side + saved block): {cov.priority}</div>
            <div className="text-muted-foreground">
              An exact track anchor without a qualified straight segment is not a qualified direction. Even with all three inputs,
              a pin whose GPS uncertainty can cross an aisle needs operator review. Side is never filled from nearby or similar pins.
              Nothing here is guaranteed or confirmed.{!tracksLoaded && " Trip tracks not loaded — direction counts provisional."}
            </div>
          </Card>

          <Card className="p-4 text-sm space-y-1">
            {!tracksLoaded
              ? <div className="font-medium">Trip evidence not loaded — candidate counts provisional.</div>
              : <div className="font-medium">Trip evidence loaded{trips.data?.error ? ` with failure: ${trips.data.error}` : ""}</div>}
            <div>Linked pins: {tsum.linked} · unique anchor {tsum.unique} · multiple {tsum.multiple} · none {tsum.none} · failed/unreadable {tsum.failed} · not loaded {tsum.notLoaded}</div>
            <div>Travel qualified — from GPS observations: {tsum.travelFromObs} · from trip track: {tsum.travelFromTrack}</div>
            <div>Device heading vs travel conflicts: {tsum.headingConflicts} · observation vs track conflicts: {tsum.sourceConflicts}</div>
            {tracksLoaded && <div>Status changes after loading tracks: {Object.keys(tsum.transitions).length ? Object.entries(tsum.transitions).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") : "none"}</div>}
            <div>Reasons (current evidence only — "not resolvable" may change with better track/history):{" "}
              {Object.entries(tsum.categories).map(([k, v]) => `${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k}: ${v}`).join(" · ")}</div>
            <div className="text-muted-foreground">Standalone pins without a trip are assessed without track loading.</div>
          </Card>

          {validation && (
            <Card className="p-4 text-sm space-y-1">
              <div className="font-medium">Validation against retrieved pins with a saved half-row aisle (read-only)</div>
              <div>Pins with saved half-row aisle + vine row retrieved this session: {validation.total} (with saved block: {validation.withSavedBlock})</div>
              <div>Saved vine row adjacent to saved aisle: {validation.adjacencyValid}/{validation.total} — a property of saved data, not evidence of new pairing accuracy</div>
              <div>Current-geometry aisle matches saved aisle: {validation.aisleMatch}/{validation.aisleEvaluated} · mismatches: {validation.aisleEvaluated - validation.aisleMatch}</div>
              <div>Local segment aisle (rows covering the point) matches saved: {validation.localMatch}/{validation.localEvaluated} · midpoint vs local disagree: {validation.methodDisagree}</div>
              <div>Pins with snapped coordinates: {validation.withSnapped} (mean raw→snapped {validation.meanRawSnapM?.toFixed(2) ?? "—"} m) · snapped-position aisle matches saved: {validation.snappedMatch}/{validation.snappedEvaluated}</div>
              <div>Travel + left/right predicted vine row vs saved: not yet measurable (reference pins lack qualified travel evidence in this view).</div>
              <div>Diagnostic — stored device heading + side vs saved vine row: match {validation.vineRowMatch}/{validation.vineRowEvaluated}, mismatch {validation.falsePositives}. Device heading is phone orientation, not travel; it is not used for candidates.</div>
              <div>Nearest physical row differs from saved vine row: {validation.nearestDiffersFromSaved}/{validation.total}</div>
              <table className="text-xs mt-2">
                <thead className="text-muted-foreground"><tr>{["Block", "Total", "Adjacent", "Aisle match", "−2", "−1", "0", "+1", "+2", "other", "Local match", "Method disagree", "Snapped match", "By capture month"].map((h) => <th key={h} className="pr-3 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {validation.perBlock.map((b) => (
                    <tr key={b.paddockId}>
                      <td className="pr-3">{b.name}</td><td>{b.total}</td><td>{b.adjacent}</td><td>{b.matched}/{b.evaluated}</td>
                      {["-2", "-1", "0", "+1", "+2", "other"].map((k) => <td key={k}>{b.diffs[k] ?? 0}</td>)}
                      <td>{b.localMatched}/{b.localEvaluated}</td><td>{b.methodDisagree}</td><td>{b.snappedMatched}/{b.snappedEvaluated}</td>
                      <td>{Object.entries(b.eras).sort().map(([m, e]) => `${m}: ${e.matched}/${e.evaluated}`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-muted-foreground">Difference = current-map aisle − saved aisle. Diagnostic only; known pins are never reassigned and no offset is applied.</div>
              <div className="text-muted-foreground">Calculated from data retrieved in this session only; never used to change stored rows.</div>
            </Card>
          )}

          <Card className="p-4 text-sm space-y-1">
            <div className="font-medium">Reference records</div>
            {SAMPLE_IDS.map((id) => {
              const pin = base.data.pins.find((p) => String(p.id) === id);
              const r = rows.find((x) => x.id === id);
              return (
                <div key={id} className="font-mono text-xs">
                  {id.slice(0, 8)} — {!pin ? "not visible to this account" : r
                    ? `${STATUS_LABEL[r.status]}; observations ${r.observationCount ?? "unavailable"}; segments ${r.segmentsState === "unavailable" ? "unavailable" : r.segmentsLabel ?? "none"}; ${r.reason}`
                    : `excluded from queue (saved Row ${pin.pin_row_number ?? pin.row_number} / aisle ${pin.driving_row_number ?? "—"}) — comparison only`}
                </div>
              );
            })}
          </Card>

          <Card className="p-4 text-sm space-y-2">
            <div className="font-medium">Review register (local drafts — {AUTHORITY}, not server-confirmed)</div>
            <div>First inspection reviewed: {reviewSummary.priorityReviewed}/{reviewSummary.priorityTotal} · Unreviewed {reviewSummary.unreviewed} · Approve (draft) {reviewSummary.approve_for_writeback} · Hold {reviewSummary.hold} · Needs field verification {reviewSummary.needs_field_verification} · Preserve existing {reviewSummary.preserve_existing}</div>
            <div className="flex gap-2 flex-wrap items-center">
              <Button size="sm" variant="outline" onClick={() => download("pin-row-review-draft-UNSIGNED.json", exportDraftJson(Object.values(decisions)), "application/json")}>Export review draft (JSON)</Button>
              <Button size="sm" variant="outline" onClick={() => download("pin-row-review-draft-UNSIGNED.csv", exportDraftCsv(Object.values(decisions)), "text/csv")}>Export review draft (CSV)</Button>
              <label className="text-xs border rounded px-2 py-1 cursor-pointer">Import review draft (JSON)
                <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
              </label>
            </div>
            {importMsg && <div className="text-xs">{importMsg}</div>}
            <div className="text-xs text-muted-foreground">{DRAFT_NOTICE} Drafts are saved in this browser only.</div>
          </Card>

          {preflight && (
            <Card className="p-4 text-sm space-y-1">
              <div className="font-medium">Writeback preflight (read-only — no write path exists yet)</div>
              <div>Eligible after explicit owner approval: <b>{preflight.eligible}</b> · Conflict / re-review: <b>{preflight.conflict}</b> · Not an approval (hold/verify/preserve): {preflight.notApproval}</div>
              {preflight.items.filter((i) => i.outcome === "conflict").map((i) => (
                <div key={i.pin_id} className="text-xs text-destructive font-mono">{i.pin_id.slice(0, 8)}: {i.checks.join("; ")}</div>
              ))}
              <div className="text-xs text-muted-foreground">Applying decisions needs a future audited server writeback (see design doc) and owner sign-off. Nothing has been written.</div>
            </Card>
          )}

          {selected && base.data && (
            <PinRowReviewDetail
              r={selected} paddocks={base.data.paddocks}
              track={selected.tripId && trips.data?.map ? trips.data.map.get(selected.tripId) ?? null : null}
              existing={decisions[selected.id] ?? null} reviewer={reviewer}
              position={selIdx >= 0 ? `${selIdx + 1} of ${shown.length} in current filter` : "outside current filter"}
              onPrev={() => go(-1)} onNext={() => go(1)}
              onClear={() => { const n = { ...decisions }; delete n[selected.id]; persist(n); }}
              onSave={(input) => persist({ ...decisions, [selected.id]: buildDecision(selected, input, reviewer, base.data!.paddocks, segMap ? segMap.get(selected.id) ?? [] : null) })}
            />
          )}

          <div className="flex gap-2 items-center flex-wrap text-xs">
            <label>Block <select className="border rounded h-8 bg-background" value={blockFilter} onChange={(e) => { setBlockFilter(e.target.value); setPage(0); }}>
              <option value="all">All</option><option value="none">No saved block</option>
              {base.data.paddocks.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>Missing input <select className="border rounded h-8 bg-background" value={missingFilter} onChange={(e) => { setMissingFilter(e.target.value as MissingInput); setPage(0); }}>
              <option value="any">Any</option><option value="gps">GPS not qualified</option><option value="direction">Direction not qualified</option><option value="side">Side not qualified</option><option value="block">No saved block</option>
            </select></label>
            <label>Review <select className="border rounded h-8 bg-background" value={decisionFilter} onChange={(e) => { setDecisionFilter(e.target.value as any); setPage(0); }}>
              <option value="all">All</option><option value="unreviewed">Unreviewed</option>
              {Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
            <span className="text-muted-foreground">{shown.length} shown</span>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            {(["all", "priority", "supported_candidate", "requires_review", "not_resolvable", "preserve_existing"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => { setFilter(f); setPage(0); }}>
                {f === "all" ? "All" : f === "priority" ? `First inspection (${cov.priority})` : STATUS_LABEL[f]}
              </Button>
            ))}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>{["Pin", "Title / mode / date", "Block", "GPS", "Inputs (GPS / direction / side)", "Device heading vs GPS travel", "Evidence", "Trip / anchor", "Existing", "Nearest row", "Bounding rows / aisle", "Candidate vine row", "Status / reason", "Review note (local)", "Draft"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="p-2 font-mono"><Button size="sm" variant={selectedId === r.id ? "default" : "outline"} className="h-6 px-2 text-xs" onClick={() => { setSelectedId(r.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{r.id.slice(0, 8)}</Button></td>
                    <td className="p-2">{r.title}<br />{r.mode}<br />{r.createdAt?.slice(0, 10)}</td>
                    <td className="p-2">{r.savedBlockName ?? (r.suggestedBlockName ? <span className="italic">Suggested: {r.suggestedBlockName}</span> : "—")}
                      {!r.savedBlockName && <div className="text-muted-foreground">{r.suggestedBlockNote}</div>}</td>
                    <td className="p-2 font-mono">{r.lat?.toFixed(7)}, {r.lng?.toFixed(7)}</td>
                    <td className="p-2">{(() => { const t = triadOf(r); return <>
                      GPS: {t.gps}<br />Direction: {t.direction}<br />Side: {t.side}
                      <div className="font-medium">{TRIAD_GROUP_LABEL[triadGroup(r, t)]}{isPriorityPin(r) ? " · first inspection" : ""}</div>
                      {t.notes.map((n) => <div key={n} className="text-muted-foreground">{n}</div>)}
                      {r.snapped && <div className="font-mono">snapped {r.snapped.lat.toFixed(7)}, {r.snapped.lng.toFixed(7)}</div>}
                      <div className="text-muted-foreground">raw side fields: {r.sideFields.pin_side ?? "—"} / {r.sideFields.side ?? "—"} / {r.sideFields.pressed_side ?? "—"}</div>
                    </>; })()}</td>
                    <td className="p-2">device (phone) {r.evidenceHeading ?? r.storedHeading ?? "—"}°
                      <br />travel {r.travel.courseDeg != null ? `${Math.round(r.travel.courseDeg)}° (${r.travel.source})` : "not established"}
                      {r.headingVsTravelDeg != null && <><br />Δ {Math.round(r.headingVsTravelDeg)}°</>}
                      {r.directionConflict && <div className="text-destructive">Direction conflict: {r.directionConflict}</div>}
                      <div>side {r.side ?? "—"} · pressed {r.pressedSide ?? "—"}</div></td>
                    <td className="p-2">{r.evidenceState === "unavailable" ? "unavailable" : r.evidenceState === "none" ? "no evidence" : <>±{r.accuracy ?? "?"} m<br />{r.observationCount === 0 ? "evidence present, 0 observations" : `${r.observationCount} observation point(s)`}</>}</td>
                    <td className="p-2">{r.tripId ? r.tripId.slice(0, 8) : "—"}<br />{r.trackAnchor.replace("_", " ")}</td>
                    <td className="p-2">{r.segmentsState === "unavailable" ? "segments unavailable" : r.existingMeta ?? "—"}</td>
                    <td className="p-2">{r.geometry?.nearestPhysicalRow ?? "—"}</td>
                    <td className="p-2">{r.geometry?.boundingRows?.join(" & ") ?? "—"}<br />aisle {r.geometry?.aisle ?? "—"}</td>
                    <td className="p-2">{r.suggestedVineRow != null ? `Candidate Row ${r.suggestedVineRow}` : "—"}</td>
                    <td className="p-2"><Badge variant="outline">{STATUS_LABEL[r.status]}</Badge><div className="text-muted-foreground mt-1">{r.reason}</div></td>
                    <td className="p-2"><Input value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} className="h-7 text-xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex gap-2 items-center text-sm">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page + 1} of {pages}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
