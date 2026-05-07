import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Copy, Archive, RotateCcw, FileText, Save, X } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
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
import { useToast } from "@/hooks/use-toast";
import { fetchList } from "@/lib/queries";
import {
  fetchSprayJobs, fetchSprayJobPaddockIds,
  createSprayJob, updateSprayJob,
  archiveSprayJob, restoreSprayJob, duplicateSprayJob,
  chemicalLinesSummary,
  fetchVineyardTeamMembers, memberLabel,
  type SprayJob, type SprayJobChemicalLine, type SprayJobInput,
  type VineyardTeamMember,
} from "@/lib/sprayJobsQuery";
import { ChemicalPicker } from "@/components/spray/ChemicalPicker";
import {
  GROWTH_STAGES, GROWTH_STAGE_LABEL,
  VSP_CANOPY_SIZES, VSP_DENSITIES,
  vspLitresPer100m, vspLitresPerHa,
} from "@/lib/vspWaterRate";
import { deriveMetrics } from "@/lib/paddockGeometry";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const STATUS_OPTIONS = ["draft", "scheduled", "in_progress", "completed", "cancelled"];

// Operation type options. Source: matches the iOS app's spray operation
// categories (also reflected in the SavedChemicals "Use" field placeholder:
// "Fungicide, Insecticide…"). Backend column `operation_type` is free text;
// we constrain the portal to these three canonical values.
export const OPERATION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Fungicide", label: "Fungicide" },
  { value: "Herbicide", label: "Herbicide" },
  { value: "Insecticide", label: "Insecticide" },
];

const OP_LABEL_BY_VALUE = new Map(OPERATION_TYPE_OPTIONS.map((o) => [o.value.toLowerCase(), o.label]));
const opTypeLabel = (v?: string | null) => {
  if (!v) return "—";
  return OP_LABEL_BY_VALUE.get(v.toLowerCase()) ?? v;
};

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

export default function SprayJobsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const [tab, setTab] = useState<"planned" | "templates" | "archived">("planned");
  const [editing, setEditing] = useState<{ job: SprayJob | null; isTemplate: boolean } | null>(null);

  const lookups = useLookups(selectedVineyardId);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Spray Jobs &amp; Templates</h1>
          <p className="text-sm text-muted-foreground">
            Plan upcoming spray work and maintain reusable templates. Completed compliance records live under Spray Records.
          </p>
        </div>
        {canEdit && tab !== "archived" && (
          <Button onClick={() => setEditing({ job: null, isTemplate: tab === "templates" })}>
            <Plus className="h-4 w-4 mr-1" />
            {tab === "templates" ? "New template" : "New planned job"}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="planned">Planned Jobs</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>

        <TabsContent value="planned">
          <JobsTable mode="planned" canEdit={canEdit} maps={lookups.maps}
            onEdit={(job) => setEditing({ job, isTemplate: false })} />
        </TabsContent>
        <TabsContent value="templates">
          <JobsTable mode="templates" canEdit={canEdit} maps={lookups.maps}
            onEdit={(job) => setEditing({ job, isTemplate: true })} />
        </TabsContent>
        <TabsContent value="archived">
          <JobsTable mode="archived" canEdit={canEdit} maps={lookups.maps}
            onEdit={(job) => setEditing({ job, isTemplate: !!job.is_template })} />
        </TabsContent>
      </Tabs>

      {editing && selectedVineyardId && (
        <SprayJobSheet
          open={true}
          onOpenChange={(o) => !o && setEditing(null)}
          vineyardId={selectedVineyardId}
          job={editing.job}
          isTemplate={editing.isTemplate}
          canEdit={canEdit}
          lookups={lookups}
        />
      )}
    </div>
  );
}

