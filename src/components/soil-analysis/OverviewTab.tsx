// Soil Analysis Overview — latest samples by block, status counts and
// lab-range issues only (no agronomic recommendations).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  listSoilSamples,
  SAMPLE_STATUS_LABEL,
  labStatusLabel,
  isOutsideLabRange,
  type SoilSample,
  type SoilSampleResult,
} from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;

export function OverviewTab({ onOpenSample }: { onOpenSample: (id: string) => void }) {
  const samplesQuery = useQuery({
    queryKey: ["soil-analysis", "samples", "overview"],
    queryFn: () => listSoilSamples(),
  });
  const resultsQuery = useQuery({
    queryKey: ["soil-analysis", "results", "overview"],
    queryFn: async (): Promise<Array<SoilSampleResult & { sample_id: string }>> => {
      const { data, error } = await db.from("soil_sample_results").select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const samples = samplesQuery.data ?? [];
  const results = resultsQuery.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, review_required: 0, confirmed: 0 };
    for (const s of samples) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [samples]);

  const latestByBlock = useMemo(() => {
    const map = new Map<string, SoilSample>();
    for (const s of samples) {
      if (!s.paddock_id) continue;
      const existing = map.get(s.paddock_id);
      const when = s.sample_date ?? s.created_at;
      if (!existing || when > (existing.sample_date ?? existing.created_at)) {
        map.set(s.paddock_id, s);
      }
    }
    return [...map.values()].sort((a, b) =>
      String(b.sample_date ?? b.created_at).localeCompare(String(a.sample_date ?? a.created_at)),
    );
  }, [samples]);

  const issues = useMemo(() => {
    const sampleById = new Map(samples.map((s) => [s.id, s]));
    return results
      .filter((r) => isOutsideLabRange(r.lab_status))
      .map((r) => ({ result: r, sample: sampleById.get(r.sample_id) }))
      .filter((x) => x.sample);
  }, [results, samples]);

  const blockSummaries = useMemo(() => {
    const map = new Map<string, { name: string; samples: number; analytes: Set<string> }>();
    for (const s of samples) {
      if (!s.paddock_id) continue;
      const entry = map.get(s.paddock_id) ?? {
        name: s.block_name ?? "Unnamed block",
        samples: 0,
        analytes: new Set<string>(),
      };
      entry.samples += 1;
      map.set(s.paddock_id, entry);
    }
    const sampleBlock = new Map(samples.map((s) => [s.id, s.paddock_id]));
    for (const r of results) {
      const pid = sampleBlock.get(r.sample_id);
      if (pid && r.analyte_key) map.get(pid)?.analytes.add(r.analyte_key);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [samples, results]);

  if (samplesQuery.isLoading) {
    return <div className="text-sm text-muted-foreground py-8">Loading soil samples…</div>;
  }
  if (samplesQuery.error) {
    return (
      <div className="text-sm text-destructive py-4">
        {(samplesQuery.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(["confirmed", "review_required", "pending"] as const).map((status) => (
          <Card key={status}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {SAMPLE_STATUS_LABEL[status]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{counts[status] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Latest sample by block</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {latestByBlock.length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 pb-4">
              No mapped samples yet. Upload a laboratory report to begin.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Block</th>
                  <th className="px-4 py-2 font-medium">Sample date</th>
                  <th className="px-4 py-2 font-medium">Laboratory</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {latestByBlock.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => onOpenSample(s.id)}
                  >
                    <td className="px-4 py-2 font-medium">{s.block_name ?? "—"}</td>
                    <td className="px-4 py-2">{formatDate(s.sample_date)}</td>
                    <td className="px-4 py-2">{s.laboratory ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{SAMPLE_STATUS_LABEL[s.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Current issues (laboratory range only)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 pb-4">
              No results outside the laboratory's stated range.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Block</th>
                  <th className="px-4 py-2 font-medium">Analyte</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Lab status</th>
                  <th className="px-4 py-2 font-medium">Sample date</th>
                </tr>
              </thead>
              <tbody>
                {issues.map(({ result, sample }) => (
                  <tr
                    key={result.id}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => sample && onOpenSample(sample.id)}
                  >
                    <td className="px-4 py-2 font-medium">{sample?.block_name ?? "—"}</td>
                    <td className="px-4 py-2">{result.source_analyte ?? result.analyte_key ?? "—"}</td>
                    <td className="px-4 py-2">
                      {result.value_numeric ?? result.value_text ?? "—"} {result.unit ?? ""}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                        {labStatusLabel(result.lab_status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{formatDate(sample?.sample_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {blockSummaries.map((b) => (
          <Card key={b.name}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">{b.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {b.samples} sample{b.samples === 1 ? "" : "s"} · {b.analytes.size} analyte
              {b.analytes.size === 1 ? "" : "s"} measured
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
