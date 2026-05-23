import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Fragment } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { DraggableHeaderCell } from "@/components/table/DraggableHeaderCell";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";

import type { ReactNode } from "react";

export interface ListColumn {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
  filterValue?: (row: any) => string;
  className?: string;
  /** When true, this column is pinned and cannot be reordered. */
  locked?: "start" | "end";
}

interface Props {
  table: string;
  title: string;
  description?: string;
  columns: ListColumn[];
  basePath: string; // e.g. /setup/paddocks
  /** Stable id used to persist column order preference. Defaults to `<table>_table`. */
  tableId?: string;
}

export default function ListPage({ table, title, description, columns, basePath, tableId }: Props) {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");

  const lockedStart = columns.filter((c) => c.locked === "start");
  const lockedEnd = columns.filter((c) => c.locked === "end");
  const movable = columns.filter((c) => !c.locked);
  const defaultOrder = useMemo(() => movable.map((c) => c.key), [movable]);
  const { order, moveColumn, reset } = useColumnOrder(
    tableId ?? `${table}_table`,
    defaultOrder,
    { vineyardId: selectedVineyardId },
  );
  const columnsById = useMemo(() => {
    const m = new Map<string, ListColumn>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);
  const orderedMovable = useMemo(
    () => order.map((id) => columnsById.get(id)).filter(Boolean) as ListColumn[],
    [order, columnsById],
  );
  const finalColumns = useMemo(
    () => [...lockedStart, ...orderedMovable, ...lockedEnd],
    [lockedStart, orderedMovable, lockedEnd],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["list", table, selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList(table, selectedVineyardId!),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r: any) =>
      columns.some((c) => {
        const v = c.filterValue ? c.filterValue(r) : r[c.key];
        return String(v ?? "").toLowerCase().includes(f);
      }),
    );
  }, [data, filter, columns]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-end gap-2">
          <Input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
          <ColumnSettingsMenu onReset={reset} />
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {finalColumns.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.locked ? (
                    c.label
                  ) : (
                    <DraggableHeaderCell columnId={c.key} onDropColumn={moveColumn}>
                      {c.label}
                    </DraggableHeaderCell>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="text-center text-muted-foreground py-8">
                  No records found. If expected records are missing, check that the selected
                  vineyard is correct and that this user has owner/manager access.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r: any) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`${basePath}/${r.id}`)}
              >
                {finalColumns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.render ? c.render(r) : formatCell(r[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function formatCell(v: any) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export { formatCell };
