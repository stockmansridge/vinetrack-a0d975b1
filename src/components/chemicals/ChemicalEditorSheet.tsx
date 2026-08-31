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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GrapevineUsesCard } from "@/components/chemicals/GrapevineUsesCard";
import {
  DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE,
  NO_GRAPEVINE_REGISTRATION_MESSAGE,
  RATE_CONFIRMATION_REQUIRED_MESSAGE,
  defaultRateStillSupported,
  grapevineOnlyDraft,
  hasConfirmedRate,
  hasGrapevineRegistration,
  lookupSaveBlocked,
} from "@/lib/chemicalVineyardScope";

import { DefaultRatesCard } from "@/components/chemicals/DefaultRatesCard";
import type {
  CanonicalDefaultRateOption,
  CanonicalRateBasis,
} from "@/lib/chemicalDefaultRatesContract";
import {
  PRODUCT_CHANGED_MESSAGE,
  matchDefaultRateSlots,
} from "@/lib/chemicalDefaultRateSelection";
import {
  applyAuthoritativeChemistry,
  applyReplacedChemistry,
  clearDefaultRate,
  hydrateDefaultRateLifecycle,
  invalidateCanonicalOptions,
  newDefaultRateLifecycle,
  selectDefaultRate,
  selectVineyardDose,
  type DefaultRateLifecycleState,
} from "@/lib/chemicalDefaultRateLifecycle";


import {
  MANUFACTURER_LABEL_UNRESOLVED,
  resolveChemicalLabelLinks,
} from "@/lib/chemicalLabelLinks";
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
import { parseRestrictions, composeRestrictions } from "@/lib/chemicalCategories";
import {
  PRODUCT_CATEGORIES,
  matchProductCategoryKey,
  productCategoryLabel,
} from "@/lib/chemicalProductCategory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Archive, RotateCcw, Check, ChevronsUpDown, ExternalLink, FileText, Globe, Trash2, Info } from "lucide-react";
import { toChemicalIntelligence, UNRESOLVED_FIELDS_CUSTOMER_MESSAGE } from "@/lib/chemicalIntelligence";
import { VerificationBadge, ActivityGroupSummary } from "@/components/chemicals/ChemicalIntelligenceBadges";
import { ChemicalIntelligenceDialog } from "@/components/chemicals/ChemicalIntelligenceDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  ChemicalAILookup,
  type AppliedSuggestion,
  type ChemicalSelectionMode,
} from "@/components/spray/ChemicalAILookup";
import {
  PHYSICAL_FORM_LABEL,
  formFromInventoryUnit,
  inventoryUnitForForm,
  packUnitForForm,
  type PhysicalForm,
} from "@/lib/chemicalPhysicalForm";
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
  name: "", product_category: "",
  active_ingredient: "", chemical_group: "", use: "",
  manufacturer: "", crop: "", problem: "", rate_per_ha: null, unit: "",
  restrictions: "", notes: "", label_url: "", product_url: "",
};

