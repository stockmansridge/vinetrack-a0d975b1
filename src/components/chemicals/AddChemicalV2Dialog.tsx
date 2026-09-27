// Chemical Search V2 — Add Chemical (vineyard Chemical Store).
//
// Fast, simple, minimal clicks: Search → Select → Save. Presentation only —
// every rule lives in `@/lib/chemicalSearchV2`, `@/lib/chemicalStagedLookup`,
// `@/lib/chemicalManualRate` and `@/lib/chemicalManualEntry`. Master records are
// never modified here.
//
// Search parity with iOS/Android:
//   1. Master Catalogue search (`search_master_chemicals_v2`) — database-first.
//   2. When it returns no Review-ready result, the staged `web_lookup_v2`
//      lookup runs AUTOMATICALLY. There is no operator "search online" button.
//   3. Candidates identify the agricultural product; choosing one enriches that
//      exact identity against its manufacturer label (`selectedName`).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Plus, Search } from "lucide-react";
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
  manualRateSelection,
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
  buildManualSavedChemicalInput,
  buildMasterSavedChemicalInput,
  findVineyardDuplicate,
  hasAnyDefaultRate,
  initialiseDefaultRatesFromMaster,
  persistedDefaultRates,
  searchMasterChemicalsV2,
  selectionFromMasterRate,
  selectionSummary,
  type MasterSearchHit,
  type V2OptionalDetails,
} from "@/lib/chemicalSearchV2";
import {
  STAGED_CANDIDATES_TEXT,
  STAGED_ENRICHMENT_FAILED_TEXT,
  STAGED_LOADING_TEXT,
  STAGED_UNAVAILABLE_TEXT,
  buildStagedSavedChemicalInput,
  initialiseDefaultRatesFromStaged,
  selectionFromStagedRate,
  stagedChemicalLookup,
  stagedRateSummary,
  type StagedCandidate,
  type StagedDetail,
  type StagedRateOption,
} from "@/lib/chemicalStagedLookup";
import { resistanceStateDisplay } from "@/lib/chemicalIntelligence";
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

type Step = "search" | "master" | "staged" | "manual";

