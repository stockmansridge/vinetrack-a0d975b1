import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { refreshCatalogueCopies, useCatalogueFreshness } from "@/lib/chemicalCatalogueFreshness";
import { useCatalogueReference } from "@/lib/chemicalCatalogueReference";

/** Server-owned auto-sync: this surface only checks and refreshes reads. */
export function CatalogueLinkFreshness({ row, query, open, vineyardId }: {
  row: Record<string, any> | null | undefined;
  query: ReturnType<typeof useCatalogueReference>;
  open: boolean;
  vineyardId?: string | null;
}) {
  const client = useQueryClient();
  const confirmed = !query.isError && !query.isFetching && !query.isLoading && query.data?.state === "approved";
  const fresh = useCatalogueFreshness(row, vineyardId ?? row?.vineyard_id, query.data, open && confirmed);
  if (!confirmed) return null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3 text-xs" data-testid="catalogue-link-freshness">
      <div className="break-all"><span className="font-semibold">Saved vineyard revision: </span>{!fresh.isError && !fresh.isFetching ? fresh.data?.savedRevisionId ?? "Unavailable" : "Checking…"}</div>
      <div className="break-all"><span className="font-semibold">Current approved catalogue revision: </span>{query.data?.state === "approved" ? query.data.revision.id : "Unavailable"}</div>
      {fresh.isError ? <div role="alert">Saved catalogue link could not be checked. <Button type="button" size="sm" variant="outline" onClick={() => fresh.refetch()}>Retry link check</Button></div>
        : fresh.isFetching || fresh.isLoading ? <p>Checking saved catalogue link…</p>
        : fresh.data?.state === "current" ? <p>Current approved catalogue — automatically synchronised.</p>
        : fresh.data?.state === "review_required" ? <>
          <p role="alert">Review required — local catalogue fields differ</p>
          <p>This copy was not automatically advanced. Customised or unsynced catalogue content needs review. Its older saved rates are not the current approved catalogue rates.</p>
        </> : null}
      <p>Eligible copies update automatically after catalogue approval. Rate changes are available on the next device sync. Label ranges are not automatically selected; label restrictions, vineyard preferences and history are preserved.</p>
      <Button type="button" size="sm" variant="outline" disabled={fresh.isFetching || query.isFetching} onClick={() => void refreshCatalogueCopies(client, vineyardId ?? row?.vineyard_id)}>Refresh catalogue status</Button>
    </div>
  );
}