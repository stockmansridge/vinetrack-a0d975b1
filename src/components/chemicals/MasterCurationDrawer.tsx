// System Admin Master Chemical curation drawer — data-quality workbench.
//
// Top to bottom: identity → Missing / needs review checklist → source buttons →
// Find Missing Data (server-owned preview + audited apply) → resistance →
// vineyard registration → registered vineyard rates (read-only) → whitelisted
// manual corrections. Vineyard rates are NEVER written from here: the live
// `master_review_correct` whitelist does not accept `viticulture_rates`.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, Save, SearchCheck, SkipForward,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  MASTER_REVIEW_STATUS_LABEL, setMasterReviewStatus, type MasterChemicalRow, type MasterReviewStatus,
} from "@/lib/masterChemicals";
import {
  MASTER_RATE_BASIS_LABEL, masterRateSummary, masterRatesForBasis, parseMasterViticultureRates,
  saveMasterCuration, approveWithCorrections, buildMasterCurationPatch, type MasterCurationIdentity, type MasterRateBasis,
} from "@/lib/masterCuration";
import {
  MASTER_ISSUE_ACTION_LABEL, masterIssues, RELEASE_WARNING_KEYS, masterManufacturerLabel, masterProductPage,
  masterRegulatorReference, masterResistanceStatus, masterVineyardUses, masterHasConflict, vineyardRelevantUnresolved, type MasterIssue,
} from "@/lib/masterWorkbench";
import { countryLabel, vineyardCountryCode } from "@/lib/chemicalJurisdiction";
import { MasterFindMissingData } from "@/components/chemicals/MasterFindMissingData";

const CORRECTIONS_SAVE_UNKNOWN_SHORT =
  "The save request didn't complete, so it isn't known whether the corrections were saved. Reload this record to check.";

const txt = (v: unknown) => (v == null ? "" : String(v));

export interface MasterCurationDrawerProps {
  row: MasterChemicalRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: { index: number; total: number };
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Called after any successful write so the list can refresh. */
  onSaved?: () => void;
  /** Move to the next record still needing attention. */
  onNextAttention?: () => void;
  /** Open the full evidence/conflict review for this record. */
  onReviewConflict?: () => void;
  /**
   * After a successful approval: open the next record (e.g. the next in
   * "Rehydrated this run"). Falls back to `onNextAttention`.
   */
  onApprovedNext?: (approvedId: string) => void;
}

