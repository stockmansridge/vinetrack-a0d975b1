// Stage 1 Existing Pin Row Recovery — System Admin, Stockman's Ridge only.
// REVIEW ONLY: no writes, no queue, no confirmations. Notes stay in this tab.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import {
  RECOVERY_VINEYARD_ID, STATUS_LABEL, assessPin, isMissingRowPin, pinTripId, recoveryCsv,
  validateKnownPins, type RecoveryStatus,
} from "@/lib/pinRowRecovery";
import { AdminGate } from "./_shared";

const SAMPLE_IDS = [
  "3c15741a-ae59-48f7-80c5-e53092d715ec",
  "b07937af-3365-477e-8b4e-b9bb8122604b",
  "6f1c2656-75bf-4041-934b-9f0df043e655",
  "fa0201e1-e22b-4cf5-98c0-8f4e858ab4a4",
];
const PAGE = 25;
const db = supabase as any;

async function chunked<T>(ids: string[], size: number, fn: (c: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

export default function PinRowRecoveryPage() {
  return <AdminGate><PinRowRecoveryInner /></AdminGate>;
}

function PinRowRecoveryInner() {
  const base = useQuery({
    queryKey: ["pin-row-recovery", "base"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pins, pads] = await Promise.all([
        db.from("pins").select("*").eq("vineyard_id", RECOVERY_VINEYARD_ID).is("deleted_at", null),
        db.from("paddocks").select("id,name,polygon_points,rows").eq("vineyard_id", RECOVERY_VINEYARD_ID).is("deleted_at", null),
      ]);
      if (pins.error) throw pins.error;
      if (pads.error) throw pads.error;
      return { pins: (pins.data ?? []) as any[], paddocks: (pads.data ?? []) as any[] };
    },
  });
  const missing = useMemo(() => (base.data?.pins ?? []).filter(isMissingRowPin), [base.data]);

  const capture = useQuery({
    queryKey: ["pin-row-recovery", "capture", missing.length],
    enabled: missing.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, number> | null> => {
      try {
        const rows = await chunked(missing.map((p) => String(p.id)), 100, async (c) => {
          const r = await db.from("pin_capture_evidence").select("pin_id").in("pin_id", c);
          if (r.error) throw r.error;
          return r.data ?? [];
        });
        const m = new Map<string, number>();
        rows.forEach((r: any) => m.set(String(r.pin_id), (m.get(String(r.pin_id)) ?? 0) + 1));
        return m;
      } catch { return null; }
    },
  });

  const [loadTrips, setLoadTrips] = useState(false);
  const trips = useQuery({
    queryKey: ["pin-row-recovery", "trips", missing.length],
    enabled: loadTrips && missing.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ map: Map<string, LatLng[]>; error: string | null }> => {
      const ids = [...new Set(missing.map(pinTripId).filter(Boolean) as string[])];
      const m = new Map<string, LatLng[]>();
      try {
        const rows = await chunked(ids, 10, async (c) => {
          const r = await db.from("trips").select("id,path_points").in("id", c);
          if (r.error) throw r.error;
          return r.data ?? [];
        });
        rows.forEach((t: any) => m.set(String(t.id), parsePolygonPoints(t.path_points)));
        return { map: m, error: null };
      } catch (e: any) { return { map: m, error: e?.message ?? "Trip data unavailable" }; }
    },
  });

  const rows = useMemo(() => {
    if (!base.data) return [];
    const ev = { paddocks: base.data.paddocks, captureCounts: capture.data ?? null, trips: trips.data?.map ?? null };
    return missing.map((p) => assessPin(p, ev));
  }, [base.data, missing, capture.data, trips.data]);

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

  const samples = SAMPLE_IDS.map((id) => {
    const pin = base.data?.pins.find((p) => String(p.id) === id);
    const inQueue = rows.find((r) => r.id === id);
    return { id, pin, inQueue };
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Existing Pin Row Recovery (Stage 1 review)</h1>
        <p className="text-sm text-muted-foreground">
          Stockman's Ridge only. Review only — nothing here changes pins, rows or evidence.
          All suggestions are non-authoritative candidates; none are confirmed.
        </p>
      </div>

      {base.error && <Card className="p-4 text-sm text-destructive">Unavailable: {(base.error as any).message}</Card>}
      {base.isLoading && <Card className="p-4 text-sm text-muted-foreground">Loading pins and blocks…</Card>}

      {base.data && (
        <>
          <Card className="p-4 flex flex-wrap gap-3 items-center text-sm">
            <span>Missing-row pins: <b>{rows.length}</b></span>
            {(Object.keys(counts) as RecoveryStatus[]).map((k) => (
              <Badge key={k} variant="outline">{STATUS_LABEL[k]}: {counts[k]}</Badge>
            ))}
            <span className="text-muted-foreground">
              Capture evidence: {capture.data === null ? "unavailable" : capture.isLoading ? "loading" : "loaded"}
            </span>
            <span className="text-muted-foreground">
              Trip tracks: {!loadTrips ? "not loaded" : trips.isLoading ? "loading" : trips.data?.error ? `unavailable (${trips.data.error})` : `loaded (${trips.data?.map.size ?? 0})`}
            </span>
            {!loadTrips && <Button size="sm" variant="outline" onClick={() => setLoadTrips(true)}>Load trip tracks</Button>}
            <Button size="sm" variant="outline" onClick={exportCsv}>Export CSV (non-authoritative)</Button>
          </Card>

          {validation && (
            <Card className="p-4 text-sm space-y-1">
              <div className="font-medium">Validation against pins with saved half-row aisle (read-only)</div>
              <div>Known pins: {validation.total} · saved vine row adjacent to saved aisle: {validation.adjacencyValid}/{validation.total}</div>
              <div>Geometric aisle matches saved aisle: {validation.aisleMatch}/{validation.aisleEvaluated}
                {validation.aisleEvaluated ? ` (mismatch ${(100 - (100 * validation.aisleMatch) / validation.aisleEvaluated).toFixed(0)}%)` : ""}</div>
              <div>Heading+side pairing matches saved vine row: {validation.vineRowMatch}/{validation.vineRowEvaluated} · false positives: {validation.falsePositives}</div>
              <div>Nearest physical row differs from saved vine row: {validation.nearestDiffersFromSaved}/{validation.total}</div>
              <div className="text-muted-foreground">Validation is never used to change stored rows.</div>
            </Card>
          )}

          <Card className="p-4 text-sm space-y-1">
            <div className="font-medium">Sample records (Blackberries, 14 Oct 2026)</div>
            {samples.map((s) => (
              <div key={s.id} className="font-mono text-xs">
                {s.id.slice(0, 8)} — {!s.pin ? "not visible" : s.inQueue
                  ? `${STATUS_LABEL[s.inQueue.status]}; obs ${s.inQueue.captureCount ?? "unavailable"}; aisle ${s.inQueue.geometry?.aisle ?? "—"}; ${s.inQueue.reason}`
                  : `excluded from queue (saved Row ${s.pin.pin_row_number ?? s.pin.row_number} / aisle ${s.pin.driving_row_number ?? "—"}) — comparison only`}
              </div>
            ))}
          </Card>

          <div className="flex gap-2 items-center">
            {(["all", "supported_candidate", "requires_review", "not_resolvable", "preserve_existing"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => { setFilter(f); setPage(0); }}>
                {f === "all" ? "All" : STATUS_LABEL[f]}
              </Button>
            ))}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>{["Pin", "Title / mode / date", "Block", "GPS / acc / heading / side", "Obs", "Trip / anchor", "Existing", "Nearest row", "Bounding rows / aisle", "Suggested vine row", "Status / reason", "Review note (local)"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="p-2 font-mono">{r.id.slice(0, 8)}</td>
                    <td className="p-2">{r.title}<br />{r.mode}<br />{r.createdAt?.slice(0, 10)}</td>
                    <td className="p-2">{r.savedBlockName ?? (r.suggestedBlockName ? <span className="italic">Suggested: {r.suggestedBlockName}</span> : "—")}
                      <div className="text-muted-foreground">{r.geometrySource}</div></td>
                    <td className="p-2 font-mono">{r.lat?.toFixed(7)}, {r.lng?.toFixed(7)}<br />±{r.accuracy ?? "?"} m · {r.heading ?? "?"}° · {r.side ?? "?"}</td>
                    <td className="p-2">{r.captureCount ?? "unavailable"}</td>
                    <td className="p-2">{r.tripId ? r.tripId.slice(0, 8) : "—"}<br />{r.trackAnchor}</td>
                    <td className="p-2">{r.existingMeta ?? "—"}</td>
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
