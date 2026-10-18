import { generateUuid, tryGenerateUuid } from "@/lib/uuid";
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
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import {
  areaLabel, areaToCanonical, areaToDisplay, costPerAreaLabel, costPerAreaToDisplay,
  inputValue, quantityLabel, quantityToDisplay, rateLabel, rateToCanonical, rateToDisplay,
} from "@/lib/fertiliserUnits";
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
  actualVineCount, assumedFullVineCount, resolveVineBasis, VINE_COUNT_BASIS_PERSISTED, vineCountBasisForSave,
  type ActualVineSource, type AssumedFullUnavailable, type DialogVineBasis,
} from "@/lib/fertiliserVineBasis";
import {
  isFertiliserProduct,
  PRODUCT_CATEGORY_LABEL,
  compareInventory,
  computeCalculation,
  costPerHectare,
  costPerVine,
  packBreakdown,
  seasonProductCost,
  defaultProductUnit,
  defaultRateUnit,
  calculationModeLabel,
  isSupportedCalculationMode,
  UNSUPPORTED_MODE_NOTICE,
  type FertiliserCalculationMode,
  type FertiliserForm,
  type FertiliserRecordStatus,
  type ProductCategoryKey,
} from "@/lib/fertiliserCalc";
import {
  fetchFertiliserAllocations,
  saveFertiliserRecord,
  type FertiliserAllocation,
  type FertiliserRecord,
} from "@/lib/fertiliserRecordsQuery";
import { fetchInventorySummary } from "@/lib/chemicalInventory";
import { fetchChemicalSeasonPrices, seasonPriceQueryKey } from "@/lib/chemicalSeasonPricing";
import { fetchVineyardSeasonSettings, SEASON_DEFAULTS } from "@/lib/vineyardSeasonSettingsQuery";
import { vintageForISO } from "@/lib/availableVintages";
import {
  createLabourLine,
  createWorkTask,
  fetchWorkTaskPaddocksForVineyard,
  syncWorkTaskPaddocks,
} from "@/lib/workTasksQuery";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  computeTargetNutrient,
  seedAnalysisFromLegacyProduct,
  NUTRIENT_DISPLAY,
  type NutrientAnalysisEntry,
  type TargetRateUnit,
} from "@/lib/targetNutrient";
import { NutrientAnalysisEditor } from "@/components/fertiliser/NutrientAnalysisEditor";

interface PaddockOption {
  id: string;
  name: string;
  areaHa: number;
  vineCount: number;
  actualVineCount: number | null;
  actualVineCountSource: ActualVineSource;
  assumedFullVineCount: number | null;
  assumedFullReason: AssumedFullUnavailable | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vineyardId: string;
  paddocks: PaddockOption[];
  role: string | null;
  /** When provided, edit that existing record instead of creating one. */
  existing?: FertiliserRecord | null;
  /**
   * Duplicate source: pre-fills every value and block from this record but
   * saves as a brand-new record with new record and allocation IDs.
   */
  duplicateFrom?: { record: FertiliserRecord; allocations: FertiliserAllocation[] } | null;
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

const STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  planned: "Planned",
  completed: "Completed",
  cancelled: "Cancelled",
};

