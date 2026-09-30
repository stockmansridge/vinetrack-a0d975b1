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
  MASTER_ISSUE_ACTION_LABEL, masterIssues, masterReleaseBlockers, masterReleaseWarnings, masterManufacturerLabel, masterProductPage,
  masterRegulatorReference, masterResistanceStatus, masterVineyardUses, type MasterIssue,
} from "@/lib/masterWorkbench";
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
}

export function MasterCurationDrawer(props: MasterCurationDrawerProps) {
  const { row, open, onOpenChange } = props;
  const [identity, setIdentity] = useState<MasterCurationIdentity>({});
  const [reason, setReason] = useState("");
  const [findSignal, setFindSignal] = useState(0);

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
  }, [row?.id]);

  const issues = useMemo(() => (row ? masterIssues(row) : []), [row]);
  // Readiness with the entered (unsaved) whitelisted corrections applied — only
  // decides which button shows; approval re-checks the confirmed saved record.
  const draftIssueCount = useMemo(
    () =>
      row
        ? masterReleaseBlockers({ ...row, ...buildMasterCurationPatch({ row, identity, reason }) } as MasterChemicalRow).length
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
      toast({ title: "Not approved", description: e?.message ?? String(e), variant: "destructive" });
      return;
    }
    if (res.outcome !== "save_failed" && res.outcome !== "save_unknown" && res.saved) props.onSaved?.();
    if (res.outcome === "approved") {
      toast({ title: res.saved ? "Corrections saved and approved" : "Approved" });
      if (!res.saved) props.onSaved?.();
      if (currentIdRef.current === startedId) props.onNextAttention?.();
      return;
    }
    toast({
      title:
        res.outcome === "save_failed"
          ? "Not saved — not approved"
          : res.outcome === "save_unknown"
            ? "Save result unknown — not approved"
          : res.outcome === "save_unconfirmed"
            ? "Save not confirmed — not approved"
              : "Not approved",
      description: res.message,
      variant: "destructive",
    });
  };

  const onIssueAction = (i: MasterIssue) => {
    if (busy) return;
    if (i.action === "review_conflict") props.onReviewConflict?.();
    else setFindSignal((n) => n + 1);
  };

  const status = row
    ? MASTER_REVIEW_STATUS_LABEL[(row.review_status as MasterReviewStatus) ?? "candidate"] ?? row.review_status
    : "";

  return (
    <Sheet open={open} onOpenChange={guardedOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto"
        aria-busy={busy || undefined}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        {!row ? null : (
          <>
            <SheetHeader className="space-y-2">
              <SheetTitle className="text-base">
                {row.registered_product_name?.trim() || "Unnamed product"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {row.registration_number?.trim() ? `APVMA ${row.registration_number.trim()}` : "No APVMA number"}
                {row.registrant?.trim() ? ` · ${row.registrant.trim()}` : ""}
                {row.product_category?.trim() ? ` · ${row.product_category.trim()}` : ""}
                {props.position ? ` · Record ${props.position.index + 1} of ${props.position.total}` : ""}
              </SheetDescription>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">{status}</Badge>
                <Badge variant="outline" className="text-[10px]">
                  {issues.length ? `Needs attention (${issues.length})` : "Complete"}
                </Badge>
              </div>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              {/* ---------------------------------------- missing checklist */}
              <section className="rounded-md border border-border/60" aria-label="Missing / needs review">
                <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
                  Missing / needs review
                </div>
                {issues.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-primary inline-flex items-center gap-1">
                    <BadgeCheck className="h-3.5 w-3.5" /> Nothing missing for vineyard use.
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60 text-xs">
                    {issues.map((i) => (
                      <li key={`${i.key}:${i.field ?? ""}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" /> {i.label}
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => onIssueAction(i)}>
                          {MASTER_ISSUE_ACTION_LABEL[i.action]}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* --------------------------------------------- source links */}
              <section className="flex flex-wrap gap-2">
                <SourceButton label="Open Manufacturer Label" url={manufacturer?.url} />
                <SourceButton label="Open APVMA / regulator reference" url={regulator?.url} />
                <SourceButton label="Open Product Page" url={productPage?.url} />
              </section>

              {/* --------------------------------------- find missing data */}
              <MasterFindMissingData
                row={row}
                trigger={findSignal}
                disabled={busy}
                onApplied={() => props.onSaved?.()}
                onNextIncomplete={props.onNextAttention}
              />

              {/* ---------------------------------------------- resistance */}
              {resistance && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground">Resistance classification</h3>
                  <div className="text-xs">
                    <span className="font-medium">
                      {resistance.state === "classified" ? "Classified" : resistance.state === "not_applicable" ? "Not applicable" : "Unresolved"}
                    </span>
                    {" · "}
                    {resistance.text}
                  </div>
                  {resistance.actives.length > 0 ? (
                    <div className="rounded-md border border-border/60 divide-y divide-border/60 text-xs">
                      {resistance.actives.map((a, i) => (
                        <div key={i} className="px-3 py-2">
                          <div className="font-medium">
                            {a.name}
                            {a.concentration ? ` · ${a.concentration}` : " · No concentration"}
                          </div>
                          <div className="text-muted-foreground">
                            {a.group ?? (resistance.state === "not_applicable" ? "No resistance group applies" : "Group unresolved")}
                            {" · "}
                            {a.group && resistance.state === "classified" ? "Authoritative classification" : "Not classified"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No active ingredients recorded.</div>
                  )}
                </section>
              )}

              {/* ----------------------------------- vineyard registration */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Vineyard registration</h3>
                {vineUses.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No grapevine use on the register record.</div>
                ) : (
                  <div className="rounded-md border border-border/60 divide-y divide-border/60 text-xs">
                    {vineUses.map((u, i) => (
                      <div key={i} className="px-3 py-2 space-y-0.5">
                        <div className="font-medium">{u.crop} · {u.target_raw || u.target || "—"}</div>
                        <div className="text-muted-foreground">
                          {u.rates.length
                            ? u.rates.map((r) => r.label || r.raw_text).filter(Boolean).join("; ")
                            : "Rate not stated"}
                          {u.withholding_period_days != null ? ` · WHP ${u.withholding_period_days} d` : " · WHP unresolved"}
                          {u.re_entry_period_hours != null ? ` · REI ${u.re_entry_period_hours} h` : " · REI unresolved"}
                        </div>
                        {u.restrictions && <div className="text-muted-foreground">{u.restrictions}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ---------------------------------- registered vineyard rates */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Registered vineyard rates</h3>
                {rates.length === 0 ? (
                  <div className="text-xs text-warning">
                    {vineUses.length ? "Registered for grapevine — rate still unresolved" : "No vineyard rates"}
                  </div>
                ) : (
                  (["per_hectare", "per_100_litres"] as MasterRateBasis[]).map((basis) => {
                    const list = masterRatesForBasis(rates, basis);
                    if (!list.length) return null;
                    return (
                      <div key={basis} className="text-xs">
                        <span className="font-medium">{MASTER_RATE_BASIS_LABEL[basis]}: </span>
                        {list.map(masterRateSummary).join("; ")}
                      </div>
                    );
                  })
                )}
                <p className="text-[11px] text-muted-foreground">
                  Vineyard rates come only from the authoritative enrichment and review path — they
                  can't be typed in here. Use Find Missing Data, or open the label for reference.
                </p>
              </section>

              {/* ------------------------------------- manual corrections */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Manual corrections</h3>
                <div className="grid gap-2 sm:grid-cols-2">
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

            <div className="sticky bottom-0 mt-4 -mx-6 border-t border-border/60 bg-background px-6 py-3 flex flex-wrap items-center gap-2">
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
                  {masterReleaseWarnings(row).length > 0 && (
                    <span className="text-xs text-muted-foreground" data-testid="release-warnings-note">
                      {masterReleaseWarnings(row).length} warning(s) stay visible after approval
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

function SourceButton({ label, url }: { label: string; url?: string | null }) {
  if (!url) {
    return (
      <Button size="sm" variant="outline" disabled>
        {label.replace("Open ", "No ")}
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label} <ExternalLink className="h-3.5 w-3.5 ml-1" />
      </a>
    </Button>
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