const emptySelections = (): Record<CanonicalRateBasis, PersistedDefaultRateSelection | null> => ({
  per_hectare: null,
  per_100_litres: null,
});

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
  const [staged, setStaged] = useState<StagedDetail | null>(null);
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const [selections, setSelections] = useState(emptySelections);
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
    setStaged(null);
    setStagedNotice(null);
    setSelections(emptySelections());
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

  // Automatic staged fallback: it runs on its own once the Master search has
  // come back without a Review-ready result. No operator action, no legacy
  // structured lookup, no APVMA call from the browser.
  const masterMissed =
    results.isSuccess && !results.isFetching && (results.data?.length ?? 0) === 0;

  const stagedSearch = useQuery({
    queryKey: ["chemical-staged-lookup", debounced, country ?? null],
    enabled: open && step === "search" && debounced.trim().length >= 2 && masterMissed,
    retry: false,
    queryFn: () => stagedChemicalLookup({ query: debounced, country }),
  });

  const stagedCandidates: StagedCandidate[] = stagedSearch.data?.candidates ?? [];

  // A staged response that already carries the manufacturer detail goes
  // straight to Review — the same as a Review-ready Master hit.
  useEffect(() => {
    const detail = stagedSearch.data?.detail;
    if (!detail || step !== "search") return;
    applyStagedDetail(detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedSearch.data?.detail]);

  const applyStagedDetail = (detail: StagedDetail) => {
    const init = initialiseDefaultRatesFromStaged(detail.rateOptions, {
      selected_at: new Date().toISOString(),
    });
    setStaged(detail);
    setHit(null);
    setStagedNotice(null);
    setSelections(init.selections);
    setRateDraft({ ...emptyManualRateDraft(), open: true });
    setDetails({});
    setStep("staged");
  };

  /**
   * Stage B. The chosen identity is enriched against its own manufacturer label
   * with `selectedName` — never a fresh loose search, never a substitution.
   */
  const enrich = useMutation({
    mutationFn: (candidate: StagedCandidate) =>
      stagedChemicalLookup({ query: debounced, country, selectedName: candidate.name }),
    onSuccess: (result, candidate) => {
      if (result.detail) {
        applyStagedDetail({
          ...result.detail,
          // The identity the operator chose is preserved.
          productName: result.detail.productName || candidate.name,
          resistanceState: result.detail.resistanceState ?? candidate.resistanceState,
        });
        return;
      }
      setStagedNotice(STAGED_ENRICHMENT_FAILED_TEXT);
    },
    onError: () => setStagedNotice(STAGED_ENRICHMENT_FAILED_TEXT),
  });

  const ambiguousMaster = useMemo(
    () => (hit ? initialiseDefaultRatesFromMaster(hit.rates).ambiguous : { per_hectare: [], per_100_litres: [] }),
    [hit],
  );
  const ambiguousStaged = useMemo(
    () =>
      staged
        ? initialiseDefaultRatesFromStaged(staged.rateOptions).ambiguous
        : { per_hectare: [] as StagedRateOption[], per_100_litres: [] as StagedRateOption[] },
    [staged],
  );

  const selectMaster = (result: MasterSearchHit) => {
    const init = initialiseDefaultRatesFromMaster(result.rates, {
      selected_at: new Date().toISOString(),
      label_version: result.labelVersion,
    });
    setHit(result);
    setStaged(null);
    setStagedNotice(null);
    setSelections(init.selections);
    setDetails({});
    setRateDraft({ ...emptyManualRateDraft(), open: true });
    setStep("master");
  };

  const startManual = () => {
    setHit(null);
    setStaged(null);
    setManualName(search.trim());
    setStep("manual");
  };

  const rateValidation = validateManualRate(rateDraft);

  const chosenRates = useMemo(() => persistedDefaultRates(selections), [selections]);
  const masterCanSave = !!hit && hasAnyDefaultRate(chosenRates);
  const stagedCanSave = !!staged && hasAnyDefaultRate(chosenRates);
  const manualCanSave = manualName.trim().length > 0 && rateValidation.ok === true;

  const save = useMutation({
    mutationFn: async () => {
      const ident = hit
        ? { masterChemicalId: hit.id, registrationNumber: hit.registrationNumber, name: hit.productName }
        : staged
          ? { registrationNumber: staged.registrationNumber, name: staged.productName }
          : { registrationNumber: details.registrationNumber, name: manualName };
      const dup = findVineyardDuplicate(existingLibrary, ident);
      if (dup) {
        setDuplicate({ chemical: dup.chemical, message: DUPLICATE_MESSAGE[dup.reason] });
        return null;
      }
      const input = hit
        ? buildMasterSavedChemicalInput(hit, chosenRates, details)
        : staged
          ? buildStagedSavedChemicalInput(staged, chosenRates, {
              notes: details.notes ?? null,
              costPerUnit: details.costPerUnit ? Number(details.costPerUnit) : null,
            })
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

  const setMasterSelection = (basis: CanonicalRateBasis, rate: MasterViticultureRate) =>
    setSelections((prev) => ({
      ...prev,
      [basis]: selectionFromMasterRate(rate, {
        selected_at: new Date().toISOString(),
        label_version: hit?.labelVersion ?? null,
      }),
    }));

  const setStagedSelection = (basis: CanonicalRateBasis, option: StagedRateOption) =>
    setSelections((prev) => ({
      ...prev,
      [basis]: selectionFromStagedRate(option, { selected_at: new Date().toISOString() }),
    }));

  const manualRateFallback = (
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
            const selection = manualRateSelection(
              rateDraft,
              { selected_at: new Date().toISOString() },
              { requireConfirmation: false },
            );
            if (selection) setSelections((p) => ({ ...p, [selection.basis]: selection }));
          }}
        >
          Use this rate
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "search"
              ? "Add chemical"
              : step === "manual"
                ? "Enter chemical manually"
                : "Review chemical"}
          </DialogTitle>
          <DialogDescription>
            {step === "search"
              ? "Search the VineTrack Master Chemical Catalogue, or enter the product yourself."
              : step === "manual"
                ? MANUAL_ENTRY_HELPER
                : "Check the product and its default rate, then save it to this vineyard."}
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
                    // Close first, then hand over the existing record: batched
                    // state updates apply in call order, so the parent's
                    // "close" reset must not run after setEditing(chemical).
                    onOpenChange(false);
                    onOpenExisting(duplicate.chemical);
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

            {(stagedSearch.isFetching || enrich.isPending) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {STAGED_LOADING_TEXT}
              </p>
            )}
            {stagedNotice && (
              <Alert>
                <AlertDescription>{stagedNotice}</AlertDescription>
              </Alert>
            )}
            {stagedSearch.error && (
              <Alert variant="destructive">
                <AlertDescription>{STAGED_UNAVAILABLE_TEXT}</AlertDescription>
              </Alert>
            )}

            {stagedCandidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{STAGED_CANDIDATES_TEXT}</p>
                {stagedCandidates.map((c) => (
                  <Card
                    key={`${c.name}-${c.registrationNumber}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => enrich.mutate(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") enrich.mutate(c);
                    }}
                    className="cursor-pointer p-3 text-sm hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.registrant, c.registrationNumber && `APVMA ${c.registrationNumber}`, c.category]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {c.activeIngredient && (
                      <div className="text-xs text-muted-foreground">{c.activeIngredient}</div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {!results.isFetching &&
              !stagedSearch.isFetching &&
              !stagedSearch.error &&
              !stagedNotice &&
              debounced.trim().length >= 2 &&
              (results.data?.length ?? 0) === 0 &&
              stagedCandidates.length === 0 &&
              stagedSearch.isFetched && (
                <p className="text-sm text-muted-foreground">
                  No registered product could be identified for that search. Enter the product yourself.
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
              <ResistanceLine state={hit.resistanceState} groupText={hit.activityGroupText} />
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
                const options = ambiguousMaster[basis];
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
                          if (rate) setMasterSelection(basis, rate);
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
              {!hasAnyDefaultRate(chosenRates) && hit.rates.length === 0 && (
                <>
                  <Alert>
                    <AlertDescription>
                      This Master record has no registered vineyard rate. Enter the operational rate yourself.
                    </AlertDescription>
                  </Alert>
                  {manualRateFallback}
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

        {step === "staged" && staged && (
          <div className="space-y-4">
            <Card className="space-y-1 p-3 text-sm">
              <div className="font-medium">{staged.productName}</div>
              <div className="text-xs text-muted-foreground">
                {[
                  staged.registrant,
                  staged.registrationNumber && `APVMA ${staged.registrationNumber}`,
                  staged.category,
                  staged.physicalForm,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {staged.activeIngredientText && (
                <div className="text-xs text-muted-foreground">{staged.activeIngredientText}</div>
              )}
              <ResistanceLine state={staged.resistanceState} groupText={staged.activityGroupText} />
              <div className="flex flex-wrap gap-3 pt-1">
                {staged.regulatorLabelUrl && (
                  <LabelLink href={staged.regulatorLabelUrl} text="Regulator label" />
                )}
                {staged.manufacturerLabelUrl && (
                  <LabelLink href={staged.manufacturerLabelUrl} text="Manufacturer label" />
                )}
                {staged.productUrl && <LabelLink href={staged.productUrl} text="Product page" />}
              </div>
            </Card>

            {staged.registeredUses.length > 0 && (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="text-sm font-medium">Registered vineyard uses</div>
                {staged.registeredUses.map((u, i) => (
                  <div key={i} className="space-y-0.5 text-xs text-muted-foreground">
                    <div className="text-foreground">
                      {[u.crop, u.targetRaw].filter(Boolean).join(" — ")}
                    </div>
                    {u.rates.map((r, ri) => (
                      <div key={ri}>{r}</div>
                    ))}
                    {u.withholdingDays != null && <div>Withholding period: {u.withholdingDays} days</div>}
                    {u.reEntryHours != null && <div>Re-entry: {u.reEntryHours} hours</div>}
                    {u.restrictions && <div>{u.restrictions}</div>}
                  </div>
                ))}
                {staged.referenceRates.map((r, i) => (
                  <div key={`ref-${i}`} className="text-xs text-muted-foreground">
                    {r.summary} (reference only)
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div className="text-sm font-medium">Default rate</div>
              {BASES.map((basis) => {
                const selection = selections[basis];
                const options = ambiguousStaged[basis];
                if (!selection && options.length === 0) return null;
                return (
                  <div key={basis} className="space-y-1 rounded-md border p-3 text-sm">
                    <div className="text-xs font-medium text-muted-foreground">{BASIS_LABEL[basis]}</div>
                    {selection ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{selectionSummary(selection)}</Badge>
                        <span className="text-xs text-muted-foreground">From the manufacturer label</span>
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
                          const option = options.find((o) => o.id === id);
                          if (option) setStagedSelection(basis, option);
                        }}
                      >
                        <p className="text-xs text-muted-foreground">
                          Several registered options — choose the one for this vineyard.
                        </p>
                        {options.map((o) => (
                          <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <RadioGroupItem value={o.id} aria-label={stagedRateSummary(o)} />
                            <span>
                              {stagedRateSummary(o)}
                              {o.condition ? (
                                <span className="text-muted-foreground"> — {o.condition}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  </div>
                );
              })}
              {!hasAnyDefaultRate(chosenRates) && staged.rateOptions.length === 0 && (
                <>
                  <Alert>
                    <AlertDescription>
                      The label has no usable registered vineyard rate. Enter the operational rate yourself.
                    </AlertDescription>
                  </Alert>
                  {manualRateFallback}
                </>
              )}
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("search")}>Back</Button>
              <Button disabled={!stagedCanSave || save.isPending} onClick={() => save.mutate()}>
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

/** Label / product page links, kept as separate concepts. */
function LabelLink({ href, text }: { href: string; text: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-xs underline"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {text} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** Resistance group exactly as the backend classified it. */
function ResistanceLine({
  state,
  groupText,
}: {
  state: "classified" | "not_applicable" | "unresolved" | null;
  groupText: string;
}) {
  const display = resistanceStateDisplay(state, groupText);
  if (display.kind === "none") return null;
  if (display.kind === "unresolved") {
    return (
      <div className="flex items-start gap-1 text-xs text-warning-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {display.text}. {display.warning}
        </span>
      </div>
    );
  }
  return <div className="text-xs text-muted-foreground">{display.text}</div>;
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
