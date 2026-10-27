// Compare tab — lab-status matrix of analytes × blocks for a sample period.
// Mixed methods/units for the same analyte are flagged, never blended.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listBlockPeriodResults,
  listAnalyteCatalogue,
  buildCompareMatrix,
  labStatusLabel,
} from "@/lib/soilAnalysis";

const db = supabase as any;

const STATUS_CLASS: Record<string, string> = {
  low: "border-warning/50 bg-warning/10 text-warning-foreground",
  within_range: "border-primary/40 bg-primary/10 text-primary",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function CompareTab() {
  const { selectedVineyardId } = useVineyard();
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", selectedVineyardId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const analytesQuery = useQuery({
    queryKey: ["soil-analysis", "analytes"],
    queryFn: listAnalyteCatalogue,
  });

  const resultsQuery = useQuery({
    queryKey: ["soil-analysis", "compare", selectedBlocks, dateFrom, dateTo],
    enabled: selectedBlocks.length > 0,
    queryFn: () => listBlockPeriodResults(selectedBlocks, dateFrom || null, dateTo || null),
  });

  const blocks = blocksQuery.data ?? [];
  const analytes = analytesQuery.data ?? [];
  const rows = resultsQuery.data ?? [];

  const analyteKeys = useMemo(() => {
    const present = new Set(rows.map((r) => r.analyte_key).filter(Boolean) as string[]);
    return analytes.filter((a) => present.has(a.analyte_key)).map((a) => a.analyte_key);
  }, [rows, analytes]);

  const matrix = useMemo(
    () => buildCompareMatrix(rows, selectedBlocks, analyteKeys),
    [rows, selectedBlocks, analyteKeys],
  );

  const analyteName = (key: string) =>
    analytes.find((a) => a.analyte_key === key)?.display_name ?? key;
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? "Block";

  const toggleBlock = (id: string) =>
    setSelectedBlocks((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Blocks:</span>
            {blocks.map((b) => (
              <Button
                key={b.id}
                size="sm"
                variant={selectedBlocks.includes(b.id) ? "default" : "outline"}
                onClick={() => toggleBlock(b.id)}
              >
                {b.name}
              </Button>
            ))}
            {blocks.length === 0 && (
              <span className="text-sm text-muted-foreground">No blocks for the selected vineyard.</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Sample period:</span>
            <Input type="date" className="w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Period from" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" className="w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Period to" />
          </div>
        </CardContent>
      </Card>

      {selectedBlocks.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          Choose two or more blocks to compare their latest laboratory results.
        </div>
      ) : resultsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-6">Loading results…</div>
      ) : matrix.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          No measured analytes for the selected blocks in this period.
        </div>
      ) : (
        <Card className="overflow-auto">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Laboratory status by block</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Analyte</th>
                  {selectedBlocks.map((id) => (
                    <th key={id} className="px-4 py-2 font-medium">{blockName(id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row[0]?.analyteKey} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {analyteName(row[0]?.analyteKey ?? "")}
                      {row.some((c) => c.mixedMethods) && (
                        <Badge variant="outline" className="ml-2 border-warning/50 bg-warning/10 text-warning-foreground">
                          Mixed methods — not directly comparable
                        </Badge>
                      )}
                    </td>
                    {row.map((cell) => (
                      <td key={cell.paddockId} className="px-4 py-2">
                        {cell.result ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge
                              variant="outline"
                              className={STATUS_CLASS[cell.result.lab_status ?? ""] ?? ""}
                            >
                              {labStatusLabel(cell.result.lab_status)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {cell.result.value_numeric ?? cell.result.value_text ?? "—"}{" "}
                              {cell.result.unit ?? ""} · {cell.result.method ?? "method not recorded"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No result</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