export function ChemicalEditor({
  open, onOpenChange, initial, vineyardId, existingLibrary, canSeeCosts, onSaved,
  initialName, jurisdiction,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: SavedChemical | null;
  vineyardId: string;
  existingLibrary: Array<Pick<SavedChemical, "id" | "name" | "active_ingredient">>;
  canSeeCosts: boolean;
  /** Optional starting product name (new chemicals only). Never a verified identity. */
  initialName?: string | null;
  /**
   * Vineyard state / territory (e.g. "NSW") used ONLY to narrow a
   * state-conditional label rate. The portal has no authoritative state field
   * today, so this is normally undefined and the conservative rules apply.
   */
  jurisdiction?: string | null;
  /** Receives the persisted Saved Chemical row so callers can bind by identity. */
  onSaved: (saved: SavedChemical) => void;
}) {
  const { toast } = useToast();
  const { currentCountry } = useVineyard();

  const [form, setForm] = useState<SavedChemicalInput>(EMPTY);
  const [rateStr, setRateStr] = useState("");
  const [packSizeStr, setPackSizeStr] = useState("");
  const [packPriceStr, setPackPriceStr] = useState("");
  // PART 6 — pack unit is only an editable suggestion derived from the
  // authoritative physical form. The legacy "Litres" default must never leak
  // into a solid or unknown-form chemical.
  const [packUnit, setPackUnit] = useState<string>("");
  // PART 5 — authoritative physical form. NEVER inferred from a concentration
  // unit, an application-rate unit, a rate basis or a spray-water volume.
  const [physicalForm, setPhysicalForm] = useState<PhysicalForm>("unknown");
  // PART 8 — the authoritative WHP wording, preserved verbatim. A numeric
  // projection may exist alongside it but never replaces the legal meaning.
  const [whpLegalText, setWhpLegalText] = useState<string>("");
  // PART 11 — the specific unresolved items from the structured response.
  const [unresolvedItems, setUnresolvedItems] = useState<string[]>([]);
  /**
   * PART 3/4 — the product editor stays hidden until the operator selects a
   * registered candidate or explicitly chooses manual entry. Editing an
   * existing saved chemical always starts unlocked.
   */
  const [selectionMode, setSelectionMode] = useState<ChemicalSelectionMode>("none");
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
  // Manufacturer's own label URL from the lookup. Never the regulator label.
  const [manufacturerLabelUrl, setManufacturerLabelUrl] = useState<string | undefined>();
  // ---- SQL 214 / D3 persisted operator default rates (Gates D4B-P2B / P2B.1).
  // ALL transitions live in the pure lifecycle module: two independent basis
  // slots, the omit-vs-write dirty gate, the canonical-option lifetime rule and
  // the product-ownership clearing rule. Never inferred from rate_per_ha, never
  // derived from the local display-only buildDefaultRateOptions().
  const [rateLife, setRateLife] = useState<DefaultRateLifecycleState>(
    newDefaultRateLifecycle(),
  );
  const { defaultRates, canonicalOptions: canonicalRateOptions } = rateLife;
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
        // Category authority is the raw shared key; a legacy row falls back to
        // its `use` wording only until the operator deliberately saves.
        const categoryKey =
          matchProductCategoryKey(initial.product_category) ??
          matchProductCategoryKey(initial.use) ??
          "";
        const useVal = productCategoryLabel(categoryKey) ?? (initial.use ?? "");
        setForm({
          name: initial.name ?? "",
          product_category: categoryKey,
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
        // No legacy "Litres" fallback: an unknown-form product keeps it unset.
        setPackUnit(displayBaseUnit(initial.purchase?.unit ?? initial.unit) || "");
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
        // Persisted defaults come ONLY from the stored contract. There is no
        // automatic lookup on reopen, so canonical options stay unavailable and
        // the saved snapshot is displayed from itself.
        setSelectionMode("existing");
        setWhpLegalText("");
        setUnresolvedItems([]);
        setPhysicalForm(formFromInventoryUnit(normaliseUnit((initial as any).unit)));
        setRateLife(
          hydrateDefaultRateLifecycle({
            storedDefaultRates: (initial as any).default_rates,
            productIdentity: draftRateProductIdentity(hydrated),
            labelVersion: hydrated.registration?.label_version ?? null,
          }),
        );
      } else {

        setForm({ ...EMPTY, name: initialName?.trim() ? initialName.trim() : "" });
        setRateStr("");
        setExistingCost(null);
        setPackSizeStr("");
        setPackPriceStr("");
        setPackUnit("");
        setPhysicalForm("unknown");
        setSelectionMode("none");
        setWhpLegalText("");
        setUnresolvedItems([]);
        setCurrency("AUD");
        setWhp("");
        setRei("");
        setRestNotes("");
        setIntel(emptyDraft());
        setIntelBase(emptyDraft());
        setUpgraded(false);
        setMasterLink(null);
        setRateLife(newDefaultRateLifecycle());

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
      // Vineyard scope: only grapevine registered uses are ever persisted.
      // Other-crop directions are dropped whole, never merged or rewritten.
      const encoded = encodeChemicalIntelligenceForWrite(grapevineOnlyDraft(reconciled));
      // Category: the RAW shared key is the stored authority; `use` carries the
      // display label as a compatibility projection only.
      const categoryKey = matchProductCategoryKey(form.product_category);
      const payload: SavedChemicalInput = {
        ...form,
        product_category: categoryKey,
        use: categoryKey ? productCategoryLabel(categoryKey) : (form.use ?? ""),
        intelligence: encoded,
        master_chemical_id: masterLink?.id ?? null,
        master_source_revision: masterLink?.revision ?? null,
        rate_per_ha: rateNum,
        restrictions,
        // Omit-vs-write (§14): omitted while clean so an unrelated edit cannot
        // wipe the persisted default; when dirty the FULL version-1 object is
        // written, including explicit null slots. Never set to null just
        // because both slots are null.
        ...(rateLife.dirty
          ? {
              default_rates: {
                version: 1 as const,
                per_hectare: defaultRates.per_hectare,
                per_100_litres: defaultRates.per_100_litres,
              },
            }
          : {}),

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
      // ---- Default rates (Gate D4B-P2B).
      // Canonical options come ONLY from the backend `default_rate_options`
      // block. The local display-only buildDefaultRateOptions() may never stand
      // in for it, and a lookup by itself NEVER changes default_rates.
      const nextIdentity = r.fields.registrationNumber
        ? {
            country: r.fields.registrationCountry ?? null,
            scheme: r.fields.registrationScheme ?? null,
            number: r.fields.registrationNumber ?? null,
          }
        : null;
      // A persisted default cites this product's rate_v1 identities. Clear both
      // slots only when BOTH registrations are known and actually differ; a
      // label revision change is NOT a product change. This applies to NEW
      // chemicals too (P2B.1 §1): product A's default may never survive a
      // subsequent authoritative lookup of product B.
      // Canonical options live only for the lookup that supplied them
      // (P2B.1 §2/§6): an authoritative apply with no option block makes the
      // previous options unavailable while the persisted selection and dirty
      // flag stay untouched. Product-ownership clearing applies to NEW
      // chemicals too (§1): product A's default may not survive a later
      // authoritative lookup of product B.
      setRateLife((prev) =>
        applyAuthoritativeChemistry(prev, {
          productIdentity: nextIdentity,
          options: r.defaultRateOptions ?? null,
          labelVersion: r.fields.labelVersion ?? null,
        }),
      );
      // PART 5/6 — honour the authoritative `form_type` verbatim and derive
      // only the INVENTORY unit default from it. Unknown stays unset.
      const authForm = r.fields.physicalForm;
      setPhysicalForm(authForm);
      const inventory = inventoryUnitForForm(authForm);
      const pack = packUnitForForm(authForm);
      setPackUnit(pack ?? "");
      setManufacturerLabelUrl(r.fields.manufacturerLabelUrl);
      setForm((p) => ({
        ...p,
        name: r.fields.name ?? s.name ?? p.name ?? "",
        product_category:
          matchProductCategoryKey(r.fields.category) ?? p.product_category ?? "",
        use:
          productCategoryLabel(matchProductCategoryKey(r.fields.category)) ??
          r.fields.category ??
          p.use ??
          "",
        manufacturer: r.fields.registrant ?? p.manufacturer ?? "",
        active_ingredient: r.fields.activeIngredientText ?? p.active_ingredient ?? "",
        chemical_group: r.fields.chemicalGroupText ?? p.chemical_group ?? "",
        problem: r.fields.target ?? p.problem ?? "",
        // §13: a canonical/recommended option never projects into the legacy
        // rate value. The unit here is the INVENTORY unit implied by the
        // authoritative physical form only — never by a rate unit.
        unit: inventory ? composeUnit(inventory, inferRateBasis(p.unit)) : "",
        label_url:
          r.fields.regulatorLabelUrl ??
          (r.fields.labelReference && /^https?:\/\//i.test(r.fields.labelReference)
            ? r.fields.labelReference
            : (p.label_url ?? "")),
        // The manufacturer's own product page — never the regulator URL.
        product_url: r.fields.manufacturerProductUrl ?? p.product_url ?? "",
      }));


      // Label-backed only. When the structured response does not return a
      // WHP / REI with authoritative provenance the field is CLEARED, so a
      // stale or AI-sourced number can never survive an authoritative apply.
      setWhp(r.fields.withholdingDays != null ? String(r.fields.withholdingDays) : "");
      setRei(r.fields.reEntryHours != null ? String(r.fields.reEntryHours) : "");
      setWhpLegalText(r.fields.withholdingText ?? "");
      setUnresolvedItems(r.unresolvedFields ?? []);
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
      // P2B.1 §5 — applying another Master product replaces the chemistry, so
      // options from an earlier authoritative lookup are no longer current.
      // Canonical options are NEVER manufactured from Master data.
      setRateLife((prev) =>
        applyReplacedChemistry(prev, {
          productIdentity: draftRateProductIdentity(draft),
        }),
      );
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
      product_category: matchProductCategoryKey(s.category) ?? p.product_category ?? "",
      use:
        productCategoryLabel(matchProductCategoryKey(s.category)) ??
        s.category ??
        p.use ??
        "",
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

  const structuredUses = intel.registeredUses.length > 0;
  // Per-basis match state of the persisted selection against the canonical set.
  const defaultRateSlots = useMemo(
    () => matchDefaultRateSlots(defaultRates, canonicalRateOptions),
    [defaultRates, canonicalRateOptions],
  );
  /**
   * A saved default only survives a label change while every rate identity it
   * cites is still on the label. When one disappears the operator must confirm
   * a replacement (or clear the slot) before the chemical can be saved — the
   * portal never silently re-points a default at a different rate.
   */
  const staleDefaultRate =
    structuredUses && !defaultRateStillSupported(defaultRates, intel.registeredUses);

  // Release contract §4 — a NEW chemical selected through registered/master
  // lookup may only be saved with a registered grapevine use AND an explicitly
  // confirmed operational rate. The gate applies to the LOOKUP MODE, never to
  // whether uses were extracted: a lookup returning zero uses is still gated.
  // Manual entry stays exempt; existing records are never stranded.
  const lookupSelected = selectionMode === "registered" || selectionMode === "master";
  const grapevineRegistered = hasGrapevineRegistration(intel.registeredUses);
  const noGrapevineRegistration = !initial && lookupSelected && !grapevineRegistered;
  const firstAddBlocked = lookupSaveBlocked({
    isExistingRecord: !!initial,
    selectionMode,
    uses: intel.registeredUses,
    defaults: defaultRates,
    staleDefaultRate,
  });
  const saveBlocked = staleDefaultRate || firstAddBlocked;


  /** Operator click: copy the backend option and stamp provenance. */
  const handleSelectDefaultRate = (
    option: CanonicalDefaultRateOption,
    basis: CanonicalRateBasis,
  ) => {
    const selectedAt = new Date().toISOString();
    setRateLife((prev) => selectDefaultRate(prev, option, basis, selectedAt));
  };

  const handleSelectVineyardDose = (
    option: CanonicalDefaultRateOption,
    basis: CanonicalRateBasis,
    value: number,
  ) =>
    setRateLife((prev) =>
      selectVineyardDose(prev, option, basis, value, new Date().toISOString()),
    );

  const handleClearDefaultRate = (basis: CanonicalRateBasis) =>
    setRateLife((prev) => clearDefaultRate(prev, basis));

  /**
   * Manual intelligence edits (§16). Canonical options belong to one
   * authoritative lookup response: if registered uses or registration identity
   * are hand-edited afterwards, only the IN-MEMORY option set is invalidated.
   * Persisted defaults are never wiped here.
   */
  const handleIntelChange = (next: ChemicalIntelligenceDraft) => {
    const identityChanged =
      intel.registration.number !== next.registration.number ||
      intel.registration.country !== next.registration.country ||
      intel.registration.scheme !== next.registration.scheme;
    const usesChanged = intel.registeredUses !== next.registeredUses;
    if (identityChanged || usesChanged) setRateLife(invalidateCanonicalOptions);
    setIntel(next);
  };



  /**
   * PART 3/4 — SEARCH state gate. "Change product" (mode → "none") returns to
   * candidate selection and clears the previous authoritative identity so a
   * product A result can never bleed into a product B review.
   */
  const editorUnlocked = selectionMode !== "none";
  const handleSelectionChange = (mode: ChemicalSelectionMode) => {
    setSelectionMode((prev) => {
      if (prev === mode) return prev;
      if (mode === "none" && !initial) {
        setForm({ ...EMPTY });
        setIntel(emptyDraft());
        setIntelBase(emptyDraft());
        setUpgraded(false);
        setMasterLink(null);
        setManufacturerLabelUrl(undefined);
        setPhysicalForm("unknown");
        setPackUnit("");
        setRateStr("");
        setWhp("");
        setRei("");
        setWhpLegalText("");
        setRestNotes("");
        setUnresolvedItems([]);
        setRateLife(newDefaultRateLifecycle());
      }
      return mode;
    });
  };

  const labelLinks = resolveChemicalLabelLinks({
    sources: intel.sources,
    labelReference: intel.registration.label_reference,
    labelUrl: form.label_url,
    manufacturerLabelUrl,

    productUrl: form.product_url,
  });

  const lookupBlock = (
    <>
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
        onSelectionChange={handleSelectionChange}
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
            // P2B.1 §4 — an accepted Master update can change registered uses,
            // identity or label revision: invalidate the in-memory options and
            // require a fresh authoritative lookup. Defaults are preserved
            // unless the registered product is provably different.
            setRateLife((prev) =>
              applyReplacedChemistry(prev, {
                productIdentity: draftRateProductIdentity(next),
              }),
            );
            toast({
              title: "Verified update applied",
              description: "Save the chemical to keep these changes.",
            });
          }}
        />
      )}
    </>
  );

  /* Legacy product-level rate editor. Only part of the normal workflow when
     there are no structured registered uses to act as the operational source;
     otherwise it lives under Advanced for mobile compatibility. */
  const legacyRateBlock = (
    <div className="space-y-3">
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
      </Field>
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
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 flex flex-col w-[92vw] max-w-[1200px] sm:max-w-[1200px] max-h-[89vh] overflow-hidden"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3 text-left">
          <DialogTitle>{initial ? "Edit chemical" : "New chemical"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {lookupBlock}

          {!editorUnlocked && (
            <p className="text-xs text-muted-foreground">
              Search for the registered product and choose it from the results, or choose
              “Enter manually”. Nothing has failed — the product details appear once an
              identity is chosen.
            </p>
          )}

          {editorUnlocked && (
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* ------------------------------------------- primary column */}
            <div className="space-y-4">
              <Section title="Product">
                <Field label="Chemical / product name *">
                  <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Registration number">
                    <Input
                      value={intel.registration.number ?? ""}
                      placeholder="Not stated"
                      // P2B.1 §3 — goes through the shared invalidation
                      // boundary so a hand-edited registration number cannot
                      // leave stale canonical options selectable.
                      onChange={(e) =>
                        handleIntelChange({
                          ...intel,
                          registration: { ...intel.registration, number: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="Category">
                    {/* The raw shared key is what is persisted; `use` is only
                        the display projection written alongside it. */}
                    <Select
                      value={form.product_category ?? ""}
                      onValueChange={(v) =>
                        setForm((p) => ({
                          ...p,
                          product_category: v,
                          use: productCategoryLabel(v) ?? p.use ?? "",
                        }))
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {PRODUCT_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* PART 5 — physical form is the authoritative form_type,
                      or Unknown. It is never inferred from a unit or rate. */}
                  <Field label="Product form">
                    <Select
                      value={physicalForm}
                      onValueChange={(v) => {
                        const next = v as PhysicalForm;
                        setPhysicalForm(next);
                        const inventory = inventoryUnitForForm(next);
                        set("unit", inventory ? composeUnit(inventory, inferRateBasis(form.unit)) : "");
                        setPackUnit(packUnitForForm(next) ?? "");
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder={PHYSICAL_FORM_LABEL.unknown} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="liquid">{PHYSICAL_FORM_LABEL.liquid}</SelectItem>
                        <SelectItem value="solid">{PHYSICAL_FORM_LABEL.solid}</SelectItem>
                        <SelectItem value="unknown">{PHYSICAL_FORM_LABEL.unknown}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {/* PART 6 — inventory / product unit, separate from pack,
                      concentration and application-rate units. */}
                  <Field label="Inventory unit">
                    <Select
                      value={(normaliseUnit(form.unit) as ChemUnit) || ""}
                      onValueChange={(v) => set("unit", composeUnit(v, inferRateBasis(form.unit)))}
                      disabled={physicalForm === "unknown" && !normaliseUnit(form.unit)}
                    >
                      <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        {unitsFor(physicalForm === "solid" ? "solid" : "liquid").map((u) => (
                          <SelectItem key={u} value={u}>{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Manufacturer / registrant">
                  <Input value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} />
                </Field>
              </Section>

              <Section title="Active ingredients & resistance">
                {showIntelEditor ? (
                  <ChemicalIntelligenceEditor
                    draft={intel}
                    onChange={handleIntelChange}
                    productName={form.name ?? ""}
                    country={currentCountry}
                    compact
                    sections={{ actives: true, registration: false, uses: false, sources: false, audit: false }}
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      This chemical has not been upgraded to structured chemistry yet. The original
                      text is preserved exactly until you upgrade it.
                    </p>
                    <div className="text-xs text-muted-foreground">
                      Active ingredient: {form.active_ingredient || "Not stated"}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
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
              </Section>

              <Section title="Labels & references">
                <div className="flex flex-wrap gap-2">
                  {labelLinks.manufacturerLabelUrl ? (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={labelLinks.manufacturerLabelUrl} target="_blank" rel="noopener noreferrer">
                        <FileText className="h-3.5 w-3.5" /> {OPEN_MANUFACTURER_LABEL}
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[11px]">
                      {MANUFACTURER_LABEL_UNRESOLVED}
                    </Badge>
                  )}
                  {labelLinks.regulatorLabelUrl && (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={labelLinks.regulatorLabelUrl} target="_blank" rel="noopener noreferrer">
                        <FileText className="h-3.5 w-3.5" /> {OPEN_REGULATOR_LABEL}
                      </a>
                    </Button>
                  )}
                  {labelLinks.registrationSourceUrl && (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={labelLinks.registrationSourceUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> {OPEN_REGISTRATION_SOURCE}
                      </a>
                    </Button>
                  )}
                  {labelLinks.productUrl && (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={labelLinks.productUrl} target="_blank" rel="noopener noreferrer">
                        <Globe className="h-3.5 w-3.5" /> {OPEN_PRODUCT_PAGE}
                      </a>
                    </Button>
                  )}
                </div>
                <Field label="Regulator label link">
                  <Input
                    type="url"
                    inputMode="url"
                    value={form.label_url ?? ""}
                    onChange={(e) => set("label_url", e.target.value)}
                    placeholder="https://…/label.pdf"
                  />
                </Field>
                <Field label="Product / manufacturer page (optional)">
                  <Input
                    type="url"
                    inputMode="url"
                    value={form.product_url ?? ""}
                    onChange={(e) => set("product_url", e.target.value)}
                    placeholder="https://… (manufacturer/brand page)"
                  />
                </Field>
              </Section>
            </div>

            {/* --------------------------------------- operational column */}
            <div className="space-y-4">
              {structuredUses && (
                <Section title="Default rate">
                  {rateLife.productChangedNotice && (
                    <p className="mb-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-[11px]">
                      {PRODUCT_CHANGED_MESSAGE}
                    </p>
                  )}
                  {staleDefaultRate && (
                    <p
                      className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px]"
                      role="alert"
                    >
                      {DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE}
                    </p>
                  )}
                  {hasGrapevineRegistration(intel.registeredUses) &&
                    !hasConfirmedRate(defaultRates) && (
                      <p className="mb-2 rounded-md border border-border/60 bg-muted/40 p-2 text-[11px]">
                        {RATE_CONFIRMATION_REQUIRED_MESSAGE}
                      </p>
                    )}
                  {/* Operator-owned shared default_rates contract. The legacy
                      numeric rate editor lives under Advanced (mobile
                      compatibility) and is never written from here. */}
                  <DefaultRatesCard
                    options={canonicalRateOptions}
                    slots={defaultRateSlots}
                    onSelect={handleSelectDefaultRate}
                    onSelectDose={handleSelectVineyardDose}
                    onClear={handleClearDefaultRate}
                  />
                </Section>
              )}

              <Section title="Grapevine uses & rates">
                {/* Vineyard-first: other crops on the label are not part of the
                    normal add flow and are never shown here. */}
                {structuredUses || lookupSelected ? (
                  <>
                    {!grapevineRegistered && (
                      <div
                        className="mb-2 space-y-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-[11px]"
                        role="alert"
                      >
                        <p>{NO_GRAPEVINE_REGISTRATION_MESSAGE}</p>
                        {noGrapevineRegistration && (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleSelectionChange("none")}
                            >
                              Change product
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => onOpenChange(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    <GrapevineUsesCard uses={intel.registeredUses} />
                  </>
                ) : (
                  legacyRateBlock
                )}
              </Section>

              {(whpLegalText || rei || unresolvedItems.length > 0) && (
                <Section title="Withholding & re-entry">
                  {/* PART 8 — legal wording wins over any numeric projection. */}
                  <div className="text-xs">
                    <span className="text-muted-foreground">Withholding period: </span>
                    {whpLegalText ? (
                      <span>{whpLegalText}</span>
                    ) : whp ? (
                      <span>{whp} days</span>
                    ) : (
                      <span className="italic text-muted-foreground">Not resolved</span>
                    )}
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Re-entry period: </span>
                    {rei ? (
                      <span>{rei} hours</span>
                    ) : (
                      <span className="italic text-muted-foreground">Not resolved</span>
                    )}
                  </div>
                  {unresolvedItems.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {UNRESOLVED_FIELDS_CUSTOMER_MESSAGE}
                    </p>
                  )}
                </Section>
              )}

              {canSeeCosts && (
                <Collapsible defaultOpen>

                  <div className="rounded-md border border-border/60">
                    <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold">
                      <span>Purchase &amp; pricing</span>
                      <span className="text-[11px] font-normal text-muted-foreground">Optional</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 px-3 pb-3">
                      {existingCost != null && computedCost == null && (
                        <p className="text-[11px] text-muted-foreground">
                          Saved: {fmtMoney(existingCost, currency)} / {packUnit}
                        </p>
                      )}
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
                            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
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
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}

              <Section title="Notes">
                <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
              </Section>
            </div>
          </div>
          )}

          {/* --------------------------------- advanced / verification */}
          {editorUnlocked && (
          <Collapsible>
            <div className="rounded-md border border-border/60">
              <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold">
                <span>Advanced / verification details</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 px-3 pb-3">
                <p className="text-[11px] text-muted-foreground">
                  Registration identity, all registered uses, evidence sources and the derived
                  legacy fields kept for the mobile apps. Nothing here is discarded — it is simply
                  outside the normal vineyard workflow.
                </p>

                {(form.active_ingredient || form.chemical_group) && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-[11px]">
                    <div className="font-medium text-xs">Derived legacy fields (read-only)</div>
                    <div className="text-muted-foreground">
                      Active ingredient: {form.active_ingredient || "Not stated"}
                    </div>
                    <div className="text-muted-foreground">
                      Chemical group: {form.chemical_group || "Not stated"}
                    </div>
                    <p className="text-muted-foreground">
                      Generated from the structured chemistry and kept for mobile compatibility.
                    </p>
                  </div>
                )}

                {unresolvedItems.length > 0 && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-[11px]">
                    <div className="font-medium text-xs">Label details not resolved</div>
                    <div className="text-muted-foreground">{unresolvedItems.join(", ")}</div>
                  </div>
                )}

                {structuredUses && legacyRateBlock}

                {showIntelEditor && (
                  <ChemicalIntelligenceEditor
                    draft={intel}
                    onChange={handleIntelChange}
                    productName={form.name ?? ""}
                    country={currentCountry}
                    sections={{ actives: false }}
                  />
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-3 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {editorUnlocked && (
            <Button
              disabled={saveMut.isPending || saveBlocked}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? "Saving…" : "Save chemical"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </div>
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

/**
 * Registered-product identity of a draft, or null when not fully stated.
 * Module scope on purpose: it is used during the first render pass, so a
 * component-scoped const would be read before initialisation.
 */
function draftRateProductIdentity(d: ChemicalIntelligenceDraft) {
  return d.registration.number
    ? {
        country: d.registration.country ?? null,
        scheme: d.registration.scheme ?? null,
        number: d.registration.number ?? null,
      }
    : null;
}
