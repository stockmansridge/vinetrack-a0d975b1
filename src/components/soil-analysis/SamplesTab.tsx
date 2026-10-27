// Soil Samples list — filterable register of uploaded laboratory reports.
// The sample lifecycle is extraction_status; there is no separate status.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listSoilSamples,
  retrySoilExtraction,
  SAMPLE_STATUS_LABEL,
  SAMPLE_SCOPE_LABEL,
  type SoilSample,
  type SoilSampleStatus,
} from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";
import { UploadSampleDialog } from "./UploadSampleDialog";

const db = supabase as any;

function depthLabel(s: SoilSample): string {
  if (s.sample_depth_from_cm == null && s.sample_depth_to_cm == null) return "—";
  if (s.sample_depth_from_cm != null && s.sample_depth_to_cm != null)
    return `${s.sample_depth_from_cm}–${s.sample_depth_to_cm} cm`;
  return `${s.sample_depth_from_cm ?? s.sample_depth_to_cm} cm`;
}

function mappingLabel(s: SoilSample): string {
  if (s.sample_scope === "row_range" && s.row_start != null) {
    return `${s.block_name ?? "Block"} rows ${s.row_start}–${s.row_end ?? s.row_start}`;
  }
  if (s.sample_scope === "point") return `${s.block_name ?? "Block"} (point)`;
  if (s.sample_scope === "whole_block") return s.block_name ?? "Whole block";
  return SAMPLE_SCOPE_LABEL.unmapped;
}

export function SamplesTab({ onOpenSample }: { onOpenSample: (id: string) => void }) {
  const { memberships, selectedVineyardId } = useVineyard();
  const [vineyardId, setVineyardId] = useState<string>(selectedVineyardId ?? "");
  const [paddockId, setPaddockId] = useState("");
  const [laboratory, setLaboratory] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Extraction failures render through the shared concise notice; only
  // non-extraction problems (e.g. a missing document) use plain text.
  const [retryFailure, setRetryFailure] = useState<{ raw: string | null; plain?: string } | null>(null);
  const qc = useQueryClient();

  // Retry reuses the existing sample + primary document ids; the evidence
  // file is never re-uploaded and no duplicate rows are created.
  const retry = async (e: React.MouseEvent, s: SoilSample) => {
    e.stopPropagation();
    setRetryError(null);
    setRetryingId(s.id);
    try {
      const { data: doc, error: docErr } = await db
        .from("soil_sample_documents")
        .select("id")
        .eq("sample_id", s.id)
        .eq("is_primary", true)
        .maybeSingle();
      if (docErr) throw docErr;
      if (!doc) {
        setRetryError("No source document is recorded for that sample, so extraction cannot be retried.");
        return;
      }
      const outcome = await retrySoilExtraction(s.id, doc.id);
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      if (!outcome.ok) setRetryError(`Extraction failed again: ${outcome.error}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  };

  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", vineyardId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const samplesQuery = useQuery({
    queryKey: [
      "soil-analysis",
      "samples",
      { vineyardId, paddockId, laboratory, status, dateFrom, dateTo },
    ],
    queryFn: () =>
      listSoilSamples({
        vineyardId: vineyardId || null,
        paddockId: paddockId || null,
        laboratory: laboratory || null,
        status: (status || null) as SoilSampleStatus | null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      }),
  });

  const laboratories = useMemo(() => {
    const set = new Set<string>();
    for (const s of samplesQuery.data ?? []) if (s.laboratory) set.add(s.laboratory);
    return [...set].sort();
  }, [samplesQuery.data]);

  const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Button className="mr-auto" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-1.5" /> Upload report
        </Button>
        <select className={selectClass} value={vineyardId} onChange={(e) => { setVineyardId(e.target.value); setPaddockId(""); }} aria-label="Filter by vineyard">
          <option value="">All vineyards</option>
          {memberships.map((m) => (
            <option key={m.vineyard_id} value={m.vineyard_id}>{m.vineyard_name ?? m.vineyard_id}</option>
          ))}
        </select>
        <select className={selectClass} value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Filter by block">
          <option value="">All blocks</option>
          {(blocksQuery.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select className={selectClass} value={laboratory} onChange={(e) => setLaboratory(e.target.value)} aria-label="Filter by laboratory">
          <option value="">All laboratories</option>
          {laboratories.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          {Object.entries(SAMPLE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <Input type="date" className="w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Samples from" />
        <Input type="date" className="w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Samples to" />
      </div>

      <Card className="overflow-hidden">
        {samplesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground p-6">Loading samples…</div>
        ) : samplesQuery.error ? (
          <div className="text-sm text-destructive p-6">{(samplesQuery.error as Error).message}</div>
        ) : (samplesQuery.data ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground p-6">
            No soil samples match these filters. Upload a laboratory report to begin.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Sample date</th>
                <th className="px-4 py-2 font-medium">Lab paddock name</th>
                <th className="px-4 py-2 font-medium">VineTrack mapping</th>
                <th className="px-4 py-2 font-medium">Depth</th>
                <th className="px-4 py-2 font-medium">Lab / sample ID</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(samplesQuery.data ?? []).map((s) => (
                <tr
                  key={s.id}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                  onClick={() => onOpenSample(s.id)}
                >
                  <td className="px-4 py-2">{formatDate(s.sampled_at)}</td>
                  <td className="px-4 py-2">{s.lab_paddock_name ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{mappingLabel(s)}</td>
                  <td className="px-4 py-2">{depthLabel(s)}</td>
                  <td className="px-4 py-2">
                    {s.laboratory ?? "—"}
                    {s.lab_sample_id ? <span className="text-muted-foreground"> · {s.lab_sample_id}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{SAMPLE_STATUS_LABEL[s.extraction_status]}</Badge>
                      {s.extraction_status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryingId === s.id}
                          onClick={(e) => retry(e, s)}
                          aria-label={`Retry extraction for ${s.lab_paddock_name ?? "sample"}`}
                        >
                          {retryingId === s.id ? "Extracting…" : "Retry"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {retryError && <div className="text-sm text-destructive">{retryError}</div>}

      <UploadSampleDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(sample) => onOpenSample(sample.id)}
      />
    </div>
  );
}
