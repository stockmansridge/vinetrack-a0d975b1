import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { ReactNode } from "react";

export interface ListColumn {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
  filterValue?: (row: any) => string;
  className?: string;
}

interface Props {
  table: string;
  title: string;
  description?: string;
  columns: ListColumn[];
  basePath: string; // e.g. /setup/paddocks
}

export default function ListPage({ table, title, description, columns, basePath }: Props) {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");

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
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64"
        />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
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
                {columns.map((c) => (
                  <TableCell key={c.key}>{formatCell(r[c.key])}</TableCell>
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
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
