// Soil sample detail — Review Results screen.
//
// Editable metadata and block mapping write only to the live metadata /
// mapping columns; source_value_numeric / source_value_text provenance is
// shown read-only and never overwritten. method / unit / lab range / lab
// status are read-only in Stage 1 because the schema keeps no duplicate
// source copies for them. Saving edits never confirms a sample — only the
// explicit Confirm action sets confirmed + verified_by + verified_at.
// The original document opens through a short-lived signed URL.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import { AdminPageHeader, formatDate } from "./_shared";
import { SoilAnalysisGate } from "@/components/soil-analysis/SoilAnalysisGate";
import {
  getSoilSampleDetail,
  getSoilDocumentSignedUrl,
  updateSoilSample,
  updateSoilResult,
  confirmSoilSample,
  retrySoilExtraction,
  isSoilSampleDeletable,
  listAnalyteCatalogue,
  setSoilSampleBlockMappings,
  validateBlockMappings,
  formatDataError,
  SAMPLE_STATUS_LABEL,
  labStatusLabel,
  type SoilSample,
  type SoilSampleResult,
  type SoilBlockMappingInput,
} from "@/lib/soilAnalysis";

type CoverageMode = "not_mapped" | "block" | "point";

/** Compact variety context for the block selector — display only; the
 *  mapping always stores just the paddock_id. */