function npk(p: Pick<Product, "nitrogen_percent" | "phosphorus_percent" | "potassium_percent" | "analysis_basis">): string {
  if (p.nitrogen_percent == null && p.phosphorus_percent == null && p.potassium_percent == null) return "";
  return ` · N-P-K ${p.nitrogen_percent ?? 0}-${p.phosphorus_percent ?? 0}-${p.potassium_percent ?? 0} (${p.analysis_basis || "elemental"})`;
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
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

function FertiliserCalculatorDialogForm({
  open,
  onOpenChange,
  vineyardId,
  paddocks,
  role,
  existing,
  duplicateFrom,
}: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isAdmin } = useIsSystemAdmin();
  const showCosts = canSeeCosts(role);
  const productsQ = useProducts(vineyardId);
  const region = useRegionFormatters();
  const money = (v: number | null | undefined, dp = 2) => (v == null ? "—" : region.currency(v, dp));
  const allocationsQ = useExistingAllocations(existing?.id);

  const [applicationDate, setApplicationDate] = useState<string>("");
  const [productId, setProductId] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [productName, setProductName] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [form, setForm] = useState<FertiliserForm>("solid");
  // "nutrientTarget" is a System Admin-only PREVIEW mode: it never saves.
  const [mode, setMode] = useState<FertiliserCalculationMode | "nutrientTarget">("perHectare");
  const [applicationRate, setApplicationRate] = useState<string>("");
  // Target Nutrient (Preview) state — local only, never persisted.
  const [analysisEntries, setAnalysisEntries] = useState<NutrientAnalysisEntry[]>([]);
  const [selectedNutrientIdx, setSelectedNutrientIdx] = useState<number>(0);
  const [manualNutrientName, setManualNutrientName] = useState("");
  const [manualPercent, setManualPercent] = useState<string>("");
  const [useManualPercent, setUseManualPercent] = useState(false);
  const [targetUnit, setTargetUnit] = useState<TargetRateUnit>("g/vine");
  const [targetRate, setTargetRate] = useState<string>("");
  const [densityInput, setDensityInput] = useState<string>("");
  const [manualArea, setManualArea] = useState<string>("");
  const [manualVines, setManualVines] = useState<string>("");
  const [packSize, setPackSize] = useState<string>("");
  const [pricePerPack, setPricePerPack] = useState<string>("");
  const [labourCost, setLabourCost] = useState<string>("");
  const [machineryCost, setMachineryCost] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<FertiliserRecordStatus>("planned");
  const [savingStatus, setSavingStatus] = useState<FertiliserRecordStatus>("planned");
  const [blocks, setBlocks] = useState<BlockState[]>([]);
  const [vineBasis, setVineBasis] = useState<DialogVineBasis>("actual");
  const [snapshotIds, setSnapshotIds] = useState<Set<string>>(new Set());

  // Optional Work Task creation.
  const [createTask, setCreateTask] = useState(false);
  const [taskType, setTaskType] = useState("Fertilising");
  const [workerCount, setWorkerCount] = useState<string>("1");
  const [hoursPerWorker, setHoursPerWorker] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("");

  // Stable ids kept across retries so upserts don't duplicate rows.
  const initialId = useState(() => tryGenerateUuid())[0];
  const [idError, setIdError] = useState<string | null>(initialId.error);
  const [recordId, setRecordId] = useState<string>(initialId.id ?? "");
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingLabourLineId, setPendingLabourLineId] = useState<string | null>(null);

  // Reset / hydrate when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const src = existing ?? duplicateFrom?.record ?? null;
    if (existing) {
      setRecordId(existing.id);
    } else {
      const next = tryGenerateUuid();
      setIdError(next.error);
      setRecordId(next.id ?? "");
    }
    if (src) {
      setApplicationDate(src.application_date);
      setProductId(src.product_id);
      setManualMode(!src.product_id);
      setProductName(src.product_name);
      setForm((src.form as FertiliserForm) === "liquid" ? "liquid" : "solid");
      setMode((src.calculation_mode as FertiliserCalculationMode) === "perVine" ? "perVine" : "perHectare");
      {
        const srcForm: FertiliserForm = (src.form as FertiliserForm) === "liquid" ? "liquid" : "solid";
        const srcMode: FertiliserCalculationMode = (src.calculation_mode as FertiliserCalculationMode) === "perVine" ? "perVine" : "perHectare";
        setApplicationRate(src.application_rate == null ? "" : inputValue(rateToDisplay(Number(src.application_rate), srcMode, srcForm, region), 4));
      }
      setPackSize(src.pack_size == null ? "" : String(src.pack_size));
      setPricePerPack(""); // price_per_pack is not stored on the record
      setLabourCost(src.labour_cost == null ? "" : String(src.labour_cost));
      setMachineryCost(src.machinery_cost == null ? "" : String(src.machinery_cost));
      setNotes(src.notes ?? "");
      setManualArea(src.total_area_ha ? inputValue(areaToDisplay(Number(src.total_area_ha), region)) : "");
      setManualVines(src.total_vines ? String(src.total_vines) : "");
      const s = existing?.record_status as FertiliserRecordStatus;
      setStatus(existing && s ? s : "planned");
    } else {
      setApplicationDate("");
      setManualMode(false);
      setProductId(null);
      setProductName("");
      setForm("solid");
      setMode("perHectare");
      setApplicationRate("");
      setPackSize("");
      setPricePerPack("");
      setLabourCost("");
      setMachineryCost("");
      setNotes("");
      setManualArea("");
      setManualVines("");
      setStatus("planned");
    }
    // Target Nutrient (Preview) reset.
    setAnalysisEntries([]);
    setSelectedNutrientIdx(0);
    setManualNutrientName("");
    setManualPercent("");
    setUseManualPercent(false);
    setTargetUnit("g/vine");
    setTargetRate("");
    setDensityInput("");
    setCreateTask(false);
    setPendingTaskId(null);
    setPendingLabourLineId(null);
    setProductSearch("");
  }, [open, existing, duplicateFrom]);

  // Hydrate block selection from existing (or duplicate-source) allocations.
  // Duplicates always get NEW allocation IDs so source child rows are never touched.
  const sourceAllocations = existing ? allocationsQ.data : duplicateFrom?.allocations;
  useEffect(() => {
    if (!open) return;
    const byPaddock = new Map((sourceAllocations ?? []).map((a) => [a.paddock_id, a]));
    // Stored records keep their snapshot vine counts until a basis is chosen.
    const src: any = existing ?? duplicateFrom?.record ?? null;
    const storedBasis = src?.vine_count_basis;
    setSnapshotIds(new Set(byPaddock.keys()));
    setVineBasis(
      storedBasis === "actual" || storedBasis === "assumed_full"
        ? (byPaddock.size ? "snapshot" : storedBasis)
        : byPaddock.size ? "snapshot" : "actual",
    );
    setBlocks(
      paddocks.map((p) => {
        const alloc = byPaddock.get(p.id);
        return {
          ...p,
          selected: alloc != null,
          allocationId: existing && alloc ? alloc.id : generateUuid(),
          areaHa: alloc ? Number(alloc.area_ha) : p.areaHa,
          vineCount: alloc ? Number(alloc.vine_count) : p.vineCount,
        };
      }),
    );
  }, [open, paddocks, sourceAllocations, existing, duplicateFrom]);

  // When the user picks a product, snapshot product-related defaults.
  const onSelectProduct = (id: string) => {
    const p = (productsQ.data ?? []).find((x) => x.id === id);
    if (!p) return;
    setProductId(p.id);
    setManualMode(false);
    setProductName(p.name);
    setForm(p.product_form === "liquid" ? "liquid" : "solid");
    setPackSize(p.pack_size == null ? "" : String(p.pack_size));
    // Legacy saved_chemicals.price_per_pack is never a cost authority.
    setPricePerPack("");
    // Target Nutrient (Preview): seed the local analysis from legacy N/P/K
    // and the density from the saved product. Local only — never written back.
    setAnalysisEntries(seedAnalysisFromLegacyProduct(p));
    setSelectedNutrientIdx(0);
    setUseManualPercent(false);
    setDensityInput(p.density != null && p.density > 0 ? String(p.density) : "");
  };

  const onManualEntry = () => {
    setManualMode(true);
    setProductId(null);
    setProductName("");
    setPackSize("");
    setPricePerPack("");
  };

  // Target Nutrient (Preview): derive the product rate from the nutrient
  // target, then reuse the existing perVine/perHectare pipeline for totals,
  // packs, costs and inventory. Never saved.
  const isTargetMode = mode === "nutrientTarget";
  const calcMode: FertiliserCalculationMode = isTargetMode
    ? targetUnit === "g/vine"
      ? "perVine"
      : "perHectare"
    : mode;
  const selectedEntry: NutrientAnalysisEntry | null =
    analysisEntries[selectedNutrientIdx] ?? null;
  const targetPct = useManualPercent || !selectedEntry ? numOr(manualPercent) : selectedEntry.percent;
  const targetPctSource: "product_analysis" | "manual" =
    useManualPercent || !selectedEntry
      ? "manual"
      : selectedEntry.sourceKind === "product_analysis"
        ? "product_analysis"
        : "manual";
  const targetConcBasis = selectedEntry?.concentrationBasis ?? "w/w";
  const targetAnalysisBasis = selectedEntry?.analysisBasis ?? "elemental";
  const densityKgPerL = densityInput === "" ? null : numOr(densityInput);
  const targetRateVal = numOr(targetRate);
  // Per-unit product rate (canonical: g/vine or mL/vine; kg/ha or L/ha).
  const targetFraction = targetPct > 0 && targetPct <= 100 ? targetPct / 100 : 0;
  const targetVolumeAvailable =
    form === "liquid" && (targetConcBasis === "w/v" || (densityKgPerL != null && densityKgPerL > 0));
  const targetRateCanon = (() => {
    if (!isTargetMode || targetFraction <= 0 || targetRateVal <= 0) return 0;
    const perUnit = targetRateVal / targetFraction; // g/vine or kg/ha of product (mass basis)
    if (form === "liquid") {
      if (targetConcBasis === "w/v") return perUnit; // numerically mL/vine or L/ha
      if (densityKgPerL != null && densityKgPerL > 0) return perUnit / densityKgPerL;
      return 0; // blocked — density required
    }
    return perUnit;
  })();
  // When a w/w liquid lacks density the product quantity is a MASS — report in
  // kg by treating the pipeline form as solid so units stay honest.
  const effectiveForm: FertiliserForm =
    isTargetMode && form === "liquid" && !targetVolumeAvailable ? "solid" : form;

  // Units are authoritative: derived from form + mode, never typed.
  const applicationRateUnit = defaultRateUnit(calcMode, effectiveForm);
  const productUnit = defaultProductUnit(effectiveForm);
  // Inputs are in the vineyard's display units; everything below works canonically.
  const rateCanon = isTargetMode
    ? targetRateCanon
    : rateToCanonical(numOr(applicationRate), calcMode, effectiveForm, region);
  const manualAreaHa = areaToCanonical(numOr(manualArea), region);
  const displayRateUnit = rateLabel(calcMode, effectiveForm, region);
  const displayQtyUnit = quantityLabel(effectiveForm, region);
  const qty = (v: number) => `${Number(quantityToDisplay(v, effectiveForm, region).toFixed(3)).toLocaleString()} ${displayQtyUnit}`;
  const selectedProduct = (productsQ.data ?? []).find((p) => p.id === productId) ?? null;
  const isSavedProduct = !!productId;

  const checkedBlocks = useMemo(() => blocks.filter((b) => b.selected), [blocks]);
  const vineResolution = useMemo(
    () => resolveVineBasis(checkedBlocks, calcMode, vineBasis, snapshotIds),
    [checkedBlocks, calcMode, vineBasis, snapshotIds],
  );
  // Blocks as they drive the calculation (Per Vine counts come from the basis).
  const selectedBlocks = useMemo(
    () => vineResolution.blocks.map((r) => ({ ...r.block, vineCount: r.vineCount })),
    [vineResolution],
  );
  const vineSourceById = useMemo(
    () => new Map(vineResolution.blocks.map((r) => [r.block.id, r.sourceLabel])),
    [vineResolution],
  );

  // Saved-product cost: SQL 264 season purchase price (Owner/Manager only).
  const seasonQ = useQuery({
    queryKey: ["season-settings", vineyardId],
    enabled: !!vineyardId && showCosts && isSavedProduct,
    queryFn: () => fetchVineyardSeasonSettings(vineyardId),
  });
  const season = seasonQ.data ?? SEASON_DEFAULTS;
  const effectiveDate = applicationDate || new Date().toISOString().slice(0, 10);
  const vintage = vintageForISO(effectiveDate, season.season_start_month, season.season_start_day);
  const priceQ = useQuery({
    queryKey: seasonPriceQueryKey(vineyardId, vintage ?? 0, null),
    enabled: !!vineyardId && showCosts && isSavedProduct && vintage != null && !seasonQ.isLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchChemicalSeasonPrices(vineyardId, vintage!),
  });
  const seasonRow = productId ? priceQ.data?.get(productId) ?? null : null;

  // Inventory: Chemical Inventory summary RPC (never saved_chemicals.inventory_quantity).
  const inventoryQ = useQuery({
    queryKey: ["fertiliser", "inventory", productId],
    enabled: !!productId,
    retry: false,
    queryFn: () => fetchInventorySummary(productId!),
  });

  const calc = useMemo(
    () =>
      computeCalculation({
        mode: calcMode,
        applicationRate: rateCanon,
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
        manual: { areaHa: manualAreaHa, vineCount: numOr(manualVines) },
        ...(isSavedProduct
          ? {
              productCostOverride: seasonProductCost(
                seasonRow,
                (() => {
                  const r = rateCanon;
                  if (selectedBlocks.length) {
                    return selectedBlocks.reduce(
                      (s, b) => s + (calcMode === "perHectare" ? r * b.areaHa : (r * b.vineCount) / 1000),
                      0,
                    );
                  }
                  return calcMode === "perHectare" ? r * manualAreaHa : (r * numOr(manualVines)) / 1000;
                })(),
                productUnit,
              ),
            }
          : {}),
      }),
    [
      rateCanon,
      manualAreaHa,
      manualArea,
      manualVines,
      isSavedProduct,
      seasonRow,
      productUnit,
      calcMode,
      applicationRate,
      packSize,
      pricePerPack,
      labourCost,
      machineryCost,
      selectedBlocks,
    ],
  );

  const hasFertiliserProducts = useMemo(
    () => (productsQ.data ?? []).some((p) => p.is_active !== false && isFertiliserProduct(p)),
    [productsQ.data],
  );
  const filteredProducts = useMemo(() => {
    const list = productsQ.data ?? [];
    const q = productSearch.trim().toLowerCase();
    return list
      .filter((p) => p.is_active !== false)
      .filter((p) => (showAllCategories || !hasFertiliserProducts ? true : isFertiliserProduct(p)))
      .filter((p) => (q ? (p.name ?? "").toLowerCase().includes(q) : true));
  }, [productsQ.data, productSearch, showAllCategories, hasFertiliserProducts]);

  const packs = packBreakdown(calc.totalProductRequired, packSize === "" ? null : numOr(packSize));
  const labourAndMachinery = numOr(labourCost) + numOr(machineryCost);
  const inventory = inventoryQ.data
    ? compareInventory(inventoryQ.data.quantity, inventoryQ.data.unit, calc.totalProductRequired, productUnit)
    : null;

  const hasQuantity = selectedBlocks.length > 0 || (calcMode === "perHectare" ? manualAreaHa > 0 : numOr(manualVines) > 0);

  // Target Nutrient (Preview) result — display-only, built from the same
  // totals the existing pipeline produced so blocks/vine basis stay shared.
  const targetResult = useMemo(() => {
    if (!isTargetMode) return null;
    return computeTargetNutrient({
      form,
      targetRateUnit: targetUnit,
      targetRate: targetRateVal,
      nutrientPercent: targetPct,
      nutrientPercentSource: targetPctSource,
      analysisBasis: targetAnalysisBasis,
      concentrationBasis: targetConcBasis,
      densityKgPerL,
      totalAreaHa: calc.totalAreaHa,
      totalVines: calc.totalVines,
      otherNutrients: analysisEntries.filter((_, i) => i !== selectedNutrientIdx),
    });
  }, [
    isTargetMode, form, targetUnit, targetRateVal, targetPct, targetPctSource,
    targetAnalysisBasis, targetConcBasis, densityKgPerL,
    calc.totalAreaHa, calc.totalVines, analysisEntries, selectedNutrientIdx,
  ]);

  // Preview mode never submits: Save / Mark Completed stay disabled and the
  // mutation itself refuses, so a nutrientTarget record can never be written.
  const canSubmit =
    !isTargetMode &&
    productName.trim().length > 0 &&
    hasQuantity &&
    rateCanon > 0 &&
    vineResolution.issues.length === 0;

  const saveMut = useMutation({
    mutationFn: async (recordStatus: FertiliserRecordStatus) => {
      if (mode === "nutrientTarget") {
        throw new Error("Target Nutrient is a preview — records cannot be saved yet.");
      }
      setSavingStatus(recordStatus);
      const savedRecordId = recordId;
      const savePayload = {
        id: savedRecordId,
        vineyard_id: vineyardId,
        product_id: productId,
        product_name: productName.trim(),
        form,
        calculation_mode: mode,
        record_status: recordStatus,
        application_date: effectiveDate,
        vine_count_basis: VINE_COUNT_BASIS_PERSISTED
          ? vineCountBasisForSave({
              mode, selectedBlockCount: selectedBlocks.length, basis: vineBasis,
              isEdit: !!existing, sourceBasis: duplicateFrom?.record?.vine_count_basis ?? null,
            })
          : undefined,
        block_names: selectedBlocks.map((b) => b.name),
        total_area_ha: calc.totalAreaHa,
        total_vines: calc.totalVines,
        application_rate: rateCanon,
        application_rate_unit: applicationRateUnit,
        total_product_required: calc.totalProductRequired,
        product_unit: productUnit,
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
        const taskId = pendingTaskId ?? generateUuid();
        setPendingTaskId(taskId);
        const primary = selectedBlocks[0];
        await createWorkTask({
          id: taskId,
          vineyard_id: vineyardId,
          paddock_id: primary.id,
          paddock_name: primary.name,
          task_type: taskType || "Fertilising",
          status: recordStatus === "completed" ? "completed" : "planned",
          description: productName.trim(),
          notes: notes,
          start_date: effectiveDate,
          end_date: effectiveDate,
          date: effectiveDate,
          area_ha: calc.totalAreaHa,
          duration_hours:
            numOr(workerCount) > 0 && numOr(hoursPerWorker) > 0
              ? numOr(workerCount) * numOr(hoursPerWorker)
              : null,
          is_finalized: recordStatus === "completed",
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
          const lineId = pendingLabourLineId ?? generateUuid();
          setPendingLabourLineId(lineId);
          await createLabourLine({
            id: lineId,
            work_task_id: taskId,
            vineyard_id: vineyardId,
            work_date: effectiveDate,
            worker_count: numOr(workerCount),
            hours_per_worker: numOr(hoursPerWorker),
            hourly_rate: hourlyRate === "" ? null : numOr(hourlyRate),
            user_id: user?.id ?? null,
          });
        }
      }

      return record;
    },
    onSuccess: (_r, recordStatus) => {
      toast({ title: recordStatus === "completed" ? "Fertiliser application recorded as completed" : "Fertiliser record saved" });
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
        {idError && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {idError}
          </div>
        )}
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Fertiliser Record" : duplicateFrom ? "Duplicate Fertiliser Record" : "New Fertiliser Calculation"}</DialogTitle>
          <DialogDescription>
            Pick a saved product or use manual entry, choose a rate mode, then select blocks or enter the treated area or vine count.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Product picker */}
          <section className="rounded-lg border-2 border-border bg-card shadow-sm p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap justify-between">
              <Label className="text-sm font-semibold">Product</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch id="show-all" checked={showAllCategories} onCheckedChange={setShowAllCategories} />
                  <Label htmlFor="show-all" className="text-xs">Show all saved products</Label>
                </div>
                <Button type="button" size="sm" variant={isSavedProduct ? "outline" : "secondary"} onClick={manualMode ? () => setManualMode(false) : onManualEntry}>
                  {manualMode ? "Choose saved product" : "Manual entry"}
                </Button>
              </div>
            </div>
            {!hasFertiliserProducts && !productsQ.isLoading && (productsQ.data ?? []).length > 0 && (
              <div className="text-xs text-muted-foreground">
                No fertiliser-category products saved yet — showing all saved products.
              </div>
            )}
            {!manualMode && (<>
            <Input
              placeholder="Search saved products by name…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto rounded border divide-y">
              {productsQ.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading products…</div>}
              {!productsQ.isLoading && filteredProducts.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">
                  No products match. Toggle “Show all saved products” or use Manual entry.
                </div>
              )}
              {filteredProducts.map((p) => {
                const isSel = productId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProduct(p.id)}
                    className={`w-full text-left p-2 hover:bg-accent/40 ${isSel ? "bg-accent/60" : ""}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{p.name}</span>
                      {p.product_category && (
                        <Badge variant="outline" className="text-xs">
                          {PRODUCT_CATEGORY_LABEL[p.product_category as ProductCategoryKey] ?? p.product_category}
                        </Badge>
                      )}
                      {p.organic_certified && <Badge variant="secondary" className="text-xs">Organic</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {p.pack_size ? `${p.pack_size} ${p.pack_unit || ""}` : "—"}
                      {npk(p)}
                    </div>
                  </button>
                );
              })}
            </div>
            </>)}
            {isSavedProduct ? (
              <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1" aria-label="Selected saved product">
                <div className="font-medium">{productName}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    Category:{" "}
                    {selectedProduct?.product_category
                      ? PRODUCT_CATEGORY_LABEL[selectedProduct.product_category as ProductCategoryKey] ?? selectedProduct.product_category
                      : "Uncategorised"}
                  </span>
                  <span>Form: {form === "liquid" ? "Liquid" : "Solid"}</span>
                  {selectedProduct?.organic_certified && <span>Organic certified</span>}
                  <span>Pack: {selectedProduct?.pack_size ? `${selectedProduct.pack_size} ${selectedProduct.pack_unit || productUnit}` : "not set"}</span>
                  {selectedProduct && npk(selectedProduct) && <span>{npk(selectedProduct).replace(/^ · /, "")}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Snapshot from the saved product library. Use Manual entry for a product that isn't saved.
                </div>
              </div>
            ) : manualMode ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Product name (manual entry)</Label>
                  <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. CalMag Plus" />
                </div>
                <div>
                  <Label className="text-xs">Form</Label>
                  <Select value={form} onValueChange={(v) => setForm(v as FertiliserForm)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solid">Solid</SelectItem>
                      <SelectItem value="liquid">Liquid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </section>

          {/* Rate + date */}
          <section className="rounded-lg border-2 border-border bg-card shadow-sm p-4 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Calculation mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  // The preview mode is System Admin-only; never selectable otherwise.
                  if (v === "nutrientTarget" && !isAdmin) return;
                  setMode(v as FertiliserCalculationMode | "nutrientTarget");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="perHectare">Per hectare</SelectItem>
                  <SelectItem value="perVine">Per vine</SelectItem>
                  {isAdmin && (
                    <SelectItem value="nutrientTarget">Target Nutrient (Preview)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Application date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} />
            </div>
            {existing && (
              <div>
                <Label className="text-xs">Status</Label>
                <div className="h-10 flex items-center text-sm">{STATUS_TEXT[status] ?? status}</div>
              </div>
            )}
            {!isTargetMode && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Application rate ({displayRateUnit})</Label>
              <div className="flex gap-2 items-center">
                <Input inputMode="decimal" value={applicationRate} onChange={(e) => setApplicationRate(e.target.value)} placeholder="e.g. 50" />
                <span className="text-sm text-muted-foreground w-20" aria-label="Rate unit">{displayRateUnit}</span>
              </div>
            </div>
            )}
            <div>
              <Label className="text-xs">Pack size ({productUnit})</Label>
              <Input
                inputMode="decimal"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 25"
                disabled={isSavedProduct}
              />
            </div>
            {showCosts && !isSavedProduct && (
              <div>
                <Label className="text-xs">Price per pack</Label>
                <Input inputMode="decimal" value={pricePerPack} onChange={(e) => setPricePerPack(e.target.value)} placeholder="e.g. 120" />
              </div>
            )}
          </section>

          {/* Blocks */}
          <section className="rounded-lg border-2 border-border bg-card shadow-sm p-4 space-y-2">
            <Label className="text-sm font-semibold">Blocks (optional)</Label>
            {calcMode === "perVine" && checkedBlocks.length > 0 && (
              <div className="rounded-md border bg-muted/40 p-3 space-y-2" role="radiogroup" aria-label="Vine count basis">
                <div className="text-sm font-semibold">Vine count basis</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ["actual", "Actual vine count", "Use the physical/manual vine counts recorded for each block."],
                    ["assumed_full", "Assumed full vine count", "Calculate the theoretical vine count from planted row length and vine spacing, ignoring missing-vine/manual-count overrides."],
                  ] as const).map(([v, label, help]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={vineBasis === v}
                      onClick={() => setVineBasis(v)}
                      className={`text-left rounded-md border-2 p-2 ${vineBasis === v ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-accent/40"}`}
                    >
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{help}</div>
                    </button>
                  ))}
                </div>
                {vineBasis === "snapshot" && (
                  <div className="text-xs text-muted-foreground">
                    Showing the vine counts stored on this record. Choose a basis to recalculate from current block settings.
                  </div>
                )}
                {vineResolution.issues.map((m) => (
                  <div key={m} role="alert" className="text-xs text-destructive">{m}</div>
                ))}
              </div>
            )}
            {blocks.length === 0 && <div className="text-sm text-muted-foreground">No blocks configured on this vineyard.</div>}
            <div className="divide-y">
              {blocks.map((b, i) => (
                <div key={b.id} className="py-1 grid grid-cols-[auto_1fr_100px_100px_1fr] gap-2 items-center">
                  <label className="flex items-center gap-3 cursor-pointer col-span-2 py-2 pl-1 rounded-md hover:bg-accent/40 min-w-0">
                  <Checkbox
                    className="h-5 w-5"
                    checked={b.selected}
                    onCheckedChange={(v) => {
                      const next = [...blocks];
                      next[i] = { ...b, selected: !!v };
                      setBlocks(next);
                    }}
                    aria-label={`Select ${b.name}`}
                  />
                  <span className="text-sm truncate">{b.name}</span>
                  </label>
                  <Input
                    disabled={!b.selected}
                    inputMode="decimal"
                    value={inputValue(areaToDisplay(b.areaHa, region))}
                    onChange={(e) => {
                      const next = [...blocks];
                      next[i] = { ...b, areaHa: areaToCanonical(numOr(e.target.value), region) };
                      setBlocks(next);
                    }}
                    aria-label={`${b.name} area ${areaLabel(region)}`}
                  />
                  {calcMode === "perVine" && b.selected ? (
                    <div className="text-xs tabular-nums" aria-label={`${b.name} vine count`}>
                      <div className="font-medium">
                        {(selectedBlocks.find((x) => x.id === b.id)?.vineCount ?? 0).toLocaleString()} vines
                      </div>
                      <div className="text-muted-foreground">{vineSourceById.get(b.id)}</div>
                    </div>
                  ) : (
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
                  )}
                  {b.selected ? (
                    <div className="text-xs text-muted-foreground tabular-nums text-right">
                      {qty(calc.allocations.find((a) => a.paddockId === b.id)?.productRequired ?? 0)}
                      {showCosts && calc.allocations.find((a) => a.paddockId === b.id)?.allocatedCost != null && (
                        <span className="ml-2">· {money(calc.allocations.find((a) => a.paddockId === b.id)!.allocatedCost)}</span>
                      )}
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
              ))}
            </div>
            {selectedBlocks.length === 0 && (
              <div className="grid gap-2 sm:grid-cols-2 border-t pt-2">
                <div className="sm:col-span-2 text-xs text-muted-foreground">
                  No blocks selected — enter the treated {calcMode === "perHectare" ? "area" : "vine count"} to calculate. The record will be saved without block allocations.
                </div>
                {calcMode === "perHectare" ? (
                  <div>
                    <Label className="text-xs">Treated area ({areaLabel(region)})</Label>
                    <Input inputMode="decimal" value={manualArea} onChange={(e) => setManualArea(e.target.value)} aria-label={`Treated area ${areaLabel(region)}`} />
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Vine count</Label>
                    <Input inputMode="numeric" value={manualVines} onChange={(e) => setManualVines(e.target.value)} aria-label="Vine count" />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Results */}
          <section className="rounded-lg border-2 border-border bg-card shadow-sm p-4 space-y-3" aria-label="Calculation results">
            <Label className="text-sm font-semibold">Product requirement</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Total area" value={region.area(calc.totalAreaHa, 2)} />
              <Stat label="Total vines" value={calc.totalVines.toLocaleString()} />
              <Stat label="Total required" value={qty(calc.totalProductRequired)} />
              <Stat label="Packs required" value={packs ? packs.packsRequired.toFixed(2) : "—"} />
              <Stat label="Full packs" value={packs ? String(packs.fullPacks) : "—"} />
              <Stat
                label="Partial pack"
                value={packs ? `${packs.partialPack.toFixed(2)} pack / ${packs.partialPercent}%` : "—"}
              />
              <Stat label="Packs to open" value={packs ? String(packs.packsToOpen) : "—"} />
            </div>

            {isSavedProduct && (
              <div className="border-t pt-3 space-y-1">
                <Label className="text-sm font-semibold">Inventory</Label>
                {inventoryQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading Chemical Inventory…</div>
                ) : inventory ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <Stat label="Available" value={`${inventory.available.toLocaleString()} ${inventory.unit}`} />
                      <Stat label="Required" value={`${inventory.required.toLocaleString()} ${inventory.unit}`} />
                      <Stat label="After application" value={`${inventory.after.toLocaleString()} ${inventory.unit}`} />
                    </div>
                    {inventory.shortage && (
                      <div role="alert" className="text-xs text-destructive">
                        Not enough stock: short by {Math.abs(inventory.after).toLocaleString()} {inventory.unit}.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No Chemical Inventory stock recorded for this product in {productUnit === "kg" ? "kg/g" : "L/mL"}.
                  </div>
                )}
              </div>
            )}

            {showCosts && (
              <div className="border-t pt-3 space-y-2">
                <Label className="text-sm font-semibold">Costs</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Labour cost</div>
                    <Input inputMode="decimal" value={labourCost} onChange={(e) => setLabourCost(e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Machinery cost</div>
                    <Input inputMode="decimal" value={machineryCost} onChange={(e) => setMachineryCost(e.target.value)} placeholder="0.00" />
                  </div>
                  <Stat
                    label="Product cost"
                    value={calc.estimatedProductCost == null ? "Unavailable" : money(calc.estimatedProductCost)}
                  />
                  <Stat label="Labour & machinery" value={money(labourAndMachinery)} />
                  <Stat label="Total job cost" value={calc.totalJobCost == null ? "—" : money(calc.totalJobCost)} />
                  <Stat
                    label={costPerAreaLabel(region)}
                    value={(() => {
                      const perHa = costPerHectare(calc.totalJobCost, calc.totalAreaHa);
                      return perHa == null ? "—" : `${money(costPerAreaToDisplay(perHa, region))}/${areaLabel(region)}`;
                    })()}
                  />
                  <Stat label="Cost per vine" value={money(costPerVine(calc.totalJobCost, calc.totalVines), 4)} />
                </div>
                {isSavedProduct && calc.estimatedProductCost == null && (
                  <div className="text-xs text-muted-foreground">
                    Product cost comes from Chemical Purchase records for this season. No usable purchase price is recorded for this product.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Work Task */}
          <section className="rounded-lg border-2 border-border bg-card shadow-sm p-4 space-y-2">
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
                  Optional. Creates a separate Work Task (with a labour line from these fields) using the same blocks, date and notes. The fertiliser record does not store a link to the task.
                </div>
              </div>
            )}
          </section>

          <section>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {existing ? (
            <>
              {existing.record_status === "planned" && (
                <Button
                  variant="secondary"
                  disabled={!canSubmit || saveMut.isPending}
                  onClick={() => saveMut.mutate("completed")}
                >
                  Mark Completed
                </Button>
              )}
              <Button disabled={!canSubmit || saveMut.isPending} onClick={() => saveMut.mutate(status)}>
                {saveMut.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={!canSubmit || saveMut.isPending} onClick={() => saveMut.mutate("planned")}>
                {saveMut.isPending && savingStatus === "planned" ? "Saving…" : "Save as Planned"}
              </Button>
              <Button disabled={!canSubmit || saveMut.isPending} onClick={() => saveMut.mutate("completed")}>
                {saveMut.isPending && savingStatus === "completed" ? "Saving…" : "Record as Completed"}
              </Button>
            </>
          )}
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
      ...(() => {
        const a = actualVineCount(p);
        const f = assumedFullVineCount(p);
        return { ...a, assumedFullVineCount: f.count, assumedFullReason: f.reason };
      })(),
    };
  });
}

/**
 * Read-only view for records whose calculation_mode this Portal build does
 * not implement (nutrientTarget, fertigation, or anything newer). Renders the
 * stored values verbatim — no calculator hooks, no computeCalculation, no
 * save path. Mounted INSTEAD OF the form so an unsupported record never
 * enters the calculation pipeline at all.
 */
function UnsupportedFertiliserRecordDialog({
  open,
  onOpenChange,
  record,
  role,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: FertiliserRecord;
  role: string | null;
}) {
  const region = useRegionFormatters();
  const showCosts = canSeeCosts(role);
  const money = (v: number | null | undefined) => (v == null ? "—" : region.currency(v, 2));
  const roQty = (v: number | null, unit: string | null) =>
    v == null ? "—" : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ""}`;
  const r = record;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fertiliser Record (read-only)</DialogTitle>
          <DialogDescription>{UNSUPPORTED_MODE_NOTICE}</DialogDescription>
        </DialogHeader>
        <div
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          {UNSUPPORTED_MODE_NOTICE} The stored values are shown exactly as
          recorded and cannot be edited, duplicated, deleted or recalculated
          here.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-lg border p-4">
          <Stat label="Date" value={r.application_date || "—"} />
          <Stat label="Product" value={r.product_name || "—"} />
          <Stat label="Form" value={r.form === "liquid" ? "Liquid" : "Solid"} />
          <Stat label="Calculation mode" value={calculationModeLabel(r.calculation_mode)} />
          <Stat label="Status" value={STATUS_TEXT[r.record_status] ?? r.record_status} />
          <Stat label="Blocks" value={(r.block_names ?? []).join(", ") || "—"} />
          <Stat label="Application rate" value={roQty(r.application_rate, r.application_rate_unit)} />
          <Stat label="Total product required" value={roQty(r.total_product_required, r.product_unit)} />
          <Stat label="Total area" value={roQty(r.total_area_ha, "ha")} />
          <Stat label="Total vines" value={r.total_vines == null ? "—" : Number(r.total_vines).toLocaleString()} />
          <Stat label="Pack size" value={roQty(r.pack_size, r.product_unit)} />
          <Stat label="Pack count" value={r.pack_count == null ? "—" : String(r.pack_count)} />
          {showCosts && (
            <>
              <Stat label="Product cost" value={money(r.estimated_product_cost)} />
              <Stat label="Labour cost" value={money(r.labour_cost)} />
              <Stat label="Machinery cost" value={money(r.machinery_cost)} />
              <Stat label="Total job cost" value={money(r.total_job_cost)} />
            </>
          )}
        </div>
        {r.notes && (
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs text-muted-foreground mb-1">Notes</div>
            {r.notes}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Default export: hook-free router between the read-only view and the
 * calculator form. The form (and its computeCalculation pipeline) is never
 * mounted for an unsupported record.
 */
export default function FertiliserCalculatorDialog(props: Props) {
  if (props.existing != null && !isSupportedCalculationMode(props.existing.calculation_mode)) {
    return (
      <UnsupportedFertiliserRecordDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        record={props.existing}
        role={props.role}
      />
    );
  }
  return <FertiliserCalculatorDialogForm {...props} />;
}
