import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Copy, Archive, RotateCcw, FileText, Save } from "lucide-react";
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
  type SprayJob, type SprayJobChemicalLine, type SprayJobInput,
} from "@/lib/sprayJobsQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const STATUS_OPTIONS = ["draft", "scheduled", "in_progress", "completed", "cancelled", "archived"];

export default function SprayJobsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const [tab, setTab] = useState<"planned" | "templates" | "archived">("planned");
  const [editing, setEditing] = useState<{ job: SprayJob | null; isTemplate: boolean } | null>(null);

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
          <JobsTable
            mode="planned"
            canEdit={canEdit}
            onEdit={(job) => setEditing({ job, isTemplate: false })}
            onNewFromTemplate={undefined}
          />
        </TabsContent>
        <TabsContent value="templates">
          <JobsTable
            mode="templates"
            canEdit={canEdit}
            onEdit={(job) => setEditing({ job, isTemplate: true })}
          />
        </TabsContent>
        <TabsContent value="archived">
          <JobsTable mode="archived" canEdit={canEdit} onEdit={(job) => setEditing({ job, isTemplate: !!job.is_template })} />
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
        />
      )}
    </div>
  );
}

function JobsTable({
  mode,
  canEdit,
  onEdit,
}: {
  mode: "planned" | "templates" | "archived";
  canEdit: boolean;
  onEdit: (job: SprayJob) => void;
  onNewFromTemplate?: (job: SprayJob) => void;
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
      return ["Name", "Operation", "Target", "Chemicals", "Water (L)", "Rate / ha", "Updated", ""];
    }
    if (mode === "archived") {
      return ["Name", "Type", "Status", "Updated", ""];
    }
    return ["Name", "Planned date", "Status", "Operation", "Target", "Equipment", "Updated", ""];
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
                  <TableCell>{fmt(j.operation_type)}</TableCell>
                  <TableCell>{fmt(j.target)}</TableCell>
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
                  <TableCell>{fmt(j.operation_type)}</TableCell>
                  <TableCell>{fmt(j.target)}</TableCell>
                  <TableCell className="font-mono text-xs">{j.equipment_id ? j.equipment_id.slice(0, 8) : "—"}</TableCell>
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
  open, onOpenChange, vineyardId, job, isTemplate, canEdit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  job: SprayJob | null;
  isTemplate: boolean;
  canEdit: boolean;
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
  }));

  const [paddockIds, setPaddockIds] = useState<string[]>([]);
  // Load existing paddock links when editing
  useQuery({
    queryKey: ["spray_job_paddocks", job?.id],
    enabled: !!job?.id,
    queryFn: async () => {
      const ids = await fetchSprayJobPaddockIds(job!.id);
      setPaddockIds(ids);
      return ids;
    },
  });

  const { data: paddocks } = useQuery({
    queryKey: ["paddocks-list", vineyardId],
    queryFn: () => fetchList("paddocks", vineyardId),
  });
  const { data: tractors } = useQuery({
    queryKey: ["tractors-list", vineyardId],
    queryFn: () => fetchList("tractors", vineyardId),
  });
  const { data: equipment } = useQuery({
    queryKey: ["equipment-list", vineyardId],
    queryFn: () => fetchList("spray_equipment", vineyardId),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateSprayJob(job!.id, form, paddockIds);
      }
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
  const addLine = () =>
    setForm((f) => ({ ...f, chemical_lines: [...(f.chemical_lines ?? []), { name: "", rate: null, unit: "L/ha", notes: "" }] }));
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, chemical_lines: (f.chemical_lines ?? []).filter((_, idx) => idx !== i) }));

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
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="flex items-center gap-2 col-span-2">
              <Checkbox
                id="tpl"
                checked={!!form.is_template}
                onCheckedChange={(c) => setForm({ ...form, is_template: !!c })}
              />
              <Label htmlFor="tpl">Reusable template</Label>
            </div>

            {!form.is_template && (
              <div className="space-y-1">
                <Label>Planned date</Label>
                <Input
                  type="date"
                  value={form.planned_date ?? ""}
                  onChange={(e) => setForm({ ...form, planned_date: e.target.value || null })}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status ?? ""} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Operation type</Label>
              <Input value={form.operation_type ?? ""} onChange={(e) => setForm({ ...form, operation_type: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Target</Label>
              <Input value={form.target ?? ""} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Water volume (L)</Label>
              <Input type="number" value={form.water_volume ?? ""} onChange={(e) => setForm({ ...form, water_volume: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>Spray rate per ha</Label>
              <Input type="number" value={form.spray_rate_per_ha ?? ""} onChange={(e) => setForm({ ...form, spray_rate_per_ha: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>

            <div className="space-y-1">
              <Label>Tractor</Label>
              <Select value={form.tractor_id ?? "__none"} onValueChange={(v) => setForm({ ...form, tractor_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {(tractors ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name ?? t.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Equipment</Label>
              <Select value={form.equipment_id ?? "__none"} onValueChange={(v) => setForm({ ...form, equipment_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {(equipment ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name ?? t.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Operator user ID</Label>
              <Input
                placeholder="UUID — leave blank if not assigned"
                value={form.operator_user_id ?? ""}
                onChange={(e) => setForm({ ...form, operator_user_id: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">Operator picker will be added once the team-members list is wired.</p>
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Paddocks</Label>
              <span className="text-xs text-muted-foreground">{paddockIds.length} selected</span>
            </div>
            <div className="rounded-md border max-h-48 overflow-y-auto divide-y">
              {(paddocks ?? []).length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">No paddocks for this vineyard.</div>
              )}
              {(paddocks ?? []).map((p: any) => {
                const checked = paddockIds.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        setPaddockIds((cur) => c ? [...cur, p.id] : cur.filter((id) => id !== p.id));
                      }}
                    />
                    <span>{p.name ?? p.id}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Chemical lines</Label>
              {canEdit && <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>}
            </div>
            <div className="space-y-2">
              {(form.chemical_lines ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">No chemical lines yet.</div>
              )}
              {(form.chemical_lines ?? []).map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-md border p-2">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Product name</Label>
                    <Input value={line.name ?? ""} onChange={(e) => setLine(i, { name: e.target.value })} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Rate</Label>
                    <Input type="number" value={line.rate ?? ""} onChange={(e) => setLine(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Input value={line.unit ?? ""} onChange={(e) => setLine(i, { unit: e.target.value })} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Input value={line.notes ?? ""} onChange={(e) => setLine(i, { notes: e.target.value })} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {canEdit && <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(i)}>×</Button>}
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
      </SheetContent>
    </Sheet>
  );
}
