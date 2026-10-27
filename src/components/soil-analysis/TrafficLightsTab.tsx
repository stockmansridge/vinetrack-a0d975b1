import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Circle, Search, Sparkles } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildSoilTrafficSnapshots, listAnalyteCatalogue, listSoilTrafficResults, soilTrafficCounts, type SoilTrafficBucket, type SoilTrafficSnapshot } from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { soilIndicationResultIds, requestSoilIndications, indicateSoilSnapshots } from "@/lib/soilTrafficIndication";
import { SoilBlockSelector } from "./SoilBlockSelector";

const sections: Array<{ bucket: SoilTrafficBucket; title: string; accent: string; surface: string }> = [
  { bucket: "low", title: "Low", accent: "text-destructive", surface: "border-destructive/30 bg-destructive/5" },
  { bucket: "satisfactory", title: "Satisfactory", accent: "text-success", surface: "border-success/30 bg-success/5" },
  { bucket: "high", title: "High", accent: "text-warning", surface: "border-warning/40 bg-warning/10" },
  { bucket: "other", title: "Other / Not stated", accent: "text-muted-foreground", surface: "border-border bg-muted/40" },
];

export function TrafficLightsTab() {
  const { selectedVineyardId } = useVineyard();
  // Null selection means all current active blocks, including blocks loaded later.
  const [selection, setSelection] = useState<{ vineyardId: string | null; ids: string[] } | null>(null);
  const [asOf, setAsOf] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [timeMode, setTimeMode] = useState("recent");
  const effectiveAsOf = timeMode === "date" ? asOf || null : null;
  const [status, setStatus] = useState<"all" | SoilTrafficBucket>("all");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", selectedVineyardId], enabled: !!selectedVineyardId,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await (supabase as any).from("paddocks").select("id, name")
        .eq("vineyard_id", selectedVineyardId).is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const blocks = useMemo(() => [...(blocksQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [blocksQuery.data]);
  const selected = blocks.filter((b) => selection?.vineyardId !== selectedVineyardId || selection.ids.includes(b.id)).map((b) => b.id);
  const catalogue = useQuery({ queryKey: ["soil-analysis", "analytes"], queryFn: listAnalyteCatalogue });
  const results = useQuery({
    queryKey: ["soil-analysis", "traffic", selectedVineyardId, selected, effectiveAsOf], enabled: !!selectedVineyardId && selected.length > 0,
    queryFn: () => listSoilTrafficResults(selected, effectiveAsOf),
  });
  const snapshots = useMemo(() => buildSoilTrafficSnapshots(results.data ?? []), [results.data]);
  const relevant = snapshots.filter((s) => selected.includes(s.paddockId));
  const resultIds = soilIndicationResultIds(relevant);
  const ai = useQuery({
    queryKey: ["soil-analysis", "viticulture-indication", selectedVineyardId, resultIds],
    enabled: aiEnabled && !!selectedVineyardId && resultIds.length > 0 && results.isSuccess,
    staleTime: 60 * 60 * 1000, gcTime: 60 * 60 * 1000,
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    queryFn: () => selectedVineyardId ? requestSoilIndications(selectedVineyardId, resultIds) : Promise.resolve([]),
  });
  const displayed = indicateSoilSnapshots(relevant, aiEnabled && !ai.isError ? ai.data : undefined);
  const analyte = (s: SoilTrafficSnapshot) => catalogue.data?.find((a) => a.key === s.analyteKey);
  const name = (s: SoilTrafficSnapshot) => analyte(s)?.display_name ?? s.entries[0]?.display_name ?? s.analyteKey;
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? id;
  const categories = [...new Set((catalogue.data ?? []).map((a) => a.category ?? "Other"))].sort();
  const filtered = displayed.filter((s) => {
    const a = analyte(s);
    const text = `${name(s)} ${s.analyteKey} ${a?.category ?? "Other"}`.toLowerCase();
    return selected.includes(s.paddockId) && text.includes(search.trim().toLowerCase()) && (category === "all" || (a?.category ?? "Other") === category);
  });
  // Summary stays independent of the direct status filter.
  const counts = soilTrafficCounts(filtered);
  return <div className="min-w-0 space-y-4">
    <div>
      <h2 className="text-lg font-semibold">Latest laboratory statuses</h2>
      <p className="text-sm text-muted-foreground">Laboratory statuses remain the source of truth. Optional AI indications are labelled separately.</p>
    </div>
    <SoilBlockSelector blocks={blocks} selected={selected} onChange={(ids) => setSelection({ vineyardId: selectedVineyardId, ids })} />
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-60 space-y-1">
        <Label htmlFor="traffic-search">Search analytes</Label>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input id="traffic-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, key or category" className="pl-9" /></div>
      </div>
      <div className="w-48 space-y-1"><Label htmlFor="traffic-category">Category</Label>
        <Select value={category} onValueChange={setCategory}><SelectTrigger id="traffic-category"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="w-44 space-y-1"><Label htmlFor="traffic-time">Time</Label>
        <Select value={timeMode} onValueChange={setTimeMode}><SelectTrigger id="traffic-time"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="recent">Most recent</SelectItem><SelectItem value="date">As of date</SelectItem></SelectContent></Select>
      </div>
      {timeMode === "date" && <div className="w-44 space-y-1"><Label htmlFor="traffic-as-of">As of date</Label>
        <Input id="traffic-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>}
    </div>
    <p className="text-xs text-muted-foreground">Most recent uses the latest confirmed result available for each block and analyte.</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Status visibility" className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-sm text-muted-foreground">Show: {status === "all" ? "All" : sections.find((s) => s.bucket === status)?.title}</span>
        {[{ bucket: "all" as const, title: "All" }, ...sections].map((s) => <Button key={s.bucket} size="sm" variant={status === s.bucket ? "default" : "outline"} aria-pressed={status === s.bucket} onClick={() => setStatus(s.bucket)}>{s.bucket === "other" ? "Other" : s.title}</Button>)}
      </div>
      <div className="flex items-center gap-2"><Switch id="traffic-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} /><Label htmlFor="traffic-ai">AI viticulture indication</Label></div>
    </div>
    <p className="text-xs text-muted-foreground">Optional AI screening for results the laboratory has not classified as Low, Satisfactory or High. It does not change the laboratory result.</p>
    {aiEnabled && ai.isFetching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4" aria-hidden />Analysing unrated results…</p>}
    {aiEnabled && ai.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">AI indication is unavailable. Laboratory statuses are still shown.<Button variant="outline" size="sm" onClick={() => ai.refetch()}>Retry</Button></div>}
    {blocksQuery.isError || results.isError ? <p role="alert" className="text-destructive">Unable to load laboratory statuses. Please try again.</p>
      : blocksQuery.isLoading || (selected.length > 0 && results.isLoading) ? <p className="text-muted-foreground">Loading laboratory statuses…</p>
      : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Latest status counts">
          {sections.map((section) => <Button key={section.bucket} variant="outline" aria-label={`Show ${section.bucket === "other" ? "Other" : section.title}`} aria-pressed={status === section.bucket} onClick={() => setStatus(section.bucket)} className={`h-auto min-w-0 flex-col items-start rounded-md border p-3 ${section.surface} ${status === section.bucket ? "ring-2 ring-ring" : ""}`}>
            <div className={`flex max-w-full items-center gap-2 whitespace-normal text-left text-sm font-semibold ${section.accent}`}><Circle className="h-3 w-3 shrink-0 fill-current" aria-hidden />{section.title}</div>
            <div className="mt-1 text-2xl font-semibold" aria-label={`${section.title} count`}>{counts[section.bucket]}</div>
            {aiEnabled && <span className="mt-1 text-xs text-muted-foreground">{filtered.filter((s) => s.bucket === section.bucket && s.sourceBucket !== "other").length + filtered.filter((s) => s.bucket === section.bucket && s.sourceBucket === "other" && s.bucket === "other").length} lab · {filtered.filter((s) => s.bucket === section.bucket && s.sourceBucket === "other" && s.bucket !== "other").length} AI</span>}
          </Button>)}
        </div>
        {!selected.length ? <p className="py-6 text-sm text-muted-foreground">Choose one or more blocks.</p>
          : !filtered.length ? <p className="py-6 text-sm text-muted-foreground">No matching confirmed laboratory results.</p>
          : <div className={`grid items-start gap-4 ${status === "all" ? "md:grid-cols-2" : "grid-cols-1"}`}>
            {sections.filter((section) => status === "all" || status === section.bucket).map((section) => {
              const group = new Map<string, (typeof filtered)[number][]>();
              for (const s of filtered.filter((s) => s.bucket === section.bucket)) group.set(s.analyteKey, [...(group.get(s.analyteKey) ?? []), s]);
              return <section key={section.bucket} aria-label={`${section.title} laboratory statuses`} className="min-w-0 space-y-2">
                <h3 className={`flex items-center gap-2 border-b pb-2 text-sm font-semibold uppercase ${section.accent}`}><Circle className="h-3 w-3 fill-current" aria-hidden />{section.title} · {counts[section.bucket]}</h3>
                {!group.size && <p className="text-sm text-muted-foreground">No results</p>}
                {!!group.size && <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setExpanded((v) => ({ ...v, [section.bucket]: [...group.keys()] }))}>Expand all</Button><Button variant="ghost" size="sm" onClick={() => setExpanded((v) => ({ ...v, [section.bucket]: [] }))}>Collapse all</Button></div>}
                <Accordion type="multiple" value={expanded[section.bucket] ?? []} onValueChange={(value) => setExpanded((v) => ({ ...v, [section.bucket]: value }))} className="space-y-2">
                {[...group.values()].sort((a, b) => name(a[0]).localeCompare(name(b[0])) || a[0].analyteKey.localeCompare(b[0].analyteKey)).map((items) => {
                  // Compare metadata across every visible latest snapshot for this analyte,
                  // even when its blocks sit in different traffic sections.
                  const raw = filtered.filter((s) => s.analyteKey === items[0].analyteKey).flatMap((s) => s.entries);
                  const mixed = new Set(raw.map((r) => JSON.stringify([r.method?.trim().toLowerCase() || null, r.unit?.trim() || null]))).size > 1;
                  return <AccordionItem value={items[0].analyteKey} key={items[0].analyteKey} className={`min-w-0 rounded-md border ${section.surface}`}>
                    <AccordionTrigger className="gap-3 px-3 py-2 text-left hover:no-underline"><span className="min-w-0"><span className="block font-semibold">{name(items[0])}</span>
                      <span className="block text-xs text-muted-foreground">{items.length} {items.length === 1 ? "block" : "blocks"}{mixed ? " · Mixed methods/units — raw results shown separately" : ""}</span></span></AccordionTrigger>
                    <AccordionContent className="pb-0"><div className="divide-y divide-border">
                      {items.sort((a, b) => blockName(a.paddockId).localeCompare(blockName(b.paddockId))).map((s) => <div key={s.paddockId} className="min-w-0 px-3 py-2">
                        <div className="flex flex-wrap justify-between gap-x-3 text-sm"><span className="font-semibold">{blockName(s.paddockId)}</span><time dateTime={s.date}>{formatDate(s.date)}</time></div>
                        {s.aiLabel && <div className="mt-2 rounded-md border border-dashed border-current p-2 text-xs"><span className="inline-flex items-center gap-1 font-semibold"><Sparkles className="h-3 w-3" aria-hidden />{s.aiLabel}</span>
                          {s.aiEntries?.map((r) => <p key={r.result_id} className="mt-1 break-words text-muted-foreground">{Math.round(r.confidence * 100)}% confidence · {r.reason}</p>)}</div>}
                        {s.statusLabel === "Mixed latest statuses" && <p className="mt-1 text-xs font-semibold text-muted-foreground">Mixed latest statuses</p>}
                        {s.entries.map((r) => <div key={r.id} className="mt-2 min-w-0 space-y-1 text-sm">
                          <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{r.value_numeric ?? r.value_text ?? "—"}{r.unit ? ` ${r.unit}` : ""}</span><span>{s.aiLabel ? "Lab: " : ""}{r.lab_status?.trim() || "Not stated"}</span></div>
                          <p className="break-words text-xs text-muted-foreground">{[r.method || "Method not recorded", r.sample.sample_depth_from_cm != null ? `Depth ${r.sample.sample_depth_from_cm}–${r.sample.sample_depth_to_cm ?? "?"} cm` : "Depth not recorded", r.sample.laboratory, r.sample.lab_sample_id ? `Lab sample ${r.sample.lab_sample_id}` : null].filter(Boolean).join(" · ")}</p>
                          <p className="text-xs text-muted-foreground">Lab range: {r.lab_range_text ?? (r.lab_range_min != null || r.lab_range_max != null ? `${r.lab_range_min ?? "?"}–${r.lab_range_max ?? "?"}` : "Not stated")}</p>
                          <Button asChild variant="link" size="sm" className="h-auto px-0"><Link to={`/soil-analysis/samples/${r.sample.id}`}>Open sample<ArrowUpRight className="ml-1 h-3 w-3" aria-hidden /></Link></Button>
                        </div>)}
                      </div>)}
                    </div></AccordionContent>
                  </AccordionItem>;
                })}
                </Accordion>
              </section>;
            })}
          </div>}
      </>}
  </div>;
}