// Shared Add / Edit Chemical editor.
//
// Extracted from the Chemical Store page so the same authoritative form (search,
// match, verification, Chemical Intelligence) can be reused inside nested
// contexts such as the Spray Program Step wizard. There is deliberately no
// simplified variant: this is the one Add New Chemical experience.
import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  fetchSavedChemicalsForVineyard,
  createSavedChemical, updateSavedChemical, archiveSavedChemical, restoreSavedChemical,
  hardDeleteUnusedSavedChemical, ChemicalInUseError,
  type SavedChemical, type SavedChemicalInput,
} from "@/lib/savedChemicalsQuery";
import { PRODUCT_CATEGORIES, matchCategory, parseRestrictions, composeRestrictions } from "@/lib/chemicalCategories";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Archive, RotateCcw, Check, ChevronsUpDown, ExternalLink, FileText, Globe, Trash2, Info } from "lucide-react";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { VerificationBadge, ActivityGroupSummary } from "@/components/chemicals/ChemicalIntelligenceBadges";
import { ChemicalIntelligenceDialog } from "@/components/chemicals/ChemicalIntelligenceDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";
import { JurisdictionNoticeBanner } from "@/components/chemicals/JurisdictionNotice";
import { countryLabel, jurisdictionSuitability } from "@/lib/chemicalJurisdiction";

import { MasterUpdateDialog } from "@/components/chemicals/MasterUpdateDialog";
import {
  fetchMasterChemical,
  masterChemicalDraft,
  masterRevision,
  masterUpdateAvailable,
  MASTER_CURRENT_MESSAGE,
  MASTER_UPDATE_MESSAGE,
} from "@/lib/masterChemicals";
import { ChemicalIntelligenceEditor } from "@/components/chemicals/ChemicalIntelligenceEditor";
import {
  type ChemicalIntelligenceDraft,
  activityGroupReferenceSource,
  draftFromRow,
  emptyDraft,
  encodeChemicalIntelligenceForWrite,
  reconcileEditedDraft,
  hasStructuredIntelligence,
  parseLegacyActiveIngredient,
  suggestActivityGroup,
  withSource,
} from "@/lib/chemicalIntelligenceWrite";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCanSeeCosts } from "@/lib/permissions";
import {
  inferRateBasis, composeUnit, chemUnitOnly, normaliseUnit,
  inferProductType, defaultUnitFor, unitsFor,
  RATE_BASIS_LABEL, PRODUCT_TYPE_LABEL, displayUnitText,
  type RateBasis, type ProductType, type ChemUnit,
} from "@/lib/rateBasis";
import { normaliseChemicalGroup, buildGroupOptions } from "@/lib/chemicalGroupNormalise";
import { normaliseManufacturerName, buildManufacturerOptions } from "@/lib/manufacturerNormalise";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { DraggableHeaderCell } from "@/components/table/DraggableHeaderCell";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { formatDate } from "@/lib/dateFormat";

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v?: number | null, currency = "AUD") => {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v));
  } catch {
    return `$${Number(v).toFixed(2)}`;
  }
};

