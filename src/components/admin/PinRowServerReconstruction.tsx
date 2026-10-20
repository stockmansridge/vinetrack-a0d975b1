import { useState } from "react";
import { Button } from "@/components/ui/button";
import { candidateMatchesPin, reconstructionCsv, supportedCandidate, type ServerReconstructionReport } from "@/lib/pinRowReconstruction";
import type { RecoveryRow } from "@/lib/pinRowRecovery";

export function PinRowServerReconstruction({ report, error, busy, disabled, rows, paddocks, onRun, onApprove }: {
  report: ServerReconstructionReport | null; error: string | null; busy: boolean; disabled: boolean;
  rows: RecoveryRow[]; paddocks: any[]; onRun: () => void; onApprove: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionReport, setSelectionReport] = useState<ServerReconstructionReport | null>(null);
  const chosen = selectionReport === report ? selected : [];
  const eligible = (id: string) => { const p = supportedCandidate(report, id); const r = rows.find((r) => r.id === id); return !!p && !!r && candidateMatchesPin(p, r); };
  const eligibleCount = report?.pins.filter((p) => eligible(p.pin_id)).length ?? 0;
  const exportFile = (format: "json" | "csv") => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([format === "json" ? JSON.stringify(report, null, 2) : reconstructionCsv(report)], { type: format === "json" ? "application/json" : "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `pin-row-server-reconstruction.${format}`; a.click(); URL.revokeObjectURL(url);
  };
  return <section className="space-y-3 border-y py-4 text-sm" aria-label="Server reconstruction">
    <h2 className="font-semibold">Server reconstruction — Stockman's Ridge</h2>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || disabled} onClick={() => { setSelected([]); setSelectionReport(null); onRun(); }}>{busy ? "Running server reconstruction…" : "Run server reconstruction"}</Button>
      <Button size="sm" variant="outline" disabled={!report || busy} onClick={() => exportFile("csv")}>Export server CSV</Button>
      <Button size="sm" variant="outline" disabled={!report || busy} onClick={() => exportFile("json")}>Export exact server JSON</Button>
    </div>
    {error && <div role="alert" className="text-destructive">{error} No browser-inferred fallback is accepted.</div>}
    {!report && !error && <p className="text-muted-foreground">Server reconstruction has not been run in this signed-in session.</p>}
    {report && <>
      <div>{report.algorithm_version} · {report.generated_at} · Missing: {report.missing_total ?? report.pins.length} · Server supported: {report.supported_batch.length} · Eligible here: <b>{eligibleCount}</b> · Held: <b>{report.pins.length - eligibleCount}</b></div>
      <div>Server tiers: {JSON.stringify(report.by_tier ?? {})}</div>
      <div>Known-row validation: <b>{report.validation.passed ? "passed" : "blocked"}</b><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(Object.fromEntries(Object.entries(report.validation).filter(([key]) => key !== "rows")), null, 2)}</pre></div>
      {!eligibleCount && <div role="alert" className="border border-destructive p-2 text-destructive"><b>No eligible automatic batch.</b> {[...new Set(report.pins.flatMap((p) => p.holds ?? []))].join("; ") || (!report.validation.passed ? "Known-row validation failed or is insufficient." : "No server-supported rows match current unprotected pins and capture/current geometry.")}</div>}
      <div className="overflow-x-auto max-h-[480px]">
        <table className="w-full text-xs"><thead className="text-left"><tr>{["Select", "Full pin UUID / title", "Block UUID / name", "Travel / source", "Left/Right / source", "Driving aisle", "Physical vine row", "Original GPS accuracy", "Geometry / history", "Tier / holds"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{report.pins.map((p) => { const r = rows.find((r) => r.id === p.pin_id); const block = paddocks.find((b) => b.id === p.proposed_block_id); return <tr key={p.pin_id} className="border-t align-top">
            <td className="p-2"><input type="checkbox" aria-label={`Select ${p.pin_id}`} disabled={disabled || busy || !eligible(p.pin_id)} checked={chosen.includes(p.pin_id)} onChange={(e) => { setSelectionReport(report); setSelected(e.target.checked ? [...chosen, p.pin_id] : chosen.filter((id) => id !== p.pin_id)); }} /></td>
            <td className="p-2"><span className="font-mono">{p.pin_id}</span><br />{r?.title ?? String(p.title ?? "Title unavailable")}</td>
            <td className="p-2"><span className="font-mono">{p.proposed_block_id ?? p.block?.paddock_id ?? "—"}</span><br />{block?.name ?? "Name unavailable"}</td>
            <td className="p-2">{p.travel?.course_deg != null ? `${p.travel.course_deg}°` : "Not established"}<br />{p.travel?.source ?? p.travel?.reason ?? "Unavailable"}</td>
            <td className="p-2">{p.side?.value ?? "Unavailable"}<br />{JSON.stringify(p.side?.sources ?? {})}</td>
            <td className="p-2">{p.suggestion?.driving_aisle ?? "—"}</td><td className="p-2">{p.suggestion?.vine_row ?? "—"}{p.suggestion?.vine_row != null && !Number.isInteger(p.suggestion.vine_row) && <strong className="text-destructive"> Fractional physical row — held</strong>}</td>
            <td className="p-2">{p.gps?.horizontal_accuracy_m != null ? `${p.gps.horizontal_accuracy_m} m` : "Unknown"}<br />{p.gps?.accuracy_source}</td>
            <td className="p-2"><pre className="whitespace-pre-wrap break-all max-w-xs">{JSON.stringify(p.geometry ?? {}, null, 2)}</pre></td>
            <td className="p-2">{p.tier}<br />{(p.holds ?? []).join("; ")}{!eligible(p.pin_id) && p.tier === "technically_supported" && <div className="text-destructive">Held: current pin / protected metadata / capture-current identity check.</div>}</td>
          </tr>; })}</tbody></table>
      </div>
      <div className="font-mono text-xs break-all">Selected exact pin → row: {chosen.map((id) => `${id} → ${supportedCandidate(report, id)?.suggestion?.vine_row}`).join("; ") || "none"}</div>
      <Button size="sm" disabled={disabled || busy || !chosen.length || chosen.some((id) => !eligible(id))} onClick={() => { onApprove(chosen); setSelected([]); }}>Approve selected exact rows as owner review drafts ({chosen.length})</Button>
      <p className="text-muted-foreground">Selection is not an application. Server dry-run, frozen approval and typed apply remain required.</p>
    </>}
  </section>;
}