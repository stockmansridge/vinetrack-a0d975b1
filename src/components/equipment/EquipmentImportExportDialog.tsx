import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, FileDown, Upload, Loader2 } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { fetchList } from "@/lib/queries";
import { saveTractor } from "@/lib/tractorWrite";
import {
  fetchActiveMachineRecords,
  createVineyardMachine,
  updateVineyardMachine,
  partitionMachines,
} from "@/lib/vineyardMachinesQuery";
import {
  fetchEquipmentItemsForVineyard,
  createEquipmentItem,
  updateEquipmentItem,
} from "@/lib/equipmentItemsQuery";
import { downloadCsv, safeFileBase } from "@/lib/paddockImportExport";
import {
  EQUIPMENT_CLASSES,
  EQUIPMENT_CLASS_LABEL,
  applyEquipmentImport,
  buildEquipmentCsv,
  buildEquipmentTemplateCsv,
  planEquipmentImport,
  type EquipmentClass,
  type EquipmentImportPlan,
  type ExistingEquipment,
} from "@/lib/equipmentImportExport";

async function loadAllEquipment(vineyardId: string): Promise<ExistingEquipment[]> {
  const [tractors, sprays, machines, items] = await Promise.all([
    fetchList<any>("tractors", vineyardId),
    fetchList<any>("spray_equipment", vineyardId),
    fetchActiveMachineRecords(vineyardId),
    fetchEquipmentItemsForVineyard(vineyardId, "other"),
  ]);
  return [
    ...tractors.map((t: any) => ({
      cls: "tractor" as const,
      id: t.id,
      name: t.name ?? "",
      make: t.brand,
      model: t.model,
      model_year: t.model_year,
      fuel_usage_l_per_hour: t.fuel_usage_l_per_hour,
      serial_number: t.serial_number,
      vin_number: t.vin_number,
    })),
    ...sprays.map((s: any) => ({
      cls: "spray_equipment" as const,
      id: s.id,
      name: s.name ?? "",
      tank_capacity_litres: s.tank_capacity_litres,
      serial_number: s.serial_number,
      vin_number: s.vin_number,
    })),
    ...partitionMachines(machines).machines.map((m) => ({
      cls: "vineyard_machine" as const,
      id: m.id,
      name: m.name ?? "",
      machine_type: m.machine_type,
      fuel_usage_l_per_hour: m.fuel_usage_l_per_hour,
      fuel_tracking_enabled: m.fuel_tracking_enabled,
      available_for_job_costing: m.available_for_job_costing,
      serial_number: m.serial_number,
      vin_number: m.vin_number,
      notes: m.notes,
      sync_version: m.sync_version,
    })),
    ...items.map((i) => ({
      cls: "other_asset" as const,
      id: i.id,
      name: i.name ?? "",
      make: i.make,
      model: i.model,
      serial_number: i.serial_number,
      vin_number: i.vin_number,
      notes: i.notes,
      sync_version: i.sync_version,
    })),
  ];
}

