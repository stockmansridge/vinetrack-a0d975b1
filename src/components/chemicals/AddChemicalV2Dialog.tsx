// Chemical Search V2 — Add Chemical (vineyard Chemical Store).
//
// Fast, simple, minimal clicks: Search → Select → Save. Presentation only —
// every rule lives in `@/lib/chemicalSearchV2`, `@/lib/chemicalManualRate` and
// `@/lib/chemicalManualEntry`. Master records are never modified here.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ManualRateEditor } from "@/components/chemicals/ManualRateEditor";
import {
  emptyManualRateDraft,
  validateManualRate,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";
import { MANUAL_ENTRY_HELPER, MANUAL_PROVENANCE_BADGE } from "@/lib/chemicalManualEntry";
import {
  masterRateSummary,
  MASTER_RATE_BASIS_LABEL,
  type MasterViticultureRate,
} from "@/lib/masterCuration";
import {
  DUPLICATE_MESSAGE,
  ONLINE_FALLBACK_LABEL,
  buildManualSavedChemicalInput,
  buildMasterSavedChemicalInput,
  findVineyardDuplicate,
  hasAnyDefaultRate,
  initialiseDefaultRatesFromMaster,
  lookupChemicalLabelOnline,
  persistedDefaultRates,
  searchMasterChemicalsV2,
  selectionFromMasterRate,
  selectionSummary,
  type MasterSearchHit,
  type OnlineLookupResult,
  type V2OptionalDetails,
} from "@/lib/chemicalSearchV2";
import type {
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
} from "@/lib/chemicalDefaultRatesContract";
import {
  createSavedChemical,
  type SavedChemical,
} from "@/lib/savedChemicalsQuery";
import { PRODUCT_CATEGORIES } from "@/lib/chemicalProductCategory";

const BASES: CanonicalRateBasis[] = ["per_hectare", "per_100_litres"];
const BASIS_LABEL: Record<CanonicalRateBasis, string> = {
  per_hectare: MASTER_RATE_BASIS_LABEL.per_hectare,
  per_100_litres: MASTER_RATE_BASIS_LABEL.per_100_litres,
};

type Step = "search" | "master" | "manual";

export function AddChemicalV2Dialog({
  open,
  onOpenChange,
  vineyardId,
  country,
  existingLibrary,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vineyardId: string;
  country?: string | null;
  existingLibrary: readonly SavedChemical[];
  onSaved: (created: SavedChemical) => void;
  onOpenExisting?: (chemical: SavedChemical) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("search");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hit, setHit] = useState<MasterSearchHit | null>(null);
  const [online, setOnline] = useState<OnlineLookupResult | null>(null);
  const [selections, setSelections] = useState<
    Record<CanonicalRateBasis, PersistedDefaultRateSelection | null>
  >({ per_hectare: null, per_100_litres: null });
  const [manualName, setManualName] = useState("");
  const [rateDraft, setRateDraft] = useState<ManualRateDraft>({ ...emptyManualRateDraft(), open: true });
  const [details, setDetails] = useState<V2OptionalDetails>({});
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<{ chemical: SavedChemical; message: string } | null>(null);

  useEffect(() => {
    if (open) return;
    setStep("search");
    setSearch("");
    setDebounced("");
    setHit(null);
    setOnline(null);
    setSelections({ per_hectare: null, per_100_litres: null });
    setManualName("");
    setRateDraft({ ...emptyManualRateDraft(), open: true });
    setDetails({});
    setOptionalOpen(false);
    setDuplicate(null);
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const results = useQuery({
    queryKey: ["master-search-v2", debounced, country ?? null],
    enabled: open && step === "search" && debounced.trim().length >= 2,
    queryFn: () => searchMasterChemicalsV2(debounced, { country }),
  });

  const onlineLookup = useMutation({
    mutationFn: () => lookupChemicalLabelOnline(search, String(country ?? "")),
    onSuccess: (result) => {
      if (!result) {
        toast({ title: "No product details found online", variant: "destructive" });
        return;
      }
      setOnline(result);
      setHit(null);
      setManualName(result.productName);
      setDetails({
        manufacturer: result.registrant,
        registrationNumber: result.registrationNumber,
        productCategory: result.category,
        activeIngredient: result.activeIngredients,
        labelUrl: result.labelUrl,
        productUrl: result.productUrl,
      });
      setStep("manual");
    },
    onError: (e: any) =>
      toast({ title: "Online label search failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const ambiguous = useMemo(
    () => (hit ? initialiseDefaultRatesFromMaster(hit.rates).ambiguous : { per_hectare: [], per_100_litres: [] }),
    [hit],
  );

  const selectMaster = (result: MasterSearchHit) => {
    const init = initialiseDefaultRatesFromMaster(result.rates, {
      selected_at: new Date().toISOString(),
      label_version: result.labelVersion,
    });
    setHit(result);
    setOnline(null);
    setSelections(init.selections);
    setDetails({});
    setRateDraft({ ...emptyManualRateDraft(), open: true });
    setStep("master");
  };

  const startManual = () => {
    setHit(null);
    setOnline(null);
    setManualName(search.trim());
    setStep("manual");
  };

  const rateValidation = validateManualRate(rateDraft);

  const masterRates = useMemo(() => persistedDefaultRates(selections), [selections]);
  const masterCanSave = !!hit && hasAnyDefaultRate(masterRates);
  const manualCanSave = manualName.trim().length > 0 && rateValidation.ok === true;

  const save = useMutation({
    mutationFn: async () => {
      const ident = hit
        ? { masterChemicalId: hit.id, registrationNumber: hit.registrationNumber, name: hit.productName }
        : { registrationNumber: details.registrationNumber, name: manualName };
      const dup = findVineyardDuplicate(existingLibrary, ident);
      if (dup) {
        setDuplicate({ chemical: dup.chemical, message: DUPLICATE_MESSAGE[dup.reason] });
        return null;
      }
      const input = hit
        ? buildMasterSavedChemicalInput(hit, masterRates, details)
        : buildManualSavedChemicalInput(manualName, rateDraft, details);
      if (!input) throw new Error("Enter a product name and a valid default rate.");
      return createSavedChemical(vineyardId, input);
    },
    onSuccess: (created) => {
      if (!created) return;
      toast({ title: `${created.name} added to the Chemical Store` });
      onSaved(created);
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Could not save this chemical", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const setBasisSelection = (basis: CanonicalRateBasis, rate: MasterViticultureRate) =>
    setSelections((prev) => ({
      ...prev,
      [basis]: selectionFromMasterRate(rate, {
        selected_at: new Date().toISOString(),
        label_version: hit?.labelVersion ?? null,
      }),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "search" ? "Add chemical" : step === "master" ? "Review chemical" : "Enter chemical manually"}
          </DialogTitle>
          <DialogDescription>
            {step === "search"
              ? "Search the VineTrack Master Chemical Catalogue, or enter the product yourself."
              : step === "master"
                ? "Check the product and its default rate, then save it to this vineyard."
                : MANUAL_ENTRY_HELPER}
          </DialogDescription>
        </DialogHeader>

        {duplicate && (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{duplicate.message}</span>
              {onOpenExisting && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenExisting(duplicate.chemical);
                    onOpenChange(false);
                  }}
                >
                  Open existing record
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {step === "search" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="v2-search">Search chemicals</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="v2-search"
                  autoFocus
                  className="pl-8"
                  placeholder="Product name or APVMA number"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={startManual}>
                <Plus className="h-4 w-4" /> Add manually
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={search.trim().length < 2 || onlineLookup.isPending}
                onClick={() => onlineLookup.mutate()}
              >
                {onlineLookup.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {ONLINE_FALLBACK_LABEL}
              </Button>
            </div>

            {results.isFetching && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching the Master Catalogue…
              </p>
            )}
            {results.error && (
              <Alert variant="destructive">
                <AlertDescription>{String((results.error as any)?.message ?? results.error)}</AlertDescription>
              </Alert>
            )}
            {!results.isFetching && debounced.trim().length >= 2 && (results.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                No Master Chemical matched that search.
              </p>
            )}

            <div className="space-y-2">
              {(results.data ?? []).map((r) => (
                <Card
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectMaster(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") selectMaster(r);
                  }}
                  className="cursor-pointer p-3 text-sm hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="font-medium">{r.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[r.registrant, r.registrationNumber && `APVMA ${r.registrationNumber}`, r.category]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {r.activeIngredients && (
                    <div className="text-xs text-muted-foreground">{r.activeIngredients}</div>
                  )}
                  {r.rateSummary && (
                    <Badge variant="outline" className="mt-1 text-[11px]">{r.rateSummary}</Badge>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === "master" && hit && (
          <div className="space-y-4">
            <Card className="space-y-1 p-3 text-sm">
              <div className="font-medium">{hit.productName}</div>
              <div className="text-xs text-muted-foreground">
                {[hit.registrant, hit.registrationNumber && `APVMA ${hit.registrationNumber}`, hit.category]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {hit.activeIngredients && <div className="text-xs text-muted-foreground">{hit.activeIngredients}</div>}
              {/^https?:\/\//i.test(hit.labelReference) && (
                <a
                  className="inline-flex items-center gap-1 text-xs underline"
                  href={hit.labelReference}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open label <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </Card>

            <div className="space-y-3">
              <div className="text-sm font-medium">Default rate</div>
              {BASES.map((basis) => {
                const selection = selections[basis];
                const options = ambiguous[basis];
                if (!selection && options.length === 0) return null;
                return (
                  <div key={basis} className="space-y-1 rounded-md border p-3 text-sm">
                    <div className="text-xs font-medium text-muted-foreground">{BASIS_LABEL[basis]}</div>
                    {selection ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{selectionSummary(selection)}</Badge>
                        <span className="text-xs text-muted-foreground">From the Master Catalogue</span>
                        {options.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setSelections((p) => ({ ...p, [basis]: null }))}
                          >
                            Change
                          </Button>
                        )}
                      </div>
                    ) : (
                      <RadioGroup
                        className="space-y-1"
                        onValueChange={(id) => {
                          const rate = options.find((o) => o.id === id);
                          if (rate) setBasisSelection(basis, rate);
                        }}
                      >
                        <p className="text-xs text-muted-foreground">
                          Several registered options — choose the one for this vineyard.
                        </p>
                        {options.map((o) => (
                          <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <RadioGroupItem value={o.id} aria-label={masterRateSummary(o)} />
                            <span>
                              {masterRateSummary(o)}
                              {o.label ? <span className="text-muted-foreground"> — {o.label}</span> : null}
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  </div>
                );
              })}
              {!hasAnyDefaultRate(masterRates) && hit.rates.length === 0 && (
                <Alert>
                  <AlertDescription>
                    This Master record has no registered vineyard rate. Enter the operational rate yourself.
                  </AlertDescription>
                </Alert>
              )}
              {!hasAnyDefaultRate(masterRates) && hit.rates.length === 0 && (
                <>
                  <ManualRateEditor
                    draft={rateDraft}
                    onChange={setRateDraft}
                    onCancel={() => undefined}
                    allowCancel={false}
                    requiredMarkers
                  />
                  {rateValidation.ok === true && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const selection = buildManualSavedChemicalInput("x", rateDraft)?.default_rates;
                        if (selection) setSelections({
                          per_hectare: selection.per_hectare,
                          per_100_litres: selection.per_100_litres,
                        });
                      }}
                    >
                      Use this rate
                    </Button>
                  )}
                </>
              )}
            </div>

            <OptionalDetails
              details={details}
              onChange={setDetails}
              open={optionalOpen}
              onOpenChange={setOptionalOpen}
            />

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("search")}>Back</Button>
              <Button disabled={!masterCanSave || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Required</div>
              <div className="space-y-1">
                <Label htmlFor="v2-manual-name">Chemical / product name *</Label>
                <Input
                  id="v2-manual-name"
                  autoFocus
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Operational default rate *</Label>
                <ManualRateEditor
                  draft={rateDraft}
                  onChange={setRateDraft}
                  onCancel={() => undefined}
                  allowCancel={false}
                  requiredMarkers
                />
              </div>
            </div>

            {online && (
              <p className="text-xs text-muted-foreground">
                Details found online — check them against the product label before saving.
              </p>
            )}
            <Badge variant="outline" className="text-[11px]">{MANUAL_PROVENANCE_BADGE}</Badge>

            <OptionalDetails
              details={details}
              onChange={setDetails}
              open={optionalOpen}
              onOpenChange={setOptionalOpen}
            />

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("search")}>Back</Button>
              <Button disabled={!manualCanSave || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OptionalDetails({
  details,
  onChange,
  open,
  onOpenChange,
}: {
  details: V2OptionalDetails;
  onChange: (next: V2OptionalDetails) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const patch = (p: Partial<V2OptionalDetails>) => onChange({ ...details, ...p });
  const field = (
    key: keyof V2OptionalDetails,
    label: string,
    props: { type?: string } = {},
  ) => (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={`v2-opt-${key}`}>{label}</Label>
      <Input
        id={`v2-opt-${key}`}
        className="h-8 text-sm"
        type={props.type}
        value={(details[key] as string) ?? ""}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<V2OptionalDetails>)}
      />
    </div>
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          Optional details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          None of these are needed to save this chemical.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("manufacturer", "Manufacturer / registrant")}
          {field("registrationNumber", "APVMA registration number")}
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="v2-opt-category">Product category</Label>
            <select
              id="v2-opt-category"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={details.productCategory ?? ""}
              onChange={(e) => patch({ productCategory: e.target.value })}
            >
              <option value="">Not set</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          {field("productForm", "Product form")}
          {field("activeIngredient", "Active ingredients")}
          {field("activityGroup", "FRAC / HRAC / IRAC group")}
          {field("labelUrl", "Label URL")}
          {field("productUrl", "Product URL")}
          {field("costPerUnit", "Cost per unit", { type: "number" })}
          {field("inventoryQuantity", "Inventory quantity", { type: "number" })}
          {field("inventoryUnit", "Inventory unit")}
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="v2-opt-notes">Notes</Label>
          <Textarea
            id="v2-opt-notes"
            className="text-sm"
            rows={2}
            value={details.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
