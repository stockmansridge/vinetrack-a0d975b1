// Soil Samples list — filterable register of uploaded laboratory reports.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listSoilSamples,
  SAMPLE_STATUS_LABEL,
  EXTRACTION_STATUS_LABEL,
  MAPPING_TYPE_LABEL,
  type SoilSample,
  type SoilSampleStatus,
  type SoilExtractionStatus,
} from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";
import { UploadSampleDialog } from "./UploadSampleDialog";

const db = supabase as any;

function depthLabel(s: SoilSample): string {
  if (s.depth_from_cm == null && s.depth_to_cm == null) return "—";
  if (s.depth_from_cm != null && s.depth_to_cm != null) return `${s.depth_from_cm}–${s.depth_to_cm} cm`;
  return `${s.depth_from_cm ?? s.depth_to_cm} cm`;
}

function mappingLabel(s: SoilSample): string {
  if (s.mapping_type === "row_range" && s.row_from != null) {
    return `${s.block_name ?? "Block"} rows ${s.row_from}–${s.row_to ?? s.row_from}`;
  }
  if (s.mapping_type === "point") return `${s.block_name ?? "Block"} (point)`;
  if (s.mapping_type === "block") return s.block_name ?? "Whole block";
  return MAPPING_TYPE_LABEL.unmapped;
}

export function SamplesTab({ onOpenSample }: { onOpenSample: (id: string) => void }) {
  const { memberships, selectedVineyardId } = useVineyard();
  const [vineyardId, setVineyardId] = useState<string>(selectedVineyardId ?? "");
  const [paddockId, setPaddockId] = useState("");
  const [laboratory, setLaboratory] = useState("");
  const [status, setStatus] = useState("");
  const [extraction, setExtraction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

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
      { vineyardId, paddockId, laboratory, status, extraction, dateFrom, dateTo },
    ],
    queryFn: () =>
      listSoilSamples({
        vineyardId: vineyardId || null,
        paddockId: paddockId || null,
        laboratory: laboratory || null,
        status: (status || null) as SoilSampleStatus | null,
        extractionStatus: (extraction || null) as SoilExtractionStatus | null,
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
        <select className={selectClass} value={extraction} onChange={(e) => setExtraction(e.target.value)} aria-label="Filter by extraction status">
          <option value="">Any extraction</option>
          {Object.entries(EXTRACTION_STATUS_LABEL).map(([k, v]) => (
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
                <th className="px-4 py-2 font-medium">Extraction</th>
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
                  <td className="px-4 py-2">{formatDate(s.sample_date)}</td>
                  <td className="px-4 py-2">{s.lab_paddock_name ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{mappingLabel(s)}</td>
                  <td className="px-4 py-2">{depthLabel(s)}</td>
                  <td className="px-4 py-2">
                    {s.laboratory ?? "—"}
                    {s.lab_sample_id ? <span className="text-muted-foreground"> · {s.lab_sample_id}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{EXTRACTION_STATUS_LABEL[s.extraction_status]}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{SAMPLE_STATUS_LABEL[s.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <UploadSampleDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(sample) => onOpenSample(sample.id)}
      />
    </div>
  );
}
