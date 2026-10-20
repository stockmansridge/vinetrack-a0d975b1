// Per-pin review detail: SVG map of CURRENT block geometry + local draft decision form.
// No writes. Decisions are operator_approved_draft only.
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parsePolygonPoints, parseRows, type LatLng } from "@/lib/paddockGeometry";
import { GEOMETRY_SOURCE_LABEL, triadOf, type RecoveryRow } from "@/lib/pinRowRecovery";
import {
  DECISION_LABEL, WARNING_LABEL, requiredWarnings, validateDecision,
  type DecisionInput, type DecisionKind, type DecisionSource, type ReviewDecision,
} from "@/lib/pinRowReviewDraft";

function ReviewMap({ r, paddock, track }: { r: RecoveryRow; paddock: any | null; track: LatLng[] | null }) {
  const poly = parsePolygonPoints(paddock?.polygon_points);
  const rows = parseRows(paddock?.rows).filter((x) => x.start && x.end);
  const pin = r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
  if (!pin) return <div className="text-xs text-muted-foreground">No GPS</div>;
  // Local metres frame around the pin, 40 m window.
  const kx = 111320 * Math.cos((pin.lat * Math.PI) / 180), ky = 110574;
  const W = 40, S = 320 / (2 * W);
  const xy = (p: LatLng) => [160 + (p.lng - pin.lng) * kx * S, 160 - (p.lat - pin.lat) * ky * S];
  const pts = (a: LatLng[]) => a.map((p) => xy(p).join(",")).join(" ");
  const bound = new Set(r.geometry?.boundingRows ?? []);
  const nearIdx = track ? track.findIndex((q) => Math.abs(q.lat - pin.lat) < 1e-7 && Math.abs(q.lng - pin.lng) < 1e-7) : -1;
  const seg = track && nearIdx >= 0 ? track.slice(Math.max(0, nearIdx - 30), nearIdx + 31) : null;
  const snap = r.snapped ? xy(r.snapped) : null;
  const [px, py] = xy(pin);
  const dir = r.travel.courseDeg;
  return (
    <svg viewBox="0 0 320 320" className="w-full max-w-[320px] rounded border bg-muted/30" role="img" aria-label="Current block geometry around pin">
      {poly.length > 2 && <polygon points={pts(poly)} className="fill-primary/5 stroke-primary/40" strokeWidth={1} />}
      {rows.map((row, i) => {
        const [x1, y1] = xy(row.start!), [x2, y2] = xy(row.end!);
        const b = bound.has(row.number!), near = row.number === r.geometry?.nearestPhysicalRow;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={b ? "stroke-primary" : near ? "stroke-amber-500" : "stroke-muted-foreground/40"} strokeWidth={b ? 2 : 1} strokeDasharray={near && !b ? "3 2" : undefined} />
            {(b || near) && <text x={(x1 + x2) / 2 + 3} y={(y1 + y2) / 2} className="fill-foreground text-[8px]">{row.number}</text>}
          </g>
        );
      })}
      {seg && seg.length > 1 && <polyline points={pts(seg)} className="fill-none stroke-sky-500" strokeWidth={1.5} />}
      {r.accuracy != null && <circle cx={px} cy={py} r={r.accuracy * S} className="fill-destructive/10 stroke-destructive/60" strokeDasharray="2 2" />}
      {snap && <circle cx={snap[0]} cy={snap[1]} r={3} className="fill-none stroke-foreground" />}
      <circle cx={px} cy={py} r={3.5} className="fill-destructive" />
      {dir != null && (
        <line x1={px} y1={py} x2={px + Math.sin((dir * Math.PI) / 180) * 30} y2={py - Math.cos((dir * Math.PI) / 180) * 30}
          className="stroke-sky-600" strokeWidth={2} markerEnd="url(#arr)" />
      )}
      <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" className="fill-sky-600" /></marker></defs>
      <text x={4} y={12} className="fill-muted-foreground text-[9px]">CURRENT GEOMETRY ONLY · 80 m window</text>
    </svg>
  );
}

import type { ServerReconstructionReport } from "@/lib/pinRowReconstruction";

const EMPTY: DecisionInput = { decision: "hold", block_id: null, vine_row: null, driving_aisle: null, side: null, reason: "", source: null, acknowledged_warnings: [] };

