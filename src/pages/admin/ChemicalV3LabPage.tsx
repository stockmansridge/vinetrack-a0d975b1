// Chemical Lookup V3 Lab — System Admin prototype. Independent of the Master
// catalogue, Chemical Search V1/V2 and vineyard saved chemicals.
import { useEffect, useState } from "react";
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
import { RateColumn, V3DataSummary, V3Warnings, VineyardUseCard } from "@/components/chemicals/V3ReviewData";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { VINEYARD_COUNTRIES, resolveVineyardCountry } from "@/lib/vineyardCountries";
import {
  FRESHNESS_LABEL, V3_BACKEND_MISSING, V3_REUSED_MESSAGE, V3_TERMINAL_STATUSES,
  approveV3, asList, fetchV3Job, fetchV3Revision, freshnessNote, freshnessOf, humaniseStage,
  isApprovedResult, labelOf, pick, rejectV3, searchV3, signedV3MediaUrl, splitRates,
  startV3Discovery, uploadV3SearchPhoto, v3ReviewQueue,
} from "@/lib/chemicalV3";

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
        </div>
        <div className="text-muted-foreground">
          {[pick(row, "manufacturer", "registrant"), pick(row, "product_category"), pick(row, "country_code", "country"), reg ? `Reg. ${reg}` : null].filter(Boolean).join(" · ")}
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
        <Button size="sm" disabled title="Not connected in V3.0">Add to Vineyard</Button>
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

