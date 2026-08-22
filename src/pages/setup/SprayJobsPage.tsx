import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Copy, Archive, RotateCcw, FileText, Save, X, Download, FileDown, Trash2, Upload, FileSpreadsheet, Info } from "lucide-react";
import { downloadSprayProgramTemplate } from "@/lib/sprayProgramTemplate";
import { SprayProgramImportDialog } from "@/components/spray/SprayProgramImportDialog";
import { ProgramStepDetailDialog } from "@/components/spray/ProgramStepDetailDialog";
import { ProgramStepPickerDialog } from "@/components/spray/ProgramStepPickerDialog";
import { PlanSprayFromProgramStep } from "@/components/spray/PlanSprayFromProgramStep";
import { growthStageOrder, chemicalLineRateText, programLines } from "@/lib/sprayProgramStep";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  exportSprayJobPdf, exportYearlySprayProgramPdf, exportYearlySprayProgramCsv,
  fetchJobPaddockMap, jobYear, type JobLookups,
} from "@/lib/sprayJobsExport";

import { useVineyard } from "@/context/VineyardContext";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { Fragment } from "react";
import { useSortableTable } from "@/lib/useSortableTable";
import { useToast } from "@/hooks/use-toast";
import { fetchList } from "@/lib/queries";
import {
  fetchSprayJobs, fetchSprayJobPaddockIds,
  createSprayJob, updateSprayJob,
  archiveSprayJob, restoreSprayJob, duplicateSprayJob, hardDeleteDraftSprayJob,
  chemicalLinesSummary,
  fetchVineyardTeamMembers, memberLabel,
  fetchLinkedSprayRecords, fetchUnlinkedSprayRecords,
  linkSprayRecord, unlinkSprayRecord,
  comparePlannedVsActual, recordTotalWaterLitres, recordChemicalNames,
  type SprayJob, type SprayJobChemicalLine, type SprayJobInput,
  type VineyardTeamMember, type LinkedSprayRecord,
} from "@/lib/sprayJobsQuery";
import { ChemicalPicker } from "@/components/spray/ChemicalPicker";
import {
  GROWTH_STAGES, GROWTH_STAGE_LABEL,
  VSP_CANOPY_SIZES, VSP_DENSITIES,
  vspLitresPer100m, vspLitresPerHa,
} from "@/lib/vspWaterRate";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { computeTankMix, fmtAmount, chemUnitOnly } from "@/lib/sprayTankMix";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { inferRateBasis, composeUnit, displayUnitText, normaliseUnit, RATE_BASIS_LABEL, type RateBasis } from "@/lib/rateBasis";
import { formatDate } from "@/lib/dateFormat";
import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : formatDate(d);
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const STATUS_OPTIONS = ["draft", "scheduled", "in_progress", "completed", "cancelled"];

// Operation type options. These describe HOW the job is applied (matches iOS).
// Chemical use/type (Fungicide/Herbicide/Insecticide) lives on the chemical
// line via saved_chemicals, not on operation_type.
export const OPERATION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Foliar Spray", label: "Foliar Spray" },
  { value: "Banded Spray", label: "Banded Spray" },
  { value: "Spreader", label: "Spreader" },
];

const OP_LABEL_BY_VALUE = new Map(OPERATION_TYPE_OPTIONS.map((o) => [o.value.toLowerCase(), o.label]));
const opTypeLabel = (v?: string | null) => {
  if (!v) return "—";
  return OP_LABEL_BY_VALUE.get(v.toLowerCase()) ?? v;
};

