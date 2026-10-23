import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { vintageScope } from "@/lib/vintageScope";
import { fetchSprayJobs, type SprayJob } from "@/lib/sprayJobsQuery";
import { fetchSprayRecordsForVineyard } from "@/lib/sprayRecordsQuery";
import { deriveProgramProgression } from "@/lib/sprayProgramProgression";
import { growthStageDescription } from "@/lib/sprayProgramStep";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Read-only "Next from Program" / "Other Program Steps" (iOS parity).
 * Derived only — never creates or materialises spray jobs. Rows open the
 * existing Program Step detail, which offers Plan Spray.
 */
export function NextFromProgramSections({ onOpen }: { onOpen: (step: SprayJob) => void }) {
  const { selectedVineyardId } = useVineyard();
  const season = useVintage();
  const scope = useMemo(
    () => vintageScope(season.vintage, season.seasonStartMonth, season.seasonStartDay),
    [season.vintage, season.seasonStartMonth, season.seasonStartDay],
  );
  const stepsQ = useQuery({
    queryKey: ["spray_jobs", selectedVineyardId, "templates"],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSprayJobs(selectedVineyardId!, { template: true, archived: false }),
  });
  const recsQ = useQuery({
    queryKey: ["spray_records_progression", selectedVineyardId, scope.startISO],
    enabled: !!selectedVineyardId && !season.isLoading,
    queryFn: () => fetchSprayRecordsForVineyard(selectedVineyardId!, scope),
  });
  const result = useMemo(
    () => deriveProgramProgression(stepsQ.data ?? [], (recsQ.data?.records ?? []) as any, scope),
    [stepsQ.data, recsQ.data, scope],
  );
  const loading = stepsQ.isLoading || recsQ.isLoading;
  const err = (stepsQ.error || recsQ.error) as Error | null;

  const list = (rows: SprayJob[], empty: string) => (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">E-L stage</TableHead>
            <TableHead>Program Step</TableHead>
            <TableHead>Operation</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>}
          {err && <TableRow><TableCell colSpan={4} className="text-center text-destructive py-6">{err.message}</TableCell></TableRow>}
          {!loading && !err && rows.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">{empty}</TableCell></TableRow>
          )}
          {!loading && !err && rows.map((s) => (
            <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpen(s)}>
              <TableCell>
                <div className="font-medium">{s.growth_stage_code ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{growthStageDescription(s.growth_stage_code) ?? ""}</div>
              </TableCell>
              <TableCell className="font-medium">{s.name ?? "Untitled step"}</TableCell>
              <TableCell>{s.operation_type ?? "—"}</TableCell>
              <TableCell>{s.target || (s.targets ?? []).join(", ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );

  return (
    <>
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Next from Program</h2>
          <p className="text-sm text-muted-foreground">
            Vintage {season.vintage} · remaining Program Steps in E-L order
            {result.highestCompletedStage != null ? `, after completed sprays through EL${result.highestCompletedStage}` : ""}.
            Open a step to plan a spray.
          </p>
        </div>
        {list(result.nextFromProgram, "No remaining staged Program Steps for this Vintage.")}
      </section>
      {result.otherProgramSteps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Other Program Steps</h2>
          <p className="text-sm text-muted-foreground">Remaining steps without an E-L stage.</p>
          {list(result.otherProgramSteps, "")}
        </section>
      )}
    </>
  );
}
