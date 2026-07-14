import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { canSeeCosts } from "@/lib/permissions";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deriveMetrics } from "@/lib/paddockGeometry";
import {
  ALL_STATUSES,
  FERTILISER_CATEGORY_KEYS,
  PRODUCT_CATEGORY_LABEL,
  STATUS_LABEL,
  computeCalculation,
  defaultProductUnit,
  defaultRateUnit,
  type FertiliserCalculationMode,
  type FertiliserForm,
  type FertiliserRecordStatus,
  type ProductCategoryKey,
} from "@/lib/fertiliserCalc";
import {
  fetchFertiliserAllocations,
  saveFertiliserRecord,
  type FertiliserRecord,
} from "@/lib/fertiliserRecordsQuery";
import {
  createLabourLine,
  createWorkTask,
  fetchWorkTaskPaddocksForVineyard,
  syncWorkTaskPaddocks,
} from "@/lib/workTasksQuery";

interface PaddockOption {
  id: string;
  name: string;
  areaHa: number;
  vineCount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vineyardId: string;
  paddocks: PaddockOption[];
  role: string | null;
  /** When provided, edit that existing record instead of creating one. */
  existing?: FertiliserRecord | null;
}

interface Product {
  id: string;
  name: string;
  product_category: string;
  product_form: string;
  pack_size: number | null;
  pack_unit: string;
  price_per_pack: number | null;
  density: number | null;
  nitrogen_percent: number | null;
  phosphorus_percent: number | null;
  potassium_percent: number | null;
  analysis_basis: string;
  organic_certified: boolean;
  is_active: boolean;
  application_notes: string;
}

