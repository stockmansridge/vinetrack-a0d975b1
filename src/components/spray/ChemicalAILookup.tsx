import { useState } from "react";
import { Sparkles, Loader2, AlertCircle, Check, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import {
  parseChemicalLookup,
  isStructuredLookupEnvelope,
  lookupJurisdictionHeadline,
  type ChemicalLookupResult,
} from "@/lib/chemicalLookupResolver";
import { ChemicalLookupResultCard } from "@/components/chemicals/ChemicalLookupResultCard";
import {
  CHEMICAL_LOOKUP_WAIT_MESSAGE,
  buildStructuredLookupBody,
  newLookupCorrelationId,
} from "@/lib/chemicalLookupRequest";
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
import type { ProductCategory } from "@/lib/chemicalCategories";
import {
  searchApprovedMasterChemicals,
  type MasterChemicalRow,
} from "@/lib/masterChemicals";
import { MasterChemicalCard } from "@/components/chemicals/MasterChemicalCard";
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
}

/**
 * Classify a resolver failure. The shared VineTrack research service can be
 * rate-limited or out of provider quota (HTTP 429 / insufficient_quota); that
 * is transient and deserves a different message from a hard outage.
 */
async function describeLookupFailure(err: unknown): Promise<"quota" | "other"> {
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
  return /429|insufficient_quota|credit_balance_exhausted|rate limit|quota|transient/i.test(text)
    ? "quota"
    : "other";
}

function lookupFailureMessage(kind: "quota" | "other"): string {
  return kind === "quota"
    ? "Chemical lookup is temporarily out of research capacity on the shared VineTrack service. No verified label data could be retrieved — please try again later or add the chemical manually."
    : "Chemical lookup is unavailable right now. Verified label data could not be retrieved — please add the chemical manually.";
}

