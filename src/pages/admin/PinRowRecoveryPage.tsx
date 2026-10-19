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
  latestEvidenceByPin, recoveryCsv, validateKnownPins, type CaptureEvidence, type RecoveryStatus,
} from "@/lib/pinRowRecovery";
import { AdminGate } from "./_shared";

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

  const counts = useMemo(() => {
    const c: Record<RecoveryStatus, number> = { supported_candidate: 0, requires_review: 0, not_resolvable: 0, preserve_existing: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const validation = useMemo(() => base.data ? validateKnownPins(base.data.pins, base.data.paddocks) : null, [base.data]);

  const [filter, setFilter] = useState<RecoveryStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
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

          {validation && (
            <Card className="p-4 text-sm space-y-1">
              <div className="font-medium">Validation against retrieved pins with a saved half-row aisle (read-only)</div>
              <div>Pins with saved half-row aisle + vine row retrieved this session: {validation.total} (with saved block: {validation.withSavedBlock})</div>
              <div>Saved vine row adjacent to saved aisle: {validation.adjacencyValid}/{validation.total} — a property of saved data, not evidence of new pairing accuracy</div>
              <div>Current-geometry aisle matches saved aisle: {validation.aisleMatch}/{validation.aisleEvaluated} · mismatches: {validation.aisleEvaluated - validation.aisleMatch}</div>
              <div>Diagnostic — stored device heading + side vs saved vine row: match {validation.vineRowMatch}/{validation.vineRowEvaluated}, mismatch {validation.falsePositives}. Device heading is phone orientation, not travel; it is not used for candidates.</div>
              <div>Nearest physical row differs from saved vine row: {validation.nearestDiffersFromSaved}/{validation.total}</div>
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

          <div className="flex gap-2 items-center flex-wrap">
            {(["all", "supported_candidate", "requires_review", "not_resolvable", "preserve_existing"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => { setFilter(f); setPage(0); }}>
                {f === "all" ? "All" : STATUS_LABEL[f]}
              </Button>
            ))}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>{["Pin", "Title / mode / date", "Block", "GPS", "Device heading vs GPS travel", "Evidence", "Trip / anchor", "Existing", "Nearest row", "Bounding rows / aisle", "Candidate vine row", "Status / reason", "Review note (local)"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="p-2 font-mono">{r.id.slice(0, 8)}</td>
                    <td className="p-2">{r.title}<br />{r.mode}<br />{r.createdAt?.slice(0, 10)}</td>
                    <td className="p-2">{r.savedBlockName ?? (r.suggestedBlockName ? <span className="italic">Suggested: {r.suggestedBlockName}</span> : "—")}
                      {!r.savedBlockName && <div className="text-muted-foreground">{r.suggestedBlockNote}</div>}</td>
                    <td className="p-2 font-mono">{r.lat?.toFixed(7)}, {r.lng?.toFixed(7)}</td>
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
