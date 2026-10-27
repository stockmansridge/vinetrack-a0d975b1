// Soil sample detail — Review Results screen.
//
// Editable metadata and block mapping write only to value_*/mapping fields;
// source_* extraction provenance is shown read-only and never overwritten.
// The original document opens through a short-lived signed URL.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import { AdminPageHeader, formatDate } from "./_shared";
import { SoilAnalysisGate } from "@/components/soil-analysis/SoilAnalysisGate";
import {
  getSoilSampleDetail,
  getSoilDocumentSignedUrl,
  updateSoilSample,
  updateSoilResult,
  listAnalyteCatalogue,
  SAMPLE_STATUS_LABEL,
  EXTRACTION_STATUS_LABEL,
  MAPPING_TYPE_LABEL,
  labStatusLabel,
  type SoilSample,
  type SoilSampleResult,
  type SoilMappingType,
} from "@/lib/soilAnalysis";

const db = supabase as any;

export default function SoilSampleDetailPage() {
  return (
    <SoilAnalysisGate>
      <DetailInner />
    </SoilAnalysisGate>
  );
}

function DetailInner() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["soil-analysis", "sample", id],
    enabled: !!id,
    queryFn: () => getSoilSampleDetail(id),
  });
  const analytesQuery = useQuery({
    queryKey: ["soil-analysis", "analytes"],
    queryFn: listAnalyteCatalogue,
  });
  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", detailQuery.data?.sample.vineyard_id],
    enabled: !!detailQuery.data?.sample.vineyard_id,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", detailQuery.data!.sample.vineyard_id)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const [draft, setDraft] = useState<Partial<SoilSample>>({});
  const [resultDrafts, setResultDrafts] = useState<Record<string, Partial<SoilSampleResult>>>({});
  const [saveState, setSaveState] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const sample = detailQuery.data?.sample;
  useEffect(() => {
    if (sample) setDraft({ ...sample });
  }, [sample?.id]);

  if (detailQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading sample…</div>;
  }
  if (detailQuery.error || !sample) {
    return (
      <div className="p-6 text-sm text-destructive">
        {(detailQuery.error as Error)?.message ?? "Soil sample not found."}
      </div>
    );
  }

  const set = (key: keyof SoilSample, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setResult = (rid: string, key: keyof SoilSampleResult, value: unknown) =>
    setResultDrafts((d) => ({ ...d, [rid]: { ...d[rid], [key]: value } }));

  const save = async () => {
    setSaveState(null);
    try {
      await updateSoilSample(sample.id, {
        sample_date: (draft.sample_date as string) ?? null,
        laboratory: (draft.laboratory as string) ?? null,
        lab_sample_id: (draft.lab_sample_id as string) ?? null,
        lab_paddock_name: (draft.lab_paddock_name as string) ?? null,
        depth_from_cm: (draft.depth_from_cm as number) ?? null,
        depth_to_cm: (draft.depth_to_cm as number) ?? null,
        notes: (draft.notes as string) ?? null,
        status: (draft.status as SoilSample["status"]) ?? sample.status,
        mapping_type: (draft.mapping_type as SoilMappingType) ?? "unmapped",
        paddock_id: (draft.paddock_id as string) ?? null,
        row_from: (draft.row_from as number) ?? null,
        row_to: (draft.row_to as number) ?? null,
        point_lat: (draft.point_lat as number) ?? null,
        point_lng: (draft.point_lng as number) ?? null,
      });
      for (const [rid, patch] of Object.entries(resultDrafts)) {
        if (Object.keys(patch).length > 0) await updateSoilResult(rid, patch);
      }
      setResultDrafts({});
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      setSaveState("Saved. Original extraction values are preserved.");
    } catch (e) {
      setSaveState(e instanceof Error ? e.message : String(e));
    }
  };

  const openDocument = async (path: string) => {
    setDocError(null);
    try {
      const url = await getSoilDocumentSignedUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  };

  const mappingType = (draft.mapping_type as SoilMappingType) ?? sample.mapping_type;
  const analytes = analytesQuery.data ?? [];
  const blocks = blocksQuery.data ?? [];
  const selectClass = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <AdminPageHeader
        title="Review soil sample"
        subtitle={`${sample.vineyard_name ?? "Vineyard"} · ${formatDate(sample.sample_date)}`}
        back="/admin/soil-analysis"
      />
      <BetaAdminBanner />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sample metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <Label>Sample date</Label>
              <Input type="date" value={(draft.sample_date as string) ?? ""} onChange={(e) => set("sample_date", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Laboratory</Label>
              <Input value={(draft.laboratory as string) ?? ""} onChange={(e) => set("laboratory", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Lab sample ID</Label>
              <Input value={(draft.lab_sample_id as string) ?? ""} onChange={(e) => set("lab_sample_id", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Lab paddock name (preserved)</Label>
              <Input value={(draft.lab_paddock_name as string) ?? ""} onChange={(e) => set("lab_paddock_name", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Depth from (cm)</Label>
              <Input type="number" value={(draft.depth_from_cm as any) ?? ""} onChange={(e) => set("depth_from_cm", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div className="space-y-1">
              <Label>Depth to (cm)</Label>
              <Input type="number" value={(draft.depth_to_cm as any) ?? ""} onChange={(e) => set("depth_to_cm", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Input value={(draft.notes as string) ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <select className={selectClass} value={(draft.status as string) ?? sample.status} onChange={(e) => set("status", e.target.value)}>
                {Object.entries(SAMPLE_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Extraction</Label>
              <div className="pt-1.5">
                <Badge variant="outline">{EXTRACTION_STATUS_LABEL[sample.extraction_status]}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">VineTrack block mapping</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <Label>Mapping</Label>
              <select className={selectClass} value={mappingType} onChange={(e) => set("mapping_type", e.target.value)}>
                {Object.entries(MAPPING_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Block</Label>
              <select
                className={selectClass}
                value={(draft.paddock_id as string) ?? ""}
                onChange={(e) => set("paddock_id", e.target.value || null)}
                disabled={mappingType === "unmapped"}
              >
                <option value="">Not mapped</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {mappingType === "row_range" && (
              <>
                <div className="space-y-1">
                  <Label>Row from</Label>
                  <Input type="number" value={(draft.row_from as any) ?? ""} onChange={(e) => set("row_from", e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Row to</Label>
                  <Input type="number" value={(draft.row_to as any) ?? ""} onChange={(e) => set("row_to", e.target.value ? Number(e.target.value) : null)} />
                </div>
              </>
            )}
            {mappingType === "point" && (
              <>
                <div className="space-y-1">
                  <Label>Latitude</Label>
                  <Input type="number" step="any" value={(draft.point_lat as any) ?? ""} onChange={(e) => set("point_lat", e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Longitude</Label>
                  <Input type="number" step="any" value={(draft.point_lng as any) ?? ""} onChange={(e) => set("point_lng", e.target.value ? Number(e.target.value) : null)} />
                </div>
              </>
            )}
            <div className="col-span-2 text-xs text-muted-foreground">
              The laboratory's paddock name stays stored separately; this mapping only links the
              sample to VineTrack blocks.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Source documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(detailQuery.data?.documents ?? []).length === 0 ? (
            <div className="text-muted-foreground">No documents recorded.</div>
          ) : (
            (detailQuery.data?.documents ?? []).map((doc) => (
              <div key={doc.id} className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{doc.original_filename}</span>
                <Button size="sm" variant="outline" onClick={() => openDocument(doc.storage_path)}>
                  View source document
                </Button>
              </div>
            ))
          )}
          {docError && <div className="text-sm text-destructive">{docError}</div>}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Measurements</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-auto">
          {(detailQuery.data?.results ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 pb-4">
              {sample.extraction_status === "awaiting_extraction"
                ? "Awaiting extraction — results appear here once the backend parser processes the document."
                : "No results recorded for this sample."}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Original analyte</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 font-medium">Source value</th>
                  <th className="px-3 py-2 font-medium">Current value</th>
                  <th className="px-3 py-2 font-medium">Lab range</th>
                  <th className="px-3 py-2 font-medium">Lab status</th>
                  <th className="px-3 py-2 font-medium">VineTrack analyte</th>
                  <th className="px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Page</th>
                </tr>
              </thead>
              <tbody>
                {(detailQuery.data?.results ?? []).map((r) => {
                  const d = resultDrafts[r.id] ?? {};
                  const value = (d.value_numeric ?? r.value_numeric) as number | null;
                  const analyteKey = (d.analyte_key ?? r.analyte_key) as string | null;
                  const verified = (d.is_verified ?? r.is_verified) as boolean;
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2 font-medium">{r.source_analyte ?? "—"}</td>
                      <td className="px-3 py-2">{r.source_method ?? r.method ?? "—"}</td>
                      <td className="px-3 py-2">{r.source_unit ?? r.unit ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.source_value ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Input
                          className="h-7 w-24 text-xs"
                          type="number"
                          step="any"
                          value={value ?? ""}
                          onChange={(e) =>
                            setResult(r.id, "value_numeric", e.target.value ? Number(e.target.value) : null)
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        {r.lab_range_low != null || r.lab_range_high != null
                          ? `${r.lab_range_low ?? "?"}–${r.lab_range_high ?? "?"}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{labStatusLabel(r.lab_status)}</td>
                      <td className="px-3 py-2">
                        <select
                          className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
                          value={analyteKey ?? ""}
                          onChange={(e) => setResult(r.id, "analyte_key", e.target.value || null)}
                        >
                          <option value="">Unmapped</option>
                          {analytes.map((a) => (
                            <option key={a.analyte_key} value={a.analyte_key}>{a.display_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={verified}
                            onChange={(e) => setResult(r.id, "is_verified", e.target.checked)}
                          />
                          <span>Verified</span>
                        </label>
                        {r.is_user_corrected && (
                          <Badge variant="outline" className="mt-1 border-warning/50 bg-warning/10 text-warning-foreground">
                            Corrected
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.source_page ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save}>Save review</Button>
        <Button variant="outline" onClick={() => navigate("/admin/soil-analysis")}>Back to Soil Analysis</Button>
        {saveState && <span className="text-sm text-muted-foreground">{saveState}</span>}
      </div>
    </div>
  );
}
