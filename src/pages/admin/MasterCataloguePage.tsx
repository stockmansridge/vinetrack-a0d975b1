// System Admin — VineTrack Master Chemical Catalogue review.
//
// The catalogue itself lives in the shared VineTrack backend (SQL 199). This
// page is a review surface only: it lists candidates, approved and retired
// products, shows the full structured intelligence and evidence for a record,
// and asks the backend to approve or retire it. The backend's RLS and evidence
// rules stay authoritative — a refusal is surfaced, never worked around.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, History, KeyRound, PencilLine, RefreshCw, Search, ShieldOff, Download } from "lucide-react";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty } from "./_shared";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { MasterChemicalCard } from "@/components/chemicals/MasterChemicalCard";
import { MasterEvidencePanel } from "@/components/chemicals/MasterEvidencePanel";
import { ApvmaImportDialog } from "@/components/chemicals/ApvmaImportDialog";
import { MasterCatalogueRefreshDialog } from "@/components/chemicals/MasterCatalogueRefreshDialog";
import { MasterReviewPreviewDialog } from "@/components/chemicals/MasterReviewPreviewDialog";
import { MasterReviewSummaryCard } from "@/components/chemicals/MasterReviewSummaryCard";
import { masterReviewSummary, type ClassifiedConflict } from "@/lib/masterReview";
import {
  identityFieldsCorrectable,
  readinessReasonAction,
  type MasterCorrectableField,
} from "@/lib/masterReviewActions";
import { MasterCorrectionDialog } from "@/components/chemicals/MasterCorrectionDialog";
import { MasterAdjudicateDialog } from "@/components/chemicals/MasterAdjudicateDialog";
import { MasterIdentityRekeyDialog } from "@/components/chemicals/MasterIdentityRekeyDialog";
import { MasterReviewHistory } from "@/components/chemicals/MasterReviewHistory";
import { MasterActionBadge } from "@/components/chemicals/MasterActionBadge";
import {
  approvalReadiness,
  fetchMasterVersions,
  listMasterChemicals,
  masterChemicalDraft,
  masterIdentityKey,
  masterRevision,
  setMasterReviewStatus,
  MASTER_REVIEW_STATUS_LABEL,
  type MasterChemicalRow,
  type MasterReviewStatus,
} from "@/lib/masterChemicals";
import { countryLabel, vineyardCountryCode } from "@/lib/chemicalJurisdiction";
import { MasterCurationDrawer } from "@/components/chemicals/MasterCurationDrawer";
import {
  MASTER_QUEUE_FILTERS,
  filterMasterQueue,
  nextAttentionId,
  nextQueueId,
  previousQueueId,
  type MasterQueueFilter,
} from "@/lib/masterCuration";
import {
  VINEYARD_RATE_STATUS_LABEL,
  masterHasConflict,
  masterHealthCounts,
  masterIssues,
  masterManufacturerLabel,
  masterRegulatorReference,
  masterResistanceStatus,
  vineyardRateStatus,
  vineyardRelevantUnresolved,
} from "@/lib/masterWorkbench";

const QK = ["admin", "master-chemicals"] as const;

export default function MasterCataloguePage() {
  return (
    <AdminGate>
      <div className="p-4 md:p-6">
        <AdminPageHeader
          title="Master Chemical Catalogue"
          subtitle="Review, approve and retire the shared VineTrack verified chemical records."
        />
        <CatalogueBody />
      </div>
    </AdminGate>
  );
}