function numOr(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function useProducts(vineyardId: string) {
  return useQuery({
    queryKey: ["fertiliser", "products", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_chemicals")
        .select(
          "id, name, product_category, product_form, pack_size, pack_unit, price_per_pack, density, nitrogen_percent, phosphorus_percent, potassium_percent, analysis_basis, organic_certified, is_active, application_notes",
        )
        .eq("vineyard_id", vineyardId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}

function useExistingAllocations(recordId: string | undefined) {
  return useQuery({
    queryKey: ["fertiliser", "allocations", recordId],
    enabled: !!recordId,
    queryFn: () => fetchFertiliserAllocations(recordId!),
  });
}

interface BlockState extends PaddockOption {
  selected: boolean;
  allocationId: string;
}

export default function FertiliserCalculatorDialog({
  open,
  onOpenChange,
  vineyardId,
  paddocks,
  role,
  existing,
}: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const showCosts = canSeeCosts(role);
  const productsQ = useProducts(vineyardId);
  const allocationsQ = useExistingAllocations(existing?.id);

  const [applicationDate, setApplicationDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [form, setForm] = useState<FertiliserForm>("solid");
  const [mode, setMode] = useState<FertiliserCalculationMode>("perHectare");
  const [applicationRate, setApplicationRate] = useState<string>("");
  const [applicationRateUnit, setApplicationRateUnit] = useState<string>("kg/ha");
  const [productUnit, setProductUnit] = useState<string>("kg");
  const [packSize, setPackSize] = useState<string>("");
  const [pricePerPack, setPricePerPack] = useState<string>("");
  const [labourCost, setLabourCost] = useState<string>("");
  const [machineryCost, setMachineryCost] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<FertiliserRecordStatus>("planned");
  const [blocks, setBlocks] = useState<BlockState[]>([]);

  // Optional Work Task creation.
  const [createTask, setCreateTask] = useState(false);
  const [taskType, setTaskType] = useState("Fertilising");
  const [workerCount, setWorkerCount] = useState<string>("1");
  const [hoursPerWorker, setHoursPerWorker] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("");

  // Stable ids kept across retries so upserts don't duplicate rows.
  const [recordId, setRecordId] = useState<string>(() => crypto.randomUUID());
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingLabourLineId, setPendingLabourLineId] = useState<string | null>(null);

  // Reset / hydrate when the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setRecordId(existing.id);
      setApplicationDate(existing.application_date);
      setProductId(existing.product_id);
      setProductName(existing.product_name);
      setForm((existing.form as FertiliserForm) === "liquid" ? "liquid" : "solid");
      setMode(
        (existing.calculation_mode as FertiliserCalculationMode) === "perVine"
          ? "perVine"
          : "perHectare",
      );
      setApplicationRate(String(existing.application_rate ?? ""));
      setApplicationRateUnit(existing.application_rate_unit || "kg/ha");
      setProductUnit(existing.product_unit || "kg");
      setPackSize(existing.pack_size == null ? "" : String(existing.pack_size));
      setPricePerPack(""); // price_per_pack is not stored on the record; recomputed from product if selected
      setLabourCost(existing.labour_cost == null ? "" : String(existing.labour_cost));
      setMachineryCost(existing.machinery_cost == null ? "" : String(existing.machinery_cost));
      setNotes(existing.notes ?? "");
      const s = existing.record_status as FertiliserRecordStatus;
      setStatus(ALL_STATUSES.includes(s) ? s : "planned");
      setCreateTask(false);
    } else {
      setRecordId(crypto.randomUUID());
      setApplicationDate(new Date().toISOString().slice(0, 10));
      setProductId(null);
      setProductName("");
      setForm("solid");
      setMode("perHectare");
      setApplicationRate("");
      setApplicationRateUnit(defaultRateUnit("perHectare", "solid"));
      setProductUnit(defaultProductUnit("solid"));
      setPackSize("");
      setPricePerPack("");
      setLabourCost("");
      setMachineryCost("");
      setNotes("");
      setStatus("planned");
      setCreateTask(false);
    }
    setPendingTaskId(null);
    setPendingLabourLineId(null);
    setProductSearch("");
  }, [open, existing]);

  // Hydrate block selection from existing allocations once they load.
  useEffect(() => {
    if (!open) return;
    const existingByPaddock = new Map(
      (allocationsQ.data ?? []).map((a) => [a.paddock_id, a]),
    );
    setBlocks(
      paddocks.map((p) => {
        const alloc = existingByPaddock.get(p.id);
        return {
          ...p,
          selected: alloc != null,
          allocationId: alloc?.id ?? crypto.randomUUID(),
          // If reloading, preserve saved area/vine values so historical
          // snapshots don't shift.
          areaHa: alloc ? Number(alloc.area_ha) : p.areaHa,
          vineCount: alloc ? Number(alloc.vine_count) : p.vineCount,
        };
      }),
    );
  }, [open, paddocks, allocationsQ.data]);

  // When the user picks a product, snapshot product-related defaults.
  const onSelectProduct = (id: string) => {
    const p = (productsQ.data ?? []).find((x) => x.id === id);
    if (!p) return;
    setProductId(p.id);
    setProductName(p.name);
    const nextForm: FertiliserForm =
      p.product_form === "liquid" ? "liquid" : "solid";
    setForm(nextForm);
    setApplicationRateUnit(defaultRateUnit(mode, nextForm));
    setProductUnit(defaultProductUnit(nextForm));
    setPackSize(p.pack_size == null ? "" : String(p.pack_size));
    setPricePerPack(p.price_per_pack == null ? "" : String(p.price_per_pack));
  };

  // Update units when mode changes.
  useEffect(() => {
    setApplicationRateUnit((cur) => {
      const def = defaultRateUnit(mode, form);
      // Only auto-swap when the user hasn't customised past the defaults.
      const defaults = ["kg/ha", "L/ha", "g/vine", "mL/vine"];
      return defaults.includes(cur) ? def : cur;
    });
  }, [mode, form]);

  const selectedBlocks = useMemo(() => blocks.filter((b) => b.selected), [blocks]);

  const calc = useMemo(
    () =>
      computeCalculation({
        mode,
        applicationRate: numOr(applicationRate),
        packSize: packSize === "" ? null : numOr(packSize, 0),
        pricePerPack: pricePerPack === "" ? null : numOr(pricePerPack, 0),
        labourCost: labourCost === "" ? 0 : numOr(labourCost, 0),
        machineryCost: machineryCost === "" ? 0 : numOr(machineryCost, 0),
        allocations: selectedBlocks.map((b) => ({
          paddockId: b.id,
          paddockName: b.name,
          areaHa: b.areaHa,
          vineCount: b.vineCount,
        })),
      }),
    [
      mode,
      applicationRate,
      packSize,
      pricePerPack,
      labourCost,
      machineryCost,
      selectedBlocks,
    ],
  );

  const filteredProducts = useMemo(() => {
    const list = productsQ.data ?? [];
    const q = productSearch.trim().toLowerCase();
    return list
      .filter((p) => p.is_active !== false)
      .filter((p) => {
        if (showAllCategories) return true;
        return (
          !p.product_category ||
          FERTILISER_CATEGORY_KEYS.includes(p.product_category as ProductCategoryKey)
        );
      })
      .filter((p) => (q ? (p.name ?? "").toLowerCase().includes(q) : true));
  }, [productsQ.data, productSearch, showAllCategories]);

  const canSubmit =
    productName.trim().length > 0 &&
    selectedBlocks.length > 0 &&
    numOr(applicationRate) > 0;

  const saveMut = useMutation({
    mutationFn: async () => {
      const iso = new Date().toISOString();
      const savedRecordId = recordId;
      const savePayload = {
        id: savedRecordId,
        vineyard_id: vineyardId,
        product_id: productId,
        product_name: productName.trim(),
        form,
        calculation_mode: mode,
        record_status: status,
        application_date: applicationDate,
        block_names: selectedBlocks.map((b) => b.name),
        total_area_ha: calc.totalAreaHa,
        total_vines: calc.totalVines,
        application_rate: numOr(applicationRate),
        application_rate_unit: applicationRateUnit || defaultRateUnit(mode, form),
        total_product_required: calc.totalProductRequired,
        product_unit: productUnit || defaultProductUnit(form),
        pack_size: packSize === "" ? null : numOr(packSize),
        pack_count: calc.packCount,
        estimated_product_cost: calc.estimatedProductCost,
        labour_cost: labourCost === "" ? null : numOr(labourCost),
        machinery_cost: machineryCost === "" ? null : numOr(machineryCost),
        total_job_cost: calc.totalJobCost,
        notes,
        allocations: selectedBlocks.map((b, i) => ({
          id: b.allocationId,
          paddock_id: b.id,
          area_ha: calc.allocations[i]?.areaHa ?? b.areaHa,
          vine_count: calc.allocations[i]?.vineCount ?? b.vineCount,
          application_rate: numOr(applicationRate),
          product_required: calc.allocations[i]?.productRequired ?? 0,
          allocated_cost: calc.allocations[i]?.allocatedCost ?? null,
        })),
        user_id: user?.id ?? null,
        current_sync_version: existing?.sync_version ?? 0,
      };

      const { record } = await saveFertiliserRecord(savePayload);

      // Optional Work Task creation. Uses the same idempotent pattern as
      // pruning: stable UUIDs, upsert on retry.
      if (createTask && selectedBlocks.length > 0) {
        const taskId = pendingTaskId ?? crypto.randomUUID();
        setPendingTaskId(taskId);
        const primary = selectedBlocks[0];
        await createWorkTask({
          id: taskId,
          vineyard_id: vineyardId,
          paddock_id: primary.id,
          paddock_name: primary.name,
          task_type: taskType || "Fertilising",
          status: status === "completed" ? "completed" : "planned",
          description: productName.trim(),
          notes: notes,
          start_date: applicationDate,
          end_date: applicationDate,
          date: applicationDate,
          area_ha: calc.totalAreaHa,
          duration_hours:
            numOr(workerCount) > 0 && numOr(hoursPerWorker) > 0
              ? numOr(workerCount) * numOr(hoursPerWorker)
              : null,
          is_finalized: status === "completed",
          user_id: user?.id ?? null,
        });
        // Multi-block link table.
        const existingLinks = await fetchWorkTaskPaddocksForVineyard(vineyardId);
        await syncWorkTaskPaddocks({
          workTaskId: taskId,
          vineyardId,
          selections: selectedBlocks.map((b) => ({
            paddock_id: b.id,
            area_ha: b.areaHa,
          })),
          existing: existingLinks.filter((r) => r.work_task_id === taskId),
          userId: user?.id ?? null,
        });
        // Single labour line seeded from the calculator's labour fields.
        if (numOr(workerCount) > 0 && numOr(hoursPerWorker) > 0) {
          const lineId = pendingLabourLineId ?? crypto.randomUUID();
          setPendingLabourLineId(lineId);
          await createLabourLine({
            id: lineId,
            work_task_id: taskId,
            vineyard_id: vineyardId,
            work_date: applicationDate,
            worker_count: numOr(workerCount),
            hours_per_worker: numOr(hoursPerWorker),
            hourly_rate: hourlyRate === "" ? null : numOr(hourlyRate),
            user_id: user?.id ?? null,
          });
        }
      }

      return record;
    },
    onSuccess: () => {
      toast({ title: "Fertiliser record saved" });
      qc.invalidateQueries({ queryKey: ["fertiliser", "records", vineyardId] });
      qc.invalidateQueries({ queryKey: ["fertiliser", "allocations"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? err ?? "");
      toast({
        title: "Could not save fertiliser record",
        description: msg || "Unexpected error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Fertiliser Record" : "New Fertiliser Calculation"}</DialogTitle>
          <DialogDescription>
            Pick a product, choose a rate mode and select blocks. Product totals and per-block allocations calculate live.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Product picker */}
          <section className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap justify-between">
              <Label className="text-sm font-semibold">Product</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="show-all"
                  checked={showAllCategories}
                  onCheckedChange={setShowAllCategories}
                />
                <Label htmlFor="show-all" className="text-xs">
                  Show all saved products
                </Label>
              </div>
            </div>
            <Input
              placeholder="Search saved products by name…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto rounded border divide-y">
              {productsQ.isLoading && (
                <div className="p-3 text-sm text-muted-foreground">Loading products…</div>
              )}
              {!productsQ.isLoading && filteredProducts.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">
                  No products match. Toggle “Show all saved products” or add one in Saved Chemicals.
                </div>
              )}
              {filteredProducts.map((p) => {
                const isSel = productId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProduct(p.id)}
                    className={`w-full text-left p-2 hover:bg-accent/40 ${
                      isSel ? "bg-accent/60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{p.name}</span>
                      {p.product_category && (
                        <Badge variant="outline" className="text-xs">
                          {PRODUCT_CATEGORY_LABEL[p.product_category as ProductCategoryKey] ??
                            p.product_category}
                        </Badge>
                      )}
                      {p.organic_certified && (
                        <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">Organic</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {p.pack_size ? `${p.pack_size} ${p.pack_unit || ""}` : "—"}
                      {p.price_per_pack != null ? ` · $${p.price_per_pack}/pack` : ""}
                      {p.nitrogen_percent != null ||
                      p.phosphorus_percent != null ||
                      p.potassium_percent != null
                        ? ` · N-P-K ${p.nitrogen_percent ?? 0}-${p.phosphorus_percent ?? 0}-${p.potassium_percent ?? 0} (${p.analysis_basis || "elemental"})`
                        : ""}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Product name (snapshot)</Label>
                <Input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. CalMag Plus"
                />
              </div>
              <div>
                <Label className="text-xs">Form</Label>
                <Select value={form} onValueChange={(v) => setForm(v as FertiliserForm)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">Solid</SelectItem>
                    <SelectItem value="liquid">Liquid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Rate + date */}
          <section className="rounded-lg border p-3 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Calculation mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as FertiliserCalculationMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="perHectare">Per hectare</SelectItem>
                  <SelectItem value="perVine">Per vine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Application date</Label>
              <Input
                type="date"
                value={applicationDate}
                onChange={(e) => setApplicationDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as FertiliserRecordStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Application rate</Label>
              <div className="flex gap-2">
                <Input
                  inputMode="decimal"
                  value={applicationRate}
                  onChange={(e) => setApplicationRate(e.target.value)}
                  placeholder="e.g. 50"
                />
                <Input
                  value={applicationRateUnit}
                  onChange={(e) => setApplicationRateUnit(e.target.value)}
                  className="w-28"
                  placeholder={defaultRateUnit(mode, form)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Product unit</Label>
              <Input
                value={productUnit}
                onChange={(e) => setProductUnit(e.target.value)}
                placeholder={defaultProductUnit(form)}
              />
            </div>
            <div>
              <Label className="text-xs">Pack size ({productUnit || defaultProductUnit(form)})</Label>
              <Input
                inputMode="decimal"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
            {showCosts && (
              <div>
                <Label className="text-xs">Price per pack</Label>
                <Input
                  inputMode="decimal"
                  value={pricePerPack}
                  onChange={(e) => setPricePerPack(e.target.value)}
                  placeholder="e.g. 120"
                />
              </div>
            )}
          </section>

          {/* Blocks */}
          <section className="rounded-lg border p-3 space-y-2">
            <Label className="text-sm font-semibold">Blocks</Label>
            {blocks.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No blocks configured on this vineyard.
              </div>
            )}
            <div className="divide-y">
              {blocks.map((b, i) => (
                <div key={b.id} className="py-2 grid grid-cols-[auto_1fr_100px_100px_1fr] gap-2 items-center">
                  <Checkbox
                    checked={b.selected}
                    onCheckedChange={(v) => {
                      const next = [...blocks];
                      next[i] = { ...b, selected: !!v };
                      setBlocks(next);
                    }}
                    aria-label={`Select ${b.name}`}
                  />
                  <div className="text-sm truncate">{b.name}</div>
                  <Input
                    disabled={!b.selected}
                    inputMode="decimal"
                    value={String(b.areaHa)}
                    onChange={(e) => {
                      const next = [...blocks];
                      next[i] = { ...b, areaHa: numOr(e.target.value) };
                      setBlocks(next);
                    }}
                    aria-label={`${b.name} area ha`}
                  />
                  <Input
                    disabled={!b.selected}
                    inputMode="numeric"
                    value={String(b.vineCount)}
                    onChange={(e) => {
                      const next = [...blocks];
                      next[i] = { ...b, vineCount: Math.round(numOr(e.target.value)) };
                      setBlocks(next);
                    }}
                    aria-label={`${b.name} vine count`}
                  />
                  {b.selected ? (
                    <div className="text-xs text-muted-foreground tabular-nums text-right">
                      {calc.allocations
                        .find((a) => a.paddockId === b.id)
                        ?.productRequired.toLocaleString()}{" "}
                      {productUnit || defaultProductUnit(form)}
                      {showCosts && calc.allocations.find((a) => a.paddockId === b.id)?.allocatedCost != null && (
                        <span className="ml-2">
                          · $
                          {calc.allocations
                            .find((a) => a.paddockId === b.id)!
                            .allocatedCost!.toFixed(2)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-2 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Total area</div>
                <div className="font-semibold tabular-nums">
                  {calc.totalAreaHa.toFixed(2)} ha
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total vines</div>
                <div className="font-semibold tabular-nums">
                  {calc.totalVines.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total product</div>
                <div className="font-semibold tabular-nums">
                  {calc.totalProductRequired.toLocaleString()} {productUnit || defaultProductUnit(form)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Packs required</div>
                <div className="font-semibold tabular-nums">
                  {calc.packCount == null ? "—" : calc.packCount.toFixed(2)}
                </div>
              </div>
              {showCosts && (
                <>
                  <div>
                    <div className="text-xs text-muted-foreground">Product cost</div>
                    <div className="font-semibold tabular-nums">
                      {calc.estimatedProductCost == null ? "—" : `$${calc.estimatedProductCost.toFixed(2)}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Labour cost</div>
                    <Input
                      inputMode="decimal"
                      value={labourCost}
                      onChange={(e) => setLabourCost(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Machinery cost</div>
                    <Input
                      inputMode="decimal"
                      value={machineryCost}
                      onChange={(e) => setMachineryCost(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total job cost</div>
                    <div className="font-semibold tabular-nums">
                      {calc.totalJobCost == null ? "—" : `$${calc.totalJobCost.toFixed(2)}`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Work Task */}
          <section className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 justify-between">
              <Label className="text-sm font-semibold">Create linked Work Task</Label>
              <Switch checked={createTask} onCheckedChange={setCreateTask} />
            </div>
            {createTask && (
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Task type</Label>
                  <Input value={taskType} onChange={(e) => setTaskType(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Workers</Label>
                  <Input
                    inputMode="numeric"
                    value={workerCount}
                    onChange={(e) => setWorkerCount(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Hours per worker</Label>
                  <Input
                    inputMode="decimal"
                    value={hoursPerWorker}
                    onChange={(e) => setHoursPerWorker(e.target.value)}
                  />
                </div>
                {showCosts && (
                  <div>
                    <Label className="text-xs">Hourly rate</Label>
                    <Input
                      inputMode="decimal"
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(e.target.value)}
                    />
                  </div>
                )}
                <div className="sm:col-span-4 text-xs text-muted-foreground">
                  A labour line seeded from these fields will be created on the task. Fertiliser totals, blocks and notes are shared so nothing is entered twice.
                </div>
              </div>
            )}
          </section>

          <section>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Saving…" : existing ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Helper — build calculator paddock options from raw iOS paddock rows. */
export function paddocksToOptions(rows: any[]): PaddockOption[] {
  return rows.map((p) => {
    const m = deriveMetrics(p);
    return {
      id: p.id,
      name: p.name ?? "Block",
      areaHa: Number(m.areaHa.toFixed(3)),
      vineCount: m.vineCount ?? 0,
    };
  });
}
