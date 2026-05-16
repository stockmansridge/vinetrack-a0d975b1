import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDiagnosticPanel } from "@/lib/systemAdmin";
import {
  buildVarietyMap,
  resolvePaddockAllocations,
  type GrapeVariety,
} from "@/lib/varietyResolver";

interface PaddockLike {
  id: string;
  name: string | null;
  variety_allocations?: unknown;
}

export default function VarietyResolverDiagnostics({
  paddocks,
  grapeVarieties,
}: {
  paddocks: PaddockLike[];
  grapeVarieties: GrapeVariety[] | undefined;
}) {
  const show = useDiagnosticPanel("show_raw_json_panels");
  const rows = useMemo(() => {
    const map = buildVarietyMap(grapeVarieties);
    return paddocks.map((p) => {
      const arr = Array.isArray(p.variety_allocations)
        ? (p.variety_allocations as any[])
        : [];
      const resolved = resolvePaddockAllocations(p.variety_allocations, map);
      return {
        paddock_id: p.id,
        paddock_name: p.name,
        raw: arr,
        allocations: arr.map((a: any, i) => ({
          index: i,
          id: a?.id ?? null,
          varietyId: a?.varietyId ?? a?.variety_id ?? null,
          name: a?.name ?? null,
          varietyName: a?.varietyName ?? a?.variety_name ?? null,
          resolvedName: resolved[i]?.name ?? null,
          resolverPath: resolved[i]?.resolverPath ?? "unresolved",
        })),
      };
    });
  }, [paddocks, grapeVarieties]);

  if (!show) return null;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Variety resolver diagnostics
          <Badge variant="outline">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-[10px] leading-tight overflow-auto max-h-96 bg-muted/40 p-2 rounded">
          {JSON.stringify(rows, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
