import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchPickingRecords } from "@/lib/pickingRecordsQuery";
import { fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";
import {
  DAFF_WINE_GRAPES_LEVY_URL,
  INSTALMENT_THRESHOLD_TONNES,
  LEVIES_ONLINE_URL,
  buildLevySources,
  computeWorksheet,
  copyAllText,
  defaultLevyEndYear,
  fmt3,
  fmtMoney,
  indicativeLevy,
  levyPeriod,
  worksheetCsv,
  type ConcentrateInput,
  type LevyPeriod,
  type LevySourceSummary,
} from "@/lib/wineGrapeLevy";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Copy, Download, ExternalLink, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: `Copied ${what}` });
  } catch {
    toast({ title: "Couldn't copy", description: "Your browser blocked the clipboard. Select and copy the value instead.", variant: "destructive" });
  }
}

export default function WineGrapeLevyPage() {
  const { selectedVineyardId } = useVineyard();
  const defaultYear = defaultLevyEndYear();
  const [endYear, setEndYear] = useState(defaultYear);
  const years = useMemo(
    () => Array.from({ length: 6 }, (_, i) => defaultYear + 1 - i),
    [defaultYear],
  );
  const period = levyPeriod(endYear);

  return (
    <div className="p-6 space-y-5 max-w-5xl print:p-0">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Wine Grape Levy Return — Preparation Worksheet</h1>
        <p className="text-sm text-muted-foreground">
          Prepare the figures for your annual Return of Prescribed Goods used in the Manufacture of Wine. VineTrack
          does not lodge or pay the levy — you lodge and pay in Levies Online.
        </p>
      </div>

      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="levy-year">Levy year</Label>
          <Select value={String(endYear)} onValueChange={(v) => setEndYear(Number(v))}>
            <SelectTrigger id="levy-year" className="w-40 print:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {levyPeriod(y).label}
                  {y > defaultYear ? " (in progress)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="hidden print:block font-medium">{period.label}</p>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground">Period</div>
          <div className="font-medium">
            {fmtDate(period.start)} – {fmtDate(period.end)}
          </div>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground">Return due</div>
          <div className="font-medium">{fmtDate(period.due)}</div>
        </div>
        <div className="flex flex-wrap gap-2 ml-auto print:hidden">
          <Button variant="outline" size="sm" asChild>
            <a href={LEVIES_ONLINE_URL} target="_blank" rel="noopener noreferrer">
              Levies Online <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={DAFF_WINE_GRAPES_LEVY_URL} target="_blank" rel="noopener noreferrer">
              DAFF levy information <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </div>
      </Card>

      {endYear > defaultYear && (
        <PortalNotice
          variant="warning"
          title="This levy year has not finished"
          description="Figures may still change before 30 June. The last complete levy year is selected by default."
        />
      )}

      <PortalNotice
        variant="warning"
        title="Harvest figures are suggestions only"
        description={
          <>
            The levy is on fresh grapes, dried grapes and grape juice you <strong>owned when used in making wine</strong>{" "}
            during the levy year — not on every tonne picked. Harvest records do not prove ownership or use in
            winemaking. Reconcile fruit processed by other wineries, bought fruit or juice, stock carried across years,
            and sold grapes before using any figure. See the{" "}
            <a className="underline" href={DAFF_WINE_GRAPES_LEVY_URL} target="_blank" rel="noopener noreferrer">
              official DAFF definition
            </a>
            .
          </>
        }
      />

      {selectedVineyardId ? (
        <LevyWorksheet key={`${selectedVineyardId}:${endYear}`} vineyardId={selectedVineyardId} period={period} />
      ) : (
        <PortalNotice variant="info" description="Select a vineyard to prepare the worksheet." />
      )}
    </div>
  );
}

function LevyWorksheet({ vineyardId, period }: { vineyardId: string; period: LevyPeriod }) {
  const picksQ = useQuery({
    queryKey: ["wine-grape-levy", "picks", vineyardId],
    queryFn: () => fetchPickingRecords(vineyardId),
  });
  const histQ = useQuery({
    queryKey: ["wine-grape-levy", "historical", vineyardId],
    queryFn: () => fetchYieldReportsForVineyard(vineyardId),
  });
  const loading = picksQ.isLoading || histQ.isLoading;
  const failed = picksQ.isError || histQ.isError;

  const sources = useMemo<LevySourceSummary | null>(() => {
    if (!picksQ.data || !histQ.data) return null;
    // Guard: only this vineyard's rows.
    const picks = picksQ.data.filter((p) => p.vineyard_id === vineyardId);
    const hist = histQ.data.historical.filter((h) => h.vineyard_id === vineyardId);
    return buildLevySources(picks, hist, period);
  }, [picksQ.data, histQ.data, vineyardId, period]);

  // Worksheet state — in memory only, never saved.
  const [fresh, setFresh] = useState("");
  const [freshFrom, setFreshFrom] = useState<"manual" | "suggestion">("manual");
  const [dried, setDried] = useState("");
  const [juice, setJuice] = useState("");
  const [conc, setConc] = useState<ConcentrateInput[]>([{ id: crypto.randomUUID(), litres: "", strength: "" }]);
  const [note, setNote] = useState("");
  const [includeSold, setIncludeSold] = useState(false);
  const [includeUndated, setIncludeUndated] = useState(false);
  const [nilConfirmed, setNilConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  const suggestion = sources
    ? sources.unsoldTonnes + (includeSold ? sources.soldTonnes : 0) + (includeUndated ? sources.undatedTonnes : 0)
    : 0;

  const result = computeWorksheet({ fresh, dried, juice, concentrates: conc });
  const levy = indicativeLevy(result.totalTonnes, period.endYear);
  const blanksOk = result.blanks.length === 0 || nilConfirmed;
  const ready = reviewed && blanksOk && !result.hasErrors;
  const freshMatchesSuggestion =
    freshFrom === "suggestion" && result.fresh.value != null && Math.abs(result.fresh.value - suggestion) < 1e-9;

  const edit = (fn: () => void) => {
    fn();
    setReviewed(false);
  };

  const downloadCsv = () => {
    const csv = worksheetCsv(period, result, levy, note, suggestion);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wine-grape-levy-worksheet-${period.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Source reconciliation */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">VineTrack actuals (suggested)</h2>
          <Badge variant="outline">Unverified</Badge>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading harvest records…</p>
        ) : failed ? (
          <PortalNotice
            variant="error"
            title="Couldn't load harvest records"
            description="No suggestion is shown because the records didn't load. You can still enter values manually."
            action={
              <Button size="sm" variant="outline" onClick={() => { picksQ.refetch(); histQ.refetch(); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
              </Button>
            }
          />
        ) : sources && !sources.hasAnyActual ? (
          <PortalNotice
            variant="info"
            title="No actual harvest records for this levy year"
            description="There are no dated picks in this period and no actual yields for this vintage. Enter the figures manually."
          />
        ) : sources ? (
          <SourceBreakdown
            s={sources}
            period={period}
            includeSold={includeSold}
            setIncludeSold={setIncludeSold}
            includeUndated={includeUndated}
            setIncludeUndated={setIncludeUndated}
          />
        ) : null}
        {sources && sources.hasAnyActual && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <div>
              <div className="text-xs text-muted-foreground">Suggested tonnes (from selected sources)</div>
              <div className="text-lg font-semibold tabular-nums">{fmt3(suggestion)} t</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="print:hidden"
              onClick={() => edit(() => { setFresh(suggestion.toFixed(3)); setFreshFrom("suggestion"); })}
            >
              Use as starting value for 01
            </Button>
          </div>
        )}
      </Card>

      {/* Worksheet */}
      <Card className="p-4 space-y-4">
        <div>
          <h2 className="font-medium">Fields for Levies Online</h2>
          <p className="text-xs text-muted-foreground">
            Edits here stay on this page only — they are not saved and never change your yield records. Print or
            export before leaving.
          </p>
        </div>

        <FieldRow
          code="01"
          label="Tonnes fresh grapes used to make wine this levy year"
          badge={
            result.fresh.value == null ? null : freshMatchesSuggestion ? (
              <Badge variant="secondary">Actual record</Badge>
            ) : (
              <Badge variant="outline">Manual</Badge>
            )
          }
          copyValue={fmt3(result.fresh.value ?? 0)}
        >
          <NumInput id="f01" unit="tonnes" value={fresh} error={result.fresh.error}
            onChange={(v) => edit(() => { setFresh(v); setFreshFrom("manual"); })} />
        </FieldRow>

        <FieldRow
          code="02"
          label="Tonnes dried grapes used to make wine this levy year"
          badge={result.dried.value == null ? <Badge variant="outline">Not entered</Badge> : <Badge variant="outline">Manual</Badge>}
          copyValue={fmt3(result.dried.value ?? 0)}
          extra={`Fresh grape equivalent (× 3): ${fmt3(result.driedFreshEquivalent)} t`}
        >
          <NumInput id="f02" unit="tonnes" value={dried} error={result.dried.error} onChange={(v) => edit(() => setDried(v))} />
        </FieldRow>

        <FieldRow
          code="03"
          label="Litres single strength grape juice used to make wine this levy year"
          badge={result.juice.value == null ? <Badge variant="outline">Not entered</Badge> : <Badge variant="outline">Manual</Badge>}
          copyValue={fmt3(result.juice.value ?? 0)}
          extra={`Fresh grape equivalent (÷ 800): ${fmt3(result.juiceFreshEquivalent)} t`}
        >
          <NumInput id="f03" unit="litres" value={juice} error={result.juice.error} onChange={(v) => edit(() => setJuice(v))} />
        </FieldRow>

        <div className="rounded-md border p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge>04</Badge>
              <span className="text-sm font-medium">Litres concentrated grape juice used to make wine this levy year</span>
            </div>
            <Button size="sm" variant="ghost" className="print:hidden"
              onClick={() => edit(() => setConc((c) => [...c, { id: crypto.randomUUID(), litres: "", strength: "" }]))}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add row
            </Button>
          </div>
          {conc.map((c, idx) => {
            const r = result.concentrates[idx];
            return (
              <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-start">
                <NumInput id={`c-l-${c.id}`} unit="litres" label="Litres" value={c.litres} error={r.litres.error}
                  onChange={(v) => edit(() => setConc((xs) => xs.map((x) => (x.id === c.id ? { ...x, litres: v } : x))))} />
                <NumInput id={`c-s-${c.id}`} unit="×" label="Strength" value={c.strength} error={r.strengthError}
                  onChange={(v) => edit(() => setConc((xs) => xs.map((x) => (x.id === c.id ? { ...x, strength: v } : x))))} />
                <div className="text-sm">
                  <div className="text-xs text-muted-foreground">Single strength equivalent</div>
                  <div className="tabular-nums pt-2">{fmt3(r.equivalentLitres)} L</div>
                </div>
                <Button size="icon" variant="ghost" aria-label="Remove row" className="print:hidden mt-5"
                  disabled={conc.length === 1}
                  onClick={() => edit(() => setConc((xs) => xs.filter((x) => x.id !== c.id)))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Total {fmt3(result.concentrateEquivalentLitres)} L single strength equivalent → fresh grape equivalent
              (÷ 800): <strong className="tabular-nums">{fmt3(result.concentrateFreshEquivalent)} t</strong>
            </span>
            <CopyBtn value={fmt3(result.concentrateFreshEquivalent)} what="04 equivalent tonnes" />
          </div>
        </div>

        <div className="rounded-md bg-muted/50 p-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm text-muted-foreground">Total tonnage (01 + 02 + 03 + 04 fresh grape equivalent)</div>
            <div className="text-xl font-semibold tabular-nums">{fmt3(result.totalTonnes)} t</div>
          </div>
          <CopyBtn value={fmt3(result.totalTonnes)} what="total tonnage" />
        </div>

        <div className="rounded-md border p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Total levy payable</span>
            <Badge variant="outline">Indicative</Badge>
          </div>
          {levy == null ? (
            <p className="text-sm">
              Calculate in Levies Online — VineTrack doesn't have verified rates for {period.label}.
            </p>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums">{fmtMoney(levy)}</p>
              <p className="text-xs text-muted-foreground">
                Estimate from the DAFF published rate schedule, GST not applied. This is not an assessment — Levies
                Online calculates the amount you owe.
                {result.totalTonnes > INSTALMENT_THRESHOLD_TONNES &&
                  " Over 100 tonnes you may be able to pay in two instalments (50% by 30 September, 50% by 31 March) — check Levies Online."}
              </p>
            </>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="levy-note">Adjustment / reconciliation note (optional)</Label>
          <Textarea id="levy-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Removed 12 t sold to another winery; added 3 t bought-in fruit." />
        </div>
      </Card>

      {/* Review + output */}
      <Card className="p-4 space-y-3">
        {result.blanks.length > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={nilConfirmed} onCheckedChange={(v) => setNilConfirmed(v === true)} className="mt-0.5" />
            <span>
              Fields {result.blanks.join(", ")} are blank. I confirm these are nil (0) for this levy year.
              <Badge variant="outline" className="ml-2">Needs confirmation</Badge>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} className="mt-0.5"
            disabled={result.hasErrors} />
          <span>
            I have reviewed these figures against my records of grapes and juice I owned and used in winemaking this
            levy year. I understand VineTrack figures are suggestions only.
          </span>
        </label>
        {result.hasErrors && <p className="text-sm text-destructive">Fix the highlighted fields first.</p>}
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button disabled={!ready} onClick={() => copyText(copyAllText(period, result, levy), "all values")}>
            <Copy className="h-4 w-4 mr-1" /> Copy All Values
          </Button>
          <Button variant="outline" disabled={!ready} onClick={downloadCsv}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" disabled={!ready} onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
          </Button>
        </div>
        {!ready && !result.hasErrors && (
          <p className="text-xs text-muted-foreground">
            Tick the review {result.blanks.length > 0 && !nilConfirmed ? "and nil confirmation " : ""}to enable copying
            and export. Changing any value clears the review.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          This is a preparation worksheet, not a lodged return. Nothing is submitted, paid or saved by VineTrack.
        </p>
      </Card>
    </div>
  );
}

function SourceBreakdown(props: {
  s: LevySourceSummary;
  period: LevyPeriod;
  includeSold: boolean;
  setIncludeSold: (v: boolean) => void;
  includeUndated: boolean;
  setIncludeUndated: (v: boolean) => void;
}) {
  const { s, period } = props;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label={`Unsold picks dated ${period.start} – ${period.end}`} value={s.unsoldTonnes}
          count={s.unsoldPicks.length} tag="Included" />
        <Stat label="Sold picks in this period" value={s.soldTonnes} count={s.soldPicks.length}
          tag={props.includeSold ? "Included" : "Excluded"} />
        <Stat label={`Undated actual yields, vintage ${period.endYear}`} value={s.undatedTonnes}
          count={s.undated.length} tag={props.includeUndated ? "Included" : "Excluded"} />
      </div>
      {s.soldPicks.length > 0 && (
        <label className="flex items-start gap-2">
          <Checkbox checked={props.includeSold} onCheckedChange={(v) => props.setIncludeSold(v === true)} className="mt-0.5" />
          <span>Include sold picks — only if you still owned that fruit when it was used to make wine.</span>
        </label>
      )}
      {s.undated.length > 0 && (
        <label className="flex items-start gap-2">
          <Checkbox checked={props.includeUndated} onCheckedChange={(v) => props.setIncludeUndated(v === true)} className="mt-0.5" />
          <span>
            Include undated actual yields for vintage {period.endYear}. These have no winemaking date, so VineTrack
            can't tell which levy year they belong to — confirm before including.
          </span>
        </label>
      )}
      {(s.undatedSuperseded > 0 || s.vintagePicksOutsidePeriod > 0) && (
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
          {s.undatedSuperseded > 0 && (
            <li>{s.undatedSuperseded} actual yield entr{s.undatedSuperseded === 1 ? "y is" : "ies are"} left out because picking records cover the same block and vintage (no double counting).</li>
          )}
          {s.vintagePicksOutsidePeriod > 0 && (
            <li>{s.vintagePicksOutsidePeriod} pick{s.vintagePicksOutsidePeriod === 1 ? "" : "s"} for vintage {period.endYear} {s.vintagePicksOutsidePeriod === 1 ? "is" : "are"} dated outside this levy year and not counted.</li>
          )}
        </ul>
      )}
      {s.unsoldPicks.length + s.soldPicks.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-primary">Show picks in this period</summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr><th className="py-1 pr-2">Date</th><th className="pr-2">Block</th><th className="pr-2">Variety</th><th className="pr-2 text-right">Tonnes</th><th className="pr-2">Status</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {[...s.unsoldPicks, ...s.soldPicks].sort((a, b) => a.pickedAt.localeCompare(b.pickedAt)).map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1 pr-2">{p.pickedAt}</td>
                    <td className="pr-2">{p.blockName}</td>
                    <td className="pr-2">{p.variety ?? "—"}</td>
                    <td className="pr-2 text-right tabular-nums">{fmt3(p.tonnes)}</td>
                    <td className="pr-2">{p.sold ? `Sold${p.soldTo ? ` to ${p.soldTo}` : ""}` : "Not sold"}</td>
                    <td>{p.purpose ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, count, tag }: { label: string; value: number; count: number; tag: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{fmt3(value)} t</div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{count} record{count === 1 ? "" : "s"}</span>
        <Badge variant={tag === "Included" ? "secondary" : "outline"}>{tag}</Badge>
      </div>
    </div>
  );
}

function FieldRow(props: {
  code: string;
  label: string;
  badge: React.ReactNode;
  copyValue: string;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 grid gap-3 md:grid-cols-[1fr_minmax(0,16rem)_auto] md:items-center">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{props.code}</Badge>
          <span className="text-sm font-medium">{props.label}</span>
          {props.badge}
        </div>
        {props.extra && <div className="text-xs text-muted-foreground tabular-nums">{props.extra}</div>}
      </div>
      {props.children}
      <CopyBtn value={props.copyValue} what={`field ${props.code}`} />
    </div>
  );
}

function NumInput(props: {
  id: string;
  unit: string;
  value: string;
  error: string | null;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      {props.label && <Label htmlFor={props.id} className="text-xs">{props.label}</Label>}
      <div className="flex items-center gap-2">
        <Input id={props.id} inputMode="decimal" value={props.value} placeholder="Blank"
          aria-invalid={!!props.error} onChange={(e) => props.onChange(e.target.value)}
          className={props.error ? "border-destructive" : ""} />
        <span className="text-xs text-muted-foreground whitespace-nowrap">{props.unit}</span>
      </div>
      {props.error && <p className="text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

function CopyBtn({ value, what }: { value: string; what: string }) {
  return (
    <Button size="sm" variant="outline" className="print:hidden" onClick={() => copyText(value.replace(/,/g, ""), what)}
      aria-label={`Copy ${what}`}>
      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
    </Button>
  );
}
