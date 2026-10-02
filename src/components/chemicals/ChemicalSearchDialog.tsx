// Chemical Search — the single customer-facing way to find and add a new
// chemical. Reuses the catalogue/discovery contracts proven in the System
// Admin Catalogue Review (search_chemical_v3_catalogue,
// start_chemical_v3_discovery + chemical-lookup-v3, chemical_v3_add_to_vineyard).
// It contains NO admin review tools and NO opening-stock fields, and never
// calls the older product lookup function or any V1/V2 search.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, Search, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  V3_TERMINAL_STATUSES, asList, fetchV3Job, fetchV3Revision, isApprovedResult, labelOf, pick,
  searchV3, signedV3MediaUrl, splitRates, startV3Discovery, uploadV3SearchPhoto,
} from "@/lib/chemicalV3";
import { addV3ToVineyard, fetchProductCategories, v3CategoryLabel } from "@/lib/chemicalInventory";
import { RateColumn } from "@/components/chemicals/V3ReviewData";
import { V3ResistanceBadge } from "@/components/chemicals/V3ResistanceField";
import { resolveVineyardCountry } from "@/lib/vineyardCountries";
import {
  CATALOGUE_LABEL, DISCOVERY_FAILED, DISCOVERY_NOTE, DISCOVERY_UNAVAILABLE, NOT_SEEN_BEFORE, NOT_SEEN_BEFORE_DETAIL,
  OWNER_MANAGER_ONLY, PENDING_REVIEW_LABEL, PENDING_REVIEW_NOTE, REUSED_DISCOVERY,
  addedMessage, customerError, customerStage, discoveryRevisionId, isCustomerAddable, isPendingStatus, resultRevisionId,
} from "@/lib/chemicalSearchPublic";

type Row = Record<string, any>;
const JOB_KEY = "vt.chemical-search.current-job";

export interface ChemicalSearchDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string | null;
  vineyardName: string | null;
  /** Vineyard country as stored; resolved to ISO-2. Unknown → search with no country. */
  country: string | null;
  canEdit: boolean;
  initialQuery?: string | null;
  /** Called after a successful add with the exact saved chemical id. */
  onAdded?: (r: { savedChemicalId: string | null; reused: boolean }) => void;
  /** Customer chose manual entry. Caller opens a manual-only editor. */
  onManual?: (name: string | null) => void;
}

function Thumb({ path, className }: { path?: string; className?: string }) {
  const { data } = useQuery({
    queryKey: ["chemical-search-media", path ?? null], enabled: !!path, staleTime: 30 * 60_000,
    queryFn: () => signedV3MediaUrl(path),
  });
  if (!path) return null;
  return data
    ? <img src={data} alt="Front label" className={cn("rounded border bg-muted object-contain", className)} />
    : <div className={cn("rounded border bg-muted", className)} />;
}

function useCategories() {
  return useQuery({ queryKey: ["chemical-product-categories"], staleTime: 10 * 60_000, queryFn: fetchProductCategories });
}

