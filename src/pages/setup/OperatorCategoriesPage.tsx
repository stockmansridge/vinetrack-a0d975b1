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
  fetchOperatorCategoriesForVineyard,
  type OperatorCategory,
} from "@/lib/operatorCategoriesQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v?: number | null) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h`;

export default function OperatorCategoriesPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<OperatorCategory | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["operator_categories", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });

  const categories = data?.categories ?? [];

  const rows = useMemo(() => {
    let list = categories.slice();
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.cost_per_hour].some((v) =>
          String(v ?? "").toLowerCase().includes(f),
        ),
      );
    }
    return list;
  }, [categories, filter]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[OperatorCategoriesPage] diagnostics", {
      selectedVineyardId,
      operatorCategoriesCount: categories.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      deletedExcluded: data?.deletedExcluded ?? 0,
      missingDisplayFields: {
        missingName: data?.missingName ?? 0,
        missingCost: data?.missingCost ?? 0,
      },
      schemaGaps: [
        "no global/shared category table (vineyard-scoped only)",
        "no description / sort_order / colour / icon columns",
        "no foreign key from operators to category — linked operator count not safely available",
        "no archive/active flag (only deleted_at)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Operator categories</h1>
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
            placeholder="Name or cost…"
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
              <TableHead>Cost per hour</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={3} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  No operator categories found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                <TableCell>{fmtMoney(c.cost_per_hour)}</TableCell>
                <TableCell>{fmtDate(c.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CategorySheet category={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function CategorySheet({
  category,
  open,
  onOpenChange,
}: {
  category: OperatorCategory | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{category?.name ?? "Operator category"}</SheetTitle>
        </SheetHeader>
        {category && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Details">
              <Field label="Name" value={fmt(category.name)} />
              <Field label="Cost per hour" value={fmtMoney(category.cost_per_hour)} />
            </Section>
            <Section title="Meta">
              <Field label="Created" value={fmtDate(category.created_at)} />
              <Field label="Updated" value={fmtDate(category.updated_at)} />
              <Field label="Record ID" value={category.id} mono />
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
