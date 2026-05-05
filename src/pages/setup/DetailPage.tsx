import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { fetchOne } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Props {
  table: string;
  title: string;
  basePath: string;
}

export default function DetailPage({ table, title, basePath }: Props) {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["detail", table, id],
    enabled: !!id,
    queryFn: () => fetchOne(table, id!),
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to={basePath}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-muted-foreground">Loading…</div>}
          {error && <div className="text-destructive">{(error as Error).message}</div>}
          {data && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {Object.entries(data).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-medium break-words">{format(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {!isLoading && !data && !error && (
            <div className="text-muted-foreground">Not found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function format(v: any) {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>;
  return String(v);
}
