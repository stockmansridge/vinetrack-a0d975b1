import { Button } from "@/components/ui/button";
import { useCatalogueFreshness } from "@/lib/chemicalCatalogueFreshness";
import { useCatalogueReference } from "@/lib/chemicalCatalogueReference";

/** No mutation exists here until a deployed optimistic update contract is verified. */
export function CatalogueLinkFreshness({ row, query, open, vineyardId }: {
  row: Record<string, any> | null | undefined;
  query: ReturnType<typeof useCatalogueReference>;
  open: boolean;
  vineyardId?: string | null;
}) {
  const confirmed = !query.isError && !query.isFetching && !query.isLoading && query.data?.state === "approved";
  const fresh = useCatalogueFreshness(row, vineyardId ?? row?.vineyard_id, query.data, open && confirmed);
  if (!confirmed) return null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3 text-xs" data-testid="catalogue-link-freshness">
      <div className="break-all"><span className="font-semibold">Saved vineyard revision: </span>{fresh.data?.savedRevisionId ?? row?.chemical_v3_revision_id ?? "Unavailable"}</div>
      <div className="break-all"><span className="font-semibold">Current approved catalogue revision: </span>{query.data?.state === "approved" ? query.data.revision.id : "Unavailable"}</div>
      {fresh.isError ? <div role="alert">Saved catalogue link could not be checked. <Button type="button" size="sm" variant="outline" onClick={() => fresh.refetch()}>Retry link check</Button></div>
        : fresh.isFetching || fresh.isLoading ? <p>Checking saved catalogue link…</p>
        : fresh.data?.state === "changed" ? <p role="alert">This chemical changed since opening. Close and reopen before updating catalogue information.</p>
        : fresh.data?.state === "current" ? <p>The saved chemical is linked to the current approved revision. No update needed.</p>
        : fresh.data?.state === "update_available" ? <>
          <p>A newer approved catalogue revision is available. The rates above are catalogue references; the saved vineyard copy still uses its older revision{fresh.data.savedRevisionStatus ? ` (${fresh.data.savedRevisionStatus})` : ""}.</p>
          <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal text-left" disabled>Update linked VineTrack catalogue information</Button>
          <p>Updating is unavailable until a verified secure server action checks the saved version and preserves vineyard selections and history.</p>
        </> : null}
    </div>
  );
}