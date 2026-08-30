import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertCircle, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import {
  parseChemicalLookup,
  isStructuredLookupEnvelope,
  type ChemicalLookupResult,
} from "@/lib/chemicalLookupResolver";
import { newLookupCorrelationId } from "@/lib/chemicalLookupRequest";
import {
  ALREADY_IN_STORE_LABEL,
  isSearchEnvelope,
  masterForCandidate,
  parseSearchCandidates,
  requiresCandidateSelection,
  savedChemicalForCandidate,
  searchRequestBody,
  structuredRequestBodyForCandidate,
  type ChemicalSearchResponse,
  type SearchCandidate,
  type SavedChemicalIdentity,
} from "@/lib/chemicalSearchFlow";
import { candidatePrompt } from "@/lib/chemicalSearchMessaging";
import { VERIFICATION_LABEL, type VerificationStatus } from "@/lib/chemicalIntelligence";
import type { ProductCategory } from "@/lib/chemicalCategories";
import {
  searchApprovedMasterChemicals,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";
import {
  countryLabel,
  vineyardCountryCode,
  MISSING_VINEYARD_COUNTRY_MESSAGE,
} from "@/lib/chemicalJurisdiction";

import type { ProductType, RateBasis, ChemUnit } from "@/lib/rateBasis";

export interface AppliedSuggestion {
  name?: string;
  active_ingredient?: string;
  category?: ProductCategory | "";
  chemical_group?: string;
  manufacturer?: string;
  product_type?: ProductType;
  unit?: ChemUnit;
  rate_basis?: RateBasis;
  rate_per_ha?: number | null; // numeric rate value (per the basis)
  rate_unit?: string;          // composed text e.g. "mL/100L"
  whp_days?: string;
  rei_hours?: string;
  target?: string;
  notes?: string;
  /** Validated official product label / SDS / regulator URL. */
  label_url?: string;
  /** Manufacturer or distributor product page (NOT a label). */
  product_url?: string;
  /** Safety Data Sheet URL when known. */
  sds_url?: string;
  /** Set when the user selected an existing library match instead of a new lookup row. */
  existing_chemical_id?: string;
  /**
   * Set when the operator chose an APPROVED VineTrack Master Chemical. The
   * consumer copies its SQL 194 structured intelligence verbatim and records
   * the Master link + revision. Never set for AI candidates.
   */
  master?: MasterChemicalRow;
  /**
   * Upgraded `chemical-info-lookup` resolver result. When present it is the
   * ONLY authority for canonical fields; AI suggestions inside it are display
   * data and are never applied.
   */
  resolved?: ChemicalLookupResult;
}

export interface ExistingLibraryItem {
  id: string;
  name?: string | null;
  active_ingredient?: string | null;
  /** Reliable identity for "already in your Chemical Store" matching. */
  registration_number?: string | null;
}

interface Props {
  initialName?: string;
  /** Existing chemicals already in the vineyard library. Used to flag duplicate hits. */
  existingLibrary?: ExistingLibraryItem[];
  /** Vineyard country (e.g. "Australia", "New Zealand", "United States") used to bias results. */
  country?: string | null;
  /** Apply a candidate (AI lookup OR existing library item). */
  onApply: (s: AppliedSuggestion) => void;
  /**
   * PART 3 — the host editor stays in SEARCH state until the operator has
   * either selected a registered candidate or explicitly chosen manual entry.
   * "none" is emitted again by "Change product".
   */
  onSelectionChange?: (mode: ChemicalSelectionMode) => void;
}

/**
 * Classify a resolver failure. The shared VineTrack research service can be
 * rate-limited or out of provider quota (HTTP 429 / insufficient_quota); that
 * is transient and deserves a different message from a hard outage.
 */
type LookupFailure = "quota" | "timeout" | "other";

async function describeLookupFailure(err: unknown): Promise<LookupFailure> {
  let text = "";
  try {
    text = typeof err === "string" ? err : JSON.stringify(err ?? "");
  } catch {
    text = String(err ?? "");
  }
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; context?: unknown };
    text += ` ${String(e.message ?? "")}`;
    // supabase-js attaches the raw Response as `context` on FunctionsHttpError.
    const ctx = e.context as Response | undefined;
    if (ctx && typeof (ctx as Response).text === "function") {
      try {
        text += ` ${await (ctx as Response).clone().text()}`;
      } catch {
        /* body already consumed or unavailable */
      }
    }
  }
  // Timeout is checked first: the server wraps it as a "transient" error too.
  if (/timeout|timed out|exceeded \d+ms|deadline|504|gateway time/i.test(text)) return "timeout";
  if (/429|insufficient_quota|credit_balance_exhausted|rate limit|quota|transient/i.test(text)) {
    return "quota";
  }
  return "other";
}

