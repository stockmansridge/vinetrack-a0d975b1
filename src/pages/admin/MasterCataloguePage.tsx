// System Admin — VineTrack Master Chemical Catalogue review.
//
// The catalogue itself lives in the shared VineTrack backend (SQL 199). This
// page is a review surface only: it lists candidates, approved and retired
// products, shows the full structured intelligence and evidence for a record,
// and asks the backend to approve or retire it. The backend's RLS and evidence
// rules stay authoritative — a refusal is surfaced, never worked around.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, History, RefreshCw, Search, ShieldOff, Download } from "lucide-react";
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
import { MasterReviewPreviewDialog } from "@/components/chemicals/MasterReviewPreviewDialog";
import { MasterReviewSummaryCard } from "@/components/chemicals/MasterReviewSummaryCard";
import { masterReviewSummary, type ClassifiedConflict } from "@/lib/masterReview";
import {
  identityFieldsCorrectable,
  unresolvedFieldAction,
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
  const [status, setStatus] = useState<MasterReviewStatus>("candidate");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MasterChemicalRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const q = useQuery({
    queryKey: [...QK, status],
    queryFn: () => listMasterChemicals({ status }),
  });

  const rows = useMemo(() => {
    const list = q.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((r) =>
      [r.registered_product_name, r.registrant, r.registration_number, r.registration_country]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [q.data, search]);

  return (
    <div className="space-y-4">
      <AdminError error={q.error} />

      <Tabs value={status} onValueChange={(v) => setStatus(v as MasterReviewStatus)}>
        <TabsList>
          <TabsTrigger value="candidate">Candidates</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="retired">Retired</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
        </div>

        <TabsContent value={status} className="mt-3">
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <AdminEmpty>
              No {MASTER_REVIEW_STATUS_LABEL[status].toLowerCase()} records.
            </AdminEmpty>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {rows.map((row) => (
                <RowCard key={row.id} row={row} onOpen={() => setSelected(row)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ApvmaImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        invalidateKey={QK}
        onReview={(row) => setSelected(row)}
      />

      {selected && (
        <ReviewDialog
          row={selected}
          open={!!selected}
          onOpenChange={(v) => !v && setSelected(null)}
        />
      )}
    </div>
  );
}

function RowCard({ row, onOpen }: { row: MasterChemicalRow; onOpen: () => void }) {
  const readiness = approvalReadiness(row);
  const draft = masterChemicalDraft(row);
  return (
    <Card className="p-3 space-y-1.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {row.registered_product_name?.trim() || "Unnamed product"}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.registrant?.trim() || "Registrant unknown"} · {masterIdentityKey(row) ?? "no registration"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {countryLabel(row.registration_country)} registration
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge className="border-transparent bg-primary/15 text-primary text-[10px]">
            {vineyardCountryCode(row.registration_country) ?? "No country"}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            rev {masterRevision(row) ?? "—"}
          </Badge>
          {row.verification_status && (
            <Badge variant="outline" className="text-[10px]">
              {String(row.verification_status).replace(/_/g, " ")}
            </Badge>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {draft.actives.length
          ? draft.actives.map((a) => a.name).join(" + ")
          : "No structured actives"}
      </div>
      <div className="flex items-center justify-between gap-2">
        {readiness.ready ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
            <BadgeCheck className="h-3.5 w-3.5" /> Evidence complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" /> {readiness.reasons.length} issue(s)
          </span>
        )}
        <Button size="sm" variant="outline" onClick={onOpen}>
          Review
        </Button>
      </div>
    </Card>
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

          <div>
            <div className="text-xs text-muted-foreground mb-1">Review notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
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
