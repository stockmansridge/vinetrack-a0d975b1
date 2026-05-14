import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileText, FileSpreadsheet, Info, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import {
  fetchSprayJobs, fetchVineyardTeamMembers, memberLabel,
} from "@/lib/sprayJobsQuery";
import {
  fetchSprayRecordsForVineyard, type SprayRecord,
} from "@/lib/sprayRecordsQuery";
import { exportSprayRecordPdf } from "@/lib/sprayRecordPdf";
import {
  exportYearlySprayProgramPdf,
  exportYearlySprayProgramXlsx,
  fetchJobPaddockMap,
  jobYear,
  type JobLookups,
} from "@/lib/sprayJobsExport";
import { useCanSeeCosts } from "@/lib/permissions";
import { computeTripCost, type TractorLite } from "@/lib/tripCosting";
import { fetchTripsForVineyard } from "@/lib/tripsQuery";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { fetchSavedInputsForVineyard } from "@/lib/savedInputsQuery";
import { fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";

function fmtRecordLabel(r: SprayRecord): string {
  const date = r.date ?? "Undated";
  const ref = r.spray_reference ?? r.id.slice(0, 8);
  const op = r.operation_type ? ` · ${r.operation_type}` : "";
  return `${date} — ${ref}${op}`;
}

export default function SprayReportsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const { toast } = useToast();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  // ---- Lookups
  const { data: paddocks } = useQuery({
    queryKey: ["paddocks-list", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList("paddocks", selectedVineyardId!),
  });
  const { data: tractors } = useQuery({
    queryKey: ["tractors-list", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList("tractors", selectedVineyardId!),
  });
  const { data: equipment } = useQuery({
    queryKey: ["equipment-list", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList("spray_equipment", selectedVineyardId!),
  });
  const { data: members } = useQuery({
    queryKey: ["team-members", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardTeamMembers(selectedVineyardId!),
  });

  const jobLookups: JobLookups = useMemo(() => ({
    paddockNameById: new Map((paddocks ?? []).map((p: any) => [p.id, p.name ?? p.block_name ?? "Unnamed"])),
    tractorNameById: new Map((tractors ?? []).map((t: any) => [t.id, t.name ?? t.model ?? "Tractor"])),
    equipmentNameById: new Map((equipment ?? []).map((e: any) => [e.id, e.name ?? e.type ?? "Equipment"])),
    memberNameById: new Map((members ?? []).map((u: any) => [u.user_id, memberLabel(u)])),
  }), [paddocks, tractors, equipment, members]);

  // ---- Records (individual export)
  const { data: recordsResult, isLoading: recordsLoading } = useQuery({
    queryKey: ["spray-records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSprayRecordsForVineyard(selectedVineyardId!),
  });

  const records = useMemo(() => {
    const list = [...(recordsResult?.records ?? [])];
    list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return list;
  }, [recordsResult]);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const selectedRecord = records.find((r) => r.id === selectedRecordId) ?? null;

  // ---- Cost inputs (owner/manager only) for linked-trip costing on PDF.
  const canSeeCosts = useCanSeeCosts();
  const costEnabled = !!selectedVineyardId && canSeeCosts;
  const { data: costTrips } = useQuery({
    queryKey: ["spray-cost-trips", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, []),
  });
  const { data: costCategories } = useQuery({
    queryKey: ["spray-cost-categories", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });
  const { data: costMembers } = useQuery({
    queryKey: ["spray-cost-members", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchVineyardMembersWithCategory(selectedVineyardId!),
  });
  const { data: costFuel } = useQuery({
    queryKey: ["spray-cost-fuel", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchFuelPurchasesForVineyard(selectedVineyardId!),
  });
  const { data: costSavedChemicals } = useQuery({
    queryKey: ["spray-cost-saved-chemicals", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });
  const { data: costSavedInputs } = useQuery({
    queryKey: ["spray-cost-saved-inputs", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedInputsForVineyard(selectedVineyardId!),
  });
  const { data: costYields } = useQuery({
    queryKey: ["spray-cost-yields", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchYieldReportsForVineyard(selectedVineyardId!),
  });

  // ---- Spray jobs (yearly program)
  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ["spray-jobs-program", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSprayJobs(selectedVineyardId!, { template: false }),
  });

  const yearsAvailable = useMemo(() => {
    const ys = new Set<number>();
    (jobs ?? []).forEach((j) => {
      const y = jobYear(j);
      if (y != null) ys.add(y);
    });
    const arr = [...ys].sort((a, b) => b - a);
    if (!arr.length) arr.push(new Date().getFullYear());
    return arr;
  }, [jobs]);

  const [year, setYear] = useState<number | null>(null);
  const effectiveYear = year ?? yearsAvailable[0];

  const jobsForYear = useMemo(
    () => (jobs ?? []).filter((j) => jobYear(j) === effectiveYear),
    [jobs, effectiveYear],
  );

  const handleExportRecord = () => {
    if (!selectedRecord) return;
    try {
      // Build linked-trip cost (owner/manager only).
      let cost = null as ReturnType<typeof computeTripCost> | null;
      if (canSeeCosts && selectedRecord.trip_id) {
        const trip = (costTrips?.trips ?? []).find((t) => t.id === selectedRecord.trip_id) ?? null;
        if (trip) {
          const tractor = trip.tractor_id
            ? ((tractors ?? []) as TractorLite[]).find((x) => x.id === trip.tractor_id) ?? null
            : null;
          cost = computeTripCost({
            trip,
            tractor,
            operatorCategories: costCategories?.categories ?? [],
            members: costMembers ?? [],
            fuelPurchases: costFuel ?? [],
            sprayRecords: recordsResult?.records ?? [],
            savedChemicals: costSavedChemicals?.chemicals ?? [],
            savedInputs: costSavedInputs?.inputs ?? [],
            paddocks: (paddocks ?? []) as any,
            historicalYields: costYields?.historical ?? [],
          });
        }
      }
      exportSprayRecordPdf(selectedRecord, vineyardName, {
        // spray_records has no paddock_id — fall back to trip linkage label if any
        paddockName: null,
        operatorName: null,
        cost,
      });
    } catch (e: any) {
      toast({ title: "PDF export failed", description: e.message, variant: "destructive" });
    }
  };

  const handleExportProgram = async (kind: "pdf" | "xlsx") => {
    if (!jobsForYear.length) {
      toast({ title: "No spray jobs", description: `No planned jobs found for ${effectiveYear}.`, variant: "destructive" });
      return;
    }
    try {
      const paddockMap = await fetchJobPaddockMap(jobsForYear.map((j) => j.id));
      if (kind === "pdf") {
        exportYearlySprayProgramPdf(jobsForYear, paddockMap, jobLookups, vineyardName, effectiveYear);
      } else {
        exportYearlySprayProgramXlsx(jobsForYear, paddockMap, jobLookups, vineyardName, effectiveYear);
      }
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  if (!selectedVineyardId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Select a vineyard to generate spray reports.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Spray Records & Compliance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export completed spray records and yearly spray programs — including chemicals,
          rates, WHP/REI, weather and tank mix details. For general per-trip reports
          (Maintenance, Mowing, Seeding, Spray operations, Custom jobs etc.) use{" "}
          <strong>Trip Reports</strong>.
        </p>
      </div>

      {/* Individual record */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <FileText className="h-5 w-5 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <div className="font-medium text-sm">Individual spray record (PDF)</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Job-sheet style report for a single completed spray. Includes chemical mix,
              rates, weather snapshot, equipment and operator details.
            </div>
          </div>
          <Badge variant="secondary">{records.length} record{records.length === 1 ? "" : "s"}</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="record-pick" className="text-xs">Record</Label>
            <Select
              value={selectedRecordId ?? ""}
              onValueChange={(v) => setSelectedRecordId(v || null)}
              disabled={recordsLoading || !records.length}
            >
              <SelectTrigger id="record-pick">
                <SelectValue placeholder={recordsLoading ? "Loading…" : records.length ? "Choose a spray record" : "No records found"} />
              </SelectTrigger>
              <SelectContent>
                {records.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{fmtRecordLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleExportRecord} disabled={!selectedRecord}>
            <Download className="h-4 w-4 mr-1" /> Export PDF
          </Button>
        </div>
      </Card>

      {/* Yearly program */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-5 w-5 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <div className="font-medium text-sm">Yearly spray program</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Full season program covering planned spray jobs, chemicals, rates and target paddocks.
            </div>
          </div>
          <Badge variant="secondary">{(jobs ?? []).length} planned job{(jobs ?? []).length === 1 ? "" : "s"}</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="year-pick" className="text-xs">Year</Label>
            <Select
              value={effectiveYear ? String(effectiveYear) : ""}
              onValueChange={(v) => setYear(v ? Number(v) : null)}
              disabled={jobsLoading}
            >
              <SelectTrigger id="year-pick">
                <SelectValue placeholder={jobsLoading ? "Loading…" : "Pick year"} />
              </SelectTrigger>
              <SelectContent>
                {yearsAvailable.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y} ({(jobs ?? []).filter((j) => jobYear(j) === y).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => handleExportProgram("pdf")} disabled={!jobsForYear.length}>
            <FileText className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button onClick={() => handleExportProgram("xlsx")} disabled={!jobsForYear.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2 bg-muted/30">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Info className="h-4 w-4" /> Report data
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>Individual spray record PDFs are generated from completed spray records.</li>
          <li>
            Yearly spray program exports are generated from planned spray jobs, templates,
            and linked completed spray records where available.
          </li>
          <li>
            Reports are generated as VineTrack documents for review, compliance, and
            record keeping.
          </li>
        </ul>
      </Card>
    </div>
  );
}