/** Message for a failure of the SEARCH (shortlist) request. */
function searchFailureMessage(kind: LookupFailure): string {
  if (kind === "timeout") {
    return "The product search took too long. Try again, or enter the chemical manually.";
  }
  return kind === "quota"
    ? "Product search is temporarily out of research capacity on the shared VineTrack service. Try again shortly, or enter the chemical manually."
    : "Product search is unavailable right now. Try again, or enter the chemical manually.";
}

/** Message for a failure of the label ENRICHMENT after a product was chosen. */
function enrichmentFailureMessage(kind: LookupFailure): string {
  if (kind === "timeout") {
    return "The product was selected, but the label details took too long to load. Retry label details.";
  }
  return kind === "quota"
    ? "The product was selected, but label details are temporarily out of research capacity on the shared VineTrack service. Retry label details."
    : "The product was selected, but the label details could not be loaded. Retry label details.";
}



export type ChemicalSelectionMode =
  | "none"
  | "registered"
  | "master"
  | "existing"
  | "manual";

export function ChemicalAILookup({
  initialName = "",
  existingLibrary = [],
  country,
  onApply,
  onSelectionChange,
}: Props) {
  // Jurisdiction is the selected vineyard's country. There is no locale,
  // browser or IP fallback — when it is missing, lookup is blocked.
  const countryCode = vineyardCountryCode(country);
  const [name, setName] = useState(initialName);

  /**
   * SEARCH and ENRICHMENT are distinct user-visible phases. They never share a
   * spinner, a message or an error recovery action.
   */
  const [phase, setPhase] = useState<"idle" | "searching" | "enriching">("idle");
  const loading = phase !== "idle";
  const [error, setError] = useState<string | null>(null);
  /** Which recovery affordance the current error offers. */
  const [errorAction, setErrorAction] = useState<"retry_search" | "retry_label" | null>(null);
  /** Server-ordered candidate list. Never re-sorted by the portal. */
  const [search, setSearch] = useState<ChemicalSearchResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  /** Candidate kept so label enrichment can be retried without re-searching. */
  const [pendingCandidate, setPendingCandidate] = useState<SearchCandidate | null>(null);
  /** The single selected-product summary shown after a one-step selection. */
  const [selected, setSelected] = useState<SelectedProductSummary | null>(null);
  // Selection mode is derived state — the source of truth stays `selected`.
  const selectionMode: ChemicalSelectionMode =
    selected == null
      ? "none"
      : selected.source === "pending"
      ? "none"
      : (selected.source as ChemicalSelectionMode);
  const notifySelection = onSelectionChange;
  useEffect(() => {
    notifySelection?.(selectionMode);
  }, [notifySelection, selectionMode]);


  // Informational only — saved chemicals never re-order or auto-select.
  const existingIdentities: SavedChemicalIdentity[] = existingLibrary.map((c) => ({
    id: c.id,
    name: c.name,
    active_ingredient: c.active_ingredient,
    registration_number: c.registration_number,
  }));

  const prompt = search ? candidatePrompt(search) : null;

  /**
   * Step 1 — DISCOVERY. Authoritative candidate search on the shared
   * `chemical-info-lookup` function. The portal does not pre-empt it with a
   * Master match or a saved-chemical match, and never re-orders the result.
   */
  async function runLookup(opts?: { skipDuplicateCheck?: boolean }) {
    const q = name.trim();
    if (!q) {
      setError("Enter a product name to look up.");
      setErrorAction(null);
      return;
    }
    // Fail closed: jurisdiction comes from the vineyard, never from a locale.
    if (!countryCode) {
      setError(MISSING_VINEYARD_COUNTRY_MESSAGE);
      setErrorAction(null);
      return;
    }
    // Already saved in THIS vineyard: ask first. Declining does no network
    // work and writes nothing.
    if (!opts?.skipDuplicateCheck) {
      const dupe = findSavedChemicalByName(existingLibrary, q);
      if (dupe) {
        setDuplicate({ id: dupe.id, name: dupe.name ?? q });
        return;
      }
    }
    setDuplicate(null);
    setError(null);
    setErrorAction(null);
    setSearch(null);
    setSelectedIndex(null);
    setSelected(null);
    setPendingCandidate(null);
    setPhase("searching");
    // One correlation id per lookup FLOW: this search and any structured
    // lookup selected from it share it. Diagnostic only.
    const cid = newLookupCorrelationId();
    setCorrelationId(cid);

    let failure: LookupFailure = "other";
    try {
      const { data, error: searchErr } = await iosSupabase.functions.invoke(
        "chemical-info-lookup",
        { body: searchRequestBody(q, countryCode, cid) },
      );
      if (!searchErr && isSearchEnvelope(data)) {
        const res = parseSearchCandidates(data);
        if (res.candidates.length === 0) {
          setError(
            `No registered product found for "${q}" in ${countryLabel(countryCode)}. Check the spelling or enter it manually.`,
          );
          setErrorAction("retry_search");
          setPhase("idle");
          return;
        }
        setSearch(res);
        setPhase("idle");
        // The server decides whether a single result is unambiguous; the
        // portal never auto-picks the top-ranked candidate itself.
        if (!requiresCandidateSelection(res)) {
          void selectCandidate(res.candidates[0], cid);
        }
        return;
      }
      console.warn("[chemical-info-lookup:search] unavailable", searchErr ?? data);
      failure = await describeLookupFailure(searchErr ?? data);
    } catch (e) {
      console.warn("[chemical-info-lookup:search] failed", e);
      failure = await describeLookupFailure(e);
    }
    // BOUNDARY: a failed shortlist NEVER escalates into a full structured
    // free-text lookup (register + research + label work). The typed query is
    // preserved and the operator chooses: retry the search, or enter manually.
    setError(searchFailureMessage(failure));
    setErrorAction("retry_search");
    setPhase("idle");
  }

  /**
   * Step 2 — SELECTION. One step: the chosen registration is pinned (country +
   * exact registration number), the structured record is fetched and applied
   * to the form immediately. There is no second "Apply" confirmation — Save
   * chemical is the final confirmation.
   */
  async function selectCandidate(candidate: SearchCandidate, cid?: string) {
    if (!countryCode) return;
    const flowId = cid ?? correlationId ?? newLookupCorrelationId();
    setError(null);
    setErrorAction(null);
    setSelectedIndex(candidate.index);
    setPendingCandidate(candidate);
    setPhase("enriching");

    // Master catalogue reuse — ONLY for the exact same registration identity.
    try {
      const rows = await searchApprovedMasterChemicals(
        candidate.productName ?? name.trim(),
        countryCode,
      );
      const exact = masterForCandidate(rows, candidate);
      if (exact) {
        applyMaster(exact);
        setPhase("idle");
        return;
      }
    } catch (e) {
      console.warn("[master-chemicals] cache lookup unavailable", e);
    }

    let failure: LookupFailure = "other";
    try {
      const { data, error: infoErr } = await iosSupabase.functions.invoke(
        "chemical-info-lookup",
        { body: structuredRequestBodyForCandidate(candidate, countryCode, flowId) },
      );
      if (!infoErr && isStructuredLookupEnvelope(data)) {
        const result = parseChemicalLookup(data, countryCode);
        if (result.jurisdiction.status !== "mismatch") {
          applyResolved(result, candidate);
          setPhase("idle");
          return;
        }
        setError(
          `The label returned is not registered in ${countryLabel(countryCode)}. Enter the chemical manually.`,
        );
        setPhase("idle");
        return;
      }
      console.warn("[chemical-info-lookup] unavailable", infoErr ?? data);
      failure = await describeLookupFailure(infoErr ?? data);
    } catch (e) {
      console.warn("[chemical-info-lookup] failed", e);
      failure = await describeLookupFailure(e);
    }
    // Enrichment failed: keep the chosen identity on screen. No re-search.
    setSelected((prev) => prev ?? summaryFromCandidate(candidate));
    setError(enrichmentFailureMessage(failure));
    setErrorAction("retry_label");
    setPhase("idle");
  }

  /** Retry ONLY the label enrichment for the already-selected registration. */
  function retryLabelDetails() {
    if (!pendingCandidate) return;
    void selectCandidate(pendingCandidate, correlationId ?? undefined);
  }


  function applyMaster(row: MasterChemicalRow) {
    const finalName = row.registered_product_name?.trim() || name.trim();
    onApply({
      name: finalName,
      manufacturer: row.registrant ?? undefined,
      label_url:
        row.label_reference && /^https?:\/\//i.test(row.label_reference)
          ? row.label_reference
          : undefined,
      master: row,
    });
    setSelected({
      name: finalName,
      registrationNumber: row.registration_number ?? undefined,
      registrant: row.registrant ?? undefined,
      activeIngredient: undefined,
      category: undefined,
      verification: row.verification_status ?? undefined,
      source: "master",
    });
  }

  function applyExisting(item: ExistingLibraryItem) {
    onApply({
      existing_chemical_id: item.id,
      name: item.name ?? undefined,
      active_ingredient: item.active_ingredient ?? undefined,
    });
    setSelected({
      name: item.name ?? name.trim(),
      activeIngredient: item.active_ingredient ?? undefined,
      registrationNumber: item.registration_number ?? undefined,
      source: "existing",
    });
  }

  /** Apply an authoritative resolver result. AI suggestions are not applied. */
  function applyResolved(result: ChemicalLookupResult, candidate?: SearchCandidate) {
    if (!result.authoritative) {
      setError(
        result.guidance ??
          "The register did not return verified label data for this product. Enter the chemical manually.",
      );
      return;
    }
    const finalName = result.fields.name?.trim() || candidate?.productName || name.trim();
    onApply({
      name: finalName,
      manufacturer: result.fields.registrant,
      label_url:
        result.fields.labelReference && /^https?:\/\//i.test(result.fields.labelReference)
          ? result.fields.labelReference
          : undefined,
      master: result.master ?? undefined,
      resolved: result,
    });
    setSelected({
      name: finalName,
      registrationNumber: result.fields.registrationNumber ?? candidate?.registrationNumber,
      registrant: result.fields.registrant ?? candidate?.registrant,
      activeIngredient: result.fields.activeIngredientText ?? candidate?.activeIngredientText,
      category: result.fields.category,
      verification: result.verificationStatus,
      source: "registered",
    });
  }

  function applyManual() {
    const q = name.trim();
    onApply({ name: q });
    setSelected({ name: q, source: "manual" });
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          {countryCode
            ? `Chemical lookup — ${countryLabel(countryCode)} labels`
            : "Chemical lookup — vineyard country not set"}
        </div>
        {countryCode && (
          <Badge variant="outline" className="text-[10px]">{countryCode}</Badge>
        )}
      </div>
      {!countryCode && (
        <div className="flex items-start gap-1.5 rounded border border-warning/50 bg-warning/10 p-2 text-[11px]">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{MISSING_VINEYARD_COUNTRY_MESSAGE}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Search a registered product name"
          aria-label="Search product"
          className="h-9 text-sm"
          disabled={!countryCode}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runLookup();
            }
          }}
        />
        <Button type="button" size="sm" onClick={runLookup} disabled={loading || !countryCode}>
          {phase === "searching" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Searching…
            </>
          ) : (
            "Lookup"
          )}
        </Button>
      </div>

      {/* SEARCH and ENRICHMENT never share a message. */}
      {phase === "searching" && (
        <p className="text-xs text-muted-foreground" role="status">
          Searching registered products…
        </p>
      )}
      {phase === "enriching" && (
        <p className="text-xs text-muted-foreground" role="status">
          Loading product label details…
        </p>
      )}

      {error && (
        <div className="space-y-1.5">
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          {errorAction === "retry_search" && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={runLookup}>
                Retry search
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={applyManual}>
                Enter manually
              </Button>
            </div>
          )}
          {errorAction === "retry_label" && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={retryLabelDetails}
              >
                Retry label details
              </Button>
            </div>
          )}
        </div>
      )}


      {/* Selected product summary. The candidate list is collapsed away — the
          operator reviews the populated form and confirms with Save chemical. */}
      {selected && (
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold leading-tight">{selected.name}</span>
                {selected.verification && (
                  <Badge variant="secondary" className="text-[10px]">
                    {VERIFICATION_LABEL[selected.verification as VerificationStatus] ??
                      selected.verification}
                  </Badge>
                )}
              </div>
              {selected.registrationNumber && (
                <div className="text-xs text-muted-foreground">
                  APVMA {selected.registrationNumber}
                </div>
              )}
              {selected.registrant && (
                <div className="text-xs text-muted-foreground">{selected.registrant}</div>
              )}
              {selected.activeIngredient && (
                <div className="text-xs text-muted-foreground">{selected.activeIngredient}</div>
              )}
              {selected.category && (
                <div className="text-xs text-muted-foreground">{selected.category}</div>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                setSelected(null);
                setSelectedIndex(null);
                setPendingCandidate(null);
                setError(null);
                setErrorAction(null);
              }}
            >
              Change product
            </Button>
          </div>
        </div>
      )}

      {!selected && search && search.candidates.length > 0 && prompt && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">
              {prompt.title}
              {search.candidates.length > 1 ? ` (${search.candidates.length})` : ""}
            </div>
            <button
              type="button"
              onClick={applyManual}
              className="text-[11px] underline text-primary hover:text-primary/80"
            >
              Enter manually
            </button>
          </div>
          {prompt.detail && (
            <p className="text-[11px] text-muted-foreground">{prompt.detail}</p>
          )}
          {/* Server order. Never re-sorted, never re-ranked by the portal. */}
          {search.candidates.map((c) => {
            const saved = savedChemicalForCandidate(existingIdentities, c);
            const registered = !!c.registrationNumber;
            return (
              <div key={c.index} className="rounded border bg-background p-2 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium leading-tight">
                      {c.productName ?? (
                        <span className="italic text-muted-foreground font-normal">Unnamed product</span>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      {c.registrant ?? "Manufacturer unknown"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {!registered && (
                      <Badge variant="outline" className="text-[10px]">
                        Unverified suggestion
                      </Badge>
                    )}
                    {saved && (
                      <Badge variant="secondary" className="text-[10px]">
                        <Library className="h-3 w-3 mr-1" />
                        {ALREADY_IN_STORE_LABEL}
                      </Badge>
                    )}
                    {c.registrationCountry && (
                      <Badge variant="outline" className="text-[10px]">{c.registrationCountry}</Badge>
                    )}
                  </div>
                </div>
                {/* Grower-useful identity first. Scheme and diagnostics are not
                    surfaced here. */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <Row label="Active ingredient" value={c.activeIngredientText} />
                  <Row label="Product type" value={c.category} />
                  {registered && (
                    <Row
                      label="Registration"
                      value={`${(c.registrationScheme ?? "APVMA").toUpperCase()} ${c.registrationNumber}`}
                    />
                  )}
                </div>
                {!registered && (
                  <p className="text-[11px] text-muted-foreground italic">
                    No registration number was returned, so this is not a confirmed registered product.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    disabled={loading}
                    onClick={() => selectCandidate(c)}
                  >
                    {phase === "enriching" && selectedIndex === c.index ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Loading product label details…
                      </>
                    ) : (
                      "Select this product"
                    )}
                  </Button>
                  {saved && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => applyExisting({ id: saved.id, name: saved.name, active_ingredient: saved.active_ingredient })}
                    >
                      Use stored
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          <p className="text-[11px] text-muted-foreground italic leading-snug pt-1">
            Results are supplied and ordered by the shared VineTrack register search.
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-snug">
        Always confirm rates, withholding periods, re-entry intervals, and permitted uses against the current product label for your country.
      </p>
    </div>
  );
}

interface SelectedProductSummary {
  name: string;
  registrationNumber?: string;
  registrant?: string;
  activeIngredient?: string;
  category?: string;
  verification?: string;
  source: "registered" | "master" | "existing" | "manual" | "pending";
}

/**
 * Identity-only summary kept on screen when label enrichment fails. It carries
 * nothing beyond what the candidate already stated — no estimated label data.
 */
function summaryFromCandidate(c: SearchCandidate): SelectedProductSummary {
  return {
    name: c.productName ?? "Selected product",
    registrationNumber: c.registrationNumber,
    registrant: c.registrant,
    activeIngredient: c.activeIngredientText,
    category: c.category,
    source: "pending",
  };
}


function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "" : "text-muted-foreground italic"}>{value || "—"}</span>
    </>
  );
}