export function PinRowReviewDetail(props: {
  serverReport?: ServerReconstructionReport | null;
  r: RecoveryRow; paddocks: any[]; track: LatLng[] | null; existing: ReviewDecision | null; reviewer: string;
  onSave: (input: DecisionInput) => void; readOnly?: boolean; onClear: () => void; onPrev: () => void; onNext: () => void; position: string;
}) {
  const { r, paddocks, track, existing } = props;
  const [f, setF] = useState<DecisionInput>(EMPTY);
  useEffect(() => {
    setF(existing ? { decision: existing.decision, block_id: existing.block_id, vine_row: existing.vine_row,
      driving_aisle: existing.driving_aisle, side: existing.side, reason: existing.reason, source: existing.source,
      acknowledged_warnings: existing.acknowledged_warnings, field_confirmation: existing.field_confirmation }
      // Never pre-select a row. Block defaults to the SAVED block only.
      : { ...EMPTY, decision: r.status === "preserve_existing" ? "preserve_existing" : "hold", block_id: r.pin.paddock_id ?? null });
  }, [r.id, existing]);
  const paddock = paddocks.find((p) => p.id === (f.block_id ?? r.pin.paddock_id)) ?? null;
  const errors = useMemo(() => validateDecision(r, f, paddocks, props.serverReport), [r, f, paddocks, props.serverReport]);
  const warnings = requiredWarnings(r);
  const t = triadOf(r);
  const fieldErrors = f.decision === "approve_for_writeback" && f.source === "manual_field_check" &&
    (!f.field_confirmation || ["observed_by", "observed_at", "method", "note"].some((k) => !f.field_confirmation?.[k as keyof typeof f.field_confirmation]?.trim()) || Number.isNaN(Date.parse(f.field_confirmation.observed_at)))
    ? ["Record who observed the row, when, the field-check method and note."] : [];
  const preserve = r.status === "preserve_existing";
  const kinds: DecisionKind[] = preserve ? ["preserve_existing", "hold"] : ["approve_for_writeback", "hold", "needs_field_verification"];

  return (
    <Card className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={props.onPrev}>Previous</Button>
        <Button size="sm" variant="outline" onClick={props.onNext}>Next</Button>
        <span className="text-muted-foreground">{props.position}</span>
        <span className="font-mono text-xs">{r.id}</span>
        <Badge variant="outline">{r.title}</Badge>
        <Badge variant="destructive">{GEOMETRY_SOURCE_LABEL}</Badge>
      </div>
      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <ReviewMap r={r} paddock={paddock} track={track} />
        <div className="space-y-1 text-xs">
          <div><b>Pin coordinate (stored pin lat/lng):</b> <span className="font-mono">{r.lat?.toFixed(7)}, {r.lng?.toFixed(7)}</span></div>
          <div><b>Saved snapped coordinate:</b> <span className="font-mono">{r.snapped ? `${r.snapped.lat.toFixed(7)}, ${r.snapped.lng.toFixed(7)}` : "none"}</span> (hollow circle)</div>
          <div><b>GPS accuracy:</b> {r.accuracy != null ? `±${r.accuracy} m (red circle)` : "unknown"} · evidence: {r.evidenceState}</div>
          <div><b>Saved block:</b> {r.savedBlockName ?? "none"}{r.suggestedBlockName && <> · <i>suggested {r.suggestedBlockName}</i></>}</div>
          <div><b>Bounding rows (blue):</b> {r.geometry?.boundingRows?.join(" & ") ?? "—"} · aisle {r.geometry?.aisle ?? "—"} · local aisle {r.geometry?.localAisle ?? "—"}</div>
          <div><b>Geometric nearest row (amber dashed, NOT the selected row):</b> {r.geometry?.nearestPhysicalRow ?? "—"}</div>
          <div><b>Travel direction:</b> {r.travel.courseDeg != null ? `${Math.round(r.travel.courseDeg)}° from ${r.travel.source} (arrow)` : `not established — ${r.travel.reason}`}</div>
          <div><b>Track:</b> {r.tripId ? `${r.trackAnchor}${track ? " (segment in light blue)" : " — load trip tracks to draw"}` : "no trip"}</div>
          <div><b>Device heading (phone):</b> {r.evidenceHeading ?? r.storedHeading ?? "—"}° {r.directionConflict && <span className="text-destructive">· {r.directionConflict}</span>}</div>
          <div><b>Left/right fields:</b> {r.sideFields.pin_side ?? "—"} / {r.sideFields.side ?? "—"} / pressed {r.sideFields.pressed_side ?? "—"}</div>
          <div><b>Inputs:</b> GPS {t.gps} · direction {t.direction} · side {t.side}</div>
          <div><b>Existing metadata:</b> {r.segmentsState === "unavailable" ? "segments unavailable" : r.existingMeta ?? "none"}</div>
          <div className="text-muted-foreground"><b>Assessment (suggestion only):</b> candidate row {r.suggestedVineRow ?? "—"} · {r.reason}</div>
        </div>
      </div>

      <div className="border-t pt-3 space-y-2">
        <div className="font-medium">Draft decision (local only — operator_approved_draft, not server-confirmed)</div>
        <div className="flex gap-2 flex-wrap">
          {kinds.map((k) => (
            <Button key={k} size="sm" variant={f.decision === k ? "default" : "outline"} onClick={() => setF({ ...f, decision: k })}>{DECISION_LABEL[k]}</Button>
          ))}
        </div>
        <div className="text-xs rounded border border-destructive/50 bg-destructive/5 p-2">Acknowledging a warning does not make weak GPS or travel evidence reliable. When technical evidence is insufficient, only a manual field check supports approval. A saved draft is not a confirmed row and nothing is written.</div>
        {props.readOnly && <div className="text-xs text-destructive">Saving disabled until signed in and evidence/segments are fully loaded.</div>}
        {f.block_id && r.pin.paddock_id && f.block_id !== r.pin.paddock_id && <div className="text-xs text-destructive">BLOCK-CONFLICT: different from the saved block — requires a separate authoritative block correction.</div>}
        {preserve && <div className="text-xs text-muted-foreground">Existing segments/aisle are preserved. Approval is not available for this pin.</div>}
        {f.decision === "approve_for_writeback" && (
          <div className="grid sm:grid-cols-4 gap-2 text-xs">
            <label>Block
              <select className="w-full border rounded h-8 bg-background" value={f.block_id ?? ""} onChange={(e) => setF({ ...f, block_id: e.target.value || null })}>
                <option value="">Choose…</option>
                {paddocks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Physical vine row
              <Input className="h-8" inputMode="numeric" value={f.vine_row ?? ""} placeholder="manual entry" onChange={(e) => setF({ ...f, vine_row: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label>Driving aisle (optional)
              <Input className="h-8" value={f.driving_aisle ?? ""} placeholder="e.g. 34.5" onChange={(e) => setF({ ...f, driving_aisle: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label>Side (optional)
              <select className="w-full border rounded h-8 bg-background" value={f.side ?? ""} onChange={(e) => setF({ ...f, side: (e.target.value || null) as any })}>
                <option value="">—</option><option value="left">Left</option><option value="right">Right</option>
              </select>
            </label>
            <label className="sm:col-span-2">Source
              <select className="w-full border rounded h-8 bg-background" value={f.source ?? ""} onChange={(e) => setF({ ...f, source: (e.target.value || null) as DecisionSource | null })}>
                <option value="">Choose…</option><option value="measured">Measured</option><option value="reviewed_track">Reviewed track</option><option value="manual_field_check">Manual field check</option>
              </select>
            </label>
            {f.source === "manual_field_check" && <fieldset className="sm:col-span-4 grid sm:grid-cols-2 gap-2"><legend>Individual field confirmation (observed in the field, not inferred)</legend>
              {(["observed_by", "observed_at", "method", "note"] as const).map((k) => <label key={k}>{k.replace(/_/g, " ")}<Input type={k === "observed_at" ? "datetime-local" : "text"} value={f.field_confirmation?.[k] ?? ""} onChange={(e) => setF({ ...f, field_confirmation: { observed_by: "", observed_at: "", method: "", note: "", ...f.field_confirmation, [k]: e.target.value } })} /></label>)}
            </fieldset>}
            <div className="sm:col-span-4 space-y-1">
              {warnings.map((w) => (
                <label key={w} className="flex gap-2 items-center">
                  <input type="checkbox" checked={f.acknowledged_warnings.includes(w)}
                    onChange={(e) => setF({ ...f, acknowledged_warnings: e.target.checked ? [...f.acknowledged_warnings, w] : f.acknowledged_warnings.filter((x) => x !== w) })} />
                  I acknowledge: {WARNING_LABEL[w]}
                </label>
              ))}
            </div>
          </div>
        )}
        <Textarea className="text-xs" placeholder="Reason (required)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        {[...errors, ...fieldErrors].length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{[...errors, ...fieldErrors].map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="flex gap-2 items-center">
          <Button size="sm" disabled={errors.length > 0 || fieldErrors.length > 0 || props.readOnly} onClick={() => props.onSave(f)}>Save draft decision</Button>
          {existing && <Button size="sm" variant="outline" onClick={props.onClear}>Clear draft</Button>}
          <span className="text-xs text-muted-foreground">Reviewer: {props.reviewer}{existing ? ` · saved ${existing.reviewed_at}` : ""}</span>
        </div>
      </div>
    </Card>
  );
}
