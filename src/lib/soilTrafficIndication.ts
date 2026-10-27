import { supabase } from "@/integrations/ios-supabase/client";
import { soilTrafficBucket, type SoilTrafficBucket, type SoilTrafficSnapshot } from "./soilAnalysis";

export interface SoilIndication {
  result_id: string;
  indication: "low" | "satisfactory" | "high" | "unable";
  confidence: number;
  reason: string;
  basis: "lab_range" | "general_viticulture" | "insufficient_context";
}
export type IndicatedSnapshot = SoilTrafficSnapshot & { sourceBucket: SoilTrafficBucket; aiLabel?: string; aiEntries?: SoilIndication[] };

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
        || typeof row.reason !== "string" || !["lab_range", "general_viticulture", "insufficient_context"].includes(row.basis)) {
        throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
      }
      seen.add(row.result_id);
      combined.push(row as SoilIndication);
    }
    if (seen.size !== batch.length) throw new Error("AI indication is unavailable. Laboratory statuses are still shown.");
  }
  return combined;
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
    if (aiEntries.length !== unrated.length || aiEntries.some((r) => r.indication === "unable")) {
      return { ...original, aiLabel: "AI: Unable to rate", aiEntries };
    }
    const buckets = new Set(s.entries.map((r) => soilTrafficBucket(r.lab_status) === "other" ? byId.get(r.id)?.indication : soilTrafficBucket(r.lab_status)));
    if (buckets.size !== 1) return { ...original, aiLabel: "AI: Mixed indications", aiEntries };
    const bucket = aiEntries[0]?.indication;
    if (!bucket || bucket === "unable") return original;
    return { ...original, bucket, aiLabel: `AI indication: ${bucket[0].toUpperCase()}${bucket.slice(1)}`, aiEntries };
  });
}