export default function EquipmentImportExportDialog({ size = "default" }: { size?: "default" | "sm" } = {}) {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "Vineyard";

  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<EquipmentClass[]>([...EQUIPMENT_CLASSES]);
  const [plan, setPlan] = useState<EquipmentImportPlan | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: existing = [], isLoading } = useQuery({
    queryKey: ["equipment-import-export", selectedVineyardId],
    enabled: open && !!selectedVineyardId,
    queryFn: () => loadAllEquipment(selectedVineyardId!),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of existing) c[e.cls] = (c[e.cls] ?? 0) + 1;
    return c;
  }, [existing]);

  const toggle = (c: EquipmentClass, on: boolean) =>
    setClasses((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)));

  const reset = () => {
    setPlan(null);
    setFilename("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = () => {
    const n = existing.filter((e) => classes.includes(e.cls)).length;
    downloadCsv(`${safeFileBase(vineyardName)}_Equipment.csv`, buildEquipmentCsv(existing, classes));
    toast.success(`Exported ${n} item${n === 1 ? "" : "s"}`);
  };

  const handleFile = async (f: File) => {
    const text = await f.text();
    setFilename(f.name);
    setPlan(planEquipmentImport(text, existing, classes));
  };

  const handleApply = async () => {
    if (!plan || !selectedVineyardId) return;
    setBusy(true);
    const uid = user?.id ?? null;
    const now = () => new Date().toISOString();
    try {
      const result = await applyEquipmentImport(plan, {
        saveTractor: async (t) => {
          await saveTractor({ ...t, vineyard_id: selectedVineyardId, user_id: uid });
        },
        insertSpray: async (p) => {
          const { error } = await supabase.from("spray_equipment").insert({
            ...p,
            vineyard_id: selectedVineyardId,
            created_by: uid,
            updated_by: uid,
            client_updated_at: now(),
          } as any);
          if (error) throw error;
        },
        updateSpray: async (id, p) => {
          const { error } = await supabase
            .from("spray_equipment")
            .update({ ...p, updated_by: uid, client_updated_at: now() } as any)
            .eq("id", id)
            .eq("vineyard_id", selectedVineyardId);
          if (error) throw error;
        },
        createMachine: async (p) => {
          await createVineyardMachine({ ...(p as any), vineyard_id: selectedVineyardId, user_id: uid });
        },
        updateMachine: async (p) => {
          await updateVineyardMachine({ ...(p as any), user_id: uid });
        },
        createItem: async (p) => {
          await createEquipmentItem({ ...(p as any), vineyard_id: selectedVineyardId, user_id: uid });
        },
        updateItem: async (p) => {
          await updateEquipmentItem({ ...(p as any), user_id: uid });
        },
      });
      qc.invalidateQueries();
      if (result.errors.length) {
        toast.error(
          `Created ${result.created}, updated ${result.updated}. ${result.errors.length} row(s) failed: ${result.errors
            .slice(0, 3)
            .map((e) => `line ${e.line} ${e.message}`)
            .join("; ")}`,
        );
      } else {
        toast.success(`Import finished: created ${result.created}, updated ${result.updated}`);
        setOpen(false);
        reset();
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (!plan) return [];
    return EQUIPMENT_CLASSES.map((c) => ({
      c,
      create: plan.rows.filter((r) => r.cls === c && r.action === "create").length,
      update: plan.rows.filter((r) => r.cls === c && r.action === "update").length,
    })).filter((s) => s.create + s.update > 0);
  }, [plan]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size} className="gap-1" disabled={!selectedVineyardId}>
          <FileDown className="h-4 w-4" /> Export / Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        {!plan ? (
          <>
            <DialogHeader>
              <DialogTitle>Equipment export & import</DialogTitle>
              <DialogDescription>
                Export equipment as CSV, download a blank template, or import a CSV to add or
                update equipment in <b>{vineyardName}</b>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="text-sm font-medium">Equipment classes</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {EQUIPMENT_CLASSES.map((c) => (
                  <Label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-3 font-normal"
                  >
                    <Checkbox
                      checked={classes.includes(c)}
                      onCheckedChange={(v) => toggle(c, v === true)}
                    />
                    <span className="flex-1">{EQUIPMENT_CLASS_LABEL[c]}</span>
                    <span className="text-xs text-muted-foreground">
                      {isLoading ? "…" : counts[c] ?? 0}
                    </span>
                  </Label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Only the ticked classes are exported, and only those rows are imported from a file.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={handleExport}
                disabled={isLoading || classes.length === 0}
              >
                <Download className="h-4 w-4" />
                <span className="font-medium">Export equipment</span>
                <span className="text-xs text-muted-foreground">Selected classes → CSV</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => downloadCsv("Equipment_Import_Template.csv", buildEquipmentTemplateCsv())}
              >
                <FileDown className="h-4 w-4" />
                <span className="font-medium">Import template</span>
                <span className="text-xs text-muted-foreground">Blank CSV with example rows</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => fileRef.current?.click()}
                disabled={!canEdit || isLoading || classes.length === 0}
              >
                <Upload className="h-4 w-4" />
                <span className="font-medium">Import CSV</span>
                <span className="text-xs text-muted-foreground">
                  {canEdit ? "Preview before applying" : "Manager role required"}
                </span>
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Alert>
              <AlertTitle>How import works</AlertTitle>
              <AlertDescription className="space-y-1 text-xs">
                <p>
                  The <code>equipment_class</code> column sets the list for each row:{" "}
                  <code>tractor</code>, <code>spray_equipment</code>, <code>vineyard_machine</code>{" "}
                  or <code>other_asset</code>.
                </p>
                <p>
                  Rows with an <code>internal_id</code>, or a name that already exists in that
                  class, update the existing item. Blank cells keep the current value. Other rows
                  are created. Nothing is archived or deleted.
                </p>
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Preview import</DialogTitle>
              <DialogDescription>{filename}</DialogDescription>
            </DialogHeader>
            {summary.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rows to import.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {summary.map((s) => (
                  <Badge key={s.c} variant="secondary">
                    {EQUIPMENT_CLASS_LABEL[s.c]}: {s.create} new, {s.update} update
                  </Badge>
                ))}
              </div>
            )}
            {plan.skippedClasses > 0 && (
              <p className="text-xs text-muted-foreground">
                {plan.skippedClasses} row(s) skipped because their class isn't ticked.
              </p>
            )}
            <ScrollArea className="max-h-64 rounded-md border">
              <ul className="divide-y text-sm">
                {plan.rows.map((r) => (
                  <li key={r.line} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-14 text-xs text-muted-foreground">Line {r.line}</span>
                    <Badge variant={r.action === "create" ? "default" : "outline"}>
                      {r.action === "create" ? "New" : "Update"}
                    </Badge>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{EQUIPMENT_CLASS_LABEL[r.cls]}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            {plan.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>{plan.errors.length} row(s) won't be imported</AlertTitle>
                <AlertDescription className="text-xs">
                  <ul className="list-disc pl-4">
                    {plan.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        Line {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset} disabled={busy}>
                Back
              </Button>
              <Button onClick={handleApply} disabled={busy || plan.rows.length === 0}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import {plan.rows.length} row{plan.rows.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