export function ChemicalAILookup({ initialName = "", existingLibrary = [], country, onApply }: Props) {
  // Jurisdiction is the selected vineyard's country. There is no locale,
  // browser or IP fallback — when it is missing, lookup is blocked.
  const countryCode = vineyardCountryCode(country);
  const [name, setName] = useState(initialName);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Server-ordered candidate list. Never re-sorted by the portal. */
  const [search, setSearch] = useState<ChemicalSearchResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [masterResult, setMasterResult] = useState<MasterChemicalRow | null>(null);
  const [resolved, setResolved] = useState<ChemicalLookupResult | null>(null);
  const [applied, setApplied] = useState<{ name: string; manufacturer?: string; source: "existing" | "manual" | "master" } | null>(null);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);

  // Informational only — saved chemicals never re-order or auto-select.
  const existingIdentities: SavedChemicalIdentity[] = existingLibrary.map((c) => ({
    id: c.id,
    name: c.name,
    active_ingredient: c.active_ingredient,
    registration_number: c.registration_number,
  }));

  /**
   * Step 1 — DISCOVERY. Authoritative candidate search on the shared
   * `chemical-info-lookup` function. The portal does not pre-empt it with a
   * Master match or a saved-chemical match, and never re-orders the result.
   */
  async function runLookup() {
    const q = name.trim();
    if (!q) {
      setError("Enter a product name to look up.");
      return;
    }
    // Fail closed: jurisdiction comes from the vineyard, never from a locale.
    if (!countryCode) {
      setError(MISSING_VINEYARD_COUNTRY_MESSAGE);
      return;
    }
    setError(null);
    setSearch(null);
    setSelectedIndex(null);
    setMasterResult(null);
    setResolved(null);
    setApplied(null);
    setResultsCollapsed(false);
    setLoading(true);
    // One correlation id per lookup FLOW: this search and any structured
    // lookup selected from it share it. Diagnostic only.
    const cid = newLookupCorrelationId();
    setCorrelationId(cid);

    try {
      const { data, error: searchErr } = await iosSupabase.functions.invoke(
        "chemical-info-lookup",
        { body: searchRequestBody(q, countryCode, cid) },
      );
      if (!searchErr && isSearchEnvelope(data)) {
        const res = parseSearchCandidates(data);
        if (res.candidates.length === 0) {
          setError(
            `No registered product matched "${q}" in ${countryLabel(countryCode)}. Check the spelling or add the chemical manually.`,
          );
          setLoading(false);
          return;
        }
        setSearch(res);
        setLoading(false);
        // The server decides whether a single result is unambiguous; the
        // portal never auto-picks the top-ranked candidate itself.
        if (!requiresCandidateSelection(res)) {
          void selectCandidate(res.candidates[0], cid);
        }
        return;
      }
      console.warn("[chemical-info-lookup:search] unavailable", searchErr ?? data);
      // Older deployment without `action: "search"` — fall back to the direct
      // structured lookup on the free text. Master is NOT consulted first.
      await runStructuredFallback(q, countryCode, cid);
      return;
    } catch (e) {
      console.warn("[chemical-info-lookup:search] failed", e);
      await runStructuredFallback(q, countryCode, cid, e);
      return;
    }
  }

  /**
   * Step 2 — SELECTION. The chosen registration is pinned: country + exact
   * registration number drive the structured lookup. The original free-text
   * query never re-decides identity.
   */
  async function selectCandidate(candidate: SearchCandidate, cid?: string) {
    if (!countryCode) return;
    const flowId = cid ?? correlationId ?? newLookupCorrelationId();
    setError(null);
    setSelectedIndex(candidate.index);
    setLoading(true);

    // Master catalogue reuse — ONLY for the exact same registration identity.
    try {
      const rows = await searchApprovedMasterChemicals(
        candidate.productName ?? name.trim(),
        countryCode,
      );
      const exact = masterForCandidate(rows, candidate);
      if (exact) {
        setMasterResult(exact);
        setSearch(null);
        setLoading(false);
        return;
      }
    } catch (e) {
      console.warn("[master-chemicals] cache lookup unavailable", e);
    }

    let failure: "quota" | "other" = "other";
    try {
      const { data, error: infoErr } = await iosSupabase.functions.invoke(
        "chemical-info-lookup",
        { body: structuredRequestBodyForCandidate(candidate, countryCode, flowId) },
      );
      if (!infoErr && isStructuredLookupEnvelope(data)) {
        const result = parseChemicalLookup(data, countryCode);
        if (result.jurisdiction.status !== "mismatch") {
          setResolved(result);
          setSearch(null);
          setLoading(false);
          return;
        }
        setError(
          `The label returned is not registered in ${countryLabel(countryCode)}. Add the chemical manually.`,
        );
        setLoading(false);
        return;
      }
      console.warn("[chemical-info-lookup] unavailable", infoErr ?? data);
      failure = await describeLookupFailure(infoErr ?? data);
    } catch (e) {
      console.warn("[chemical-info-lookup] failed", e);
      failure = await describeLookupFailure(e);
    }
    setError(lookupFailureMessage(failure));
    setLoading(false);
  }

  /** Legacy direct structured lookup for deployments without `action: search`. */
  async function runStructuredFallback(
    q: string,
    cc: string,
    cid: string,
    priorError?: unknown,
  ) {
    let failure: "quota" | "other" = priorError
      ? await describeLookupFailure(priorError)
      : "other";
    try {
      const { data, error: infoErr } = await iosSupabase.functions.invoke(
        "chemical-info-lookup",
        { body: buildStructuredLookupBody(q, cc, { correlationId: cid }) },
      );
      if (!infoErr && isStructuredLookupEnvelope(data)) {
        const result = parseChemicalLookup(data, cc);
        if (result.jurisdiction.status !== "mismatch") {
          setResolved(result);
          setLoading(false);
          return;
        }
        setError(
          `The label returned is not registered in ${countryLabel(cc)}. Add the chemical manually.`,
        );
        setLoading(false);
        return;
      }
      failure = await describeLookupFailure(infoErr ?? data);
    } catch (e) {
      failure = await describeLookupFailure(e);
    }
    // Fail closed: no canonical data may come from the legacy AI function.
    setError(lookupFailureMessage(failure));
    setLoading(false);
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
    setApplied({ name: finalName, manufacturer: row.registrant ?? undefined, source: "master" });
    setResultsCollapsed(true);
  }

  function applyExisting(item: ExistingLibraryItem) {
    onApply({
      existing_chemical_id: item.id,
      name: item.name ?? undefined,
      active_ingredient: item.active_ingredient ?? undefined,
    });
    setApplied({ name: item.name ?? name.trim(), source: "existing" });
    setResultsCollapsed(true);
  }

  /** Apply an authoritative resolver result. AI suggestions are not applied. */
  function applyResolved(result: ChemicalLookupResult) {
    if (!result.authoritative) return;
    const finalName = result.fields.name?.trim() || name.trim();
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
    setApplied({ name: finalName, manufacturer: result.fields.registrant, source: "master" });
    setResultsCollapsed(true);
  }

  function applyManual() {
    const q = name.trim();
    onApply({ name: q });
    setApplied({ name: q, source: "manual" });
    setResultsCollapsed(true);
  }

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {resolved
            ? lookupJurisdictionHeadline(resolved.jurisdiction)
            : countryCode
              ? `Chemical lookup — ${countryLabel(countryCode)} labels`
              : "Chemical lookup — vineyard country not set"}
        </div>
        {(resolved?.jurisdiction.country ?? countryCode) && (
          <Badge variant="outline" className="text-[10px]">
            {resolved?.jurisdiction.country ?? countryCode}
          </Badge>
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
          placeholder="Product name e.g. Thiovit Jet, Flint, Ridomil…"
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
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Looking up…
            </>
          ) : (
            "Lookup"
          )}
        </Button>
      </div>

      {/* Same first-search expectation-setting copy as iOS. Repeat lookups are
          usually faster but are never promised as instant. */}
      {loading && (
        <p className="text-xs text-muted-foreground" role="status">
          {CHEMICAL_LOOKUP_WAIT_MESSAGE}
        </p>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {applied && resultsCollapsed && (
        <div className="rounded-md border bg-background p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>
              <span className="text-muted-foreground">Applied:</span>{" "}
              <span className="font-medium">{applied.name}</span>
              {applied.manufacturer ? (
                <span className="text-muted-foreground"> — {applied.manufacturer}</span>
              ) : null}
              <span className="text-muted-foreground"> · review and save below</span>
            </span>
          </div>
          {search?.candidates.length ? (
            <button
              type="button"
              onClick={() => setResultsCollapsed(false)}
              className="text-[11px] underline text-primary hover:text-primary/80 shrink-0"
            >
              Change product
            </button>
          ) : null}
        </div>
      )}

      {!resultsCollapsed && resolved && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            {resolved.authoritative
              ? resolved.matchSource === "master"
                ? "VineTrack Master Catalogue"
                : "Registered product"
              : "Lookup result"}
          </div>
          <ChemicalLookupResultCard
            result={resolved}
            onApply={() => applyResolved(resolved)}
            onManual={applyManual}
          />
        </div>
      )}

      {!resultsCollapsed && masterResult && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            VineTrack Master Catalogue
          </div>
          <MasterChemicalCard master={masterResult} vineyardCountry={countryCode} onApply={() => applyMaster(masterResult)} />
          <button
            type="button"
            onClick={applyManual}
            className="text-[11px] underline text-primary hover:text-primary/80"
          >
            Not the right product? Enter manually
          </button>
        </div>
      )}

      {!resultsCollapsed && search && search.candidates.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              Registered products ({search.candidates.length}) for "{name.trim()}"
              {countryCode ? ` · ${countryLabel(countryCode)}` : ""}
            </div>
            <button
              type="button"
              onClick={applyManual}
              className="text-[11px] underline text-primary hover:text-primary/80"
            >
              Not the right product? Enter manually
            </button>
          </div>
          {search.summary?.ambiguous && (
            <div className="flex items-start gap-1.5 rounded border border-warning/50 bg-warning/10 p-2 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {search.summary.ambiguityReason ??
                  "More than one registered product matched. Select the correct registration."}
              </span>
            </div>
          )}
          {/* Server order. Never re-sorted, never re-ranked by the portal. */}
          {search.candidates.map((c) => {
            const saved = savedChemicalForCandidate(existingIdentities, c);
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
                      {c.registrant ?? "Registrant unknown"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
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
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <Row label="Registration" value={c.registrationNumber} />
                  <Row label="Scheme" value={c.registrationScheme} />
                  <Row label="Active" value={c.activeIngredientText} />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={loading}
                    onClick={() => selectCandidate(c)}
                  >
                    {loading && selectedIndex === c.index ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Loading label…
                      </>
                    ) : (
                      "Select this registration"
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

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "" : "text-muted-foreground italic"}>{value || "—"}</span>
    </>
  );
}