function varietyContext(allocations: unknown): string | null {
  if (!Array.isArray(allocations)) return null;
  const names = allocations
    .map((a: any) => String(a?.varietyName ?? a?.variety_name ?? a?.name ?? "").trim())
    .filter(Boolean);
  return names.length > 0 ? [...new Set(names)].join(" · ") : null;
}
import { ExtractionErrorNotice } from "@/components/soil-analysis/ExtractionErrorNotice";
import { DeleteSampleDialog } from "@/components/soil-analysis/DeleteSampleDialog";

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
  const { user } = useAuth();

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
    queryFn: async (): Promise<Array<{ id: string; name: string; variety_allocations: unknown }>> => {
      const { data, error } = await db
        .from("paddocks")
        .select("id, name, variety_allocations")
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
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // A failed retry shows the concise notice with the raw detail collapsed;
  // saveState stays reserved for plain status text.
  const [retryFailure, setRetryFailure] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Block coverage: a repeatable list of mapping rows. soil_sample_block_mappings
  // is the authority; legacy sample fields are only a fallback when no rows exist.
  const [coverageMode, setCoverageMode] = useState<CoverageMode>("not_mapped");
  const [mappingRows, setMappingRows] = useState<SoilBlockMappingInput[]>([]);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  const sample = detailQuery.data?.sample;
  const mappings = detailQuery.data?.mappings;
  useEffect(() => {
    if (!sample || !mappings || initialisedFor === sample.id) return;
    setDraft({ ...sample });
    if (sample.sample_scope === "point") {
      setCoverageMode("point");
      setMappingRows([]);
    } else if (mappings.length > 0) {
      setCoverageMode("block");
      setMappingRows(
        mappings.map((m) => ({
          paddock_id: m.paddock_id,
          mapping_scope: m.mapping_scope,
          row_start: m.row_start,
          row_end: m.row_end,
        })),
      );
    } else if (
      sample.paddock_id &&
      (sample.sample_scope === "whole_block" || sample.sample_scope === "row_range")
    ) {
      // Legacy fallback only — this sample predates the mappings backfill.
      setCoverageMode("block");
      setMappingRows([
        {
          paddock_id: sample.paddock_id,
          mapping_scope: sample.sample_scope,
          row_start: sample.row_start,
          row_end: sample.row_end,
        },
      ]);
    } else {
      setCoverageMode("not_mapped");
      setMappingRows([]);
    }
    setInitialisedFor(sample.id);
  }, [sample?.id, mappings]);

  const updateMappingRow = (idx: number, patch: Partial<SoilBlockMappingInput>) =>
    setMappingRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addMappingRow = () =>
    setMappingRows((rows) => [
      ...rows,
      { paddock_id: "", mapping_scope: "whole_block", row_start: null, row_end: null },
    ]);
  const removeMappingRow = (idx: number) =>
    setMappingRows((rows) => rows.filter((_, i) => i !== idx));

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

  // Returns true when everything saved; false when validation failed or a
  // write errored (the human-readable message is already in saveState).
  const save = async (): Promise<boolean> => {
    setSaveState(null);
    // Validate block coverage BEFORE any write so an invalid state (e.g. a
    // row range with no block) can never reach the database.
    if (coverageMode === "block") {
      const invalid = validateBlockMappings(mappingRows);
      if (invalid) {
        setSaveState(invalid);
        return false;
      }
    }
    try {
      // 1. Metadata only. sample_scope / paddock_id / row_start / row_end
      //    are owned by the atomic mappings RPC for block coverage and are
      //    NEVER written directly here.
      await updateSoilSample(sample.id, {
        sampled_at: (draft.sampled_at as string) ?? null,
        received_at: (draft.received_at as string) ?? null,
        reported_at: (draft.reported_at as string) ?? null,
        laboratory: (draft.laboratory as string) ?? null,
        lab_code: (draft.lab_code as string) ?? null,
        order_number: (draft.order_number as string) ?? null,
        lab_sample_id: (draft.lab_sample_id as string) ?? null,
        lab_paddock_name: (draft.lab_paddock_name as string) ?? null,
        client_agronomist: (draft.client_agronomist as string) ?? null,
        crop: (draft.crop as string) ?? null,
        soil_type: (draft.soil_type as string) ?? null,
        sample_depth_from_cm: (draft.sample_depth_from_cm as number) ?? null,
        sample_depth_to_cm: (draft.sample_depth_to_cm as number) ?? null,
        notes: (draft.notes as string) ?? null,
      });
      // 2. Block mappings — ONE atomic RPC call, never N separate inserts.
      //    The RPC also synchronises the legacy sample fields (including
      //    multi_block when more than one block is mapped).
      if (coverageMode === "block") {
        await setSoilSampleBlockMappings(sample.id, mappingRows);
      } else {
        // Not mapped and Sampling point both clear block mappings.
        await setSoilSampleBlockMappings(sample.id, []);
        if (coverageMode === "point") {
          // A sampling point is a sample-level location, not a block mapping.
          await updateSoilSample(sample.id, {
            sample_scope: "point",
            paddock_id: null,
            row_start: null,
            row_end: null,
            latitude: (draft.latitude as number) ?? null,
            longitude: (draft.longitude as number) ?? null,
          });
        }
      }
      // 3. Result corrections (provenance-safe patches only).
      for (const [rid, patch] of Object.entries(resultDrafts)) {
        if (Object.keys(patch).length > 0) await updateSoilResult(rid, patch);
      }
      setResultDrafts({});
      // Refetch: the RPC may have changed sample_scope (e.g. multi_block).
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      setSaveState("Saved. Original extraction values are preserved; the sample stays in review until you confirm it.");
      return true;
    } catch (e) {
      setSaveState(formatDataError(e));
      return false;
    }
  };

  const confirm = async () => {
    if (!user?.id) return;
    setConfirming(true);
    setSaveState(null);
    try {
      const saved = await save();
      if (!saved) return; // validation message already shown
      await confirmSoilSample(sample.id, user.id);
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      setSaveState("Confirmed. The reviewed values are now the confirmed record.");
    } catch (e) {
      setSaveState(formatDataError(e));
    } finally {
      setConfirming(false);
    }
  };

  const retry = async () => {
    const primaryDoc = (detailQuery.data?.documents ?? []).find((d) => d.is_primary)
      ?? detailQuery.data?.documents?.[0];
    if (!primaryDoc) {
      setSaveState("No source document is recorded for this sample, so extraction cannot be retried.");
      return;
    }
    setRetrying(true);
    setSaveState(null);
    setRetryFailure(null);
    try {
      const outcome = await retrySoilExtraction(sample.id, primaryDoc.id);
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      if (outcome.ok) {
        setSaveState("Extraction finished — review the extracted details below, then confirm.");
      } else {
        setRetryFailure(outcome.error);
      }
    } catch (e) {
      setSaveState(formatDataError(e));
    } finally {
      setRetrying(false);
    }
  };

  const openDocument = async (path: string) => {
    setDocError(null);
    try {
      const url = await getSoilDocumentSignedUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setDocError(formatDataError(e));
    }
  };

  const analytes = analytesQuery.data ?? [];
  const blocks = blocksQuery.data ?? [];
  const results = detailQuery.data?.results ?? [];
  const selectClass = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  const resultsEmptyMessage =
    sample.extraction_status === "pending"
      ? "Awaiting extraction — results appear here once the parser processes the document."
      : sample.extraction_status === "processing"
        ? "Extracting — the parser is processing the document now."
        : sample.extraction_status === "failed"
          ? "Extraction failed. The uploaded document is preserved; retry when ready."
          : "No results recorded for this sample.";

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <AdminPageHeader
        title="Review soil sample"
        subtitle={`${sample.vineyard_name ?? "Vineyard"} · ${formatDate(sample.sampled_at)}`}
        back="/admin/soil-analysis"
      />
      <BetaAdminBanner />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Extracted from report</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <Label>Sample date</Label>
              <Input type="date" value={(draft.sampled_at as string) ?? ""} onChange={(e) => set("sampled_at", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Received date</Label>
              <Input type="date" value={(draft.received_at as string) ?? ""} onChange={(e) => set("received_at", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Reported date</Label>
              <Input type="date" value={(draft.reported_at as string) ?? ""} onChange={(e) => set("reported_at", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Laboratory</Label>
              <Input value={(draft.laboratory as string) ?? ""} onChange={(e) => set("laboratory", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Lab code</Label>
              <Input value={(draft.lab_code as string) ?? ""} onChange={(e) => set("lab_code", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Order number</Label>
              <Input value={(draft.order_number as string) ?? ""} onChange={(e) => set("order_number", e.target.value || null)} />
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
              <Label>Client / agronomist</Label>
              <Input value={(draft.client_agronomist as string) ?? ""} onChange={(e) => set("client_agronomist", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Crop</Label>
              <Input value={(draft.crop as string) ?? ""} onChange={(e) => set("crop", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Soil type</Label>
              <Input value={(draft.soil_type as string) ?? ""} onChange={(e) => set("soil_type", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Depth from (cm)</Label>
              <Input type="number" value={(draft.sample_depth_from_cm as any) ?? ""} onChange={(e) => set("sample_depth_from_cm", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div className="space-y-1">
              <Label>Depth to (cm)</Label>
              <Input type="number" value={(draft.sample_depth_to_cm as any) ?? ""} onChange={(e) => set("sample_depth_to_cm", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Input value={(draft.notes as string) ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <div className="pt-1.5">
                <Badge variant="outline">{SAMPLE_STATUS_LABEL[sample.extraction_status]}</Badge>
              </div>
            </div>
            {sample.verified_at && (
              <div className="space-y-1">
                <Label>Verified</Label>
                <div className="pt-1.5 text-xs text-muted-foreground">{formatDate(sample.verified_at)}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">VineTrack block coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Link this laboratory sample to the VineTrack blocks it represents. The
              laboratory paddock name is preserved separately.
            </p>
            <div className="space-y-1">
              <Label>Coverage</Label>
              <select
                className={selectClass}
                value={coverageMode}
                onChange={(e) => setCoverageMode(e.target.value as CoverageMode)}
                aria-label="Coverage mode"
              >
                <option value="not_mapped">Not mapped</option>
                <option value="block">Block coverage</option>
                <option value="point">Sampling point</option>
              </select>
            </div>

            {coverageMode === "block" && (
              <div className="space-y-2">
                {mappingRows.map((row, idx) => (
                  <div key={idx} className="rounded-md border border-border p-2 space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label>Block</Label>
                        <select
                          className={selectClass}
                          value={row.paddock_id}
                          onChange={(e) => updateMappingRow(idx, { paddock_id: e.target.value })}
                          aria-label={`Mapping block ${idx + 1}`}
                        >
                          <option value="">Choose a block…</option>
                          {blocks.map((b) => {
                            const varieties = varietyContext(b.variety_allocations);
                            return (
                              <option key={b.id} value={b.id}>
                                {varieties ? `${b.name} — ${varieties}` : b.name}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMappingRow(idx)}
                        aria-label={`Remove mapping ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label>Coverage</Label>
                        <select
                          className={selectClass}
                          value={row.mapping_scope}
                          onChange={(e) =>
                            updateMappingRow(idx, {
                              mapping_scope: e.target.value as SoilBlockMappingInput["mapping_scope"],
                            })
                          }
                          aria-label={`Mapping coverage ${idx + 1}`}
                        >
                          <option value="whole_block">Whole block</option>
                          <option value="row_range">Row range</option>
                        </select>
                      </div>
                      {row.mapping_scope === "row_range" && (
                        <>
                          <div className="space-y-1">
                            <Label>Row from</Label>
                            <Input
                              type="number"
                              className="w-24"
                              value={row.row_start ?? ""}
                              onChange={(e) =>
                                updateMappingRow(idx, {
                                  row_start: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Row to</Label>
                            <Input
                              type="number"
                              className="w-24"
                              value={row.row_end ?? ""}
                              onChange={(e) =>
                                updateMappingRow(idx, {
                                  row_end: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addMappingRow}>
                  + Add another block
                </Button>
              </div>
            )}

            {coverageMode === "point" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Latitude</Label>
                  <Input type="number" step="any" value={(draft.latitude as any) ?? ""} onChange={(e) => set("latitude", e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Longitude</Label>
                  <Input type="number" step="any" value={(draft.longitude as any) ?? ""} onChange={(e) => set("longitude", e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>
            )}
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
              <div key={doc.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{doc.original_filename}</span>
                  <Button size="sm" variant="outline" onClick={() => openDocument(doc.storage_path)}>
                    View source document
                  </Button>
                </div>
                {doc.extraction_status === "failed" && doc.extraction_error && (
                  <ExtractionErrorNotice raw={doc.extraction_error} className="space-y-0.5 text-xs" />
                )}
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
          {results.length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 pb-4">{resultsEmptyMessage}</div>
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
                {results.map((r) => {
                  const d = resultDrafts[r.id] ?? {};
                  const value = (d.value_numeric ?? r.value_numeric) as number | null;
                  const analyteKey = (d.analyte_key ?? r.analyte_key) as string | null;
                  const verified = (d.is_user_verified ?? r.is_user_verified) as boolean;
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2 font-medium">{r.original_analyte_name ?? "—"}</td>
                      <td className="px-3 py-2">{r.method ?? "—"}</td>
                      <td className="px-3 py-2">{r.unit ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.source_value_numeric ?? r.source_value_text ?? "—"}
                      </td>
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
                        {r.lab_range_min != null || r.lab_range_max != null
                          ? `${r.lab_range_min ?? "?"}–${r.lab_range_max ?? "?"}`
                          : (r.lab_range_text ?? "—")}
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
                            <option key={a.key} value={a.key}>{a.display_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {r.extraction_confidence != null ? `${Math.round(r.extraction_confidence * 100)}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={verified}
                            onChange={(e) => setResult(r.id, "is_user_verified", e.target.checked)}
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
        {sample.extraction_status === "failed" && (
          <Button variant="outline" onClick={retry} disabled={retrying}>
            {retrying ? "Extracting…" : "Retry extraction"}
          </Button>
        )}
        {sample.extraction_status !== "confirmed" && sample.extraction_status !== "failed" && (
          <Button variant="outline" onClick={confirm} disabled={confirming}>
            {confirming ? "Confirming…" : "Confirm reviewed sample"}
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate("/admin/soil-analysis")}>Back to Soil Analysis</Button>
        {retryFailure && <ExtractionErrorNotice raw={retryFailure} />}
        {saveState && <span className="text-sm text-muted-foreground">{saveState}</span>}
      </div>

      {isSoilSampleDeletable(sample.extraction_status) && (
        <div className="mt-6 border-t pt-4">
          <Button
            variant="destructive"
            className="gap-1.5"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> Delete sample permanently
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Only unapproved samples can be deleted. Confirmed samples are protected.
          </p>
        </div>
      )}
      <DeleteSampleDialog
        sample={sample}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          qc.invalidateQueries({ queryKey: ["soil-analysis"] });
          navigate("/admin/soil-analysis?tab=samples");
        }}
      />
    </div>
  );
}