export function MasterCurationDrawer(props: MasterCurationDrawerProps) {
  const { row, open, onOpenChange } = props;
  const [identity, setIdentity] = useState<MasterCurationIdentity>({});
  const [reason, setReason] = useState("");
  const [findSignal, setFindSignal] = useState(0);
  const [approveError, setApproveError] = useState<{ title: string; message?: string } | null>(null);

  useEffect(() => {
    if (!row) return;
    setIdentity({
      registered_product_name: txt(row.registered_product_name),
      registrant: txt(row.registrant),
      product_category: txt(row.product_category),
      form_type: txt(row.form_type),
      label_reference: txt(row.label_reference),
    });
    setReason("");
    setApproveError(null);
  }, [row?.id]);

  const issues = useMemo(() => (row ? masterIssues(row) : []), [row]);
  // Readiness with the entered (unsaved) whitelisted corrections applied — only
  // decides which button shows; approval re-checks the confirmed saved record.
  const draftIssueCount = useMemo(
    () =>
      row
        ? masterIssues({ ...row, ...buildMasterCurationPatch({ row, identity, reason }) } as MasterChemicalRow).filter(
            (i) => !RELEASE_WARNING_KEYS.has(i.key),
          ).length
        : 0,
    [row, identity, reason],
  );
  const resistance = useMemo(() => (row ? masterResistanceStatus(row) : null), [row]);
  const vineUses = useMemo(() => (row ? masterVineyardUses(row) : []), [row]);
  const rates = useMemo(() => parseMasterViticultureRates(row?.viticulture_rates), [row]);
  const manufacturer = row ? masterManufacturerLabel(row) : null;
  const regulator = row ? masterRegulatorReference(row) : null;
  const productPage = row ? masterProductPage(row) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No record selected.");
      return saveMasterCuration({ row, identity, reason });
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No record selected.");
      // Snapshot the record + entered values so mid-operation edits can't change what is approved.
      return approveWithCorrections(
        { row, identity: { ...identity }, reason },
        {
          save: saveMasterCuration,
          approve: (id, notes) => setMasterReviewStatus(id, "approved", notes),
        },
      );
    },
  });
  const busy = save.isPending || approve.isPending;
  // Track the currently selected record so an async completion can't advance a different one.
  const currentIdRef = useRef<string | null>(row?.id ?? null);
  currentIdRef.current = row?.id ?? null;
  const guardedOpenChange = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
  };

  const runSave = async (then?: () => void) => {
    let res;
    try {
      res = await save.mutateAsync();
    } catch (e: any) {
      // Request didn't report an outcome — don't claim nothing was saved.
      toast({
        title: "Save result unknown",
        description: `${CORRECTIONS_SAVE_UNKNOWN_SHORT} ${e?.message ?? String(e)}`.trim(),
        variant: "destructive",
      });
      return;
    }
    if (res.outcome !== "ok") {
      toast({ title: "Not saved", description: res.message, variant: "destructive" });
      return;
    }
    if (res.readBackFailed) {
      toast({ title: "Saved — not confirmed", description: res.message, variant: "destructive" });
      props.onSaved?.();
      return;
    }
    toast({ title: "Saved", description: res.message });
    props.onSaved?.();
    then?.();
  };

  const runApprove = async () => {
    if (busy || !row) return;
    const startedId = row.id;
    let res;
    try {
      res = await approve.mutateAsync();
    } catch (e: any) {
      if (currentIdRef.current === startedId) setApproveError({ title: "Not approved", message: e?.message ?? String(e) });
      toast({ title: "Not approved", description: e?.message ?? String(e), variant: "destructive" });
      return;
    }
    if (res.outcome !== "save_failed" && res.outcome !== "save_unknown" && res.saved) props.onSaved?.();
    if (res.outcome === "approved") {
      toast({ title: res.saved ? "Corrections saved and approved" : "Approved" });
      if (!res.saved) props.onSaved?.();
      if (currentIdRef.current === startedId) {
        setApproveError(null);
        if (props.onApprovedNext) props.onApprovedNext(startedId);
        else props.onNextAttention?.();
      }
      return;
    }
    const failTitle =
        res.outcome === "save_failed"
          ? "Not saved — not approved"
          : res.outcome === "save_unknown"
            ? "Save result unknown — not approved"
          : res.outcome === "save_unconfirmed"
            ? "Save not confirmed — not approved"
              : "Not approved";
    if (currentIdRef.current === startedId) setApproveError({ title: failTitle, message: res.message });
    toast({ title: failTitle, description: res.message, variant: "destructive" });
  };

  const onIssueAction = (i: MasterIssue) => {
    if (busy) return;
    if (i.action === "review_conflict") props.onReviewConflict?.();
    else setFindSignal((n) => n + 1);
  };

  const status = row
    ? MASTER_REVIEW_STATUS_LABEL[(row.review_status as MasterReviewStatus) ?? "candidate"] ?? row.review_status
    : "";

  const conflict = row ? masterHasConflict(row) : false;
  const unresolvedFields = row ? vineyardRelevantUnresolved(row) : [];
  const vineyardRegistered = vineUses.length > 0;
  const regNumber = row?.registration_number?.trim() || "";
  const scheme = row?.registration_scheme?.trim() || "";
  const country = row ? vineyardCountryCode(row.registration_country) : null;
  const whps = uniq(vineUses.map((u) => u.withholding_period_days).filter((v) => v != null).map((v) => `${v} days`));
  const reis = uniq(vineUses.map((u) => u.re_entry_period_hours).filter((v) => v != null).map((v) => `${v} hours`));
  const restrictions = uniq(vineUses.map((u) => u.restrictions?.trim() || "").filter(Boolean));
  const sources = Array.isArray(row?.verification_sources) ? (row!.verification_sources as unknown[]) : [];

  return (
    <Sheet open={open} onOpenChange={guardedOpenChange}>
      <SheetContent
        side="right"
        data-testid="master-review-drawer"
        className="w-screen max-w-none sm:w-[90vw] sm:max-w-[90vw] lg:w-[75vw] lg:max-w-[75vw] overflow-y-auto p-0"
        aria-busy={busy || undefined}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        {!row ? null : (
          <>
            {/* ------------------------------------------ sticky review header */}
            <SheetHeader className="sticky top-0 z-10 space-y-2 border-b border-border/60 bg-background px-6 pb-3 pt-6 pr-12">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <SheetTitle className="text-2xl font-semibold leading-tight">
                    {row.registered_product_name?.trim() || "Unnamed product"}
                  </SheetTitle>
                  <SheetDescription className="text-sm">
                    {[
                      row.registrant?.trim() || "Manufacturer missing",
                      row.product_category?.trim() || "Category missing",
                      country ? countryLabel(row.registration_country) : "Country missing",
                      regNumber ? `Reg. ${regNumber}` : null,
                      `Revision ${row.catalogue_version ?? "—"}`,
                      props.position ? `Record ${props.position.index + 1} of ${props.position.total}` : null,
                    ].filter(Boolean).join(" · ")}
                  </SheetDescription>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-[10px]">{status}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {issues.length ? `Needs attention (${issues.length})` : "Complete"}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2" data-testid="header-label">
                  {manufacturer?.url ? (
                    <Button asChild size="lg">
                      <a href={manufacturer.url} target="_blank" rel="noopener noreferrer" data-testid="header-manufacturer-label">
                        Open Manufacturer Label <ExternalLink className="h-4 w-4 ml-1" />
                      </a>
                    </Button>
                  ) : (
                    <div
                      data-testid="manufacturer-label-missing"
                      data-status="missing"
                      className="flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                    >
                      <AlertTriangle className="h-4 w-4" /> Manufacturer label missing
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        aria-label="Find Missing Data for manufacturer label"
                        onClick={() => setFindSignal((n) => n + 1)}
                      >
                        <SearchCheck className="h-4 w-4 mr-1" /> Find Missing Data
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {approveError && (
                <div role="alert" data-testid="approve-error" className="rounded-md border-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <div className="font-semibold">{approveError.title}</div>
                  {approveError.message && <div className="text-xs">{approveError.message}</div>}
                </div>
              )}
            </SheetHeader>

            <div className="space-y-5 px-6 py-4 text-sm">
              {/* --------------------------------------- find missing data */}
              <MasterFindMissingData
                row={row}
                trigger={findSignal}
                disabled={busy}
                onApplied={() => props.onSaved?.()}
                onNextIncomplete={props.onNextAttention}
              />

              <div className="grid gap-4 xl:grid-cols-2">
                {/* -------------------------------------------- A product */}
                <ReviewSection title="Product" testId="section-product">
                  <FieldRow label="Product name" value={row.registered_product_name} />
                  <FieldRow label="Manufacturer / registrant" value={row.registrant} />
                  <FieldRow label="Country" value={country ? countryLabel(row.registration_country) : null} />
                  <FieldRow label="Product category" value={row.product_category} />
                  <FieldRow label="Formulation / form" value={row.form_type} missing="review" />
                  <FieldRow label="Registration scheme" value={scheme ? scheme.toUpperCase() : null} missing="na" />
                  <FieldRow label="Registration number" value={regNumber || null} missing="na" />
                  <FieldRow label="Catalogue revision" value={row.catalogue_version != null ? String(row.catalogue_version) : null} missing="review" />
                  <FieldRow label="Review status" value={status} />
                </ReviewSection>

                {/* ------------------------------ B actives & resistance */}
                <ReviewSection title="Active ingredients & resistance" testId="section-actives">
                  {resistance && (
                    <FieldRow
                      label="Resistance classification"
                      value={resistance.state === "classified" ? `Classified · ${resistance.text}` : resistance.state === "not_applicable" ? "Not applicable" : `Unresolved · ${resistance.text}`}
                      state={resistance.state === "classified" ? "ok" : resistance.state === "not_applicable" ? "na" : "review"}
                    />
                  )}
                  <FieldRow label="Resistance scheme" value={row.activity_group_scheme} missing={resistance?.state === "not_applicable" ? "na" : "review"} />
                  {resistance && resistance.actives.length > 0 ? (
                    resistance.actives.map((a, i) => (
                      <div key={i} className="rounded border border-border/60 p-2 space-y-1">
                        <FieldRow label="Active ingredient" value={a.name} />
                        <FieldRow label="Concentration" value={a.concentration} />
                        <FieldRow
                          label="Resistance group"
                          value={a.group}
                          missing={resistance.state === "not_applicable" ? "na" : "review"}
                          emptyText={resistance.state === "not_applicable" ? "Not applicable" : "Unresolved"}
                        />
                      </div>
                    ))
                  ) : (
                    <FieldRow label="Active ingredients" value={null} />
                  )}
                </ReviewSection>

                {/* ------------------------------------- C vineyard uses */}
                <ReviewSection title="Vineyard uses" testId="section-uses">
                  {vineUses.length === 0 ? (
                    <FieldRow label="Grapevine registered uses" value={null} missing="na" emptyText="None on the register record" />
                  ) : (
                    vineUses.map((u, i) => (
                      <div key={i} className="rounded border border-border/60 p-2 text-xs space-y-0.5">
                        <div className="font-medium">{u.crop}</div>
                        <div>Target: {u.target_raw || u.target || <span className="text-warning">Not established</span>}</div>
                        {u.restrictions && <div className="text-muted-foreground">Condition: {u.restrictions}</div>}
                      </div>
                    ))
                  )}
                </ReviewSection>

                {/* ------------------------------------ D vineyard rates */}
                <ReviewSection
                  title="Vineyard rates"
                  testId="section-rates"
                  state={rates.length === 0 && vineyardRegistered ? "missing" : undefined}
                >
                  {rates.length === 0 ? (
                    <FieldRow
                      label="Registered vineyard rates"
                      value={null}
                      missing={vineyardRegistered ? "missing" : "na"}
                      emptyText={vineyardRegistered ? "Missing — registered for grapevine" : "Not applicable"}
                    />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(["per_hectare", "per_100_litres"] as MasterRateBasis[]).map((basis) => {
                        const grouped = groupRates(masterRatesForBasis(rates, basis).map(masterRateSummary));
                        return (
                          <div key={basis} className="rounded border border-border/60 p-2 text-xs">
                            <div className="mb-1 font-semibold">{MASTER_RATE_BASIS_LABEL[basis]}</div>
                            {grouped.length === 0 ? (
                              <div className="text-muted-foreground">None registered</div>
                            ) : (
                              <ul className="space-y-0.5">
                                {grouped.map(([text, n]) => (
                                  <li key={text}>{text}{n > 1 ? <span className="text-muted-foreground"> · {n} entries</span> : null}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Rates come only from the authoritative enrichment and review path — use Find Missing Data.
                  </p>
                </ReviewSection>

                {/* --------------------------------------- E safety / label */}
                <ReviewSection title="Safety / label details" testId="section-safety">
                  <FieldRow label="WHP" value={whps.join("; ") || null} missing={vineyardRegistered ? "review" : "na"} emptyText={vineyardRegistered ? "Not established" : "Not applicable"} />
                  <FieldRow label="REI" value={reis.join("; ") || null} missing={vineyardRegistered ? "review" : "na"} emptyText={vineyardRegistered ? "Not established" : "Not applicable"} />
                  <FieldRow label="Restrictions" value={restrictions.join("; ") || null} missing="na" emptyText="None stated" />
                  <FieldRow label="Label version" value={row.label_version} missing="review" emptyText="Not established" />
                </ReviewSection>

                {/* --------------------------------------------- F sources */}
                <ReviewSection title="Sources" testId="section-sources">
                  <FieldRow label="Manufacturer label" value={manufacturer?.url ?? null} link />
                  <FieldRow label="Manufacturer product page" value={productPage?.url ?? null} link missing="review" />
                  <FieldRow label="Regulatory / register source" value={regulator?.url ?? null} link missing="na" />
                  <FieldRow label="Source provenance" value={sources.length ? `${sources.length} recorded source(s)` : null} missing="review" />
                  <FieldRow label="Retrieved" value={row.retrieved_at?.slice(0, 10) ?? null} missing="review" />
                  <FieldRow label="Verified" value={row.verified_at?.slice(0, 10) ?? null} missing="review" emptyText="Not verified" />
                </ReviewSection>
              </div>

              {/* --------------------------------------- G outstanding issues */}
              <ReviewSection
                title="Outstanding issues"
                testId="section-issues"
                state={conflict ? "missing" : issues.length ? "review" : "ok"}
              >
                {conflict && (
                  <div data-status="missing" className="rounded border-2 border-destructive bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                    Evidence conflict — must be adjudicated
                  </div>
                )}
                {issues.length === 0 ? (
                  <div className="text-xs text-success inline-flex items-center gap-1">
                    <BadgeCheck className="h-3.5 w-3.5" /> Nothing missing for vineyard use.
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60 text-xs">
                    {issues.map((i) => (
                      <li key={`${i.key}:${i.field ?? ""}`} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className={`h-3.5 w-3.5 ${i.key === "conflict" ? "text-destructive" : "text-warning"}`} /> {i.label}
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => onIssueAction(i)}>
                          {MASTER_ISSUE_ACTION_LABEL[i.action]}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {unresolvedFields.length > 0 && (
                  <div className="text-[11px] text-warning">Unresolved fields: {unresolvedFields.join(", ")}</div>
                )}
              </ReviewSection>

              {/* ------------------------------------- manual corrections */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Manual corrections</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Registered product name">
                    <Input disabled={busy} value={txt(identity.registered_product_name)}
                      onChange={(e) => setIdentity((s) => ({ ...s, registered_product_name: e.target.value }))} />
                  </Field>
                  <Field label="Registrant / manufacturer">
                    <Input disabled={busy} value={txt(identity.registrant)}
                      onChange={(e) => setIdentity((s) => ({ ...s, registrant: e.target.value }))} />
                  </Field>
                  <Field label="Category">
                    <Input disabled={busy} placeholder="fungicide, insecticide, herbicide…" value={txt(identity.product_category)}
                      onChange={(e) => setIdentity((s) => ({ ...s, product_category: e.target.value }))} />
                  </Field>
                  <Field label="Form / type">
                    <Input disabled={busy} placeholder="SC, WG, EC…" value={txt(identity.form_type)}
                      onChange={(e) => setIdentity((s) => ({ ...s, form_type: e.target.value }))} />
                  </Field>
                  <Field label="Label link">
                    <Input disabled={busy} placeholder="https://…" value={txt(identity.label_reference)}
                      onChange={(e) => setIdentity((s) => ({ ...s, label_reference: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Reason / review note">
                  <Textarea rows={2} disabled={busy} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </section>
            </div>

            <div className="sticky bottom-0 z-10 border-t border-border/60 bg-background px-6 py-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" disabled={!props.hasPrevious || busy} onClick={props.onPrevious}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.hasNext || busy} onClick={props.onNext}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={props.onNextAttention}>
                <SkipForward className="h-4 w-4 mr-1" /> Next needing attention
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runSave()}>
                <Save className="h-4 w-4 mr-1" /> Save corrections
              </Button>
              {draftIssueCount > 0 ? (
                <Button size="sm" disabled={busy} onClick={() => setFindSignal((n) => n + 1)}>
                  <SearchCheck className="h-4 w-4 mr-1" /> Find Missing Data
                </Button>
              ) : row.review_status !== "approved" ? (
                <>
                  {issues.filter((i) => RELEASE_WARNING_KEYS.has(i.key)).length > 0 && (
                    <span className="text-xs text-muted-foreground" data-testid="release-warnings-note">
                      {issues.filter((i) => RELEASE_WARNING_KEYS.has(i.key)).length} warning(s) stay visible after approval
                    </span>
                  )}
                  <Button size="sm" disabled={busy} onClick={runApprove}>
                    <BadgeCheck className="h-4 w-4 mr-1" /> Approve &amp; Next
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------- field statuses */

export type FieldStatus = "ok" | "review" | "missing" | "na";

export const FIELD_STATUS_CLASS: Record<FieldStatus, string> = {
  ok: "border-l-4 border-success",
  review: "border-l-4 border-warning bg-warning/10",
  missing: "border-l-4 border-destructive bg-destructive/10",
  na: "border-l-4 border-border",
};

const DEFAULT_EMPTY: Record<FieldStatus, string> = {
  ok: "—",
  review: "Not established",
  missing: "Missing",
  na: "Not applicable",
};

const uniq = (xs: string[]) => Array.from(new Set(xs));

/** Collapse duplicated raw rate lines into canonical text + count. */
function groupRates(lines: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return Array.from(m.entries());
}

function FieldRow({
  label, value, state, missing = "missing", emptyText, link,
}: {
  label: string;
  value: string | null | undefined;
  /** Explicit status; otherwise present → ok, absent → `missing`. */
  state?: FieldStatus;
  missing?: FieldStatus;
  emptyText?: string;
  link?: boolean;
}) {
  const v = value == null ? "" : String(value).trim();
  const st: FieldStatus = state ?? (v ? "ok" : missing);
  return (
    <div data-status={st} data-field={label} className={`flex flex-wrap items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-xs ${FIELD_STATUS_CLASS[st]}`}>
      <span className="text-muted-foreground">{label}</span>
      {v ? (
        link ? (
          <a href={v} target="_blank" rel="noopener noreferrer" className="max-w-[70%] truncate font-medium underline">{v}</a>
        ) : (
          <span className="font-medium text-right break-words">{v}</span>
        )
      ) : (
        <span className={`font-semibold ${st === "missing" ? "text-destructive" : st === "review" ? "text-warning" : "text-muted-foreground"}`}>
          {emptyText ?? DEFAULT_EMPTY[st]}
        </span>
      )}
    </div>
  );
}

function ReviewSection({
  title, testId, state, children,
}: { title: string; testId: string; state?: FieldStatus; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`space-y-1.5 rounded-md border p-3 ${state === "missing" ? "border-2 border-destructive" : state === "review" ? "border-warning/60" : "border-border/60"}`}
    >
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
