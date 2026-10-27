import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Circle, Search } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildSoilTrafficSnapshots, listAnalyteCatalogue, listSoilTrafficResults, soilTrafficCounts, type SoilTrafficBucket, type SoilTrafficSnapshot } from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";
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
  const [exceptions, setExceptions] = useState(false);
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
    queryKey: ["soil-analysis", "traffic", selectedVineyardId, selected, asOf], enabled: !!selectedVineyardId && selected.length > 0,
    queryFn: () => listSoilTrafficResults(selected, asOf || null),
  });
  const snapshots = useMemo(() => buildSoilTrafficSnapshots(results.data ?? []), [results.data]);
  const analyte = (s: SoilTrafficSnapshot) => catalogue.data?.find((a) => a.key === s.analyteKey);
  const name = (s: SoilTrafficSnapshot) => analyte(s)?.display_name ?? s.entries[0]?.display_name ?? s.analyteKey;
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? id;
  const categories = [...new Set((catalogue.data ?? []).map((a) => a.category ?? "Other"))].sort();
  const filtered = snapshots.filter((s) => {
    const a = analyte(s);
    const text = `${name(s)} ${s.analyteKey} ${a?.category ?? "Other"}`.toLowerCase();
    return selected.includes(s.paddockId) && text.includes(search.trim().toLowerCase()) && (category === "all" || (a?.category ?? "Other") === category);
  });
  // Summary describes the selected/search/category scope; Exceptions only hides the satisfactory section.
  const counts = soilTrafficCounts(filtered);
  return <div className="min-w-0 space-y-4">
    <div>
      <h2 className="text-lg font-semibold">Latest laboratory statuses</h2>
      <p className="text-sm text-muted-foreground">Laboratory status wording only — not a VineTrack agronomic judgement.</p>
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
      <div className="w-44 space-y-1"><Label htmlFor="traffic-as-of">As of date</Label>
        <Input id="traffic-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <div role="group" aria-label="Status visibility" className="flex gap-1">
        <Button variant={!exceptions ? "default" : "outline"} aria-pressed={!exceptions} onClick={() => setExceptions(false)}>All</Button>
        <Button variant={exceptions ? "default" : "outline"} aria-pressed={exceptions} onClick={() => setExceptions(true)}>Exceptions only</Button>
      </div>
    </div>
    {blocksQuery.isError || results.isError ? <p role="alert" className="text-destructive">Unable to load laboratory statuses. Please try again.</p>
      : blocksQuery.isLoading || (selected.length > 0 && results.isLoading) ? <p className="text-muted-foreground">Loading laboratory statuses…</p>
      : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Latest status counts">
          {sections.map((section) => <div key={section.bucket} className={`rounded-md border p-3 ${section.surface}`}>
            <div className={`flex items-center gap-2 text-sm font-semibold ${section.accent}`}><Circle className="h-3 w-3 fill-current" aria-hidden />{section.title}</div>
            <div className="mt-1 text-2xl font-semibold" aria-label={`${section.title} count`}>{counts[section.bucket]}</div>
          </div>)}
        </div>
        {!selected.length ? <p className="py-6 text-sm text-muted-foreground">Choose one or more blocks.</p>
          : !filtered.length ? <p className="py-6 text-sm text-muted-foreground">No matching confirmed laboratory results.</p>
          : <div className="grid items-start gap-6 md:grid-cols-2">
            {sections.filter((section) => !exceptions || section.bucket !== "satisfactory").map((section) => {
              const group = new Map<string, SoilTrafficSnapshot[]>();
              for (const s of filtered.filter((s) => s.bucket === section.bucket)) group.set(s.analyteKey, [...(group.get(s.analyteKey) ?? []), s]);
              return <section key={section.bucket} aria-label={`${section.title} laboratory statuses`} className="min-w-0 space-y-3">
                <h3 className={`flex items-center gap-2 border-b pb-2 text-sm font-semibold uppercase ${section.accent}`}><Circle className="h-3 w-3 fill-current" aria-hidden />{section.title} · {counts[section.bucket]}</h3>
                {!group.size && <p className="text-sm text-muted-foreground">No results</p>}
                {[...group.values()].sort((a, b) => name(a[0]).localeCompare(name(b[0])) || a[0].analyteKey.localeCompare(b[0].analyteKey)).map((items) => {
                  const raw = items.flatMap((s) => s.entries);
                  const mixed = new Set(raw.map((r) => JSON.stringify([r.method?.trim().toLowerCase() || null, r.unit?.trim() || null]))).size > 1;
                  return <article key={items[0].analyteKey} className={`min-w-0 rounded-md border ${section.surface}`}>
                    <header className="px-3 py-2"><h4 className="font-semibold">{name(items[0])}</h4>
                      <p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "block" : "blocks"}{mixed ? " · Mixed methods/units — raw results shown separately" : ""}</p></header>
                    <div className="divide-y divide-border">
                      {items.sort((a, b) => blockName(a.paddockId).localeCompare(blockName(b.paddockId))).map((s) => <div key={s.paddockId} className="min-w-0 px-3 py-2">
                        <div className="flex flex-wrap justify-between gap-x-3 text-sm"><span className="font-semibold">{blockName(s.paddockId)}</span><time dateTime={s.date}>{formatDate(s.date)}</time></div>
                        {s.statusLabel === "Mixed latest statuses" && <p className="mt-1 text-xs font-semibold text-muted-foreground">Mixed latest statuses</p>}
                        {s.entries.map((r) => <div key={r.id} className="mt-2 min-w-0 space-y-1 text-sm">
                          <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{r.value_numeric ?? r.value_text ?? "—"}{r.unit ? ` ${r.unit}` : ""}</span><span>{r.lab_status?.trim() || "Not stated"}</span></div>
                          <p className="break-words text-xs text-muted-foreground">{[r.method || "Method not recorded", r.sample.sample_depth_from_cm != null ? `Depth ${r.sample.sample_depth_from_cm}–${r.sample.sample_depth_to_cm ?? "?"} cm` : "Depth not recorded", r.sample.laboratory, r.sample.lab_sample_id ? `Lab sample ${r.sample.lab_sample_id}` : null].filter(Boolean).join(" · ")}</p>
                          <p className="text-xs text-muted-foreground">Lab range: {r.lab_range_text ?? (r.lab_range_min != null || r.lab_range_max != null ? `${r.lab_range_min ?? "?"}–${r.lab_range_max ?? "?"}` : "Not stated")}</p>
                          <Button asChild variant="link" size="sm" className="h-auto px-0"><Link to={`/soil-analysis/samples/${r.sample.id}`}>Open sample<ArrowUpRight className="ml-1 h-3 w-3" aria-hidden /></Link></Button>
                        </div>)}
                      </div>)}
                    </div>
                  </article>;
                })}
              </section>;
            })}
          </div>}
      </>}
  </div>;
}