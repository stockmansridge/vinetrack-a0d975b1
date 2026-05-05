import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  fetchSavedSprayPresetsForVineyard,
  type SavedSprayPreset,
} from "@/lib/sprayPresetsQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });

export default function SprayPresetsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SavedSprayPreset | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["saved_spray_presets", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSavedSprayPresetsForVineyard(selectedVineyardId!),
  });

  const presets = data?.presets ?? [];

  const rows = useMemo(() => {
    let list = presets.slice();
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((p) =>
        [p.name, p.water_volume, p.spray_rate_per_ha, p.concentration_factor]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [presets, filter]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[SprayPresetsPage] diagnostics", {
      selectedVineyardId,
      sprayPresetsCount: presets.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      deletedExcluded: data?.deletedExcluded ?? 0,
      missingDisplayFields: {
        missingName: data?.missingName ?? 0,
        missingRate: data?.missingRate ?? 0,
      },
      linkedChemicals: {
        resolved: data?.linkedChemicalsResolved ?? 0,
        unresolved: data?.linkedChemicalsUnresolved ?? 0,
      },
      schemaGaps: [
        "no global/shared preset table (vineyard-scoped only)",
        "no operation_type / target / crop column",
        "no equipment_id or chemical_id link — preset is water/rate only",
        "no JSONB mix payload to pretty-print",
        "no archive/active flag (only deleted_at)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Spray presets</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Soft-deleted records are excluded.
        </p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Name, rate, water volume…"
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
              <TableHead>Water volume (L)</TableHead>
              <TableHead>Spray rate / ha</TableHead>
              <TableHead>Concentration</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={5} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No spray presets found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => setSelected(p)}>
                <TableCell className="font-medium">{fmt(p.name)}</TableCell>
                <TableCell>{fmtNum(p.water_volume)}</TableCell>
                <TableCell>{fmtNum(p.spray_rate_per_ha)}</TableCell>
                <TableCell>{fmtNum(p.concentration_factor, 3)}×</TableCell>
                <TableCell>{fmtDate(p.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <PresetSheet preset={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function PresetSheet({
  preset,
  open,
  onOpenChange,
}: {
  preset: SavedSprayPreset | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{preset?.name ?? "Spray preset"}</SheetTitle>
        </SheetHeader>
        {preset && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Recipe">
              <Field label="Name" value={fmt(preset.name)} />
              <Field label="Water volume (L)" value={fmtNum(preset.water_volume)} />
              <Field label="Spray rate per ha" value={fmtNum(preset.spray_rate_per_ha)} />
              <Field
                label="Concentration factor"
                value={preset.concentration_factor == null ? "—" : `${fmtNum(preset.concentration_factor, 3)}×`}
              />
            </Section>
            <Section title="Linked chemicals">
              <p className="text-muted-foreground">
                The preset table does not store linked chemical IDs. Mixes are
                composed at spray time. See diagnostics for the schema gap.
              </p>
            </Section>
            <Section title="Meta">
              <Field label="Created" value={fmtDate(preset.created_at)} />
              <Field label="Updated" value={fmtDate(preset.updated_at)} />
              <Field label="Record ID" value={preset.id} mono />
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