function CatalogueBody() {
  const [filter, setFilter] = useState<MasterQueueFilter>("needs_attention");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deep, setDeep] = useState<MasterChemicalRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // System Admin maintenance only — never a vineyard-user feature.
  const [refreshOpen, setRefreshOpen] = useState(false);
  // Latest (persisted, resumable) rehydration run + the temporary review queue.
  const [runState, setRunState] = useState<RefreshRunState | null>(() => readStoredRefreshState());
  const [runQueue, setRunQueue] = useState(false);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: [...QK, "queue"],
    queryFn: () => listMasterChemicals({}),
  });

  // Rehydration scope is ALWAYS every candidate in the unfiltered catalogue.
  const rehydrateIds = useMemo(() => rehydrationScopeIds(q.data ?? []), [q.data]);
  const runIds = useMemo(() => new Set(rehydratedQueueIds(runState)), [runState]);
  const retryCount = retryableRunIds(runState).length;

  const queue = useMemo(() => {
    if (!runQueue) return filterMasterQueue(q.data ?? [], filter, search);
    const byId = new Map((q.data ?? []).map((r) => [r.id, r]));
    // Approved rows leave the candidate review queue.
    return rehydratedQueueIds(runState)
      .map((id) => byId.get(id))
      .filter((r): r is MasterChemicalRow => !!r && (r.review_status ?? "candidate") === "candidate")
      .filter((r) => !search.trim() || filterMasterQueue([r], "all", search).length > 0);
  }, [q.data, filter, search, runQueue, runState]);

  // Stay on the record after an apply even if it just left the current filter.
  const selected =
    queue.find((r) => r.id === selectedId) ?? (q.data ?? []).find((r) => r.id === selectedId) ?? null;
  const index = selected ? queue.findIndex((r) => r.id === selected.id) : -1;
  const health = useMemo(() => masterHealthCounts(q.data ?? []), [q.data]);

  const openId = (id: string | null) => setSelectedId(id);
  const chooseFilter = (f: MasterQueueFilter) => {
    setRunQueue(false);
    setFilter(f);
  };

  const cards: Array<{ label: string; value: number; filter: MasterQueueFilter }> = [
    { label: "Total chemicals", value: health.total, filter: "all" },
    { label: "Needs attention", value: health.needsAttention, filter: "needs_attention" },
    { label: "Resistance unresolved", value: health.resistanceUnresolved, filter: "resistance_unresolved" },
    { label: "Missing resistance group", value: health.missingGroup, filter: "missing_group" },
    { label: "Missing vineyard rates", value: health.missingRates, filter: "missing_rate" },
    { label: "Vineyard use but no vineyard rates", value: health.vineyardMissingRates, filter: "vineyard_missing_rates" },
    { label: "Missing label", value: health.missingLabel, filter: "manufacturer_label_missing" },
    { label: "Evidence conflicts", value: health.conflicts, filter: "conflicts" },
    { label: "Missing category", value: health.missingCategory, filter: "missing_category" },
    { label: "Complete", value: health.complete, filter: "complete" },
  ];

  return (
    <div className="space-y-3">
      <AdminError error={q.error} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => chooseFilter(c.filter)}
            className={`rounded-md border p-2 text-left hover:bg-muted/50 ${
              !runQueue && filter === c.filter ? "border-primary bg-primary/10" : "border-border/60"
            }`}
          >
            <div className="text-lg font-semibold">{q.isLoading ? "…" : c.value}</div>
            <div className="text-[11px] text-muted-foreground">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {MASTER_QUEUE_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={!runQueue && filter === f.key ? "default" : "outline"}
            onClick={() => chooseFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        {runIds.size > 0 && (
          <Button size="sm" variant={runQueue ? "default" : "outline"} onClick={() => setRunQueue(true)}>
            Rehydrated this run ({runIds.size})
          </Button>
        )}
        {retryCount > 0 && (
          <span className="text-xs text-destructive">{retryCount} failed / unavailable — resume rehydration to retry</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search product, registrant or registration number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Download className="h-4 w-4 mr-1" /> Import from APVMA
        </Button>
        <Button
          variant="outline"
          onClick={() => setRefreshOpen(true)}
          disabled={rehydrateIds.length === 0}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Rehydrate Master Catalogue
        </Button>
        <span className="text-xs text-muted-foreground">{queue.length} record(s)</span>
      </div>

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : queue.length === 0 ? (
        <AdminEmpty>Nothing matches this filter.</AdminEmpty>
      ) : (
        <Card className="divide-y divide-border/60">
          {queue.map((row) => (
            <QueueRow
              key={row.id}
              row={row}
              active={row.id === selectedId}
              runRow={runState?.rows[row.id]}
              runAt={runState?.updatedAt}
              onOpen={() => openId(row.id)}
              onEvidence={() => setDeep(row)}
            />
          ))}
        </Card>
      )}

      <MasterCurationDrawer
        row={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setSelectedId(null)}
        position={index >= 0 ? { index, total: queue.length } : undefined}
        hasPrevious={index > 0}
        hasNext={index >= 0 && index < queue.length - 1}
        onPrevious={() => openId(previousQueueId(queue, selectedId))}
        onNext={() => openId(nextQueueId(queue, selectedId))}
        onNextAttention={() => openId(nextAttentionId(queue, selectedId))}
        onApprovedNext={(approvedId) =>
          openId(
            runQueue
              ? nextQueueId(queue.filter((r) => r.id !== approvedId || true), approvedId)
              : nextAttentionId(queue, approvedId),
          )
        }
        onSaved={() => queryClient.invalidateQueries({ queryKey: QK })}
        onReviewConflict={() => selected && setDeep(selected)}
      />

      <MasterCatalogueRefreshDialog
        open={refreshOpen}
        onOpenChange={setRefreshOpen}
        ids={rehydrateIds}
        onProgress={setRunState}
        onFinished={() => queryClient.invalidateQueries({ queryKey: QK })}
        onReview={(s) => {
          setRunState(s);
          setRefreshOpen(false);
          setRunQueue(true);
          setSearch("");
          const first = rehydratedQueueIds(s).find((id) =>
            (q.data ?? []).some((r) => r.id === id && (r.review_status ?? "candidate") === "candidate"),
          );
          openId(first ?? null);
        }}
      />

      <ApvmaImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        invalidateKey={QK}
        onReview={(row) => openId(row.id)}
      />

      {deep && (
        <ReviewDialog row={deep} open={!!deep} onOpenChange={(v) => !v && setDeep(null)} />
      )}
    </div>
  );
}

/** One scannable queue row. The full registered_uses structure is never shown here. */
function QueueRow({
  row,
  active,
  onOpen,
  onEvidence,
}: {
  row: MasterChemicalRow;
  active: boolean;
  onOpen: () => void;
  onEvidence: () => void;
}) {
  const issues = masterIssues(row);
  const resistance = masterResistanceStatus(row);
  const rateStatus = vineyardRateStatus(row);
  const manufacturer = masterManufacturerLabel(row);
  const regulator = masterRegulatorReference(row);
  const conflict = masterHasConflict(row);
  const unresolved = vineyardRelevantUnresolved(row).length;
  const status = MASTER_REVIEW_STATUS_LABEL[
    (row.review_status as MasterReviewStatus) ?? "candidate"
  ] ?? row.review_status;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${
        active ? "bg-muted/60" : ""
      }`}
    >
      <div className="min-w-[200px] flex-1">
        <div className="font-medium">{row.registered_product_name?.trim() || "Unnamed product"}</div>
        <div className="text-xs text-muted-foreground">
          {row.registration_number?.trim() || "No APVMA number"}
          {row.registrant?.trim() ? ` · ${row.registrant.trim()}` : ""}
          {row.product_category?.trim() ? ` · ${row.product_category.trim()}` : " · No category"}
        </div>
      </div>

      <Badge
        variant="outline"
        className={`text-[10px] ${resistance.state === "unresolved" || resistance.incomplete ? "border-warning/50 text-warning" : ""}`}
      >
        {resistance.text}
      </Badge>

      <Badge
        variant="outline"
        className={`text-[10px] ${rateStatus === "vineyard_missing" ? "border-destructive/50 text-destructive" : ""}`}
      >
        {VINEYARD_RATE_STATUS_LABEL[rateStatus]}
      </Badge>

      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-[10px]">
          {manufacturer ? "Manufacturer label" : "No manufacturer label"}
        </Badge>
        {regulator && <Badge variant="outline" className="text-[10px]">APVMA evidence</Badge>}
        {conflict && <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">Conflict</Badge>}
        {unresolved > 0 && <Badge variant="outline" className="text-[10px]">{unresolved} unresolved</Badge>}
      </div>

      <Badge variant="secondary" className="text-[10px]">{status}</Badge>

      {issues.length > 0 ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5" /> Needs attention ({issues.length})
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-primary">
          <BadgeCheck className="h-3.5 w-3.5" /> Complete
        </span>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onEvidence();
        }}
      >
        Evidence
      </Button>
    </div>
  );
}

function ReviewDialog({
  row,
  open,
  onOpenChange,
}: {
  row: MasterChemicalRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(row.review_notes ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctField, setCorrectField] = useState<MasterCorrectableField | null>(null);
  const [adjudicating, setAdjudicating] = useState<ClassifiedConflict | null>(null);
  const [rekeyOpen, setRekeyOpen] = useState(false);
  // null until a preview has actually been run in this session.
  const [fresherAvailable, setFresherAvailable] = useState<boolean | null>(null);
  const readiness = approvalReadiness(row);
  const draft = masterChemicalDraft(row);
  const current = row.review_status;
  const canRekey = identityFieldsCorrectable(row);

  const openCorrection = (field?: MasterCorrectableField | null) => {
    setCorrectField(field ?? null);
    setCorrectOpen(true);
  };

  const versions = useQuery({
    queryKey: [...QK, "versions", row.id],
    enabled: open,
    queryFn: () => fetchMasterVersions(row.id),
  });

  const mut = useMutation({
    mutationFn: (status: MasterReviewStatus) => setMasterReviewStatus(row.id, status, notes),
    onSuccess: (_d, status) => {
      toast({ title: `Marked ${MASTER_REVIEW_STATUS_LABEL[status].toLowerCase()}` });
      qc.invalidateQueries({ queryKey: QK });
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Not applied", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {row.registered_product_name?.trim() || "Master chemical"}
            <Badge className="border-transparent bg-primary/15 text-primary text-[11px]">
              {vineyardCountryCode(row.registration_country) ?? "No country"} ·{" "}
              {masterIdentityKey(row) ?? "no registration"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Current status: {MASTER_REVIEW_STATUS_LABEL[(current as MasterReviewStatus) ?? "candidate"] ?? current}.
            Approval applies to the {countryLabel(row.registration_country)} registration only —
            it does not make this product verified in other jurisdictions.
            Approval and retirement are enforced by the VineTrack backend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <MasterReviewSummaryCard
            summary={masterReviewSummary(row, {
              blockingReasons: readiness.reasons,
              fresherAvailable,
            })}
          />

          <MasterChemicalCard master={row} />

          <MasterEvidencePanel
            row={row}
            onAdjudicate={(item) => setAdjudicating(item)}
            onCorrect={(f) => openCorrection(f)}
            onRefresh={() => setPreviewOpen(true)}
          />

          {!readiness.ready && (
            <div className="rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
                Evidence gaps ({readiness.reasons.length})
              </div>
              <div className="divide-y divide-border/60 text-xs">
                {readiness.reasons.map((r, i) => {
                  const act = readinessReasonAction(r, row);
                  return (
                    <div key={i} className="px-3 py-2 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-words">{r}</span>
                        <MasterActionBadge kind={act.kind} />
                      </div>
                      <div className="text-[11px] text-muted-foreground">{act.detail}</div>
                      {act.kind === "admin_correction_available" && act.correctField && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCorrection(act.correctField)}
                        >
                          Correct {act.correctField.replace(/_/g, " ")}
                        </Button>
                      )}
                      {act.kind === "refresh_from_apvma" && (
                        <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
                          Preview APVMA update
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {draft.registeredUses.length > 0 && (
            <div className="rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
                {countryLabel(row.registration_country)} registered uses ({draft.registeredUses.length})
              </div>
              <div className="divide-y divide-border/60 text-xs">
                {draft.registeredUses.map((u, i) => (
                  <div key={i} className="px-3 py-2">
                    <div className="font-medium">
                      {u.crop || "—"} · {u.target_raw || u.target || "—"}
                    </div>
                    <div className="text-muted-foreground">
                      {u.rates.map((r) => r.label).join("; ") || "No rates"}
                      {u.withholding_period_days != null ? ` · WHP ${u.withholding_period_days} d` : ""}
                      {u.re_entry_period_hours != null ? ` · REI ${u.re_entry_period_hours} h` : ""}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                Registered uses, rates, withholding periods and re-entry intervals are typed,
                evidence-level data. They cannot be edited or adjudicated from the portal — a gap
                here is only closed by an authoritative APVMA preview and apply.
              </div>
            </div>
          )}

          <div className="rounded-md border border-border/60">
            <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
              <History className="h-3.5 w-3.5" /> Revision history
            </div>
            <div className="divide-y divide-border/60 text-xs">
              {(versions.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-muted-foreground">No recorded revisions.</div>
              ) : (
                (versions.data ?? []).map((v) => (
                  <div key={v.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span>
                      {vineyardCountryCode(row.registration_country) ?? "??"} · rev{" "}
                      {v.catalogue_version ?? "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {v.change_reason || "—"} · {v.changed_at?.slice(0, 10) ?? "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <MasterReviewHistory masterChemicalId={row.id} enabled={open} />

          <div>
            <div className="text-xs text-muted-foreground mb-1">Review notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" onClick={() => openCorrection(null)}>
            <PencilLine className="h-4 w-4 mr-1" /> Correct fields
          </Button>
          {canRekey && (
            <Button variant="outline" onClick={() => setRekeyOpen(true)}>
              <KeyRound className="h-4 w-4 mr-1" /> Correct identity
            </Button>
          )}
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Preview APVMA update
          </Button>
          {current !== "retired" && (
            <Button
              variant="outline"
              disabled={mut.isPending}
              onClick={() => mut.mutate("retired")}
            >
              <ShieldOff className="h-4 w-4 mr-1" /> Retire
            </Button>
          )}
          {current !== "approved" && (
            <Button disabled={mut.isPending} onClick={() => mut.mutate("approved")}>
              <BadgeCheck className="h-4 w-4 mr-1" /> Approve{" "}
              {vineyardCountryCode(row.registration_country) ?? ""}
            </Button>
          )}
        </DialogFooter>

        <MasterCorrectionDialog
          row={row}
          open={correctOpen}
          onOpenChange={setCorrectOpen}
          focusField={correctField}
          invalidateKey={QK}
        />

        <MasterAdjudicateDialog
          row={row}
          item={adjudicating}
          open={!!adjudicating}
          onOpenChange={(v) => !v && setAdjudicating(null)}
          invalidateKey={QK}
        />

        {canRekey && (
          <MasterIdentityRekeyDialog
            row={row}
            open={rekeyOpen}
            onOpenChange={setRekeyOpen}
            invalidateKey={QK}
          />
        )}

        <MasterReviewPreviewDialog
          row={row}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          invalidateKey={QK}
          onApplied={(res) => {
            const ok = res.outcome === "applied" || res.outcome === "already_applied";
            setFresherAvailable(res.outcome === "applied" ? false : fresherAvailable);
            versions.refetch();
            toast({
              title: ok
                ? res.outcome === "applied"
                  ? `Applied — revision ${res.revision ?? "updated"}`
                  : "Already applied"
                : "Not applied",
              description: res.message,
              variant: ok ? undefined : "destructive",
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