function JobsTable({
  mode, canEdit, onEdit, maps,
}: {
  mode: "planned" | "templates" | "archived";
  canEdit: boolean;
  onEdit: (job: SprayJob) => void;
  maps: LookupMaps;
}) {
  const { selectedVineyardId } = useVineyard();
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
  const dupMut = useMutation({
    mutationFn: ({ id, asTemplate }: { id: string; asTemplate: boolean }) =>
      duplicateSprayJob(id, asTemplate),
    onSuccess: (_d, vars) => {
      toast({ title: vars.asTemplate ? "Saved as template" : "Duplicated" });
      refresh();
    },
    onError: (e: any) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const rows = data ?? [];

  const columns = useMemo(() => {
    if (mode === "templates") {
      return ["Name", "Operation", "Target pest/disease/weed", "Chemicals", "Water (L)", "Rate / ha", "Updated", ""];
    }
    if (mode === "archived") {
      return ["Name", "Type", "Status", "Updated", ""];
    }
    return ["Name", "Planned date", "Status", "Operation", "Target pest/disease/weed", "Equipment", "Operator", "Updated", ""];
  }, [mode]);

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>{columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
          )}
          {error && (
            <TableRow><TableCell colSpan={columns.length} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">No records.</TableCell></TableRow>
          )}
          {rows.map((j) => (
            <TableRow key={j.id} className="cursor-pointer" onClick={() => onEdit(j)}>
              {mode === "templates" ? (
                <>
                  <TableCell className="font-medium">{fmt(j.name)}</TableCell>
                  <TableCell>{opTypeLabel(j.operation_type)}</TableCell>
                  <TableCell>{j.target ? j.target : "—"}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{chemicalLinesSummary(j.chemical_lines)}</TableCell>
                  <TableCell>{fmt(j.water_volume)}</TableCell>
                  <TableCell>{fmt(j.spray_rate_per_ha)}</TableCell>
                  <TableCell>{fmtDate(j.updated_at)}</TableCell>
                </>
              ) : mode === "archived" ? (
                <>
                  <TableCell className="font-medium">{fmt(j.name)}</TableCell>
                  <TableCell>{j.is_template ? "Template" : "Planned"}</TableCell>
                  <TableCell><Badge variant="secondary">{fmt(j.status)}</Badge></TableCell>
                  <TableCell>{fmtDate(j.updated_at)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="font-medium">{fmt(j.name)}</TableCell>
                  <TableCell>{fmtDate(j.planned_date)}</TableCell>
                  <TableCell><Badge variant="secondary">{fmt(j.status)}</Badge></TableCell>
                  <TableCell>{opTypeLabel(j.operation_type)}</TableCell>
                  <TableCell>{j.target ? j.target : "—"}</TableCell>
                  <TableCell>{j.equipment_id ? maps.equipment.get(j.equipment_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{j.operator_user_id ? maps.members.get(j.operator_user_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{fmtDate(j.updated_at)}</TableCell>
                </>
              )}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1">
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
  );
}

function SprayJobSheet({
  open, onOpenChange, vineyardId, job, isTemplate, canEdit, lookups,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  job: SprayJob | null;
  isTemplate: boolean;
  canEdit: boolean;
  lookups: ReturnType<typeof useLookups>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const editing = !!job;

  const [form, setForm] = useState<SprayJobInput>(() => ({
    vineyard_id: vineyardId,
    name: job?.name ?? "",
    is_template: job ? !!job.is_template : isTemplate,
    planned_date: job?.planned_date ?? null,
    status: job?.status ?? "draft",
    operation_type: job?.operation_type ?? "",
    target: job?.target ?? "",
    chemical_lines: job?.chemical_lines ?? [],
    water_volume: job?.water_volume ?? null,
    spray_rate_per_ha: job?.spray_rate_per_ha ?? null,
    equipment_id: job?.equipment_id ?? null,
    tractor_id: job?.tractor_id ?? null,
    operator_user_id: job?.operator_user_id ?? null,
    notes: job?.notes ?? "",
    growth_stage_code: job?.growth_stage_code ?? null,
    vsp_canopy_size: job?.vsp_canopy_size ?? null,
    vsp_canopy_density: job?.vsp_canopy_density ?? null,
    row_spacing_metres: job?.row_spacing_metres ?? null,
    concentration_factor: job?.concentration_factor ?? 1.0,
  }));

  // Whether the user has manually overridden the row spacing or spray rate.
  const [rowSpacingOverridden, setRowSpacingOverridden] = useState<boolean>(
    !!job?.row_spacing_metres,
  );
  const [sprayRateOverridden, setSprayRateOverridden] = useState<boolean>(
    !!job?.spray_rate_per_ha,
  );

  const [paddockIds, setPaddockIds] = useState<string[]>([]);
  const [paddocksOpen, setPaddocksOpen] = useState(false);
  const [pickerLineIndex, setPickerLineIndex] = useState<number | null>(null);

  useQuery({
    queryKey: ["spray_job_paddocks", job?.id],
    enabled: !!job?.id,
    queryFn: async () => {
      const ids = await fetchSprayJobPaddockIds(job!.id);
      setPaddockIds(ids);
      return ids;
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) return updateSprayJob(job!.id, form, paddockIds);
      return createSprayJob(form, paddockIds);
    },
    onSuccess: () => {
      toast({ title: editing ? "Saved" : "Created" });
      qc.invalidateQueries({ queryKey: ["spray_jobs", vineyardId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const setLine = (i: number, patch: Partial<SprayJobChemicalLine>) => {
    setForm((f) => {
      const next = [...(f.chemical_lines ?? [])];
      next[i] = { ...next[i], ...patch };
      return { ...f, chemical_lines: next };
    });
  };
  const addLine = () => {
    setForm((f) => ({
      ...f,
      chemical_lines: [...(f.chemical_lines ?? []), { name: "", rate: null, unit: "L/ha", notes: "" }],
    }));
    setPickerLineIndex((form.chemical_lines ?? []).length);
  };
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, chemical_lines: (f.chemical_lines ?? []).filter((_, idx) => idx !== i) }));

  const togglePaddock = (id: string) =>
    setPaddockIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  // Selected paddock objects (for area + row width data).
  const selectedPaddocks = useMemo(
    () => lookups.paddocks.filter((p: any) => paddockIds.includes(p.id)),
    [lookups.paddocks, paddockIds],
  );

  const meanRowSpacing = useMemo(() => {
    const widths = selectedPaddocks
      .map((p: any) => Number(p.row_width))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!widths.length) return null;
    return widths.reduce((a, b) => a + b, 0) / widths.length;
  }, [selectedPaddocks]);

  const totalAreaHa = useMemo(() => {
    if (!selectedPaddocks.length) return null;
    let total = 0;
    let any = false;
    for (const p of selectedPaddocks as any[]) {
      const m = deriveMetrics(p);
      if (m.areaHa > 0) { total += m.areaHa; any = true; }
    }
    return any ? total : null;
  }, [selectedPaddocks]);

  const effectiveRowSpacing = rowSpacingOverridden
    ? form.row_spacing_metres ?? null
    : meanRowSpacing;

  const litresPer100m = vspLitresPer100m(form.vsp_canopy_size, form.vsp_canopy_density);
  const calculatedLitresPerHa = vspLitresPerHa(
    form.vsp_canopy_size,
    form.vsp_canopy_density,
    effectiveRowSpacing ?? null,
  );

  const effectiveSprayRate = sprayRateOverridden
    ? form.spray_rate_per_ha ?? null
    : calculatedLitresPerHa;

  const concentrationFactor =
    !effectiveSprayRate || effectiveSprayRate <= 0 || calculatedLitresPerHa == null
      ? 1.0
      : calculatedLitresPerHa / effectiveSprayRate;

  const computedWaterVolume =
    totalAreaHa != null && effectiveSprayRate != null
      ? totalAreaHa * effectiveSprayRate
      : null;

  // Sync derived values into the form (deferred to avoid setState-in-render).
  useMemo(() => {
    const next: Partial<SprayJobInput> = {};
    if ((form.row_spacing_metres ?? null) !== (effectiveRowSpacing ?? null)) {
      next.row_spacing_metres = effectiveRowSpacing ?? null;
    }
    if (!sprayRateOverridden && (form.spray_rate_per_ha ?? null) !== (effectiveSprayRate ?? null)) {
      next.spray_rate_per_ha = effectiveSprayRate ?? null;
    }
    const cfRounded = Math.round(concentrationFactor * 100) / 100;
    if ((form.concentration_factor ?? 1) !== cfRounded) {
      next.concentration_factor = cfRounded;
    }
    if (computedWaterVolume != null) {
      const wv = Math.round(computedWaterVolume);
      if ((form.water_volume ?? null) !== wv) next.water_volume = wv;
    }
    if (Object.keys(next).length) {
      queueMicrotask(() => setForm((f) => ({ ...f, ...next })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRowSpacing, effectiveSprayRate, concentrationFactor, computedWaterVolume]);

  const cfWarning = Math.abs(concentrationFactor - 1.0) > 0.005;
  const fmt1 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
  const fmt2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
  const fmt0 = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toString());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {editing ? "Edit" : "New"} {form.is_template ? "template" : "planned job"}
          </SheetTitle>
        </SheetHeader>

        <fieldset disabled={!canEdit} className="mt-4 space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Name</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.is_template ? "e.g. Powdery mildew preventive" : "e.g. Block A spray — week 14"} />
            </div>

            <div className="flex items-center gap-2 col-span-2">
              <Checkbox id="tpl" checked={!!form.is_template}
                onCheckedChange={(c) => setForm({ ...form, is_template: !!c })} />
              <Label htmlFor="tpl">Reusable template</Label>
            </div>

            {!form.is_template && (
              <>
                <div className="space-y-1">
                  <Label>Planned date</Label>
                  <Input type="date" value={form.planned_date ?? ""}
                    onChange={(e) => setForm({ ...form, planned_date: e.target.value || null })} />
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={form.status ?? "draft"} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label>Operation type</Label>
              <Select
                value={form.operation_type ?? ""}
                onValueChange={(v) => setForm({ ...form, operation_type: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select operation type" /></SelectTrigger>
                <SelectContent>
                  {OPERATION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Target pest / disease / weed</Label>
              <Input
                value={form.target ?? ""}
                placeholder="e.g. powdery mildew, downy mildew, botrytis, weeds, insects"
                onChange={(e) => setForm({ ...form, target: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Optional — what this spray is intended to control.
              </p>
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Growth stage (E-L)</Label>
              <Select
                value={form.growth_stage_code ?? "__none"}
                onValueChange={(v) =>
                  setForm({ ...form, growth_stage_code: v === "__none" ? null : v })
                }
              >
                <SelectTrigger><SelectValue placeholder="— Not set —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Not set —</SelectItem>
                  {GROWTH_STAGES.map((g) => (
                    <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Optional — Eichhorn-Lorenz growth stage.</p>
            </div>

            <div className="space-y-1">
              <Label>Tractor</Label>
              <Select value={form.tractor_id ?? "__none"}
                onValueChange={(v) => setForm({ ...form, tractor_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {lookups.tractors.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name ?? t.model ?? "Tractor"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Equipment</Label>
              <Select value={form.equipment_id ?? "__none"}
                onValueChange={(v) => setForm({ ...form, equipment_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {lookups.equipment.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name ?? t.type ?? "Equipment"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!form.is_template && (
              <div className="space-y-1 col-span-2">
                <Label>Operator</Label>
                <Select value={form.operator_user_id ?? "__none"}
                  onValueChange={(v) => setForm({ ...form, operator_user_id: v === "__none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="— Not assigned —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Not assigned —</SelectItem>
                    {lookups.members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)} <span className="text-muted-foreground">· {m.role}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lookups.members.length === 0 && (
                  <p className="text-xs text-muted-foreground">No team members visible for this vineyard.</p>
                )}
              </div>
            )}

            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>

          {/* Paddocks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Paddocks / blocks</Label>
              <Popover open={paddocksOpen} onOpenChange={setPaddocksOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    <Plus className="h-3.5 w-3.5 mr-1" />Select paddocks
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <div className="max-h-60 overflow-y-auto divide-y">
                    {lookups.paddocks.length === 0 && (
                      <div className="p-3 text-xs text-muted-foreground">No paddocks for this vineyard.</div>
                    )}
                    {lookups.paddocks.map((p: any) => {
                      const checked = paddockIds.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 text-sm">
                          <Checkbox checked={checked} onCheckedChange={() => togglePaddock(p.id)} />
                          <span>{p.name ?? "Unnamed paddock"}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
              {paddockIds.length === 0 && <span className="text-xs text-muted-foreground">No paddocks selected.</span>}
              {paddockIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  {lookups.maps.paddocks.get(id) ?? "Unknown"}
                  {canEdit && (
                    <button type="button" onClick={() => togglePaddock(id)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          </div>

          {/* Chemicals */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Chemicals</Label>
              {canEdit && (
                <Button type="button" size="sm" variant="outline" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Add chemical
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {(form.chemical_lines ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">No chemicals added yet.</div>
              )}
              {(form.chemical_lines ?? []).map((line, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{line.name || "Select a chemical…"}</div>
                      {line.active_ingredient && (
                        <div className="text-xs text-muted-foreground truncate">{line.active_ingredient}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {canEdit && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPickerLineIndex(i)}>
                          {line.name ? "Change" : "Pick"}
                        </Button>
                      )}
                      {canEdit && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(i)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Rate</Label>
                      <Input type="number" value={line.rate ?? ""} onChange={(e) => setLine(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Unit</Label>
                      <Input value={line.unit ?? ""} onChange={(e) => setLine(i, { unit: e.target.value })} />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Water rate</Label>
                      <Input type="number" value={line.water_rate ?? ""} onChange={(e) => setLine(i, { water_rate: e.target.value === "" ? null : Number(e.target.value) })} />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input value={line.notes ?? ""} onChange={(e) => setLine(i, { notes: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </fieldset>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {canEdit && (
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          )}
        </SheetFooter>

        {pickerLineIndex !== null && (
          <ChemicalPicker
            open={pickerLineIndex !== null}
            onOpenChange={(o) => !o && setPickerLineIndex(null)}
            vineyardId={vineyardId}
            canCreate={canEdit}
            onSelect={(c) => {
              const idx = pickerLineIndex;
              if (idx == null) return;
              setLine(idx, {
                chemical_id: c.id,
                name: c.name ?? "",
                active_ingredient: c.active_ingredient ?? null,
                rate: c.rate_per_ha ?? null,
                unit: c.unit ?? "L/ha",
                notes: c.restrictions ?? null,
              });
              setPickerLineIndex(null);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
