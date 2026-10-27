import { supabase } from "@/integrations/ios-supabase/client";
import { soilTrafficBucket, type SoilTrafficBucket, type SoilTrafficSnapshot } from "./soilAnalysis";

export interface SoilIndication {
  result_id: string;
  indication: "low" | "satisfactory" | "high" | "unable";
  confidence: number;
  reason: string;
  basis: "lab_range" | "general_viticulture" | "insufficient_context";
  scope: "result" | "sample_nitrogen_context" | "sample_context";
}
export type IndicatedSnapshot = SoilTrafficSnapshot & { sourceBucket: SoilTrafficBucket; aiLabel?: string; aiEntries?: SoilIndication[] };

/** Shown wherever an indication was reached from companion measurements in the same sample. */
export const SOIL_SAMPLE_CONTEXT_HELP = "Uses related measurements from the same soil sample when a single result does not have a defensible standalone viticulture threshold.";

/** Only unclassified entries in currently selected latest snapshots; stable cache identity. */
export function soilIndicationResultIds(snapshots: SoilTrafficSnapshot[]): string[] {
  return [...new Set(snapshots.filter((s) => s.bucket === "other").flatMap((s) => s.entries
    .filter((r) => soilTrafficBucket(r.lab_status) === "other").map((r) => r.id)))].sort();
}

/** Read-only screening through the existing endpoint. No automatic retries or sample writes. */
export async function requestSoilIndications(vineyardId: string, ids: string[]): Promise<SoilIndication[]> {
  const unique = [...new Set(ids)].sort();
  const combined: SoilIndication[] = [];
  for (let i = 0; i < unique.length; i += 150) {
    const batch = unique.slice(i, i + 150);
    const { data, error } = await supabase.functions.invoke("soil-analysis-viticulture-indicate", {
      body: { vineyard_id: vineyardId, result_ids: batch },
    });
    if (error || data?.error) throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
    const rows: unknown = Array.isArray(data) ? data : data?.classifications;
    if (!Array.isArray(rows)) throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.result_id !== "string" || !batch.includes(row.result_id) || seen.has(row.result_id)
        || !["low", "satisfactory", "high", "unable"].includes(row.indication)
        || typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1
        || typeof row.reason !== "string" || !["lab_range", "general_viticulture", "insufficient_context"].includes(row.basis)
        || !["result", "sample_nitrogen_context", "sample_context"].includes(row.scope)) {
        throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
      }
      seen.add(row.result_id);
      combined.push(row as SoilIndication);
    }
    if (seen.size !== batch.length) throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
  }
  return combined;
}

/** Names the evidence the endpoint actually used, so companion-based readings never look standalone. */
function indicationPrefix(entries: SoilIndication[]): string {
  if (entries.some((r) => r.scope === "sample_nitrogen_context")) return "AI nitrogen context";
  if (entries.some((r) => r.scope === "sample_context")) return "AI sample context";
  return "AI indication";
}

/** Overlay only: the original snapshot and every laboratory entry remain untouched. */
export function indicateSoilSnapshots(snapshots: SoilTrafficSnapshot[], indications?: SoilIndication[]): IndicatedSnapshot[] {
  const byId = new Map(indications?.map((r) => [r.result_id, r]));
  return snapshots.map((s) => {
    const original = { ...s, sourceBucket: s.bucket };
    if (s.bucket !== "other" || !indications) return original;
    const unrated = s.entries.filter((r) => soilTrafficBucket(r.lab_status) === "other");
    if (!unrated.length) return original;
    const aiEntries = unrated.flatMap((r) => byId.get(r.id) ? [byId.get(r.id) as SoilIndication] : []);
    const prefix = indicationPrefix(aiEntries);
    if (aiEntries.length !== unrated.length || aiEntries.some((r) => r.indication === "unable")) {
      return { ...original, aiLabel: prefix === "AI indication" ? "AI: Unable to rate" : `${prefix}: Unable to rate`, aiEntries };
    }
    const buckets = new Set(s.entries.map((r) => soilTrafficBucket(r.lab_status) === "other" ? byId.get(r.id)?.indication : soilTrafficBucket(r.lab_status)));
    if (buckets.size !== 1) return { ...original, aiLabel: "AI: Mixed indications", aiEntries };
    const bucket = aiEntries[0]?.indication;
    if (!bucket || bucket === "unable") return original;
    return { ...original, bucket, aiLabel: `${prefix}: ${bucket[0].toUpperCase()}${bucket.slice(1)}`, aiEntries };
  });
}
