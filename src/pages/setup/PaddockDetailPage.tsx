import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { fetchOne } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  deriveMetrics,
  parsePolygonPoints,
  parseRows,
} from "@/lib/paddockGeometry";
import { PaddockDetailContent } from "@/components/PaddockDetailPanel";

export default function PaddockDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["detail", "paddocks", id],
    enabled: !!id,
    queryFn: () => fetchOne("paddocks", id!),
  });

  const polygon = parsePolygonPoints((data as any)?.polygon_points);
  const parsedRows = parseRows((data as any)?.rows);
  const rawRows = Array.isArray((data as any)?.rows) ? (data as any).rows.length : 0;
  const metrics = data ? deriveMetrics(data) : null;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/setup/paddocks">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to blocks
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{(data as any)?.name ?? "Block detail"}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-muted-foreground">Loading…</div>}
          {error && <div className="text-destructive">{(error as Error).message}</div>}
          {data && metrics && (
            <PaddockDetailContent
              paddock={data}
              metrics={metrics}
              parsedRowsCount={parsedRows.length}
              rawRowsCount={rawRows}
              polygonPointCount={polygon.length}
            />
          )}
          {!isLoading && !data && !error && (
            <div className="text-muted-foreground">Not found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