function AddButton({ revisionId, vineyardId, vineyardName, canEdit, onAdded }: {
  revisionId: string; vineyardId: string | null; vineyardName: string | null; canEdit: boolean;
  onAdded?: ChemicalSearchDialogProps["onAdded"];
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const mut = useMutation({
    // Customers never send opening stock in this release.
    mutationFn: () => addV3ToVineyard({ revisionId, vineyardId: vineyardId!, quantity: "", unit: "L" }),
    onSuccess: (r) => {
      setMsg({ tone: "ok", text: addedMessage(r.reused, vineyardName) });
      qc.invalidateQueries({ queryKey: ["saved_chemicals"] });
      qc.invalidateQueries({ queryKey: ["saved-chemicals"] });
      onAdded?.(r);
    },
    onError: (e) => setMsg({ tone: "err", text: customerError(e, "add") }),
  });
  if (!canEdit) return <p className="text-xs text-muted-foreground">{OWNER_MANAGER_ONLY}</p>;
  return (
    <div className="space-y-1">
      <Button size="sm" disabled={!vineyardId || mut.isPending || msg?.tone === "ok"} onClick={() => mut.mutate()}>
        Add to Vineyard
      </Button>
      {msg && <p className={cn("text-xs", msg.tone === "err" ? "text-destructive" : "text-success")} data-testid="chemical-search-add-msg">{msg.text}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: unknown }) {
  return isPendingStatus(status)
    ? <Badge variant="outline" className="border-warning/60 bg-warning/10">{PENDING_REVIEW_LABEL}</Badge>
    : <Badge className="border-transparent bg-success/15 text-success">{CATALOGUE_LABEL}</Badge>;
}

/** Compact product view — no admin review content. */
export function ProductSummary({ row, children }: { row: Row; children?: React.ReactNode }) {
  const cats = useCategories();
  const status = pick(row, "review_status", "status");
  const actives = asList(pick(row, "active_ingredients")).map(labelOf).filter(Boolean);
  const activeText = actives.length ? actives.join(", ") : pick(row, "active_ingredient_summary");
  const reg = pick(row, "registration_number");
  const label = pick(row, "manufacturer_label_url");
  const rates = splitRates(pick(row, "default_rate_options", "vineyard_rates", "rates"));
  const [showRates, setShowRates] = useState(false);
  const hasRates = rates.perHa.length + rates.per100L.length > 0;
  return (
    <div className="flex gap-3 rounded border bg-card p-3" data-testid="chemical-search-result">
      <Thumb path={pick(row, "front_label_image_path")} className="h-20 w-20 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{pick(row, "product_name") ?? "Unnamed product"}</span>
          <StatusBadge status={status} />
        </div>
        <div className="text-muted-foreground">
          {[pick(row, "manufacturer", "registrant"), pick(row, "country_code", "country"), reg ? `Reg. ${reg}` : null].filter(Boolean).join(" · ")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {v3CategoryLabel(row, cats.data) && <span className="font-medium">{v3CategoryLabel(row, cats.data)}</span>}
          <V3ResistanceBadge row={row} />
          {pick(row, "product_form") && <span className="text-muted-foreground">{pick(row, "product_form")}</span>}
        </div>
        {activeText && <div>{activeText}</div>}
        {isPendingStatus(status) && <p className="text-xs text-muted-foreground">{PENDING_REVIEW_NOTE}</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {label ? (
            <a href={label} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              Open Manufacturer Label <ExternalLink className="h-3 w-3" />
            </a>
          ) : <span className="text-muted-foreground">No manufacturer label</span>}
          {hasRates && (
            <button type="button" className="underline" onClick={() => setShowRates((v) => !v)}>
              {showRates ? "Hide" : "Show"} vineyard rates ({rates.perHa.length} per ha · {rates.per100L.length} per 100 L)
            </button>
          )}
        </div>
        {showRates && (
          <div className="grid gap-3 pt-2 md:grid-cols-2">
            <RateColumn title="Per hectare" items={rates.perHa} />
            <RateColumn title="Per 100 L" items={rates.per100L} />
          </div>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function DiscoveryResult({ jobId, addProps, onManual, onRetry }: {
  jobId: string; addProps: Omit<Parameters<typeof AddButton>[0], "revisionId">;
  onManual: () => void; onRetry: () => void;
}) {
  const q = useQuery({
    queryKey: ["chemical-search-job", jobId],
    queryFn: () => fetchV3Job(jobId),
    refetchInterval: (query) => {
      const s = String((query.state.data as Row | null)?.status ?? "").toLowerCase();
      return V3_TERMINAL_STATUSES.includes(s) ? false : 4000;
    },
  });
  const job = q.data;
  const status = String(job?.status ?? "").toLowerCase();
  const revisionId = discoveryRevisionId(job);
  const done = V3_TERMINAL_STATUSES.includes(status);
  const rev = useQuery({
    queryKey: ["chemical-search-revision", revisionId], enabled: !!revisionId && done,
    queryFn: () => fetchV3Revision(revisionId!),
  });
  if (q.error || (!q.isLoading && !job)) return <Failed onManual={onManual} onRetry={onRetry} text={DISCOVERY_FAILED} />;
  if (q.isLoading || !job) return <p className="text-sm text-muted-foreground">Starting…</p>;
  if (/fail|cancel/.test(status) || (done && !revisionId)) return <Failed onManual={onManual} onRetry={onRetry} text={DISCOVERY_FAILED} />;
  if (done && rev.data) {
    const revStatus = pick(rev.data, "review_status", "status") ?? status;
    return (
      <ProductSummary row={{ ...rev.data, review_status: revStatus }}>
        {isCustomerAddable(revStatus) && <AddButton revisionId={revisionId!} {...addProps} />}
      </ProductSummary>
    );
  }
  if (done && rev.error) return <Failed onManual={onManual} onRetry={onRetry} text={DISCOVERY_FAILED} />;
  const pct = Number(job.progress_percent);
  return (
    <div className="space-y-2 rounded border bg-card p-4" data-testid="chemical-search-progress">
      <div className="font-medium">{customerStage(job.stage, job.status)}</div>
      {Number.isFinite(pct) && <div className="flex items-center gap-2"><Progress value={pct} className="h-2" /><span className="text-xs">{pct}%</span></div>}
      <p className="text-xs text-muted-foreground">{DISCOVERY_NOTE}</p>
    </div>
  );
}

function Failed({ text, onRetry, onManual }: { text: string; onRetry: () => void; onManual: () => void }) {
  return (
    <div className="space-y-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p>{text}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
        <Button size="sm" variant="outline" onClick={onManual}>Enter manually</Button>
      </div>
    </div>
  );
}

export function ChemicalSearchDialog(props: ChemicalSearchDialogProps) {
  const { open, onOpenChange, vineyardId, vineyardName, country, canEdit, initialQuery, onAdded, onManual } = props;
  const { user } = useAuth();
  const countryCode = resolveVineyardCountry(country ?? undefined) ?? null;
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [searched, setSearched] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => sessionStorage.getItem(JOB_KEY));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setQuery(initialQuery ?? ""); setSearched(null); setError(null); } }, [open, initialQuery]);
  useEffect(() => { if (jobId) sessionStorage.setItem(JOB_KEY, jobId); else sessionStorage.removeItem(JOB_KEY); }, [jobId]);

  const search = useQuery({
    queryKey: ["chemical-search", searched, countryCode],
    enabled: !!searched && open,
    queryFn: () => searchV3(searched!, countryCode),
  });
  const results = (search.data ?? []).filter(isApprovedResult);

  const begin = async (args: Parameters<typeof startV3Discovery>[0]) => {
    setError(null); setNotice(null);
    try {
      const res = await startV3Discovery(args);
      setJobId(res.job_id);
      if (res.backendMissing) { setJobId(null); setError(DISCOVERY_UNAVAILABLE); return; }
      if (res.reused) setNotice(REUSED_DISCOVERY);
    } catch (e) { setError(customerError(e, "discovery")); }
  };
  const find = useMutation({ mutationFn: () => begin({ query: searched, countryCode, inputKind: "text", photoPath: null }) });
  const photoFind = useMutation({
    mutationFn: async () => {
      if (!user || !photo) return;
      try {
        const path = await uploadV3SearchPhoto(user.id, photo);
        await begin({ query: null, countryCode, inputKind: "photo", photoPath: path });
      } catch (e) { setError(customerError(e, "discovery")); }
    },
  });

  const manual = () => onManual?.(searched ?? (query.trim() || null));
  const addProps = { vineyardId, vineyardName, canEdit, onAdded };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Add Chemical</DialogTitle></DialogHeader>
        {!canEdit ? (
          <p className="text-sm">{OWNER_MANAGER_ONLY}</p>
        ) : (
          <>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="search">Search</TabsTrigger>
                <TabsTrigger value="photo">Search by Photo</TabsTrigger>
              </TabsList>
              <TabsContent value="search" className="space-y-3">
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) { setJobId(null); setNotice(null); setSearched(query.trim()); } }}>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product name" aria-label="Product name" />
                  <Button type="submit"><Search className="mr-1 h-4 w-4" />Search</Button>
                </form>
                {search.isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
                {search.error && <Failed text={customerError(search.error, "search")} onRetry={() => search.refetch()} onManual={manual} />}
                {!jobId && results.length > 0 && (
                  <p className="font-medium" data-testid="chemical-search-matches">Matches in the VineTrack catalogue</p>
                )}
                {!jobId && results.map((r, i) => {
                  const revId = resultRevisionId(r);
                  return (
                    <ProductSummary key={String(revId ?? pick(r, "product_id") ?? i)} row={r}>
                      {revId && <AddButton revisionId={revId} {...addProps} />}
                    </ProductSummary>
                  );
                })}
                {!jobId && results.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="chemical-search-different">
                    <span>Can't find the right product?</span>
                    <Button size="sm" variant="ghost" onClick={() => find.mutate()} disabled={find.isPending}>
                      <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />Find a different product
                    </Button>
                  </div>
                )}
                {!jobId && searched && search.isSuccess && results.length === 0 && (
                  <div className="space-y-3 rounded-lg border bg-muted/40 p-4" data-testid="chemical-search-miss">
                    <p className="font-medium">{NOT_SEEN_BEFORE}</p>
                    <p className="text-sm text-muted-foreground">{NOT_SEEN_BEFORE_DETAIL}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => find.mutate()} disabled={find.isPending}>
                        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Find this product
                      </Button>
                      <Button variant="outline" onClick={manual}>Enter manually</Button>
                    </div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="photo" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="file" accept="image/*" capture="environment" className="max-w-sm" aria-label="Product photo"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                  <Button disabled={!photo || !user || photoFind.isPending} onClick={() => photoFind.mutate()}>
                    <Camera className="mr-1 h-4 w-4" />Find product
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Your photo is stored privately and is only used to find this product.</p>
              </TabsContent>
            </Tabs>
            {notice && <p className="rounded border bg-muted/40 p-2 text-sm">{notice}</p>}
            {error && <Failed text={error} onRetry={() => (tab === "photo" ? photoFind.mutate() : find.mutate())} onManual={manual} />}
            {jobId && (
              <div className="space-y-1">
                <DiscoveryResult jobId={jobId} addProps={addProps} onManual={manual}
                  onRetry={() => { setJobId(null); tab === "photo" ? photoFind.mutate() : find.mutate(); }} />
                <Button size="sm" variant="ghost" onClick={() => { setJobId(null); setNotice(null); }}>Start a new search</Button>
              </div>
            )}
            <div className="border-t pt-3 text-right">
              <Button variant="link" size="sm" onClick={manual}>Enter manually</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