function OperationTypeBadge({ value }: { value?: string | null }) {
  if (!value) return <span>—</span>;
  const label = opTypeLabel(value);
  const lower = value.toLowerCase();
  const cls =
    lower === "foliar spray"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/60"
      : lower === "banded spray"
      ? "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/60"
      : lower === "spreader"
      ? "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-700/60"
      : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

type LookupMaps = {
  paddocks: Map<string, string>;
  tractors: Map<string, string>;
  equipment: Map<string, string>;
  members: Map<string, string>;
};

function useLookups(vineyardId: string | null) {
  const { data: paddocks } = useQuery({
    queryKey: ["paddocks-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("paddocks", vineyardId!),
  });
  const { data: tractors } = useQuery({
    queryKey: ["tractors-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("tractors", vineyardId!),
  });
  const { data: equipment } = useQuery({
    queryKey: ["equipment-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("spray_equipment", vineyardId!),
  });
  const { data: members } = useQuery({
    queryKey: ["team-members", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchVineyardTeamMembers(vineyardId!),
  });

  const maps: LookupMaps = useMemo(() => {
    const m: LookupMaps = {
      paddocks: new Map(),
      tractors: new Map(),
      equipment: new Map(),
      members: new Map(),
    };
    (paddocks ?? []).forEach((p: any) => m.paddocks.set(p.id, p.name ?? p.block_name ?? "Unnamed paddock"));
    (tractors ?? []).forEach((t: any) => m.tractors.set(t.id, t.name ?? t.model ?? "Tractor"));
    (equipment ?? []).forEach((e: any) => m.equipment.set(e.id, e.name ?? e.type ?? "Equipment"));
    (members ?? []).forEach((u) => m.members.set(u.user_id, memberLabel(u)));
    return m;
  }, [paddocks, tractors, equipment, members]);

  return { paddocks: paddocks ?? [], tractors: tractors ?? [], equipment: equipment ?? [], members: (members ?? []) as VineyardTeamMember[], maps };
}

export default function SprayJobsPage({ templatesOnly = false }: { templatesOnly?: boolean } = {}) {
  const { selectedVineyardId, currentRole, memberships } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const { toast } = useToast();
  // Internal tab key "templates" is the Program tab (spray_jobs.is_template = true).
  const [tab, setTab] = useState<"planned" | "templates" | "archived">("templates");
  const [editing, setEditing] = useState<{ job: SprayJob | null; isTemplate: boolean } | null>(null);
  const [detailStep, setDetailStep] = useState<SprayJob | null>(null);
  const [planningFrom, setPlanningFrom] = useState<SprayJob | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);

  const qc = useQueryClient();
  const lookups = useLookups(selectedVineyardId);

  const effectiveTab = templatesOnly && tab === "planned" ? "templates" : tab;
  const vineyardName = memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const handleDownloadTemplate = async () => {
    if (!selectedVineyardId) return;
    setTplBusy(true);
    try {
      await downloadSprayProgramTemplate({ vineyardId: selectedVineyardId, vineyardName });
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setTplBusy(false);
    }
  };

  const startPlanFromStep = (step: SprayJob) => {
    setPickerOpen(false);
    setDetailStep(null);
    setPlanningFrom(step);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Spray Program</h1>
          <p className="text-sm text-muted-foreground">
            Build your vineyard spray program, maintain reusable Program Steps, and plan
            upcoming spray applications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && effectiveTab === "templates" && (
            <>
              <Button onClick={() => setEditing({ job: null, isTemplate: true })}>
                <Plus className="h-4 w-4 mr-1" /> Add Program Step
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!selectedVineyardId}>
                <Upload className="h-4 w-4 mr-1" /> Import Program
              </Button>
              <Button variant="outline" onClick={handleDownloadTemplate} disabled={tplBusy || !selectedVineyardId}>
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {tplBusy ? "Preparing…" : "Download Import Spreadsheet"}
              </Button>
            </>
          )}
          {canEdit && effectiveTab === "planned" && (
            <>
              <Button onClick={() => setPickerOpen(true)} disabled={!selectedVineyardId}>
                <Plus className="h-4 w-4 mr-1" /> Plan Spray from Program
              </Button>
              <Button variant="outline" onClick={() => setEditing({ job: null, isTemplate: false })}>
                One-off Spray
              </Button>
            </>
          )}
        </div>
      </div>

      {canEdit && effectiveTab === "templates" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Before importing a program</AlertTitle>
          <AlertDescription>
            For the smoothest import, set up your vineyard data first. Add your chemicals,
            spray equipment and tractors before downloading the spreadsheet. The spreadsheet
            uses these existing records as reference lists so imported Program Steps can match
            correctly.
          </AlertDescription>
        </Alert>
      )}

      {importOpen && selectedVineyardId && (
        <SprayProgramImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          vineyardId={selectedVineyardId}
        />
      )}


      <Tabs value={effectiveTab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="templates">Program</TabsTrigger>
          {!templatesOnly && <TabsTrigger value="planned">Planned Sprays</TabsTrigger>}
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <JobsTable mode="templates" canEdit={canEdit} maps={lookups.maps} templatesOnly={templatesOnly}
            onEdit={(job) => setDetailStep(job)}
            onPlanSpray={startPlanFromStep} />
        </TabsContent>
        {!templatesOnly && (
          <TabsContent value="planned">
            <JobsTable mode="planned" canEdit={canEdit} maps={lookups.maps}
              onEdit={(job) => setEditing({ job, isTemplate: false })} />
          </TabsContent>
        )}
        <TabsContent value="archived">
          <JobsTable mode="archived" canEdit={canEdit} maps={lookups.maps} templatesOnly={templatesOnly}
            onEdit={(job) => setEditing({ job, isTemplate: templatesOnly ? true : !!job.is_template })} />
        </TabsContent>
      </Tabs>

      {detailStep && selectedVineyardId && (
        <ProgramStepDetailDialog
          open={true}
          onOpenChange={(o) => !o && setDetailStep(null)}
          job={detailStep}
          vineyardId={selectedVineyardId}
          canEdit={canEdit}
          equipmentName={detailStep.equipment_id ? lookups.maps.equipment.get(detailStep.equipment_id) ?? null : null}
          tractorName={detailStep.tractor_id ? lookups.maps.tractors.get(detailStep.tractor_id) ?? null : null}
          onPlanSpray={() => startPlanFromStep(detailStep)}
          onEdit={() => {
            const job = detailStep;
            setDetailStep(null);
            setEditing({ job, isTemplate: true });
          }}
          onArchive={() => {
            const job = detailStep;
            setDetailStep(null);
            archiveSprayJob(job.id)
              .then(() => {
                toast({ title: "Program Step archived" });
                qc.invalidateQueries({ queryKey: ["spray_jobs", selectedVineyardId] });
              })
              .catch((e: any) =>
                toast({ title: "Archive failed", description: e?.message ?? String(e), variant: "destructive" }));
          }}
        />
      )}

      {pickerOpen && selectedVineyardId && (
        <ProgramStepPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          vineyardId={selectedVineyardId}
          onPick={startPlanFromStep}
        />
      )}

      {planningFrom && selectedVineyardId && (
        <PlanSprayFromProgramStep
          open={true}
          onOpenChange={(o) => !o && setPlanningFrom(null)}
          vineyardId={selectedVineyardId}
          programStep={planningFrom}
          canEdit={canEdit}
          lookups={lookups}
        />
      )}

      {editing && selectedVineyardId && (
        <SprayJobWizard
          open={true}
          onOpenChange={(o) => !o && setEditing(null)}
          vineyardId={selectedVineyardId}
          job={editing.job}
          isTemplate={editing.isTemplate}
          canEdit={canEdit}
          lookups={lookups}
          linkedRecords={
            editing.job && !editing.job.is_template ? (
              <LinkedRecordsSection
                jobId={editing.job.id}
                job={editing.job}
                vineyardId={selectedVineyardId}
                canEdit={canEdit}
              />
            ) : null
          }
        />
      )}

    </div>
  );
}

function JobsTable({
  mode, canEdit, onEdit, maps, templatesOnly = false, onPlanSpray,
}: {
  mode: "planned" | "templates" | "archived";
  canEdit: boolean;
  onEdit: (job: SprayJob) => void;
  maps: LookupMaps;
  templatesOnly?: boolean;
  onPlanSpray?: (job: SprayJob) => void;
}) {
  const { selectedVineyardId, memberships } = useVineyard();
  const formatters = useRegionFormatters();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["spray_jobs", selectedVineyardId, mode],
    enabled: !!selectedVineyardId,
    queryFn: () =>
      fetchSprayJobs(selectedVineyardId!, {
        template: mode === "templates" ? true : mode === "planned" ? false : undefined,
        archived: mode === "archived",
      }),
  });

  const lookupMaps: JobLookups = {
    paddockNameById: maps.paddocks,
    tractorNameById: maps.tractors,
    equipmentNameById: maps.equipment,
    memberNameById: maps.members,
  };

  const handleExportRowPdf = async (job: SprayJob) => {
    try {
      const ids = await fetchSprayJobPaddockIds(job.id);
      await exportSprayJobPdf(job, ids, lookupMaps, vineyardName, formatters);
    } catch (e: any) {
      toast({ title: "PDF export failed", description: e.message, variant: "destructive" });
    }
  };

  // Years available for the program export (planned tab only).
  const years = useMemo(() => {
    const set = new Set<number>();
    (data ?? []).forEach((j) => {
      const y = jobYear(j);
      if (y != null) set.add(y);
    });
    const arr = Array.from(set).sort((a, b) => b - a);
    if (!arr.length) arr.push(new Date().getFullYear());
    return arr;
  }, [data]);
  const [yearSel, setYearSel] = useState<string>(() => String(new Date().getFullYear()));

  const handleYearExport = async (kind: "pdf" | "csv") => {
    const year = Number(yearSel);
    const yearJobs = (data ?? []).filter((j) => jobYear(j) === year);
    try {
      const padMap = await fetchJobPaddockMap(yearJobs.map((j) => j.id));
      if (kind === "pdf") {
        exportYearlySprayProgramPdf(yearJobs, padMap, lookupMaps, vineyardName, year, formatters);
      } else {
        exportYearlySprayProgramCsv(yearJobs, padMap, lookupMaps, vineyardName, year, formatters);
      }
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };


  const refresh = () => qc.invalidateQueries({ queryKey: ["spray_jobs", selectedVineyardId] });

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveSprayJob(id),
    onSuccess: () => { toast({ title: "Archived" }); refresh(); },
    onError: (e: any) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreSprayJob(id),
    onSuccess: () => { toast({ title: "Restored" }); refresh(); },
    onError: (e: any) => toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });
  const [deleteTarget, setDeleteTarget] = useState<SprayJob | null>(null);
  const deleteMut = useMutation({
    mutationFn: (id: string) => hardDeleteDraftSprayJob(id),
    onSuccess: () => {
      toast({ title: "Draft spray job deleted" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
  const dupMut = useMutation({
    mutationFn: ({ id, asTemplate }: { id: string; asTemplate: boolean }) =>
      duplicateSprayJob(id, asTemplate),
    onSuccess: (_d, vars) => {
      toast({ title: vars.asTemplate ? "Saved as template" : "Duplicated" });
      refresh();
    },
    onError: (e: any) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [opFilter, setOpFilter] = useState<string>("all");
  const [growthFilter, setGrowthFilter] = useState<string>("all");
  const [equipmentFilter, setEquipmentFilter] = useState<string>("all");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const allRows = useMemo(() => {
    const base = data ?? [];
    if (templatesOnly && mode === "archived") return base.filter((j) => !!j.is_template);
    return base;
  }, [data, templatesOnly, mode]);
  const growthOptions = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((j) => { if (j.growth_stage_code) set.add(j.growth_stage_code); });
    return Array.from(set).sort();
  }, [allRows]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo).getTime() + 86_400_000 - 1 : null;
    return allRows.filter((j) => {
      if (q) {
        const hay = [
          j.name, j.target, j.operation_type, j.growth_stage_code,
          j.notes, chemicalLinesSummary(j.chemical_lines),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== "all" && String(j.status ?? "").toLowerCase() !== statusFilter) return false;
      if (opFilter !== "all" && String(j.operation_type ?? "").toLowerCase() !== opFilter.toLowerCase()) return false;
      if (growthFilter !== "all" && j.growth_stage_code !== growthFilter) return false;
      if (equipmentFilter !== "all" && j.equipment_id !== equipmentFilter) return false;
      if (operatorFilter !== "all" && j.operator_user_id !== operatorFilter) return false;
      if (from != null || to != null) {
        const d = j.planned_date ? new Date(j.planned_date).getTime() : null;
        if (d == null) return false;
        if (from != null && d < from) return false;
        if (to != null && d > to) return false;
      }
      return true;
    });
  }, [allRows, search, statusFilter, opFilter, growthFilter, equipmentFilter, operatorFilter, dateFrom, dateTo]);

  const filtersActive =
    statusFilter !== "all" || opFilter !== "all" || growthFilter !== "all" ||
    equipmentFilter !== "all" || operatorFilter !== "all" || !!dateFrom || !!dateTo;
  const clearFilters = () => {
    setStatusFilter("all"); setOpFilter("all"); setGrowthFilter("all");
    setEquipmentFilter("all"); setOperatorFilter("all"); setDateFrom(""); setDateTo("");
  };

  type ColDef = { key: string; label: string; align?: "right"; accessor: (j: SprayJob) => any; render: (j: SprayJob) => React.ReactNode };
  const STATUS_ORDER: Record<string, number> = {
    draft: 1, scheduled: 2, in_progress: 3, completed: 4, cancelled: 5,
  };
  const growthCol: ColDef = {
    key: "growth",
    label: "Growth",
    accessor: (j) => j.growth_stage_code ?? "",
    render: (j) => (
      <TableCell title={j.growth_stage_code ? GROWTH_STAGE_LABEL.get(j.growth_stage_code) ?? "" : ""}>
        {j.growth_stage_code ?? "—"}
      </TableCell>
    ),
  };

  const columnDefs: ColDef[] = useMemo(() => {
    if (mode === "templates") {
      return [
        growthCol,
        { key: "name", label: "Name", accessor: (j) => j.name ?? "", render: (j) => <TableCell className="font-medium">{fmt(j.name)}</TableCell> },
        { key: "operation", label: "Operation", accessor: (j) => opTypeLabel(j.operation_type), render: (j) => <TableCell><OperationTypeBadge value={j.operation_type} /></TableCell> },
        { key: "target", label: "Target pest/disease/weed", accessor: (j) => j.target ?? "", render: (j) => <TableCell>{j.target ? j.target : "—"}</TableCell> },
        { key: "chemicals", label: "Chemicals", accessor: (j) => chemicalLinesSummary(j.chemical_lines), render: (j) => {
          const lines = (j.chemical_lines ?? []).filter((l) => (l?.name ?? "").trim());
          return (
            <TableCell className="min-w-[260px] max-w-[440px] align-top">
              {lines.length === 0 ? <span className="text-muted-foreground">—</span> : (
                <ul className="flex flex-col gap-0.5 whitespace-normal break-words">
                  {lines.map((l, i) => {
                    const name = (l.name ?? "").trim();
                    const baseUnit = normaliseUnit(l.unit);
                    // Determine basis suffix from rate_basis; fall back to
                    // rate_per_ha / rate_per_100L when basis is missing.
                    const basis =
                      l.rate_basis === "per_hectare"
                        ? "per_hectare"
                        : l.rate_basis === "per_100L" || l.rate_basis === "per_100_litres"
                          ? "per_100L"
                          : (l as any).rate_per_ha != null
                            ? "per_hectare"
                            : (l as any).rate_per_100L != null
                              ? "per_100L"
                              : null;
                    const suffix =
                      basis === "per_hectare" ? "/ha" : basis === "per_100L" ? "/100 L" : "";
                    const rateText =
                      l.rate != null
                        ? `${l.rate}${baseUnit ? ` ${baseUnit}` : ""}${suffix}`
                        : "";
                    const detail = rateText;

                    return (
                      <li key={i} className="leading-snug">
                        <span className="font-medium">{name}</span>
                        {detail ? <span className="text-muted-foreground text-xs ml-1">— {detail}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </TableCell>
          );
        } },
        { key: "water", label: "Water (L)", accessor: (j) => (j.water_volume == null ? null : Number(j.water_volume)), render: (j) => <TableCell>{fmt(j.water_volume)}</TableCell> },
        { key: "rate", label: "Rate / ha", accessor: (j) => (j.spray_rate_per_ha == null ? null : Number(j.spray_rate_per_ha)), render: (j) => <TableCell>{fmt(j.spray_rate_per_ha)}</TableCell> },
        { key: "cf", label: "CF", accessor: (j) => (j.concentration_factor == null ? null : Number(j.concentration_factor)), render: (j) => <TableCell>{j.concentration_factor != null ? Number(j.concentration_factor).toFixed(2) : "—"}</TableCell> },
        { key: "updated", label: "Updated", accessor: (j) => (j.updated_at ? new Date(j.updated_at) : null), render: (j) => <TableCell>{fmtDate(j.updated_at)}</TableCell> },
      ];
    }
    if (mode === "archived") {
      return [
        { key: "name", label: "Name", accessor: (j) => j.name ?? "", render: (j) => <TableCell className="font-medium">{fmt(j.name)}</TableCell> },
        { key: "type", label: "Type", accessor: (j) => (j.is_template ? "Template" : "Planned"), render: (j) => <TableCell>{j.is_template ? "Template" : "Planned"}</TableCell> },
        { key: "status", label: "Status", accessor: (j) => STATUS_ORDER[String(j.status ?? "").toLowerCase()] ?? 0, render: (j) => <TableCell><Badge variant="secondary">{fmt(j.status)}</Badge></TableCell> },
        { key: "updated", label: "Updated", accessor: (j) => (j.updated_at ? new Date(j.updated_at) : null), render: (j) => <TableCell>{fmtDate(j.updated_at)}</TableCell> },
      ];
    }
    return [
      growthCol,
      { key: "name", label: "Name", accessor: (j) => j.name ?? "", render: (j) => <TableCell className="font-medium">{fmt(j.name)}</TableCell> },
      { key: "planned", label: "Planned date", accessor: (j) => (j.planned_date ? new Date(j.planned_date) : null), render: (j) => <TableCell>{fmtDate(j.planned_date)}</TableCell> },
      { key: "status", label: "Status", accessor: (j) => STATUS_ORDER[String(j.status ?? "").toLowerCase()] ?? 0, render: (j) => <TableCell><Badge variant="secondary">{fmt(j.status)}</Badge></TableCell> },
      { key: "operation", label: "Operation", accessor: (j) => opTypeLabel(j.operation_type), render: (j) => <TableCell><OperationTypeBadge value={j.operation_type} /></TableCell> },
      { key: "target", label: "Target pest/disease/weed", accessor: (j) => j.target ?? "", render: (j) => <TableCell>{j.target ? j.target : "—"}</TableCell> },
      { key: "rate", label: "Rate / ha", accessor: (j) => (j.spray_rate_per_ha == null ? null : Number(j.spray_rate_per_ha)), render: (j) => <TableCell>{fmt(j.spray_rate_per_ha)}</TableCell> },
      { key: "water", label: "Water (L)", accessor: (j) => (j.water_volume == null ? null : Number(j.water_volume)), render: (j) => <TableCell>{fmt(j.water_volume)}</TableCell> },
      { key: "cf", label: "CF", accessor: (j) => (j.concentration_factor == null ? null : Number(j.concentration_factor)), render: (j) => <TableCell>{j.concentration_factor != null ? Number(j.concentration_factor).toFixed(2) : "—"}</TableCell> },
      { key: "equipment", label: "Equipment", accessor: (j) => (j.equipment_id ? maps.equipment.get(j.equipment_id) ?? "" : ""), render: (j) => <TableCell>{j.equipment_id ? maps.equipment.get(j.equipment_id) ?? "—" : "—"}</TableCell> },
      { key: "operator", label: "Operator", accessor: (j) => (j.operator_user_id ? maps.members.get(j.operator_user_id) ?? "" : ""), render: (j) => <TableCell>{j.operator_user_id ? maps.members.get(j.operator_user_id) ?? "—" : "—"}</TableCell> },
      { key: "updated", label: "Updated", accessor: (j) => (j.updated_at ? new Date(j.updated_at) : null), render: (j) => <TableCell>{fmtDate(j.updated_at)}</TableCell> },
    ];
  }, [mode, maps]);

  const accessorMap = useMemo(() => {
    const m: Record<string, (j: SprayJob) => any> = {};
    columnDefs.forEach((c) => { m[c.key] = c.accessor; });
    return m;
  }, [columnDefs]);
  const { sorted, getSortDirection, toggleSort } = useSortableTable<SprayJob, string>(rows, {
    accessors: accessorMap,
    initial: mode === "archived" ? { key: "updated", direction: "desc" } : { key: "growth", direction: "asc" },
  });
  const defaultColOrder = useMemo(() => columnDefs.map((c) => c.key), [columnDefs]);
  const { order: sjOrder, moveColumn: sjMove, reset: sjReset } = useColumnOrder(
    `spray_jobs_${mode}_table`,
    defaultColOrder,
    { vineyardId: selectedVineyardId },
  );
  const colsById = useMemo(() => {
    const m = new Map<string, ColDef>();
    columnDefs.forEach((c) => m.set(c.key, c));
    return m;
  }, [columnDefs]);
  const orderedCols = useMemo(
    () => sjOrder.map((id) => colsById.get(id)).filter(Boolean) as ColDef[],
    [sjOrder, colsById],
  );
  const totalCols = columnDefs.length + 1; // +1 for actions column

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={mode === "templates" ? "Search templates by name, target, chemical…" : "Search by name, target, chemical…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-72"
        />
        <span className="text-xs text-muted-foreground">{sorted.length} {sorted.length === 1 ? "result" : "results"}</span>
        {mode === "planned" && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Yearly program:</span>
            <Select value={yearSel} onValueChange={setYearSel}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => handleYearExport("pdf")}>
              <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleYearExport("csv")}>
              <Download className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {mode !== "templates" && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Operation</Label>
          <Select value={opFilter} onValueChange={setOpFilter}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operations</SelectItem>
              {OPERATION_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {growthOptions.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Growth stage</Label>
            <Select value={growthFilter} onValueChange={setGrowthFilter}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {growthOptions.map((g) => (
                  <SelectItem key={g} value={g}>{g}{GROWTH_STAGE_LABEL.get(g) ? ` – ${GROWTH_STAGE_LABEL.get(g)}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {mode === "planned" && (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Equipment</Label>
              <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All equipment</SelectItem>
                  {Array.from(maps.equipment.entries()).map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Operator</Label>
              <Select value={operatorFilter} onValueChange={setOperatorFilter}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All operators</SelectItem>
                  {Array.from(maps.members.entries()).map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Planned from</Label>
              <Input type="date" className="h-8 w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Planned to</Label>
              <Input type="date" className="h-8 w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </>
        )}
        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8">
            <X className="h-3.5 w-3.5 mr-1" /> Clear filters
          </Button>
        )}
        <div className="ml-auto">
          <ColumnSettingsMenu onReset={sjReset} />
        </div>
      </div>
      <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {orderedCols.map((c) => (
              <ReorderableHead
                key={c.key}
                columnId={c.key}
                onDropColumn={sjMove}
                align={c.align}
                sort={{ active: getSortDirection(c.key), onSort: () => toggleSort(c.key) }}
              >
                {c.label}
              </ReorderableHead>
            ))}
            <TableHead className="w-1" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={totalCols} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
          )}
          {error && (
            <TableRow><TableCell colSpan={totalCols} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
          )}
          {!isLoading && !error && sorted.length === 0 && (
            <TableRow><TableCell colSpan={totalCols} className="text-center text-muted-foreground py-8">No records.</TableCell></TableRow>
          )}
          {sorted.map((j) => (
            <TableRow key={j.id} className="cursor-pointer" onClick={() => onEdit(j)}>
              {orderedCols.map((c) => (
                <Fragment key={c.key}>{c.render(j)}</Fragment>
              ))}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1">
                  {mode !== "archived" && (
                    <Button size="sm" variant="ghost" onClick={() => handleExportRowPdf(j)} title="Download PDF">
                      <FileDown className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canEdit && mode !== "archived" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(j)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dupMut.mutate({ id: j.id, asTemplate: false })} title="Duplicate">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {mode === "planned" && (
                        <Button size="sm" variant="ghost" onClick={() => dupMut.mutate({ id: j.id, asTemplate: true })} title="Save as template">
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {mode === "templates" && (
                        <Button size="sm" variant="ghost" onClick={() => dupMut.mutate({ id: j.id, asTemplate: false })} title="Create planned job from template">
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => archiveMut.mutate(j.id)} title="Archive">
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                      {mode === "planned" && String(j.status ?? "").toLowerCase() === "draft" && !j.is_template && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(j)}
                          title="Delete draft permanently"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                  {canEdit && mode === "archived" && (
                    <Button size="sm" variant="ghost" onClick={() => restoreMut.mutate(j.id)} title="Restore">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
    <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete draft spray job?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete{deleteTarget?.name ? ` "${deleteTarget.name}"` : " this draft spray job"}.
            This is safe only because the job has not been started or recorded.
            Non-draft jobs must be archived or cancelled instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (deleteTarget) deleteMut.mutate(deleteTarget.id);
            }}
            disabled={deleteMut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMut.isPending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded border p-2 ${warn ? "border-warning bg-warning/10" : ""}`}>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
      <div className={`font-medium ${warn ? "text-warning-foreground" : ""}`}>{value}</div>
    </div>
  );
}

// ============================================================================
// Linked spray records — Planned vs Actual
// ============================================================================

function LinkedRecordsSection({
  jobId, job, vineyardId, canEdit,
}: {
  jobId: string;
  job: SprayJob;
  vineyardId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: linked = [], isLoading } = useQuery({
    queryKey: ["spray_records_linked", jobId],
    queryFn: () => fetchLinkedSprayRecords(jobId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["spray_records_linked", jobId] });
    qc.invalidateQueries({ queryKey: ["spray_records_unlinked", vineyardId] });
  };

  const unlinkMut = useMutation({
    mutationFn: (recId: string) => unlinkSprayRecord(recId),
    onSuccess: () => { toast({ title: "Unlinked" }); refresh(); },
    onError: (e: any) =>
      toast({ title: "Unlink failed", description: e.message, variant: "destructive" }),
  });

  const showCompletionBanner =
    linked.length > 0 && job.status !== "completed" && job.status !== "cancelled";

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Linked spray records</div>
          <p className="text-xs text-muted-foreground">
            Completed compliance records linked back to this planned job.
          </p>
        </div>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Link existing record
          </Button>
        )}
      </div>

      {showCompletionBanner && (
        <div className="rounded border border-warning bg-warning/10 px-3 py-2 text-xs">
          This job appears completed (matching spray record found) but its status is
          still <span className="font-medium">{job.status ?? "draft"}</span>. Consider
          marking it completed.
        </div>
      )}

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}

      {!isLoading && linked.length === 0 && (
        <div className="text-xs text-muted-foreground">No spray records linked yet.</div>
      )}

      {linked.map((rec) => {
        const diff = comparePlannedVsActual(job, rec);
        const water = recordTotalWaterLitres(rec);
        const chems = recordChemicalNames(rec);
        return (
          <div key={rec.id} className="rounded border p-2 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {rec.spray_reference || rec.date || rec.id.slice(0, 8)}
                </div>
                <div className="text-muted-foreground">
                  {rec.date ?? "—"}{rec.start_time ? ` · ${rec.start_time.slice(0, 5)}` : ""}
                  {rec.tractor ? ` · ${rec.tractor}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={diff.ok ? "secondary" : "destructive"}>
                  {diff.ok ? "Matches plan" : "Differs"}
                </Badge>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => unlinkMut.mutate(rec.id)}
                    disabled={unlinkMut.isPending}
                    title="Unlink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  Planned
                </div>
                <div className="flex items-center gap-1">Op: <OperationTypeBadge value={job.operation_type} /></div>
                <div>Water: {job.water_volume != null ? `${job.water_volume} L` : "—"}</div>
                <div className="truncate" title={chemicalLinesSummary(job.chemical_lines)}>
                  Chems: {chemicalLinesSummary(job.chemical_lines)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  Actual
                </div>
                <div className="flex items-center gap-1">Op: <OperationTypeBadge value={rec.operation_type} /></div>
                <div>Water: {water != null ? `${water} L` : "—"}</div>
                <div className="truncate" title={chems.join(", ") || "—"}>
                  Chems: {chems.length ? chems.join(", ") : "—"}
                </div>
              </div>
            </div>
            {!diff.ok && (
              <ul className="list-disc pl-4 text-warning-foreground">
                {diff.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        );
      })}

      {linkOpen && (
        <LinkRecordDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          jobId={jobId}
          vineyardId={vineyardId}
          onLinked={refresh}
        />
      )}
    </div>
  );
}

function LinkRecordDialog({
  open, onOpenChange, jobId, vineyardId, onLinked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  vineyardId: string;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["spray_records_unlinked", vineyardId],
    queryFn: () => fetchUnlinkedSprayRecords(vineyardId),
    enabled: open,
  });

  const linkMut = useMutation({
    mutationFn: (recId: string) => linkSprayRecord(recId, jobId),
    onSuccess: () => {
      toast({ title: "Linked" });
      onLinked();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [r.spray_reference, r.date, r.tractor, r.operation_type, r.notes]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [records, search]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[35vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Link existing spray record</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Search by reference, tractor, operation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No unlinked spray records for this vineyard.
            </div>
          )}
          <div className="space-y-2">
            {filtered.map((rec) => (
              <div
                key={rec.id}
                className="rounded border p-2 flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {rec.spray_reference || rec.date || rec.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {rec.date ?? "—"}
                    {rec.operation_type ? (
                      <span className="ml-1"><OperationTypeBadge value={rec.operation_type} /></span>
                    ) : null}
                    {rec.tractor ? ` · ${rec.tractor}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => linkMut.mutate(rec.id)}
                  disabled={linkMut.isPending}
                >
                  Link
                </Button>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Tank-mix preview — mirrors the iOS spray/tank mix calculator
// ============================================================================

function TankMixPreview({
  form, tankCapacityL, equipmentName, selectedPaddocks, totalAreaHa,
}: {
  form: SprayJobInput;
  tankCapacityL: number | null;
  equipmentName: string | null;
  selectedPaddocks: any[];
  totalAreaHa: number | null;
}) {
  const sprayRate = form.spray_rate_per_ha ?? null;
  const lines = form.chemical_lines ?? [];
  const result = useMemo(
    () => computeTankMix({
      totalAreaHa, sprayRatePerHa: sprayRate, tankCapacityL, chemicalLines: lines,
    }),
    [totalAreaHa, sprayRate, tankCapacityL, lines],
  );

  // Per-paddock breakdown
  const perPaddock = useMemo(() => {
    return selectedPaddocks.map((p) => {
      const m = deriveMetrics(p);
      const water = sprayRate != null && m.areaHa > 0 ? m.areaHa * sprayRate : null;
      return {
        id: p.id,
        name: p.name ?? "Unnamed block",
        areaHa: m.areaHa || null,
        water,
      };
    });
  }, [selectedPaddocks, sprayRate]);

  const missing: string[] = [];
  if (totalAreaHa == null) missing.push("blocks with area");
  if (sprayRate == null) missing.push("water rate (L/ha)");
  if (tankCapacityL == null) missing.push("equipment with tank capacity");

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Tank-mix preview</div>
          <p className="text-xs text-muted-foreground">
            {equipmentName
              ? `Tank capacity from equipment: ${equipmentName}${tankCapacityL ? ` (${tankCapacityL.toLocaleString()} L)` : ""}`
              : "Select equipment to set tank capacity."}
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Add {missing.join(", ")} to see a full tank-mix preview.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Stat label="Total area" value={totalAreaHa != null ? `${totalAreaHa.toFixed(2)} ha` : "—"} />
        <Stat label="Total water" value={result.totalWaterL != null ? `${Math.round(result.totalWaterL).toLocaleString()} L` : "—"} />
        <Stat label="Full tanks" value={result.numFullTanks != null ? String(result.numFullTanks) : "—"} />
        <Stat label="Last tank" value={result.lastTankL != null && result.lastTankL > 0 ? `${result.lastTankL.toLocaleString()} L` : "—"} />
      </div>

      {result.chemicals.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Per chemical
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1 pr-2">Chemical</th>
                  <th className="text-left py-1 pr-2">Rate</th>
                  <th className="text-right py-1 pr-2">Total</th>
                  <th className="text-right py-1 pr-2">Per full tank</th>
                  <th className="text-right py-1">In last tank</th>
                </tr>
              </thead>
              <tbody>
                {result.chemicals.map((c, i) => {
                  const basis = c.basis === "per_ha" ? "per ha" : c.basis === "per_100L" ? "per 100 L" : "—";
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{c.name}</td>
                      <td className="py-1 pr-2 text-muted-foreground">
                        {c.rate ? `${c.rate} ${chemUnitOnly(form.chemical_lines?.[i]?.unit) || ""}` : "—"} <span className="opacity-60">{basis}</span>
                      </td>
                      <td className="py-1 pr-2 text-right">{fmtAmount(c.totalAmount, c.unit)}</td>
                      <td className="py-1 pr-2 text-right">{fmtAmount(c.perFullTank, c.unit)}</td>
                      <td className="py-1 text-right">{fmtAmount(c.inLastTank, c.unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.chemicals.some((c) => c.basis === "unknown") && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Tip: set chemical units to <span className="font-medium">L/ha</span>, <span className="font-medium">kg/ha</span>, <span className="font-medium">mL/100L</span>, or <span className="font-medium">g/100L</span> to calculate amounts.
            </p>
          )}
        </div>
      )}

      {perPaddock.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Per block / paddock
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1 pr-2">Block</th>
                  <th className="text-right py-1 pr-2">Area</th>
                  <th className="text-right py-1">Water</th>
                </tr>
              </thead>
              <tbody>
                {perPaddock.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-medium">{p.name}</td>
                    <td className="py-1 pr-2 text-right">{p.areaHa != null ? `${p.areaHa.toFixed(2)} ha` : "—"}</td>
                    <td className="py-1 text-right">{p.water != null ? `${Math.round(p.water).toLocaleString()} L` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Start-from-template picker
// ============================================================================

function StartFromTemplatePicker({
  vineyardId, onUseTemplate,
}: {
  vineyardId: string;
  onUseTemplate: (t: SprayJob) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["spray_jobs", vineyardId, "templates"],
    queryFn: () => fetchSprayJobs(vineyardId, { template: true, archived: false }),
  });
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const hay = [t.name, t.target, t.operation_type, chemicalLinesSummary(t.chemical_lines)]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-3 flex items-center justify-between gap-2">
      <div className="text-sm">
        <div className="font-medium">Start from a template?</div>
        <p className="text-xs text-muted-foreground">
          Copy a saved template’s settings into this job. You can still edit anything afterwards.
        </p>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            <FileText className="h-3.5 w-3.5 mr-1" /> Use template
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="p-2 border-b">
            <Input
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {isLoading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">No templates available.</div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted/60 text-sm border-b last:border-0"
                onClick={() => { onUseTemplate(t); setOpen(false); }}
              >
                <div className="font-medium truncate">{t.name || "Untitled template"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.target ? `${t.target} · ` : ""}{chemicalLinesSummary(t.chemical_lines)}
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