function ReviewSheet({ revisionId, onClose }: { revisionId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const q = useQuery({ queryKey: ["chemical-v3-revision", revisionId], enabled: !!revisionId, queryFn: () => fetchV3Revision(revisionId!) });
  useEffect(() => { setNote(""); setMsg(null); }, [revisionId]);
  const act = useMutation({
    mutationFn: async (kind: "approve" | "reject") => (kind === "approve" ? approveV3(revisionId!, note) : rejectV3(revisionId!, note)),
    onSuccess: (_d, kind) => {
      setMsg({ tone: "ok", text: kind === "approve" ? "Approved." : "Rejected." });
      qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] });
      qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] });
    },
    onError: (e: any) => setMsg({ tone: "err", text: e?.message ?? "The backend refused this action." }),
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
  const labelUrl = pick(r, "manufacturer_label_url");
  const status = String(pick(r, "review_status", "status") ?? "").toLowerCase();
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
                {[pick(r, "manufacturer", "registrant"), pick(r, "country_code", "country"), pick(r, "product_category")].filter(Boolean).join(" · ")}
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
            </SheetHeader>
            <div className="flex flex-col gap-4 md:flex-row">
              {pick(r, "front_label_image_path") ? <Thumb path={pick(r, "front_label_image_path")} className="h-72 w-full md:w-72" /> : (
                <div className={cn("flex h-40 w-full items-center justify-center rounded border text-sm md:w-72", STATUS_CLASS.missing)}>Front label image missing</div>
              )}
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Product name" value={pick(r, "product_name")} status={st("product_name")} />
                <Field label="Manufacturer / registrant" value={pick(r, "manufacturer", "registrant")} status={st("manufacturer", "registrant")} />
                <Field label="Country" value={pick(r, "country_code", "country")} status={st("country_code", "country")} />
                <Field label="Product category" value={pick(r, "product_category")} status={st("product_category")} />
                <Field label="Product form" value={pick(r, "product_form", "formulation")} status={has("product_form", "formulation") ? "ok" : "review"} />
                <Field label="Active ingredients" value={actives.length ? actives.map(labelOf).join("; ") : undefined} status={actives.length ? "ok" : "missing"} />
                <Field label="Registration scheme" value={pick(r, "registration_scheme") ?? "Not applicable"} status={opt("registration_scheme")} />
                <Field label="Registration number" value={pick(r, "registration_number") ?? "No registration number"} status={opt("registration_number")} />
                <Field label="Manufacturer product URL" value={pick(r, "manufacturer_product_url")} status={has("manufacturer_product_url") ? "ok" : "review"} />
                <Field label="Manufacturer label URL" value={labelUrl} status={st("manufacturer_label_url")} />
                <Field label="Label fingerprint / SHA" value={pick(r, "label_sha256", "label_sha")} status={st("label_sha256", "label_sha")} />
                <Field label="Source retrieved" value={pick(r, "source_retrieved_at", "label_retrieved_at")} status={has("source_retrieved_at", "label_retrieved_at") ? "ok" : "review"} />
              </div>
            </div>
            <V3DataSummary uses={uses.length} perHa={rates.perHa.length} per100L={rates.per100L.length} />
            <V3Warnings warnings={warnings} />
            <section className="space-y-2">
              <h3 className="font-semibold">Vineyard uses</h3>
              {uses.length ? <div className="space-y-2">{uses.map((u, i) => <VineyardUseCard key={i} use={u} />)}</div> : <p className="text-sm text-muted-foreground">None extracted</p>}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Vineyard rates</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <RateColumn title="Per hectare" items={rates.perHa} testId="v3-rates-per-ha" />
                <RateColumn title="Per 100 litres" items={rates.per100L} testId="v3-rates-per-100l" />
              </div>
              {rates.other.length > 0 && <RateColumn title="Basis not stated" items={rates.other} />}
            </section>
            <section className={cn("rounded border p-2", unresolved.length ? STATUS_CLASS.review : STATUS_CLASS.na)}>
              <h3 className="font-semibold">Outstanding / unresolved fields</h3>
              {unresolved.length ? <ul className="list-disc pl-5 text-sm">{unresolved.map((w, i) => <li key={i}>{labelOf(w)}</li>)}</ul> : <p className="text-sm">None</p>}
            </section>
            <section className="space-y-2 border-t pt-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (required to reject)" aria-label="Review note" />
              {msg && <p className={cn("text-sm", msg.tone === "err" ? "text-destructive" : "text-success")}>{msg.text}</p>}
              <div className="flex gap-2">
                <Button disabled={act.isPending} onClick={() => act.mutate("approve")}>Approve</Button>
                <Button variant="destructive" disabled={act.isPending || !note.trim()} onClick={() => act.mutate("reject")}>Reject</Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReviewQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["chemical-v3-queue"], queryFn: v3ReviewQueue });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>
          {["Product", "Manufacturer", "Country", "Category", "Core complete", "Vineyard rates", "Manufacturer label", "Front label", "Warnings", "Unresolved", "Age"].map((h) => <th key={h} className="p-2">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => {
          const id = String(pick(r, "revision_id", "id"));
          const created = pick(r, "created_at");
          const age = created ? `${Math.max(0, Math.round((Date.now() - new Date(created).getTime()) / 86_400_000))} d` : "—";
          return (
            <tr key={id} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => onOpen(id)}>
              <td className="p-2 font-medium">{pick(r, "product_name") ?? "—"}</td>
              <td className="p-2">{pick(r, "manufacturer") ?? "—"}</td>
              <td className="p-2">{pick(r, "country_code", "country") ?? "—"}</td>
              <td className="p-2">{pick(r, "product_category") ?? "—"}</td>
              <td className="p-2">{r.core_fields_complete ? "Yes" : "No"}</td>
              <td className="p-2">{humaniseStage(pick(r, "vineyard_rate_status")) || "—"}</td>
              <td className="p-2">{humaniseStage(pick(r, "manufacturer_label_status")) || (pick(r, "manufacturer_label_url") ? "Present" : "Missing")}</td>
              <td className="p-2">{humaniseStage(pick(r, "front_label_status")) || (pick(r, "front_label_image_path") ? "Present" : "Missing")}</td>
              <td className="p-2">{asList(pick(r, "warnings")).length || pick(r, "warning_count") || 0}</td>
              <td className="p-2">{asList(pick(r, "unresolved_fields")).length || pick(r, "unresolved_count") || 0}</td>
              <td className="p-2">{age}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export default function ChemicalV3LabPage() {
  const { user } = useAuth();
  const { currentCountry } = useVineyard();
  const [country, setCountry] = useState<string | null>(resolveVineyardCountry(currentCountry) ?? null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(JOB_KEY));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRevision, setOpenRevision] = useState<string | null>(null);
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
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><FlaskConical className="h-6 w-6" />Chemical Lookup V3</h1>
        <p className="text-sm text-muted-foreground">Prototype lab. Separate from the Master Catalogue and the customer Chemical Store.</p>
      </div>
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="photo">Search by Photo</TabsTrigger>
          <TabsTrigger value="review">Pending Review</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="space-y-4">
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) setSearched(query.trim()); }}>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product name" className="max-w-md" aria-label="Search" />
            <CountrySelect value={country} onChange={setCountry} />
            <Button type="submit"><Search className="mr-1 h-4 w-4" />Search</Button>
          </form>
          {search.isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
          {search.error && <p className="text-sm text-destructive">{(search.error as Error).message}</p>}
          {approved.map((r, i) => (
            <ResultCard key={String(pick(r, "revision_id", "product_id", "id") ?? i)} row={r}
              onView={() => { const id = pick(r, "revision_id", "current_revision_id", "approved_revision_id"); if (id) setOpenRevision(String(id)); }} />
          ))}
          {searched && search.isSuccess && approved.length === 0 && (
            <div className="space-y-2 rounded border p-4">
              <p>We haven't seen this product before.</p>
              <Button onClick={() => find.mutate()} disabled={find.isPending}>Find this product</Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="photo" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept="image/*" capture="environment" className="max-w-sm" aria-label="Upload photo"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <CountrySelect value={country} onChange={setCountry} />
            <Button disabled={!photo || !user || photoSearch.isPending} onClick={() => photoSearch.mutate()}><Camera className="mr-1 h-4 w-4" />Find from photo</Button>
          </div>
          <p className="text-xs text-muted-foreground">The photo is stored privately; product recognition is done by the V3 backend.</p>
        </TabsContent>
        <TabsContent value="review"><ReviewQueue onOpen={setOpenRevision} /></TabsContent>
      </Tabs>
      {notice && <div className="flex items-center gap-2 rounded border border-warning/50 bg-warning/10 p-3 text-sm"><AlertTriangle className="h-4 w-4" />{notice}</div>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {jobId && (
        <div className="space-y-1">
          <JobProgress jobId={jobId} onRevision={setOpenRevision} />
          <Button size="sm" variant="ghost" onClick={() => { setJobId(null); setNotice(null); }}>Dismiss</Button>
        </div>
      )}
      <ReviewSheet revisionId={openRevision} onClose={() => setOpenRevision(null)} />
    </div>
  );
}
