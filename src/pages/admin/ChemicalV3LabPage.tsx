// Chemical Lookup V3 Lab — System Admin prototype. Independent of the Master
// catalogue, Chemical Search V1/V2 and vineyard saved chemicals.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChemicalSearchDialog } from "@/components/chemicals/ChemicalSearchDialog";
import { V3ReSearchButton } from "@/components/chemicals/V3ReSearchButton";
import { canReSearch, needsReSearch } from "@/lib/chemicalV3";
import { V3ReviewDecisions } from "@/components/chemicals/V3ReviewDecisions";
import { ChemicalInventoryPanel } from "@/components/chemicals/ChemicalInventoryPanel";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { v3EntryBadge } from "@/lib/chemicalInventory";
import {
  APPROVED_TOAST, DECISIONS_REQUIRED, approvedRevisionId, fetchApprovedCatalogue, fetchReviewIssues,
  findSavedForV3, vineyardChemicalsKey, approvalPanelFor, isDecisionsRefusal, isPendingQueueRow, outstandingWithoutIssue,
  labelFingerprintView,
} from "@/lib/chemicalV3Review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, ExternalLink, FlaskConical, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RateColumn, V3DataSummary, V3Warnings, VineyardUsesSection, type RateEditHandlers } from "@/components/chemicals/V3ReviewData";
import { V3RateEditor } from "@/components/chemicals/V3RateEditor";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { VINEYARD_COUNTRIES, resolveVineyardCountry } from "@/lib/vineyardCountries";
import {
  FRESHNESS_LABEL, V3_BACKEND_MISSING, V3_REUSED_MESSAGE, V3_TERMINAL_STATUSES,
  approveV3, asList, fetchV3Job, fetchV3Revision, freshnessNote, freshnessOf, humaniseStage,
  isApprovedResult, labelOf, pick, rejectV3, searchV3, signedV3MediaUrl, splitRates,
  startV3Discovery, uploadV3SearchPhoto, v3ReviewQueue,
  deleteV3RateOption, draftFromOption, emptyRateDraft, formatRateOption, isV3RevisionEditable, saveV3RateOption,
  type V3RateBasis, type V3RateDraft,
} from "@/lib/chemicalV3";
import { canUseInventoryPilot, fetchProductCategories, isV3Addable, setV3ProductCategory, v3CategoryLabel, type CategoryOption } from "@/lib/chemicalInventory";
import { V3AddToVineyardButton } from "@/components/chemicals/V3AddToVineyardDialog";
import { V3ResistanceBadge, V3ResistanceField } from "@/components/chemicals/V3ResistanceField";
import { isV3ResistanceEditable, setV3ResistanceGroups, type V3ResistanceDraft } from "@/lib/chemicalV3Resistance";

function useCategories() {
  return useQuery({ queryKey: ["chemical-product-categories"], staleTime: 10 * 60_000, queryFn: fetchProductCategories });
}
function usePilotVineyard() {
  const { selectedVineyardId, memberships } = useVineyard();
  const name = memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  return { vineyardId: selectedVineyardId, vineyardName: name };
}

type Row = Record<string, any>;
const JOB_KEY = "vt.chemical-v3.current-job";
const NO_COUNTRY = "__none";

const STATUS_CLASS = {
  ok: "border-success/40 bg-success/10",
  review: "border-warning/50 bg-warning/10",
  missing: "border-destructive/40 bg-destructive/10",
  na: "border-border bg-muted/40 text-muted-foreground",
} as const;
type FieldStatus = keyof typeof STATUS_CLASS;

function useSignedImage(path: string | undefined) {
  return useQuery({
    queryKey: ["chemical-v3-media", path ?? null],
    enabled: !!path,
    staleTime: 30 * 60_000,
    queryFn: () => signedV3MediaUrl(path),
  });
}

function Thumb({ path, className }: { path?: string; className?: string }) {
  const { data } = useSignedImage(path);
  if (!path) return null;
  return data ? (
    <img src={data} alt="Front label" className={cn("rounded border object-contain bg-muted", className)} />
  ) : (
    <div className={cn("rounded border bg-muted", className)} />
  );
}

function FreshnessBadge({ row }: { row: Row }) {
  const f = freshnessOf(row);
  if (!f) return null;
  const tone = f === "fresh" ? "bg-success/15 text-success" : f === "aging" ? "bg-warning/20" : "bg-destructive/15 text-destructive";
  return <Badge className={cn("border-transparent", tone)}>{FRESHNESS_LABEL[f]}</Badge>;
}

function CountrySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? NO_COUNTRY} onValueChange={(v) => onChange(v === NO_COUNTRY ? null : v)}>
      <SelectTrigger className="w-56" aria-label="Country"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_COUNTRY}>Not set</SelectItem>
        {VINEYARD_COUNTRIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>{c.name} / {c.code}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function JobProgress({ jobId, onRevision }: { jobId: string; onRevision: (id: string) => void }) {
  const q = useQuery({
    queryKey: ["chemical-v3-job", jobId],
    queryFn: () => fetchV3Job(jobId),
    refetchInterval: (query) => {
      const s = String((query.state.data as Row | null)?.status ?? "").toLowerCase();
      return V3_TERMINAL_STATUSES.includes(s) ? false : 4000;
    },
  });
  const job = q.data;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading discovery…</p>;
  if (q.error) return <p className="text-sm text-destructive">Could not read discovery progress: {(q.error as Error).message}</p>;
  if (!job) return <p className="text-sm text-muted-foreground">Discovery job not found.</p>;
  const pct = Number(job.progress_percent);
  const revisionId = pick(job, "revision_id", "product_revision_id", "candidate_revision_id");
  return (
    <div className="rounded border p-4 space-y-2" data-testid="v3-job-progress">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{humaniseStage(job.stage) || humaniseStage(job.status)}…</div>
        <Badge variant="outline">{humaniseStage(job.status)}</Badge>
      </div>
      {Number.isFinite(pct) && (
        <div className="flex items-center gap-2"><Progress value={pct} className="h-2" /><span className="text-xs">{pct}%</span></div>
      )}
      {job.user_message && <p className="text-sm">{job.user_message}</p>}
      <p className="text-xs text-muted-foreground">
        This is a product VineTrack has not seen before. Finding an official manufacturer label may take a little while. You can leave this page and come back.
      </p>
      {(job.error_code || job.error_message) && (
        <p className="text-xs text-destructive">{[job.error_code, job.error_message].filter(Boolean).join(": ")}</p>
      )}
      {revisionId && <Button size="sm" variant="outline" onClick={() => onRevision(String(revisionId))}>Open result</Button>}
    </div>
  );
}

function ResultCard({ row, onView }: { row: Row; onView: () => void }) {
  const { isAdmin } = useIsSystemAdmin();
  const cats = useCategories();
  const { vineyardId, vineyardName } = usePilotVineyard();
  const revId = pick(row, "revision_id", "current_revision_id", "approved_revision_id");
  const rowStatus = String(pick(row, "review_status", "status") ?? "").toLowerCase();
  const approved = isApprovedResult(row);
  const note = freshnessNote(freshnessOf(row));
  const reg = pick(row, "registration_number");
  return (
    <div className="flex gap-3 rounded border p-3" data-testid="v3-result">
      <Thumb path={pick(row, "front_label_image_path")} className="h-16 w-16 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{pick(row, "product_name") ?? "Unnamed product"}</span>
          {approved ? <Badge className="border-transparent bg-success/15 text-success">Approved</Badge> : <Badge variant="outline">Not approved</Badge>}
          <FreshnessBadge row={row} />
          <V3ResistanceBadge row={row} />
        </div>
        <div className="text-muted-foreground">
          {[pick(row, "manufacturer", "registrant"), v3CategoryLabel(row, cats.data), pick(row, "country_code", "country"), reg ? `Reg. ${reg}` : null].filter(Boolean).join(" · ")}
        </div>
        {pick(row, "active_ingredient_summary") && <div>{pick(row, "active_ingredient_summary")}</div>}
        <div className="text-xs text-muted-foreground">
          {pick(row, "manufacturer_label_url") ? "Manufacturer label available" : "No manufacturer label"}
          {pick(row, "last_verified_at", "approved_at") && ` · Last verified ${new Date(pick(row, "last_verified_at", "approved_at")).toLocaleDateString()}`}
        </div>
        {note && <div className="text-xs text-warning-foreground">{note}</div>}
      </div>
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="outline" onClick={onView}>View</Button>
        {canUseInventoryPilot(isAdmin) && revId && isV3Addable(rowStatus) && (
          <V3AddToVineyardButton revisionId={String(revId)} productName={pick(row, "product_name") ?? "this product"} status={rowStatus}
            vineyardId={vineyardId} vineyardName={vineyardName} />
        )}
      </div>
    </div>
  );
}

function Field({ label, value, status }: { label: string; value: React.ReactNode; status: FieldStatus }) {
  return (
    <div className={cn("rounded border p-2 text-sm", STATUS_CLASS[status])} data-status={status}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words">{value ?? "Missing"}</div>
    </div>
  );
}

function CategoryField({ row, options, editable, busy, onChange, msg }: {
  row: Row; options: CategoryOption[]; editable: boolean; busy: boolean; onChange: (key: string) => void;
  msg: { tone: "ok" | "err"; text: string } | null;
}) {
  const key = pick(row, "product_category_key");
  const label = v3CategoryLabel(row, options);
  return (
    <div className={cn("rounded border p-2 text-sm", STATUS_CLASS[key ? "ok" : "missing"])} data-status={key ? "ok" : "missing"} data-testid="v3-category">
      <div className="text-xs text-muted-foreground">Product category</div>
      {editable && options.length > 0 ? (
        <Select value={key ?? undefined} onValueChange={onChange} disabled={busy}>
          <SelectTrigger aria-label="Product category" className="h-8"><SelectValue placeholder="Missing" /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : <div>{label ?? "Missing"}</div>}
      {msg && <p className={cn("text-xs", msg.tone === "err" ? "text-destructive" : "text-success")}>{msg.text}</p>}
    </div>
  );
}

function ReviewSheet({ revisionId, jobId: queueJobId, onClose, onApproved, onOpenRevision }: { revisionId: string | null; jobId?: string | null; onClose: () => void; onApproved?: () => void; onOpenRevision?: (id: string) => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [needDecisions, setNeedDecisions] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const decisionsRef = useRef<HTMLElement>(null);
  const ratesRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["chemical-v3-revision", revisionId], enabled: !!revisionId, queryFn: () => fetchV3Revision(revisionId!) });
  const issuesQ = useQuery({ queryKey: ["chemical-v3-issues", revisionId], enabled: !!revisionId, queryFn: () => fetchReviewIssues(revisionId!) });
  useEffect(() => { setNote(""); setMsg(null); setNeedDecisions(false); setInvOpen(false); }, [revisionId]);
  const act = useMutation({
    mutationFn: async (kind: "approve" | "reject") => (kind === "approve" ? approveV3(revisionId!, note) : rejectV3(revisionId!, note)),
    onSuccess: (_d, kind) => {
      qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] });
      qc.invalidateQueries({ queryKey: ["chemical-v3-approved"] });
      qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] });
      if (kind === "approve") { toast.success(APPROVED_TOAST); onApproved?.(); setMsg(null); }
      else setMsg({ tone: "ok", text: "Rejected." });
    },
    onError: (e: any, kind) => {
      if (kind === "approve" && isDecisionsRefusal(e)) {
        setNeedDecisions(true);
        setMsg({ tone: "err", text: DECISIONS_REQUIRED });
        qc.invalidateQueries({ queryKey: ["chemical-v3-issues", revisionId] });
        decisionsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        decisionsRef.current?.focus?.();
        return;
      }
      setMsg({ tone: "err", text: e?.message ?? "The backend refused this action." });
    },
  });
  const { isAdmin } = useIsSystemAdmin();
  const [draft, setDraft] = useState<V3RateDraft | null>(null);
  const [rateErr, setRateErr] = useState<string | null>(null);
  const [rateMsg, setRateMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  useEffect(() => { setDraft(null); setRateErr(null); setRateMsg(null); }, [revisionId]);
  const rateMut = useMutation({
    mutationFn: async (a: { kind: "save"; draft: V3RateDraft } | { kind: "delete"; optionId: string }) =>
      a.kind === "save" ? saveV3RateOption(revisionId!, a.draft) : deleteV3RateOption(revisionId!, a.optionId),
    onSuccess: async (_d, a) => {
      setDraft(null); setRateErr(null);
      setRateMsg({ tone: "ok", text: a.kind === "save" ? "Rate saved." : "Rate deleted." });
      // The database resolves the vineyard_rates issue on save — reload revision + issues + queue.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] }),
        qc.invalidateQueries({ queryKey: ["chemical-v3-issues", revisionId] }),
        qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] }),
      ]);
    },
    onError: (e: any, a) => {
      const text = e?.message ?? "The backend refused this change.";
      if (a.kind === "save") setRateErr(text); else setRateMsg({ tone: "err", text });
    },
  });
  const cats = useCategories();
  const { vineyardId, vineyardName } = usePilotVineyard();
  const savedQ = useQuery({
    queryKey: vineyardChemicalsKey(vineyardId),
    enabled: !!vineyardId && canUseInventoryPilot(isAdmin) && !!revisionId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId!),
  });
  const [catMsg, setCatMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  useEffect(() => { setCatMsg(null); }, [revisionId]);
  const catMut = useMutation({
    mutationFn: (key: string) => setV3ProductCategory(revisionId!, key),
    onSuccess: async () => { setCatMsg({ tone: "ok", text: "Category saved." }); await qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] }); },
    onError: (e: any) => setCatMsg({ tone: "err", text: e?.message ?? "The backend refused this change." }),
  });
  const [resMsg, setResMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  useEffect(() => { setResMsg(null); }, [revisionId]);
  const resMut = useMutation({
    mutationFn: (d: V3ResistanceDraft) => setV3ResistanceGroups(revisionId!, d),
    onSuccess: async () => { setResMsg({ tone: "ok", text: "Resistance group saved." }); await qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] }); },
    onError: (e: any) => setResMsg({ tone: "err", text: e?.message ?? "The backend refused this change." }),
  });
  const r = q.data;
  const has = (...k: string[]) => pick(r, ...k) !== undefined;
  const st = (...k: string[]): FieldStatus => (has(...k) ? "ok" : "missing");
  const opt = (...k: string[]): FieldStatus => (has(...k) ? "ok" : "na");
  const actives = asList(pick(r, "active_ingredients"));
  const rates = splitRates(pick(r, "default_rate_options", "vineyard_rates", "rates"));
  const uses = asList(pick(r, "vineyard_uses", "uses"));
  const warnings = asList(pick(r, "warnings"));
  const unresolved = asList(pick(r, "unresolved_fields"));
  const outstanding = outstandingWithoutIssue(unresolved, issuesQ.data ?? []);
  const linkedSaved = canUseInventoryPilot(isAdmin) ? findSavedForV3(savedQ.data?.chemicals ?? [], r) : null;
  const labelUrl = pick(r, "manufacturer_label_url");
  const status = String(pick(r, "review_status", "status") ?? "").toLowerCase();
  const canEdit = isAdmin && !!revisionId && isV3RevisionEditable(status);
  const fp = labelFingerprintView(r, issuesQ.data ?? []);
  const openAddRate = () => {
    setRateErr(null);
    setDraft(emptyRateDraft("per_hectare"));
    ratesRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    ratesRef.current?.focus?.();
    setTimeout(() => {
      editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      (editorRef.current?.querySelector("input, select, button") as HTMLElement | null)?.focus?.();
    }, 0);
  };
  const editHandlers = (fallback: V3RateBasis): RateEditHandlers | undefined => canEdit ? {
    disabled: rateMut.isPending,
    onEdit: (o) => { setRateErr(null); setDraft(draftFromOption(o, fallback)); },
    onDelete: (o) => {
      const id = pick(o, "id", "option_id");
      if (id != null && window.confirm(`Delete rate ${formatRateOption(o)}?`)) rateMut.mutate({ kind: "delete", optionId: String(id) });
    },
  } : undefined;
  return (
    <Sheet open={!!revisionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-screen max-w-none sm:w-[90vw] sm:max-w-none lg:w-[75vw] overflow-y-auto">
        {q.isLoading && <p>Loading…</p>}
        {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
        {r && (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="text-2xl">{pick(r, "product_name") ?? "Product name missing"}</SheetTitle>
              <div className="text-sm text-muted-foreground">
                {[pick(r, "manufacturer", "registrant"), pick(r, "country_code", "country"), v3CategoryLabel(r, cats.data)].filter(Boolean).join(" · ")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{humaniseStage(status) || "Status unknown"}</Badge>
                <Badge className={cn("border-transparent", r.core_fields_complete ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                  Core fields {r.core_fields_complete ? "complete" : "incomplete"}
                </Badge>
                {labelUrl ? (
                  <Button size="sm" asChild><a href={labelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Open Manufacturer Label</a></Button>
                ) : <Badge className="border-transparent bg-destructive/15 text-destructive">Manufacturer label missing</Badge>}
              </div>
              {(() => {
                const jid = queueJobId ?? pick(r, "job_id", "discovery_job_id");
                return revisionId && canReSearch(isAdmin, status, jid) ? (
                  <V3ReSearchButton jobId={String(jid)} revisionId={revisionId} prominent={needsReSearch(r)}
                    onNewRevision={(id) => onOpenRevision?.(id)} />
                ) : null;
              })()}
              {canUseInventoryPilot(isAdmin) && revisionId && isV3Addable(status) && (
                <div className="flex flex-wrap items-start gap-2">
                  <V3AddToVineyardButton revisionId={revisionId} productName={pick(r, "product_name") ?? "this product"} status={status}
                    vineyardId={vineyardId} vineyardName={vineyardName} />
                  {linkedSaved && <Button size="sm" variant="outline" onClick={() => setInvOpen(true)}>Open Inventory / Purchases</Button>}
                </div>
              )}
              {linkedSaved && (
                <Sheet open={invOpen} onOpenChange={setInvOpen}>
                  <SheetContent className="w-screen max-w-none overflow-y-auto sm:w-[640px]">
                    <SheetHeader><SheetTitle>{linkedSaved.name}</SheetTitle></SheetHeader>
                    <div className="mt-4"><ChemicalInventoryPanel savedChemicalId={String(linkedSaved.id)} /></div>
                  </SheetContent>
                </Sheet>
              )}
            </SheetHeader>
            <div className="flex flex-col gap-4 md:flex-row">
              {pick(r, "front_label_image_path") ? <Thumb path={pick(r, "front_label_image_path")} className="h-72 w-full md:w-72" /> : (
                <div className={cn("flex h-40 w-full items-center justify-center rounded border text-sm md:w-72", STATUS_CLASS.missing)}>Front label image missing</div>
              )}
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Product name" value={pick(r, "product_name")} status={st("product_name")} />
                <Field label="Manufacturer / registrant" value={pick(r, "manufacturer", "registrant")} status={st("manufacturer", "registrant")} />
                <Field label="Country" value={pick(r, "country_code", "country")} status={st("country_code", "country")} />
                <CategoryField row={r} options={cats.data ?? []} editable={canUseInventoryPilot(isAdmin) && isV3RevisionEditable(status)}
                  busy={catMut.isPending} onChange={(k) => catMut.mutate(k)} msg={catMsg} />
                <V3ResistanceField row={r} editable={canUseInventoryPilot(isAdmin) && !!revisionId && isV3ResistanceEditable(status)}
                  busy={resMut.isPending} onSave={(d) => resMut.mutate(d)} msg={resMsg} />
                <Field label="Product form" value={pick(r, "product_form", "formulation")} status={has("product_form", "formulation") ? "ok" : "review"} />
                <Field label="Active ingredients" value={actives.length ? actives.map(labelOf).join("; ") : undefined} status={actives.length ? "ok" : "missing"} />
                <Field label="Registration scheme" value={pick(r, "registration_scheme") ?? "Not applicable"} status={opt("registration_scheme")} />
                <Field label="Registration number" value={pick(r, "registration_number") ?? "No registration number"} status={opt("registration_number")} />
                <Field label="Manufacturer product URL" value={pick(r, "manufacturer_product_url")} status={has("manufacturer_product_url") ? "ok" : "review"} />
                <Field label="Manufacturer label URL" value={labelUrl} status={st("manufacturer_label_url")} />
                <Field label="Label fingerprint" status={fp.tone}
                  value={<span data-testid="v3-label-fingerprint" data-tone={fp.tone}>{fp.value}{fp.note && <span className="block text-xs text-muted-foreground">{fp.note}</span>}</span>} />
                <Field label="Source retrieved" value={pick(r, "source_retrieved_at", "label_retrieved_at")} status={has("source_retrieved_at", "label_retrieved_at") ? "ok" : "review"} />
              </div>
            </div>
            <V3DataSummary uses={uses.length} perHa={rates.perHa.length} per100L={rates.per100L.length} />
            {issuesQ.error && warnings.length > 0 && <V3Warnings warnings={warnings} />}
            <V3ReviewDecisions ref={decisionsRef} revisionId={revisionId!} issues={issuesQ.data ?? []}
              loading={issuesQ.isLoading} error={(issuesQ.error as Error) ?? null} highlight={needDecisions}
              labelUrl={labelUrl ?? null} rateCount={rates.perHa.length + rates.per100L.length + rates.other.length}
              onAddRate={canEdit ? openAddRate : undefined} />
            <section ref={ratesRef} tabIndex={-1} className="space-y-2 rounded border bg-card p-3 outline-none" data-testid="v3-rates-section">
              <h3 className="font-semibold">Vineyard rates</h3>
              {rateMsg && <p className={cn("text-sm", rateMsg.tone === "err" ? "text-destructive" : "text-success")}>{rateMsg.text}</p>}
              <div className="grid gap-3 md:grid-cols-2">
                <RateColumn title="Per hectare" items={rates.perHa} testId="v3-rates-per-ha" edit={editHandlers("per_hectare")} onAdd={canEdit ? () => setDraft(emptyRateDraft("per_hectare")) : undefined} addLabel="+ Add per hectare rate" />
                <RateColumn title="Per 100 litres" items={rates.per100L} testId="v3-rates-per-100l" edit={editHandlers("per_100_litres")} onAdd={canEdit ? () => setDraft(emptyRateDraft("per_100_litres")) : undefined} addLabel="+ Add per 100 L rate" />
              </div>
              {rates.other.length > 0 && <RateColumn title="Basis not stated" items={rates.other} edit={editHandlers("per_hectare")} />}
            </section>
            {canEdit && draft && (
              <div ref={editorRef} data-testid="v3-rate-editor-anchor">
                <V3RateEditor draft={draft} revisionId={revisionId!} busy={rateMut.isPending} error={rateErr}
                  onCancel={() => { setDraft(null); setRateErr(null); }}
                  onSave={(d) => rateMut.mutate({ kind: "save", draft: d })} />
              </div>
            )}
            <VineyardUsesSection uses={uses} />
            {outstanding.length > 0 && (
              <section className={cn("rounded border p-2", STATUS_CLASS.review)} data-testid="v3-outstanding">
                <h3 className="font-semibold">Outstanding fields</h3>
                <ul className="list-disc pl-5 text-sm">{outstanding.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </section>
            )}
            <section className="space-y-2 border-t pt-3" data-testid="v3-approval-panel" data-panel={approvalPanelFor(status)}>
              {approvalPanelFor(status) === "decide" ? (
                <>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (required to reject)" aria-label="Review note" />
                  {msg && <p className={cn("text-sm", msg.tone === "err" ? "text-destructive" : "text-success")}>{msg.text}</p>}
                  <div className="flex gap-2">
                    <Button disabled={act.isPending} onClick={() => act.mutate("approve")}>Approve</Button>
                    <Button variant="destructive" disabled={act.isPending || !note.trim()} onClick={() => act.mutate("reject")}>Reject</Button>
                  </div>
                </>
              ) : approvalPanelFor(status) === "approved" ? (
                <div className="rounded border border-success/40 bg-success/10 p-2 text-sm text-success">
                  <div className="font-medium">Approved for V3 catalogue ✓</div>
                  {pick(r, "approved_at", "approved_date", "reviewed_at") && <div className="text-xs">Approved {String(pick(r, "approved_at", "approved_date", "reviewed_at")).slice(0, 10)}</div>}
                </div>
              ) : approvalPanelFor(status) === "superseded" ? (
                <p className="rounded border bg-muted p-2 text-sm text-muted-foreground">Superseded revision</p>
              ) : approvalPanelFor(status) === "rejected" ? (
                <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">Rejected</p>
              ) : (
                <p className="text-sm text-muted-foreground">Read-only revision</p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ReviewQueue({ onOpen }: { onOpen: (id: string, jobId?: string | null) => void }) {
  const cats = useCategories();
  const { isAdmin } = useIsSystemAdmin();
  const q = useQuery({ queryKey: ["chemical-v3-queue"], queryFn: v3ReviewQueue, refetchOnMount: "always", refetchOnWindowFocus: "always" });
  const refresh = (
    <div className="mb-2 flex justify-end">
      <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()} data-testid="v3-queue-refresh">Refresh</Button>
    </div>
  );
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <div>{refresh}<p className="text-sm text-destructive">{(q.error as Error).message}</p></div>;
  const seen = new Set<string>();
  const rows = (q.data ?? []).filter(isPendingQueueRow).filter((r) => {
    const id = String(pick(r, "revision_id", "id"));
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  if (!rows.length) return <div>{refresh}<p className="rounded border bg-card p-3 text-sm text-muted-foreground">Nothing waiting for review.</p></div>;
  return (
    <div>{refresh}
    <div className="overflow-x-auto rounded border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-card text-left text-xs text-muted-foreground"><tr>
          {["Product", "Manufacturer", "Country", "Category", "Core complete", "Vineyard rates", "Manufacturer label", "Front label", "Warnings", "Unresolved", "Age", "Actions"].map((h) => <th key={h} className="p-2">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => {
          const id = String(pick(r, "revision_id", "id"));
          const created = pick(r, "created_at");
          const age = created ? `${Math.max(0, Math.round((Date.now() - new Date(created).getTime()) / 86_400_000))} d` : "—";
          const jid = pick(r, "job_id");
          const status = String(pick(r, "review_status", "status") ?? "");
          return (
            <tr key={id} className={SOLID_ROW} data-testid="v3-review-row" onClick={() => onOpen(id, jid ? String(jid) : null)}>
              <td className="p-2 font-medium">{pick(r, "product_name") ?? "—"}</td>
              <td className="p-2">{pick(r, "manufacturer") ?? "—"}</td>
              <td className="p-2">{pick(r, "country_code", "country") ?? "—"}</td>
              <td className="p-2">{v3CategoryLabel(r, cats.data) ?? pick(r, "product_category") ?? "—"}</td>
              <td className="p-2">{r.core_fields_complete ? "Yes" : "No"}</td>
              <td className="p-2">{humaniseStage(pick(r, "vineyard_rate_status")) || "—"}</td>
              <td className="p-2">{humaniseStage(pick(r, "manufacturer_label_status")) || (pick(r, "manufacturer_label_url") ? "Present" : "Missing")}</td>
              <td className="p-2">{humaniseStage(pick(r, "front_label_status")) || (pick(r, "front_label_image_path") ? "Present" : "Missing")}</td>
              <td className="p-2">{asList(pick(r, "warnings")).length || pick(r, "warning_count") || 0}</td>
              <td className="p-2">{asList(pick(r, "unresolved_fields")).length || pick(r, "unresolved_count") || 0}</td>
              <td className="p-2">{age}</td>
              <td className="p-2" data-testid="v3-row-actions">
                {canReSearch(isAdmin, status, jid ? String(jid) : null) ? (
                  <V3ReSearchButton jobId={String(jid)} revisionId={id} prominent={false} label="Re-search"
                    onNewRevision={(next) => onOpen(next, String(jid))} />
                ) : "—"}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
    </div>
  );
}

const SOLID_ROW = "cursor-pointer border-t bg-card hover:bg-muted";

function ApprovedList({ onOpen }: { onOpen: (id: string) => void }) {
  const cats = useCategories();
  const q = useQuery({ queryKey: ["chemical-v3-approved"], queryFn: fetchApprovedCatalogue });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="rounded border bg-card p-3 text-sm text-muted-foreground">No approved catalogue products yet.</p>;
  const date = (v: any) => (v ? new Date(v).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—");
  return (
    <div className="overflow-x-auto rounded border bg-card">
      <table className="w-full text-sm" data-testid="v3-approved-table">
        <thead className="bg-card text-left text-xs text-muted-foreground"><tr>
          {["Product", "Manufacturer", "Country", "Category", "Resistance group", "Approved date", "Last verified", "Warnings", "Front label"].map((h) => <th key={h} className="p-2">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, i) => {
          const id = approvedRevisionId(r);
          return (
            <tr key={id ?? i} className={SOLID_ROW} data-testid="v3-approved-row" onClick={() => id && onOpen(id)}>
              <td className="p-2 font-medium">{pick(r, "product_name") ?? "—"}</td>
              <td className="p-2">{pick(r, "manufacturer", "registrant") ?? "—"}</td>
              <td className="p-2">{pick(r, "country_code", "country") ?? "—"}</td>
              <td className="p-2">{v3CategoryLabel(r, cats.data) ?? "—"}</td>
              <td className="p-2"><V3ResistanceBadge row={r} /></td>
              <td className="p-2">{date(pick(r, "approved_at"))}</td>
              <td className="p-2">{date(pick(r, "last_verified_at"))}</td>
              <td className="p-2">{asList(pick(r, "warnings")).length || pick(r, "warning_count") || 0}</td>
              <td className="p-2"><Thumb path={pick(r, "front_label_image_path")} className="h-10 w-10" /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function InventoryTab() {
  const { vineyardId, vineyardName } = usePilotVineyard();
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: vineyardChemicalsKey(vineyardId), enabled: !!vineyardId, queryFn: () => fetchSavedChemicalsForVineyard(vineyardId!) });
  if (!vineyardId) return <p className="rounded border bg-card p-3 text-sm">Select a vineyard first.</p>;
  const rows = [...(q.data?.chemicals ?? [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  return (
    <div className="space-y-3 rounded border bg-card p-3" data-testid="v3-inventory-tab">
      <p className="text-sm text-muted-foreground">Chemical inventory and purchases for {vineyardName ?? "this vineyard"}. Select a chemical to review its stock and purchase history.</p>
      <Select value={sel ?? undefined} onValueChange={setSel}>
        <SelectTrigger className="max-w-md" aria-label="Vineyard chemical"><SelectValue placeholder={q.isLoading ? "Loading…" : "Choose a chemical"} /></SelectTrigger>
        <SelectContent>{rows.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}{v3EntryBadge(c) ? ` — ${v3EntryBadge(c)!.label}` : ""}</SelectItem>)}</SelectContent>
      </Select>
      {sel && <ChemicalInventoryPanel savedChemicalId={sel} />}
    </div>
  );
}

export default function ChemicalV3LabPage() {
  const { user } = useAuth();
  const { isAdmin } = useIsSystemAdmin();
  const [tab, setTab] = useState("review");
  const [searchOpen, setSearchOpen] = useState(false);
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const { currentCountry } = useVineyard();
  const [country, setCountry] = useState<string | null>(resolveVineyardCountry(currentCountry) ?? null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(JOB_KEY));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRevision, setOpenRevision] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => { if (jobId) localStorage.setItem(JOB_KEY, jobId); else localStorage.removeItem(JOB_KEY); }, [jobId]);

  const search = useQuery({
    queryKey: ["chemical-v3-search", searched, country],
    enabled: !!searched,
    queryFn: () => searchV3(searched!, country),
  });
  const approved = (search.data ?? []).filter(isApprovedResult);

  const begin = async (args: Parameters<typeof startV3Discovery>[0]) => {
    setError(null); setNotice(null);
    try {
      const res = await startV3Discovery(args);
      setJobId(res.job_id);
      setNotice(res.reused ? V3_REUSED_MESSAGE : res.backendMissing ? V3_BACKEND_MISSING : null);
    } catch (e: any) { setError(e?.message ?? "Could not start discovery."); }
  };
  const find = useMutation({ mutationFn: () => begin({ query: searched, countryCode: country, inputKind: "text", photoPath: null }) });
  const photoSearch = useMutation({
    mutationFn: async () => {
      if (!user || !photo) return;
      try {
        const path = await uploadV3SearchPhoto(user.id, photo);
        await begin({ query: null, countryCode: country, inputKind: "photo", photoPath: path });
      } catch (e: any) { setError(e?.message ?? "Upload failed."); }
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><FlaskConical className="h-6 w-6" />Chemical Catalogue Review</h1>
        <p className="text-sm text-muted-foreground">Curate the VineTrack chemical catalogue. Customers search from Chemicals → Add Chemical.</p>
      </div>
      <Button variant="outline" onClick={() => setSearchOpen(true)}><Search className="mr-1 h-4 w-4" />Open Chemical Search</Button>
      <ChemicalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} vineyardId={selectedVineyardId}
        vineyardName={memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null}
        country={currentCountry} canEdit={currentRole === "owner" || currentRole === "manager" || isAdmin} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="review">Pending Review</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          {canUseInventoryPilot(isAdmin) && <TabsTrigger value="inventory">Inventory &amp; Purchases</TabsTrigger>}
        </TabsList>
        <TabsContent value="review"><ReviewQueue onOpen={(id, j) => { setOpenRevision(id); setOpenJob(j ?? null); }} /></TabsContent>
        <TabsContent value="approved"><ApprovedList onOpen={setOpenRevision} /></TabsContent>
        {canUseInventoryPilot(isAdmin) && <TabsContent value="inventory"><InventoryTab /></TabsContent>}
      </Tabs>
      {notice && <div className="flex items-center gap-2 rounded border border-warning/50 bg-warning/10 p-3 text-sm"><AlertTriangle className="h-4 w-4" />{notice}</div>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {jobId && (
        <div className="space-y-1">
          <JobProgress jobId={jobId} onRevision={setOpenRevision} />
          <Button size="sm" variant="ghost" onClick={() => { setJobId(null); setNotice(null); }}>Dismiss</Button>
        </div>
      )}
      <ReviewSheet revisionId={openRevision} jobId={openJob} onClose={() => { setOpenRevision(null); setOpenJob(null); }}
        onOpenRevision={(id) => setOpenRevision(id)}
        onApproved={() => { setTab("approved"); if (jobId) { setJobId(null); setNotice(null); } }} />

    </div>
  );
}