function purchaseCostPerUnit(purchase: any): number | null {
  const raw = purchase?.costPerBaseUnit ?? purchase?.cost_per_base_unit
    ?? purchase?.costPerUnit ?? purchase?.cost_per_unit;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function displayBaseUnit(unit?: string | null): string {
  const base = normaliseUnit(unit);
  return base || unit || "unit";
}

const EMPTY: SavedChemicalInput = {
  name: "", active_ingredient: "", chemical_group: "", use: "",
  manufacturer: "", crop: "", problem: "", rate_per_ha: null, unit: "",
  restrictions: "", notes: "", label_url: "", product_url: "",
};

export function ChemicalEditor({
  open, onOpenChange, initial, vineyardId, existingLibrary, canSeeCosts, onSaved,
  initialName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: SavedChemical | null;
  vineyardId: string;
  existingLibrary: Array<Pick<SavedChemical, "id" | "name" | "active_ingredient">>;
  canSeeCosts: boolean;
  /** Optional starting product name (new chemicals only). Never a verified identity. */
  initialName?: string | null;
  /** Receives the persisted Saved Chemical row so callers can bind by identity. */
  onSaved: (saved: SavedChemical) => void;
}) {
  const { toast } = useToast();
  const { currentCountry } = useVineyard();
  const [form, setForm] = useState<SavedChemicalInput>(EMPTY);
  const [rateStr, setRateStr] = useState("");
  const [packSizeStr, setPackSizeStr] = useState("");
  const [packPriceStr, setPackPriceStr] = useState("");
  const [packUnit, setPackUnit] = useState<string>("Litres");
  const [existingCost, setExistingCost] = useState<number | null>(null);
  const [currency, setCurrency] = useState("AUD");
  const [whp, setWhp] = useState("");
  const [rei, setRei] = useState("");
  const [restNotes, setRestNotes] = useState("");
  // SQL 194 structured intelligence. `intelBase` is the untouched rehydrated
  // record so a manual edit can invalidate only the evidence it affects.
  const [intel, setIntel] = useState<ChemicalIntelligenceDraft>(emptyDraft());
  const [intelBase, setIntelBase] = useState<ChemicalIntelligenceDraft>(emptyDraft());
  // Legacy-only records keep their text untouched until the operator opts in.
  const [upgraded, setUpgraded] = useState(false);
  // SQL 199 Master Catalogue link. Written only when the operator picked a
  // Master product or accepted a Master update — never inferred by name.
  const [masterLink, setMasterLink] = useState<{ id: string; revision: number | null } | null>(null);
  const [masterUpdateOpen, setMasterUpdateOpen] = useState(false);
  const showIntelEditor = !initial || upgraded || hasStructuredIntelligence(intel);

  // Linked Master record — used only for revision-drift detection. The saved
  // chemical's own columns remain the source of truth for display.
  const masterQ = useQuery({
    queryKey: ["master-chemical", masterLink?.id ?? null],
    enabled: open && !!masterLink?.id,
    staleTime: 60_000,
    queryFn: () => fetchMasterChemical(masterLink!.id),
  });
  const masterRow = masterQ.data ?? null;
  const masterUpdate = masterUpdateAvailable(
    { master_chemical_id: masterLink?.id, master_source_revision: masterLink?.revision },
    masterRow,
  );
  // A linked Master record is also checked against the vineyard country: an AU
  // Master revision is never "current verified information" for an NZ vineyard.
  const masterJurisdiction = jurisdictionSuitability(
    masterRow?.registration_country,
    currentCountry,
  );



  // Computed cost per base unit from pack size + pack price.
  const computedCost = useMemo(() => {
    const size = Number(packSizeStr);
    const price = Number(packPriceStr);
    if (!Number.isFinite(size) || !Number.isFinite(price)) return null;
    if (size <= 0 || price < 0) return null;
    return price / size;
  }, [packSizeStr, packPriceStr]);

  // Cost we'll actually save: prefer freshly computed, fall back to existing.
  const effectiveCost = computedCost ?? existingCost;

  // Reset when opening
  useMemo(() => {
    if (open) {
      if (initial) {
        const useVal = matchCategory(initial.use) ?? (initial.use ?? "");
        setForm({
          name: initial.name ?? "",
          active_ingredient: initial.active_ingredient ?? "",
          chemical_group: initial.chemical_group ?? "",
          use: useVal,
          manufacturer: initial.manufacturer ?? "",
          crop: initial.crop ?? "",
          problem: initial.problem ?? "",
          rate_per_ha: initial.rate_per_ha ?? null,
          unit: initial.unit ?? "",
          restrictions: initial.restrictions ?? "",
          notes: initial.notes ?? "",
          label_url: initial.label_url ?? "",
          product_url: (initial as any).product_url ?? "",
          purchase: initial.purchase ?? null,
        });
        setRateStr(initial.rate_per_ha == null ? "" : String(initial.rate_per_ha));
        setExistingCost(purchaseCostPerUnit(initial.purchase));
        setPackSizeStr("");
        setPackPriceStr("");
        setPackUnit(displayBaseUnit(initial.purchase?.unit ?? initial.unit) || "Litres");
        setCurrency(initial.purchase?.currency ?? "AUD");
        const p = parseRestrictions(initial.restrictions);
        setWhp(p.whpDays);
        setRei(p.reiHours);
        setRestNotes(p.rest);
        const hydrated = draftFromRow(initial as any);
        setIntel(hydrated);
        setIntelBase(hydrated);
        setUpgraded(false);
        setMasterLink(
          (initial as any).master_chemical_id
            ? {
                id: (initial as any).master_chemical_id as string,
                revision:
                  (initial as any).master_source_revision == null
                    ? null
                    : Number((initial as any).master_source_revision),
              }
            : null,
        );
      } else {
        setForm({ ...EMPTY, name: initialName?.trim() ? initialName.trim() : "" });
        setRateStr("");
        setExistingCost(null);
        setPackSizeStr("");
        setPackPriceStr("");
        setPackUnit("Litres");
        setCurrency("AUD");
        setWhp("");
        setRei("");
        setRestNotes("");
        setIntel(emptyDraft());
        setIntelBase(emptyDraft());
        setUpgraded(false);
        setMasterLink(null);
      }
      setMasterUpdateOpen(false);
    }
  }, [open, initial, initialName]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rateNum = rateStr.trim() === "" ? null : Number(rateStr);
      const costNum = effectiveCost;
      if (rateNum != null && Number.isNaN(rateNum)) {
        throw new Error("Rate per ha must be a number");
      }
      if (packSizeStr.trim() !== "" || packPriceStr.trim() !== "") {
        if (computedCost == null) {
          throw new Error("Enter both a pack size (> 0) and a pack price to calculate cost");
        }
      }
      const restrictions = composeRestrictions({ whpDays: whp, reiHours: rei, rest: restNotes });
      // Re-resolve trust before encoding: a hand-edited critical value can no
      // longer lean on the evidence that certified the previous value.
      const reconciled = reconcileEditedDraft(intelBase, intel);
      const encoded = encodeChemicalIntelligenceForWrite(reconciled);
      const payload: SavedChemicalInput = {
        ...form,
        intelligence: encoded,
        master_chemical_id: masterLink?.id ?? null,
        master_source_revision: masterLink?.revision ?? null,
        rate_per_ha: rateNum,
        restrictions,
        purchase: canSeeCosts && costNum != null
          ? {
              ...(form.purchase ?? {}),
              costPerBaseUnit: costNum,
              cost_per_base_unit: costNum,
              costPerUnit: costNum,
              cost_per_unit: costNum,
              currency,
              unit: packUnit || displayBaseUnit(form.unit),
            }
          : null,
      };
      if (!payload.name || !payload.name.trim()) throw new Error("Name is required");
      for (const key of ["label_url", "product_url"] as const) {
        const raw = ((payload as any)[key] ?? "").trim();
        if (raw) {
          try {
            const u = new URL(raw);
            if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s)");
            (payload as any)[key] = u.toString();
          } catch {
            throw new Error(
              key === "label_url"
                ? "Label link must be a full http:// or https:// URL"
                : "Product/manufacturer page must be a full http:// or https:// URL",
            );
          }
        } else {
          (payload as any)[key] = "";
        }
      }
      if (initial) return updateSavedChemical(initial.id, payload);
      return createSavedChemical(vineyardId, payload);
    },
    onSuccess: (saved: SavedChemical) => {
      toast({ title: initial ? "Chemical updated" : "Chemical created" });
      onSaved(saved);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const set = <K extends keyof SavedChemicalInput>(k: K, v: SavedChemicalInput[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const applySuggestion = (s: AppliedSuggestion) => {
    // ---- Upgraded resolver result. This branch is TERMINAL: once a
    // structured resolver result has been handled, no legacy AI/lookup
    // fallback below may run or overwrite a canonical field.
    //
    // Canonical fields come ONLY from the authoritative structured response;
    // `ai_suggestion` is never applied, and an unresolved rate / WHP / REI is
    // left blank rather than inherited from a legacy suggestion.
    if (s.resolved) {
      const r = s.resolved;
      if (!r.authoritative || !r.draft) {
        // Unresolved / ambiguous / AI-only: only the typed product name is
        // kept so the operator can enter the product manually.
        setForm((p) => ({ ...p, name: s.name ?? p.name ?? "" }));
        return;
      }
      setIntel(r.draft);
      setIntelBase(r.draft);
      setUpgraded(true);
      if (s.master) {
        setMasterLink({ id: s.master.id, revision: masterRevision(s.master) ?? null });
      }
      // LD-2 authoritative label rate. Only a single-value per-100 L or
      // per-hectare rate may fill the numeric field; ranges keep their min/max
      // (shown on the card) and basis "other" is reference text only.
      const rate = r.fields.ratePer100L ?? r.fields.ratePerHectare;
      setForm((p) => ({
        ...p,
        name: r.fields.name ?? s.name ?? p.name ?? "",
        use: r.fields.category ?? p.use ?? "",
        manufacturer: r.fields.registrant ?? p.manufacturer ?? "",
        active_ingredient: r.fields.activeIngredientText ?? p.active_ingredient ?? "",
        chemical_group: r.fields.chemicalGroupText ?? p.chemical_group ?? "",
        problem: r.fields.target ?? p.problem ?? "",
        unit: rate?.composedUnit ?? p.unit ?? "",
        label_url:
          r.fields.labelReference && /^https?:\/\//i.test(r.fields.labelReference)
            ? r.fields.labelReference
            : (p.label_url ?? ""),
      }));
      setRateStr(rate?.autoFillValue != null ? String(rate.autoFillValue) : "");
      // Label-backed only. When the structured response does not return a
      // WHP / REI with authoritative provenance the field is CLEARED, so a
      // stale or AI-sourced number can never survive an authoritative apply.
      setWhp(r.fields.withholdingDays != null ? String(r.fields.withholdingDays) : "");
      setRei(r.fields.reEntryHours != null ? String(r.fields.reEntryHours) : "");
      setRestNotes(r.fields.restrictions ?? "");
      return;

    }


    // ---- Master Catalogue result: copy the verified SQL 194 intelligence
    // verbatim and record the link + revision. It is never re-derived from
    // free text and never sent back through AI.
    if (s.master) {
      const draft = masterChemicalDraft(s.master);
      setIntel(draft);
      setIntelBase(draft);
      setUpgraded(true);
      setMasterLink({ id: s.master.id, revision: masterRevision(s.master) ?? null });
      setForm((p) => ({
        ...p,
        name: s.master!.registered_product_name?.trim() || s.name || p.name || "",
        manufacturer: s.master!.registrant ?? p.manufacturer ?? "",
        label_url:
          s.master!.label_reference && /^https?:\/\//i.test(s.master!.label_reference)
            ? s.master!.label_reference
            : (p.label_url ?? ""),
      }));
      return;
    }
    // Compose unit text from product type + chem unit + basis when AI gives
    // structured fields; fall back to whatever rate_unit string was returned.
    const basis = s.rate_basis ?? inferRateBasis(s.rate_unit);
    const productType = s.product_type ?? inferProductType(s.unit ?? s.rate_unit);
    const chemUnit = s.unit ?? (normaliseUnit(s.rate_unit) || defaultUnitFor(productType));
    const composed = s.rate_unit ?? composeUnit(chemUnit, basis);
    setForm((p) => ({
      ...p,
      name: s.name ?? p.name ?? "",
      active_ingredient: s.active_ingredient ?? p.active_ingredient ?? "",
      use: s.category ?? p.use ?? "",
      chemical_group: s.chemical_group ?? p.chemical_group ?? "",
      manufacturer: s.manufacturer ?? p.manufacturer ?? "",
      problem: s.target ?? p.problem ?? "",
      unit: composed,
      notes: s.notes ?? p.notes ?? "",
      label_url: s.label_url && /^https?:\/\//i.test(s.label_url) ? s.label_url : (p.label_url ?? ""),
      product_url: s.product_url && /^https?:\/\//i.test(s.product_url) ? s.product_url : (p.product_url ?? ""),
    }));
    // Seed structured chemistry from the AI suggestion. AI is never
    // authoritative: identity is recorded as ai_interpretation and only the
    // built-in FRAC/HRAC/IRAC table may supply an authoritative group.
    setIntel((prev) => {
      if (hasStructuredIntelligence(prev)) return prev;
      const actives = parseLegacyActiveIngredient(
        s.active_ingredient ?? form.active_ingredient ?? "",
        "ai_interpretation",
      ).map((a) => {
        const group = suggestActivityGroup(a.name);
        return group
          ? { ...a, activity_group: group, group_source: "authoritative_classification" as const }
          : a;
      });
      if (!actives.length) return prev;
      let sources = withSource(prev.sources, {
        kind: "ai_interpretation",
        name: "VineTrack AI chemical lookup",
        reference: s.label_url ?? undefined,
        retrieved_at: new Date().toISOString(),
      });
      if (actives.some((a) => a.group_source === "authoritative_classification")) {
        sources = withSource(sources, activityGroupReferenceSource());
      }
      // AI cannot certify registration identity or label evidence. Both stay
      // empty and are recorded as unresolved until a re-verify resolves the
      // actual registered product and its label.
      const unresolved = new Set(prev.unresolvedFields);
      unresolved.add("registration_number");
      unresolved.add("label_reference");
      return {
        ...prev,
        actives,
        sources,
        unresolvedFields: Array.from(unresolved),
        claimedStatus: "unverified",
      };

    });
    if (s.rate_per_ha != null) setRateStr(String(s.rate_per_ha));
    // WHP / REI are label facts. A legacy AI candidate is not label evidence,
    // so it may never populate them — they stay blank for manual entry.

  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[50%] sm:max-w-[50%] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit chemical" : "New chemical"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 text-sm">
          <ChemicalAILookup
            initialName={form.name ?? ""}
            country={currentCountry}
            existingLibrary={existingLibrary
              .filter((c) => !initial || c.id !== initial.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                active_ingredient: c.active_ingredient,
                registration_number: (c as { registration_number?: string | null }).registration_number,
              }))}
            onApply={applySuggestion}
          />
          {/* Jurisdiction suitability is computed, never stored. Chemistry is
              kept; only label authority changes. */}
          <JurisdictionNoticeBanner
            registrationCountry={intel.registration.country}
            vineyardCountry={currentCountry}
          />
          {masterLink && (
            <div
              className={`rounded-md border p-2 text-xs ${
                masterUpdate ? "border-warning/50 bg-warning/10" : "border-primary/30 bg-primary/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {masterUpdate
                    ? MASTER_UPDATE_MESSAGE
                    : masterJurisdiction === "compatible"
                    ? MASTER_CURRENT_MESSAGE
                    : `Current ${countryLabel(masterRow?.registration_country)} Master information`}
                </span>
                {masterUpdate && masterRow && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setMasterUpdateOpen(true)}>
                    Review update
                  </Button>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">
                Linked to the VineTrack Master Catalogue (revision {masterLink.revision ?? "—"}).
                Catalogue updates are only applied when you accept them.
              </p>
              {masterRow && masterJurisdiction === "mismatch" && (
                <p className="mt-1 text-muted-foreground">
                  This is the applicable registration for{" "}
                  {countryLabel(masterRow.registration_country)}, not for the current
                  vineyard ({countryLabel(currentCountry)}).
                </p>
              )}
            </div>
          )}

          {masterRow && (
            <MasterUpdateDialog
              open={masterUpdateOpen}
              onOpenChange={setMasterUpdateOpen}
              current={intel}
              master={masterRow}
              onAccept={(next, revision) => {
                setIntel(next);
                setIntelBase(next);
                setUpgraded(true);
                setMasterLink((prev) => (prev ? { ...prev, revision } : prev));
                toast({
                  title: "Verified update applied",
                  description: "Save the chemical to keep these changes.",
                });
              }}
            />
          )}
          <Field label="Product name *">
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Product type / category">
            <Select value={form.use ?? ""} onValueChange={(v) => set("use", v)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {PRODUCT_CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </Field>

          {/* Legacy authoritative chemistry is read-only: active ingredient and
              chemical group are derived from structured Chemical Intelligence. */}
          {(form.active_ingredient || form.chemical_group) && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-[11px]">
              <div className="font-medium text-xs">
                {showIntelEditor ? "Derived legacy fields (read-only)" : "Legacy record (read-only)"}
              </div>
              <div className="text-muted-foreground">
                Active ingredient: {form.active_ingredient || "—"}
              </div>
              <div className="text-muted-foreground">
                Chemical group: {form.chemical_group || "—"}
              </div>
              <p className="text-muted-foreground">
                {showIntelEditor
                  ? "These text fields are generated from the structured chemistry below and are kept for mobile compatibility."
                  : "This chemical has not been upgraded to structured Chemical Intelligence yet. The original text is preserved exactly until you upgrade it."}
              </p>
            </div>
          )}

          {!showIntelEditor && (
            <div className="rounded-md border border-border/60 p-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Upgrade this chemical to structured chemistry so resistance grouping,
                registered uses and verification work across the portal and mobile apps.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Seed the draft from the preserved legacy text as an
                    // operator interpretation — never as verified evidence.
                    setIntel((prev) => ({
                      ...prev,
                      actives: prev.actives.length
                        ? prev.actives
                        : parseLegacyActiveIngredient(form.active_ingredient ?? "", "legacy_record"),
                    }));
                    setUpgraded(true);
                  }}
                >
                  Upgrade to structured chemistry
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setUpgraded(true)}>
                  Start from scratch
                </Button>
              </div>
            </div>
          )}

          {showIntelEditor && (
            <ChemicalIntelligenceEditor
              draft={intel}
              onChange={setIntel}
              productName={form.name ?? ""}
              country={currentCountry}
            />
          )}

          <Field label="Supplier / manufacturer">
            <Input value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} />
          </Field>
          <Field label="Target pest / disease / weed (optional)">
            <Input
              value={form.problem ?? ""}
              onChange={(e) => set("problem", e.target.value)}
              placeholder="Leave blank for biostimulants / nutrition products"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Default rate">
              <Input type="number" inputMode="decimal" step="any" value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
            </Field>
            <Field label="Product type">
              <Select
                value={inferProductType(form.unit)}
                onValueChange={(v) => {
                  const pt = v as ProductType;
                  const basis = inferRateBasis(form.unit);
                  set("unit", composeUnit(defaultUnitFor(pt), basis));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Liquid / Solid" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="liquid">{PRODUCT_TYPE_LABEL.liquid}</SelectItem>
                  <SelectItem value="solid">{PRODUCT_TYPE_LABEL.solid}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Unit">
              <Select
                value={(normaliseUnit(form.unit) as ChemUnit) || defaultUnitFor(inferProductType(form.unit))}
                onValueChange={(v) => {
                  const basis = inferRateBasis(form.unit);
                  set("unit", composeUnit(v, basis));
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {unitsFor(inferProductType(form.unit)).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Rate basis">
            <RadioGroup
              className="flex gap-6"
              value={inferRateBasis(form.unit)}
              onValueChange={(v) => {
                const basis = v as RateBasis;
                const cu = chemUnitOnly(form.unit ?? "") || "L";
                set("unit", composeUnit(cu, basis));
              }}
            >
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="per_hectare" /> {RATE_BASIS_LABEL.per_hectare}
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="per_100L" /> {RATE_BASIS_LABEL.per_100L}
              </label>
            </RadioGroup>
            <p className="text-[11px] text-muted-foreground mt-1">
              Choose whether this product rate is applied by area or by spray volume.
            </p>
          </Field>
          {canSeeCosts && (
            <div className="rounded-md border border-border/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Pricing</h4>
                {existingCost != null && computedCost == null && (
                  <span className="text-[11px] text-muted-foreground">
                    Saved: {fmtMoney(existingCost, currency)} / {packUnit}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter the pack size and pack price. VineTrack will calculate the cost per L, mL, kg or g for costing.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Pack / container size">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={packSizeStr}
                    onChange={(e) => setPackSizeStr(e.target.value)}
                    placeholder="e.g. 20"
                  />
                </Field>
                <Field label="Pack unit">
                  <Select value={packUnit} onValueChange={setPackUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Litres">Litres</SelectItem>
                      <SelectItem value="mL">mL</SelectItem>
                      <SelectItem value="Kg">Kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Pack price">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={packPriceStr}
                    onChange={(e) => setPackPriceStr(e.target.value)}
                    placeholder="e.g. 180.00"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr),120px] gap-3 items-end">
                <Field label="Calculated cost per unit">
                  <div className="vt-field flex w-full items-center px-3.5 py-2 text-sm bg-muted/40 text-muted-foreground">
                    {computedCost != null
                      ? `${fmtMoney(computedCost, currency)} / ${packUnit}`
                      : existingCost != null
                        ? `${fmtMoney(existingCost, currency)} / ${packUnit} (saved)`
                        : "—"}
                  </div>
                </Field>
                <Field label="Currency">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="NZD">NZD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Withholding period (days)">
              <Input type="number" inputMode="decimal" step="any" value={whp} onChange={(e) => setWhp(e.target.value)} />
            </Field>
            <Field label="Re-entry period (hours)">
              <Input type="number" inputMode="decimal" step="any" value={rei} onChange={(e) => setRei(e.target.value)} />
            </Field>
          </div>
          <Field label="Other restrictions / safety notes">
            <Textarea rows={2} value={restNotes} onChange={(e) => setRestNotes(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <Field label="Label URL (official label PDF or regulator page)">
            <Input
              type="url"
              inputMode="url"
              value={form.label_url ?? ""}
              onChange={(e) => set("label_url", e.target.value)}
              placeholder="https://…/label.pdf"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Label URL should be the official label PDF or regulator label page (e.g. APVMA). Must start with https:// or http://.
            </p>
            {form.label_url && /^https?:\/\//i.test(form.label_url.trim()) && (
              <a
                href={form.label_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
              >
                <FileText className="h-3 w-3" />
                Open label
              </a>
            )}
          </Field>
          <Field label="Product / Manufacturer page (optional)">
            <Input
              type="url"
              inputMode="url"
              value={form.product_url ?? ""}
              onChange={(e) => set("product_url", e.target.value)}
              placeholder="https://… (manufacturer/brand page)"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Optional link to the manufacturer or distributor product page. This is <strong>not</strong> the official label and will be displayed separately as "Product page".
            </p>
            {form.product_url && /^https?:\/\//i.test(form.product_url.trim()) && (
              <a
                href={form.product_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline mt-1"
              >
                <Globe className="h-3 w-3" />
                Open product page
              </a>
            )}
          </Field>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Saving…" : initial ? "Save changes" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
