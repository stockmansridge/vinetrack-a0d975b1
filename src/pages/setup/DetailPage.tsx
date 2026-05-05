import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { fetchOne } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown } from "lucide-react";

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
                <Field key={k} k={k} v={v} />
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

function Field({ k, v }: { k: string; v: any }) {
  const isObj = v != null && typeof v === "object";
  return (
    <div className={isObj ? "sm:col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="text-sm font-medium break-words">
        {isObj ? <JsonField value={v} /> : <Scalar v={v} />}
      </dd>
    </div>
  );
}

function Scalar({ v }: { v: any }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  return <span>{String(v)}</span>;
}

function JsonField({ value }: { value: any }) {
  const [open, setOpen] = useState(false);
  const summary = Array.isArray(value)
    ? `${value.length} item${value.length === 1 ? "" : "s"}`
    : `${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
        >
          <span>{summary}</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-80 overflow-auto rounded border bg-background p-2 text-[11px] leading-tight font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(value, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
