import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchSavedChemicalsForVineyard,
  type SavedChemical,
} from "@/lib/savedChemicalsQuery";

const ANY = "__any__";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

export default function SavedChemicalsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<string>(ANY);
  const [use, setUse] = useState<string>(ANY);
  const [selected, setSelected] = useState<SavedChemical | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["saved_chemicals", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });

  const chemicals = data?.chemicals ?? [];

  const groups = useMemo(() => {
    const s = new Set<string>();
    chemicals.forEach((c) => c.chemical_group && s.add(c.chemical_group));
    return Array.from(s).sort();
  }, [chemicals]);
  const uses = useMemo(() => {
    const s = new Set<string>();
    chemicals.forEach((c) => c.use && s.add(c.use));
    return Array.from(s).sort();
  }, [chemicals]);

  const rows = useMemo(() => {
    let list = chemicals.slice();
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (group !== ANY) list = list.filter((c) => c.chemical_group === group);
    if (use !== ANY) list = list.filter((c) => c.use === use);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) =>
        [
          c.name, c.active_ingredient, c.manufacturer, c.chemical_group,
          c.use, c.crop, c.problem, c.mode_of_action, c.notes, c.restrictions,
        ].some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [chemicals, filter, group, use]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[SavedChemicalsPage] diagnostics", {
      selectedVineyardId,
      savedChemicalsCount: chemicals.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      deletedExcluded: data?.deletedExcluded ?? 0,
      missingDisplayFields: {
        missingName: data?.missingName ?? 0,
        missingRate: data?.missingRate ?? 0,
      },
      schemaGaps: [
        "no global/shared chemical library table (vineyard-scoped only)",
        "no withholding_period or re_entry_interval column (lives in `restrictions` free text)",
        "no archive/active flag (only deleted_at)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Saved chemicals</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Soft-deleted records are excluded.
        </p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Group</div>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any group</SelectItem>
              {groups.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Use</div>
          <Select value={use} onValueChange={setUse}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any use</SelectItem>
              {uses.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Name, ingredient, target…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Active ingredient</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Use</TableHead>
              <TableHead>Rate/ha</TableHead>
              <TableHead>Manufacturer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No saved chemicals found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                <TableCell>{fmt(c.active_ingredient)}</TableCell>
                <TableCell>{c.chemical_group ? <Badge variant="secondary">{c.chemical_group}</Badge> : "—"}</TableCell>
                <TableCell>{fmt(c.use)}</TableCell>
                <TableCell>
                  {c.rate_per_ha == null ? "—" : `${c.rate_per_ha}${c.unit ? ` ${c.unit}` : ""}`}
                </TableCell>
                <TableCell>{fmt(c.manufacturer)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ChemicalSheet chem={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function ChemicalSheet({
  chem,
  open,
  onOpenChange,
}: {
  chem: SavedChemical | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const ratesArr = Array.isArray(chem?.rates) ? chem!.rates : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{chem?.name ?? "Saved chemical"}</SheetTitle>
        </SheetHeader>
        {chem && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Identity">
              <Field label="Name" value={fmt(chem.name)} />
              <Field label="Active ingredient" value={fmt(chem.active_ingredient)} />
              <Field label="Manufacturer" value={fmt(chem.manufacturer)} />
              <Field label="Group" value={fmt(chem.chemical_group)} />
              <Field label="Mode of action" value={fmt(chem.mode_of_action)} />
            </Section>
            <Section title="Application">
              <Field label="Use" value={fmt(chem.use)} />
              <Field label="Crop" value={fmt(chem.crop)} />
              <Field label="Target" value={fmt(chem.problem)} />
              <Field
                label="Rate per ha"
                value={chem.rate_per_ha == null ? "—" : `${chem.rate_per_ha}${chem.unit ? ` ${chem.unit}` : ""}`}
              />
              <Field label="Unit" value={fmt(chem.unit)} />
            </Section>
            {ratesArr && ratesArr.length > 0 && (
              <Section title={`Rate variants (${ratesArr.length})`}>
                <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">
                  {JSON.stringify(ratesArr, null, 2)}
                </pre>
              </Section>
            )}
            {(chem.restrictions || chem.notes) && (
              <Section title="Restrictions & notes">
                {chem.restrictions && (
                  <div>
                    <div className="text-muted-foreground mb-1">Restrictions (incl. WHP / REI)</div>
                    <p className="whitespace-pre-wrap">{chem.restrictions}</p>
                  </div>
                )}
                {chem.notes && (
                  <div>
                    <div className="text-muted-foreground mb-1">Notes</div>
                    <p className="whitespace-pre-wrap">{chem.notes}</p>
                  </div>
                )}
              </Section>
            )}
            {chem.purchase && (
              <Section title="Purchase">
                <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">
                  {JSON.stringify(chem.purchase, null, 2)}
                </pre>
              </Section>
            )}
            <Section title="Meta">
              {chem.label_url && (
                <Field label="Label URL" value={chem.label_url} mono />
              )}
              <Field label="Created" value={fmtDate(chem.created_at)} />
              <Field label="Updated" value={fmtDate(chem.updated_at)} />
              <Field label="Record ID" value={chem.id} mono />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}
